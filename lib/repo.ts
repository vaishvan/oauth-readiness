import fs from 'node:fs';
import path from 'node:path';
import { and, desc, eq, gt, ilike, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, guides, jobs, scrapes, type Db } from './db';
import { Guide, type GuideSummary, type PipelineEvent } from './schema';

export function loadSeeds(): Guide[] {
  const dir = path.join(process.cwd(), 'seed', 'guides');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => Guide.parse(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))));
}

export async function upsertGuideOn(d: Db, g: Guide) {
  const row = { slug: g.slug, appName: g.appName, data: g, difficulty: g.verdict.difficulty, origin: g.meta.origin, updatedAt: new Date() };
  await d.insert(guides).values(row).onConflictDoUpdate({ target: guides.slug, set: row });
}
export const upsertGuide = async (g: Guide) => upsertGuideOn(await db(), g);

export async function getGuide(slug: string): Promise<{ guide: Guide; updatedAt: Date } | null> {
  const [r] = await (await db()).select().from(guides).where(eq(guides.slug, slug));
  return r ? { guide: r.data, updatedAt: r.updatedAt } : null;
}

export const domainOf = (g: Guide) => new URL(g.appUrl).hostname.replace(/^www\./, '');

export const summarize = (g: Guide): GuideSummary => ({
  slug: g.slug,
  appName: g.appName,
  domain: domainOf(g),
  difficulty: g.verdict.difficulty,
  label: g.verdict.label,
  timeToS1: g.verdict.timeToS1,
  timeToS3: g.verdict.timeToS3,
  composioManaged: g.composioManaged,
  origin: g.meta.origin,
  oneLiner: g.verdict.oneLiner,
});

export async function listGuides(f: { q?: string; difficulty?: number; origin?: string } = {}): Promise<GuideSummary[]> {
  const conds = [];
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, '\\$&')}%`;
    conds.push(or(ilike(guides.appName, like), ilike(guides.slug, like)));
  }
  if (f.difficulty) conds.push(eq(guides.difficulty, f.difficulty));
  if (f.origin === 'seed' || f.origin === 'live') conds.push(eq(guides.origin, f.origin));
  const rows = await (await db())
    .select({ data: guides.data })
    .from(guides)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(guides.difficulty, guides.appName)
    .limit(200);
  return rows.map((r) => summarize(r.data));
}

// ---- jobs ----
export type Job = typeof jobs.$inferSelect;

export async function createJob(query: string): Promise<string> {
  const id = nanoid(12);
  await (await db()).insert(jobs).values({ id, query, status: 'queued' });
  return id;
}
export async function getJob(id: string): Promise<Job | null> {
  const [r] = await (await db()).select().from(jobs).where(eq(jobs.id, id));
  return r ?? null;
}
export async function updateJob(id: string, set: Partial<Pick<Job, 'status' | 'stage' | 'guideSlug' | 'error'>>) {
  await (await db()).update(jobs).set(set).where(eq(jobs.id, id));
}
export async function appendEvent(id: string, ev: PipelineEvent) {
  await (await db()).execute(sql`update jobs set events = events || ${JSON.stringify([ev])}::jsonb where id = ${id}`);
}
export async function setChoice(id: string, i: number) {
  await (await db()).update(jobs).set({ choice: i }).where(eq(jobs.id, id));
}
export async function findRecentJob(query: string, withinMs = 5 * 60_000): Promise<string | null> {
  const [r] = await (await db())
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.query, query), gt(jobs.createdAt, new Date(Date.now() - withinMs)), or(eq(jobs.status, 'queued'), eq(jobs.status, 'running'), eq(jobs.status, 'done'))))
    .orderBy(desc(jobs.createdAt))
    .limit(1);
  return r?.id ?? null;
}

// ---- budget + scrape cache ----
export async function dailySpendUsd(): Promise<number> {
  const r: any = await (await db()).execute(
    sql`select coalesce(sum((data->'meta'->>'costUsd')::float), 0) as s from guides where origin = 'live' and updated_at > now() - interval '1 day'`,
  );
  return Number(r.rows?.[0]?.s ?? 0);
}

export async function getScrape(url: string, maxAgeMs = 7 * 86_400_000) {
  const [r] = await (await db()).select().from(scrapes).where(and(eq(scrapes.url, url), gt(scrapes.fetchedAt, new Date(Date.now() - maxAgeMs))));
  return r ?? null;
}
export async function putScrape(url: string, title: string, markdown: string) {
  const row = { url, title, markdown, fetchedAt: new Date() };
  await (await db()).insert(scrapes).values(row).onConflictDoUpdate({ target: scrapes.url, set: row });
}
