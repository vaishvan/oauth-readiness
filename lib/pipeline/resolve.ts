import { z } from 'zod';
import { search } from '../firecrawl';
import { MODEL_FAST, callTool, type Usage } from '../llm';
import { prompt } from '../prompts';
import { defang, slugify, withTimeout } from './util';

const Host = z.string().min(3).max(120).transform((s) => s.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]);

export const Resolved = z.object({
  appName: z.string().min(1).max(80),
  domain: Host,
  slug: z.string().regex(/^[a-z0-9-]{2,60}$/),
  devDocsHost: Host.optional(),
  oauthLikely: z.boolean(),
  ambiguous: z.boolean(),
  candidates: z.array(z.object({ appName: z.string().max(80), domain: Host })).max(3).default([]),
});
export type Resolved = z.infer<typeof Resolved>;

export async function resolve(query: string, usage: Usage): Promise<Resolved> {
  let hits: Awaited<ReturnType<typeof search>> = [];
  try {
    hits = await search(`"${query}" developer API OAuth`, 5);
  } catch {
    // resolve can still work from the name alone
  }
  const list = hits.map((h) => `- ${h.title} | ${h.url} | ${h.description.slice(0, 160)}`).join('\n');
  const r = await withTimeout(callTool({
    model: MODEL_FAST(),
    system: prompt('resolve.v1'),
    user: defang(`INPUT: ${query}\nSEARCH RESULTS:\n${list}`),
    tool: { name: 'resolve_app', description: 'Identify the app the user means', schema: Resolved },
    maxTokens: 300,
    usage,
  }), 5500, 'resolve model').catch(() => fallback(query, hits)); // weak models sometimes skip the tool; never fail the job here
  return { ...r, slug: slugify(r.slug) || slugify(r.appName) };
}

/** Deterministic resolve from the query and search hits, used when the model call fails. */
export function fallback(query: string, hits: { url: string }[]): Resolved {
  const slug = slugify(query) || 'app';
  const key = slug.split('-')[0];
  const hosts = hits.map((h) => { try { return new URL(h.url).hostname.replace(/^www\./, ''); } catch { return ''; } });
  const own = hosts.find((h) => h.split('.').some((p) => p === key || p.startsWith(key)));
  const domain = own ? own.split('.').slice(-2).join('.') : `${key}.com`;
  const appName = /^https?:|\./.test(query) ? key.replace(/^./, (c) => c.toUpperCase()) : query.trim().replace(/\b\w/g, (c) => c.toUpperCase());
  return { appName, domain, slug, devDocsHost: own && own !== domain ? own : undefined, oauthLikely: true, ambiguous: false, candidates: [] };
}
