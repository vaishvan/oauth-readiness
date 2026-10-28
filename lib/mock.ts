// Canned search/scrape/LLM used when MOCK_PIPELINE=1 so the whole pipeline, API and UI run without API keys.
// Special app names exercise failure paths: "mercury" = ambiguous, "broken" = invalid refs fixed by repair,
// "stubborn" = invalid refs never fixed (publish with warnings), "thin" = too little documentation.
type Hit = { url: string; title: string; description: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const delay = () => sleep(Number(process.env.MOCK_DELAY_MS ?? 120));
const mslug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

const quotes = (App: string) => [
  `${App} OAuth apps are created in the developer console under Settings.`,
  'The redirect URI must match exactly or authorization fails with redirect_uri_mismatch.',
  'Access tokens expire after 1 hour and a refresh token is returned.',
  'Apps that are not listed are limited to 25 installs until the listing is approved.',
  'Marketplace review usually takes 2 to 4 weeks.',
];

export async function mockSearch(q: string, limit: number): Promise<Hit[]> {
  await delay();
  const app = q.replace(/"/g, '').split(/ (?:developer|OAuth|create|app review)/i)[0].trim();
  const s = mslug(app);
  const h = (p: string, t: string): Hit => ({ url: `https://developers.${s}.com/docs/${p}`, title: `${title(app)} ${t}`, description: `${t} for ${app}` });
  let out: Hit[];
  if (/developer API OAuth/i.test(q)) out = [{ url: `https://www.${s}.com/`, title: `${title(app)} home`, description: 'home' }, h('oauth', 'OAuth')];
  else if (/documentation/i.test(q)) out = [h('oauth', 'OAuth'), h('scopes', 'Scopes')];
  else if (/register/i.test(q)) out = [h('register-app', 'Register an app'), h('oauth', 'OAuth')];
  else if (/review/i.test(q)) out = [h('app-review', 'App review'), { url: `https://medium.com/${s}-oauth-tips?utm=1#x`, title: 'OAuth tips', description: 'blog' }];
  else out = [h('scopes', 'Scopes'), { url: `https://stackoverflow.com/q/${s}`, title: 'SO question', description: 'q' }];
  return out.slice(0, limit);
}

export async function mockScrape(url: string): Promise<{ title: string; markdown: string } | null> {
  await delay();
  const u = new URL(url);
  const s = u.hostname.replace(/^(developers|www)\./, '').replace(/\.com$/, '');
  const App = title(s);
  if (/thin/.test(s)) return null;
  const p = u.pathname.split('/').pop() || '';
  const Q = quotes(App);
  const body: Record<string, string[]> = {
    oauth: [Q[0], Q[1], Q[2]],
    'register-app': [Q[0], Q[1]],
    'app-review': [Q[3], Q[4]],
    scopes: [Q[2], `Scopes: read, write, admin.`],
  };
  const lines = body[p] ?? [`${App} community note: OAuth setup can be fiddly.`];
  return { title: `${App} ${p || 'page'}`, markdown: `# ${App} ${p}\n\n${lines.join('\n\n')}\n` };
}

export async function mockTool(name: string, user: string, onPartial?: (p: any) => void): Promise<unknown> {
  await delay();
  if (name === 'resolve_app') {
    const input = (user.match(/INPUT: (.*)/)?.[1] ?? 'app').trim();
    if (/mercury/i.test(input))
      return { appName: 'Mercury', domain: 'mercury.com', slug: 'mercury', oauthLikely: true, ambiguous: true, candidates: [{ appName: 'Mercury Bank', domain: 'mercury.com' }, { appName: 'Mercury Mail', domain: 'getmercury.app' }] };
    const host = input.match(/^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+)\.[a-z.]+/i);
    const nm = title((host ? host[1] : input).replace(/[^a-z0-9 -]/gi, '').trim());
    return { appName: nm, domain: `${mslug(nm)}.com`, slug: nm.toLowerCase().replace(/[^a-z0-9]+/g, '-'), devDocsHost: `developers.${mslug(nm)}.com`, oauthLikely: true, ambiguous: false, candidates: [] };
  }
  if (name === 'judge_claims') {
    const ids = [...user.matchAll(/<item id="([^"]+)">([\s\S]*?)<\/item>/g)];
    return { verdicts: ids.map((m) => ({ claimId: m[1], verdict: /never expire/.test(m[2]) ? 'contradicts' : /takes 2 weeks/.test(m[2]) ? 'partial' : 'supports' })) };
  }
  if (name !== 'submit_guide') throw new Error(`mock: unknown tool ${name}`);

  const app = user.match(/<app name="([^"]+)" domain="([^"]+)" slug="([^"]+)"/)!;
  const [, App, domain, slug] = app;
  const docs = [...user.matchAll(/<doc id="(src_\d+)" url="([^"]+)" publisher="([^"]+)">([\s\S]*?)<\/doc>/g)].map((m) => ({ id: m[1], url: m[2], publisher: m[3], text: m[4] }));
  const Q = quotes(App);
  const src = (q: string) => docs.find((d) => d.text.includes(q))?.id;
  const claim = (id: string, text: string, q: string, fallbackKind: 'unverified' = 'unverified') => {
    const sid = src(q);
    return sid
      ? { id, text, confidence: 0.9, evidence: { kind: 'sourced' as const, sourceIds: [sid], quote: q } }
      : { id, text, confidence: 0.5, evidence: { kind: fallbackKind, sourceIds: [] } };
  };
  const broken = /broken|stubborn/i.test(App) && !(/stubborn/i.test(App) ? false : /failed (validation|invariant)/.test(user));
  const claims = [
    claim('clm_1', `Apps are created in the ${App} developer console`, Q[0]),
    claim('clm_2', 'Redirect URI must match exactly', Q[1]),
    claim('clm_3', 'Access tokens last 1 hour and refresh tokens exist', Q[2]),
    claim('clm_4', 'Unlisted apps are capped at 25 installs', Q[3]),
    claim('clm_5', 'Marketplace review takes 2 to 4 weeks', Q[4]),
    { id: 'clm_6', text: 'Review might need three weeks', confidence: 0.9, evidence: { kind: 'sourced' as const, sourceIds: [docs[0].id], quote: 'reviews run roughly three weeks' } },
    { id: 'clm_7', text: 'Tokens never expire', confidence: 0.9, evidence: { kind: 'sourced' as const, sourceIds: [src(Q[2]) ?? docs[0].id], quote: Q[2] } },
    { id: 'clm_8', text: 'Console needs sign-in', confidence: 0.4, evidence: { kind: 'unverified' as const, sourceIds: [] } },
  ];
  const step = (n: number, stage: 'S0' | 'S1' | 'S2' | 'S3', t: string, owner: 'agent' | 'you' | 'provider', lo: number, hi: number, ids: string[], wait?: [number, number]) => ({
    id: `stp_${n}`, stage, title: t, detail: `${t} for ${App}.`, owner, estMinutes: { low: lo, high: hi }, claimIds: ids,
    ...(wait ? { waitDays: { low: wait[0], high: wait[1] } } : {}),
  });
  const steps = [
    step(1, 'S0', 'Read the OAuth docs', 'agent', 2, 5, ['clm_1']),
    step(2, 'S0', 'Create an app in the console', 'you', 5, 10, ['clm_1', 'clm_8']),
    step(3, 'S1', 'Add the redirect URI', 'agent', 1, 2, broken ? ['clm_999'] : ['clm_2']),
    step(4, 'S1', 'Run the authorization flow', 'you', 5, 10, ['clm_3']),
    step(5, 'S2', 'Invite testers within the install cap', 'you', 5, 15, ['clm_4']),
    step(6, 'S3', 'Draft the listing answers', 'agent', 10, 20, ['clm_5']),
    step(7, 'S3', 'Wait for marketplace review', 'provider', 0, 0, ['clm_5', 'clm_6'], [14, 28]),
  ];
  const guide = {
    schemaVersion: 1, slug, appName: App, appUrl: `https://www.${domain}/`,
    developerConsoleUrl: `https://developers.${domain}/apps`, docsUrl: `https://developers.${domain}/docs/oauth`,
    oauthVersion: 'oauth2', pkceSupported: 'unknown', refreshTokens: 'yes', composioManaged: 'unknown',
    verdict: {
      difficulty: 1, label: 'Instant', oneLiner: `${App}: quick to start, capped until the listing is approved.`,
      timeToS1: { lowMin: 0, highMin: 0 }, timeToS3: { lowDays: 0, highDays: 0, hasReview: false },
      s2Limit: '25 installs until the listing is approved', agentShare: 0,
    },
    scopes: [{ name: 'read', tier: 'basic' }, { name: 'admin', tier: 'sensitive' }],
    requirements: [{ id: 'req_1', label: 'Developer account', category: 'account', requiredAt: 'S0', claimIds: ['clm_1'] }],
    steps,
    blockers: [{ id: 'blk_1', symptom: 'redirect_uri_mismatch', cause: 'Redirect URI differs from the registered one.', fix: 'Register the exact URI.', claimIds: ['clm_2'] }],
    claims, sources: docs.map((d) => ({ id: d.id, url: d.url, title: `${App} ${d.url.split('/').pop()}`, publisher: d.publisher, fetchedAt: new Date().toISOString() })),
    uncertainties: ['Mock run: not real documentation.'],
  };
  if (onPartial) {
    onPartial({ verdict: guide.verdict });
    for (let i = 1; i <= steps.length; i++) { await sleep(40); onPartial({ verdict: guide.verdict, steps: steps.slice(0, i) }); }
    onPartial({ ...guide });
  }
  return guide;
}
