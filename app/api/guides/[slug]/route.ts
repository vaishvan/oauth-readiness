import { NextResponse } from 'next/server';
import { getGuide } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = /^[a-z0-9-]{2,60}$/.test(slug) ? await getGuide(slug) : null;
  return r ? NextResponse.json(r.guide) : NextResponse.json({ error: 'not found' }, { status: 404 });
}
