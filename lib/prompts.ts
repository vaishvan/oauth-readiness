import fs from 'node:fs';
import path from 'node:path';

const cache = new Map<string, string>();
/** Prompts live in lib/pipeline/prompts/<name>.md; the version is in the filename and logged in meta. */
export function prompt(name: string, vars: Record<string, string> = {}): string {
  let t = cache.get(name);
  if (!t) cache.set(name, (t = fs.readFileSync(path.join(process.cwd(), 'lib', 'pipeline', 'prompts', `${name}.md`), 'utf8')));
  return t.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}
