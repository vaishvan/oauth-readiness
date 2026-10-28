import Firecrawl from '@mendable/firecrawl-js';
import { getScrape, putScrape } from './repo';
import { mockScrape, mockSearch } from './mock';

export type Hit = { url: string; title: string; description: string };

let client: Firecrawl | undefined;
const fc = () => (client ??= new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY }));
export const isMock = () => process.env.MOCK_PIPELINE === '1';

export async function search(query: string, limit = 5): Promise<Hit[]> {
  if (isMock()) return mockSearch(query, limit);
  const r = await fc().search(query, { limit });
  return (r.web ?? []).map((x: any) => ({ url: x.url, title: x.title ?? x.url, description: x.description ?? '' }));
}

/** Scrape to markdown, cached 7 days in Postgres. Returns null on failure (caller skips the URL). */
export async function scrape(url: string): Promise<{ title: string; markdown: string; cached: boolean } | null> {
  const hit = await getScrape(url);
  if (hit) return { title: hit.title, markdown: hit.markdown, cached: true };
  try {
    if (isMock()) {
      const r = await mockScrape(url);
      if (!r) return null;
      await putScrape(url, r.title, r.markdown);
      return { ...r, cached: false };
    }
    const d: any = await fc().scrape(url, { formats: ['markdown'], onlyMainContent: true, timeout: 15000 });
    if (!d?.markdown) return null;
    const title = d.metadata?.title ?? url;
    await putScrape(url, title, d.markdown);
    return { title, markdown: d.markdown, cached: false };
  } catch {
    return null;
  }
}
