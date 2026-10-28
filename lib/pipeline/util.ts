import type { PipelineEvent } from '../schema';

export type Emit = (e: PipelineEvent) => Promise<void>;
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout;
  const timeout = new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)));
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

/** "Zoho CRM" -> zoho-crm, "https://www.pipedrive.com/x" -> pipedrive */
export function slugify(input: string): string {
  const s = input.trim().toLowerCase();
  const host = s.match(/^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})(?:[/?#:]|$)/);
  const base = host ? host[1].split('.')[0] : s;
  return base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

export const normalizeQuery = (q: string) => q.trim().toLowerCase().replace(/\s+/g, ' ');

/** Strip characters that could close our wrapper tags inside untrusted content. */
export const defang = (s: string) => s.replace(/<\/(doc|probe|item)/gi, '<\\/$1');
