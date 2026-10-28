import dns from 'node:dns/promises';
import net from 'node:net';
import type { PipelineEvent } from '../schema';

type ProbeEvent = Extract<PipelineEvent, { type: 'probe' }>;
export type ProbeResult = {
  events: ProbeEvent[];
  facts: { authorizationEndpoint?: string; tokenEndpoint?: string; scopesSupported?: string[]; pkce?: 'yes' | 'no' | 'unknown' };
};

const UA = 'OAuthReadinessBot/1.0 (+https://github.com/oauth-readiness)';

/** Block loopback, private, link-local, CGNAT and unspecified addresses (v4, v6 and v4-mapped v6). */
export function isPrivateIp(ip: string): boolean {
  const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]);
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    return l === '::1' || l === '::' || /^f[cd]/.test(l) || /^fe[89ab]/.test(l);
  }
  return true; // not an IP we understand: refuse
}

export async function assertPublicHost(host: string): Promise<void> {
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error(`blocked private address ${host}`);
    return;
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) throw new Error(`blocked host ${host}`);
  // ponytail: resolve-then-fetch leaves a DNS-rebinding window; pin the resolved IP with a custom dispatcher if this goes beyond a demo.
  const addrs = await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error(`blocked host ${host} (resolves to a private address)`);
}

const underSuffix = (host: string, d: string) => host === d || host.endsWith('.' + d);

/** GET only: http(s), public IPs on every redirect hop, optional host-suffix restriction, 5 s timeout, body capped at 64 KB. */
export async function safeGet(url: string, opts: { suffix?: string; hops?: number } = {}): Promise<{ status: number; location?: string; body: string; url: string }> {
  let cur = url;
  for (let hop = 0; hop <= (opts.hops ?? 3); hop++) {
    const u = new URL(cur);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`blocked scheme ${u.protocol}`);
    if (opts.suffix && !underSuffix(u.hostname.toLowerCase(), opts.suffix)) throw new Error(`host ${u.hostname} is outside ${opts.suffix}`);
    await assertPublicHost(u.hostname.replace(/^\[|\]$/g, ''));
    const res = await fetch(cur, { method: 'GET', redirect: 'manual', headers: { 'user-agent': UA, accept: 'application/json,text/html;q=0.8,*/*;q=0.5' }, signal: AbortSignal.timeout(5000) });
    const location = res.headers.get('location') ?? undefined;
    if (res.status >= 300 && res.status < 400 && location) {
      cur = new URL(location, cur).toString();
      continue;
    }
    return { status: res.status, location, body: await readCapped(res), url: cur };
  }
  throw new Error('too many redirects');
}

async function readCapped(res: Response, cap = 65_536): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  while (n < cap) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.length;
  }
  await reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString('utf8').slice(0, cap);
}

export async function probeDiscovery(domain: string): Promise<ProbeResult> {
  if (process.env.MOCK_PIPELINE === '1') return mockProbe();
  const res: ProbeResult = { events: [], facts: {} };
  const bases = [`https://${domain}`, `https://api.${domain}`];
  const paths = ['/.well-known/openid-configuration', '/.well-known/oauth-authorization-server'];
  const urls = bases.flatMap((b) => paths.map((p) => b + p));
  const found = await Promise.all(
    urls.map(async (u) => {
      try {
        const r = await safeGet(u, { suffix: domain });
        const j = r.status === 200 ? JSON.parse(r.body) : null;
        return j && typeof j.authorization_endpoint === 'string' ? { u, j } : null;
      } catch {
        return null;
      }
    }),
  );
  const hit = found.find(Boolean);
  if (!hit) {
    res.events.push({ type: 'probe', check: 'oidc', ok: false, detail: `No OIDC or OAuth discovery document under ${domain} (tried ${urls.length} URLs)` });
    return res;
  }
  const { u, j } = hit;
  const methods: string[] = Array.isArray(j.code_challenge_methods_supported) ? j.code_challenge_methods_supported : [];
  res.facts = {
    authorizationEndpoint: j.authorization_endpoint,
    tokenEndpoint: typeof j.token_endpoint === 'string' ? j.token_endpoint : undefined,
    scopesSupported: Array.isArray(j.scopes_supported) ? j.scopes_supported.slice(0, 50) : undefined,
    pkce: methods.length ? (methods.includes('S256') ? 'yes' : 'no') : 'unknown',
  };
  res.events.push({ type: 'probe', check: 'oidc', ok: true, detail: `Discovery found at ${u} · PKCE: ${methods.length ? methods.join(', ') : 'not advertised'}` });
  // unauthenticated authorize request with a bogus client id: proves the endpoint is live, creates nothing
  try {
    const q = `${j.authorization_endpoint}${String(j.authorization_endpoint).includes('?') ? '&' : '?'}client_id=probe_invalid&response_type=code&redirect_uri=https://example.com/cb`;
    const r = await safeGet(q);
    const err = r.body.match(/invalid_client|unauthorized_client|invalid_request|redirect_uri_mismatch|invalid_redirect_uri/i)?.[0];
    res.events.push({ type: 'probe', check: 'authorize', ok: r.status < 500, detail: `Authorize endpoint answered HTTP ${r.status}${err ? ` with ${err}` : ''}` });
  } catch (e: any) {
    res.events.push({ type: 'probe', check: 'authorize', ok: false, detail: `Authorize probe failed: ${e.message}` });
  }
  return res;
}

/** Console probe: is the developer console behind a sign-in? Run after extract, once the console URL is known. */
export async function probeConsole(url: string, domain: string): Promise<ProbeEvent> {
  if (process.env.MOCK_PIPELINE === '1') return { type: 'probe', check: 'console', ok: true, detail: `Console ${url} redirects to a sign-in page (mock)` };
  try {
    const r = await safeGet(url, { suffix: domain.split('.').slice(-2).join('.'), hops: 0 });
    const login = /login|signin|sign-in|auth|sso/i.test(r.location ?? '') || /type=["']password["']/i.test(r.body);
    return { type: 'probe', check: 'console', ok: true, detail: `GET ${url} → HTTP ${r.status}${r.location ? ` → ${r.location.slice(0, 80)}` : ''}${login ? ' · behind sign-in' : ''}` };
  } catch (e: any) {
    return { type: 'probe', check: 'console', ok: false, detail: `Console probe skipped: ${e.message}` };
  }
}

function mockProbe(): ProbeResult {
  return {
    events: [
      { type: 'probe', check: 'oidc', ok: true, detail: 'Discovery found (mock) · PKCE: S256' },
      { type: 'probe', check: 'authorize', ok: true, detail: 'Authorize endpoint answered HTTP 400 with invalid_client (mock)' },
    ],
    facts: { authorizationEndpoint: 'https://example.invalid/authorize', pkce: 'yes' },
  };
}

export const probeSummary = (r: ProbeResult) =>
  r.events.map((e) => `${e.check}: ${e.ok ? 'ok' : 'failed'} - ${e.detail}`).join('\n') +
  (r.facts.scopesSupported ? `\nscopes_supported: ${r.facts.scopesSupported.join(' ')}` : '');
