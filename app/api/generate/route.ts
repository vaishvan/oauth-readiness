import { waitUntil } from '@vercel/functions';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runPipeline } from '@/lib/pipeline';
import { normalizeQuery, slugify } from '@/lib/pipeline/util';
import { rateLimit } from '@/lib/ratelimit';
import { createJob, dailySpendUsd, findRecentJob, getGuide } from '@/lib/repo';

export const maxDuration = 300;
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  query: z.string().trim().min(2).max(200),
  force: z.boolean().optional(),
  pinUrl: z.string().url().max(500).regex(/^https?:\/\//i, 'http(s) only').optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'query must be 2-200 characters' }, { status: 400 });
  const { force, pinUrl } = parsed.data;
  const query = normalizeQuery(parsed.data.query);
  const ttl = Number(process.env.CACHE_TTL_DAYS ?? 30) * 86_400_000;

  // cached: the query already names a fresh guide
  if (!force && !pinUrl) {
    const hit = await getGuide(slugify(query));
    if (hit && Date.now() - hit.updatedAt.getTime() < ttl) return NextResponse.json({ jobId: null, cached: hit.guide.slug }, { status: 200 });
    const dup = await findRecentJob(query);
    if (dup) return NextResponse.json({ jobId: dup }, { status: 202 });
  }

  if ((await dailySpendUsd()) >= Number(process.env.DAILY_BUDGET_USD ?? 15)) return NextResponse.json({ error: 'Demo budget reached' }, { status: 503 });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
  const rl = rateLimit(ip);
  if (!rl.ok) return NextResponse.json({ error: 'Rate limit: 5 live generations per hour' }, { status: 429, headers: { 'retry-after': String(rl.retryAfterSec) } });

  const jobId = await createJob(query);
  waitUntil(runPipeline(jobId, { query, force, pinUrl }));
  return NextResponse.json({ jobId }, { status: 202 });
}
