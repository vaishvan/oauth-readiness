import { guideToMarkdown } from '@/lib/markdown';
import { getGuide } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = /^[a-z0-9-]{2,60}$/.test(slug) ? await getGuide(slug) : null;
  if (!r) return new Response('not found', { status: 404 });
  return new Response(guideToMarkdown(r.guide), {
    headers: { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="${slug}-oauth-readiness.md"` },
  });
}
