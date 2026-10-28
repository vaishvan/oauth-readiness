import { sql } from 'drizzle-orm';
import { integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { Guide, PipelineEvent } from './schema';

export const guides = pgTable('guides', {
  slug: text('slug').primaryKey(),
  appName: text('app_name').notNull(),
  data: jsonb('data').$type<Guide>().notNull(),
  difficulty: integer('difficulty').notNull(), // denormalized for sorting
  origin: text('origin').notNull(), // 'seed' | 'live'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const jobs = pgTable('jobs', {
  id: text('id').primaryKey(),
  query: text('query').notNull(),
  status: text('status').notNull(), // queued|running|done|failed
  stage: text('stage'),
  events: jsonb('events').$type<PipelineEvent[]>().default([]).notNull(),
  guideSlug: text('guide_slug'),
  error: text('error'),
  choice: integer('choice'), // user's pick when the pipeline asked needs_choice
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const scrapes = pgTable('scrapes', {
  url: text('url').primaryKey(),
  title: text('title').notNull(),
  markdown: text('markdown').notNull(),
  fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
});

const DDL = [
  `create table if not exists guides (slug text primary key, app_name text not null, data jsonb not null, difficulty integer not null, origin text not null, created_at timestamp not null default now(), updated_at timestamp not null default now())`,
  `create table if not exists jobs (id text primary key, query text not null, status text not null, stage text, events jsonb not null default '[]'::jsonb, guide_slug text, error text, choice integer, created_at timestamp not null default now())`,
  `create table if not exists scrapes (url text primary key, title text not null, markdown text not null, fetched_at timestamp not null default now())`,
];

export type Db = PgDatabase<any, any, any>;

async function init(): Promise<Db> {
  let d: any;
  if (process.env.DATABASE_URL) {
    const { neon } = await import('@neondatabase/serverless');
    const { drizzle } = await import('drizzle-orm/neon-http');
    d = drizzle(neon(process.env.DATABASE_URL));
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    d = drizzle(new PGlite(process.env.PGLITE_DIR ?? '.data/pg')); // ponytail: embedded Postgres for local runs; Neon in prod
  }
  for (const q of DDL) await d.execute(sql.raw(q));
  if (!process.env.DATABASE_URL) await seedIfEmpty(d);
  return d;
}

async function seedIfEmpty(d: Db) {
  const [{ n }] = (await d.select({ n: sql<number>`count(*)::int` }).from(guides)) as { n: number }[];
  if (n > 0) return;
  const { loadSeeds, upsertGuideOn } = await import('./repo');
  for (const g of loadSeeds()) await upsertGuideOn(d, g);
}

const g = globalThis as unknown as { __oauthDb?: Promise<Db> };
export const db = (): Promise<Db> => (g.__oauthDb ??= init());
