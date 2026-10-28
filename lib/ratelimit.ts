// ponytail: in-memory per-instance counter, matches the PRD. Move to Postgres/Redis if the demo runs on >1 instance.
const hits = new Map<string, number[]>();

export function rateLimit(ip: string, limit = Number(process.env.RATE_LIMIT_PER_HOUR ?? 5), now = Date.now()) {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= limit) {
    hits.set(ip, recent);
    return { ok: false as const, retryAfterSec: Math.ceil((recent[0] + 3_600_000 - now) / 1000) };
  }
  recent.push(now);
  hits.set(ip, recent);
  return { ok: true as const };
}

export const _resetRateLimit = () => hits.clear();
