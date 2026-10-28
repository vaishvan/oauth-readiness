import { NextResponse } from 'next/server';
import { listGuides } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const d = Number(p.get('difficulty'));
  const guides = await listGuides({
    q: p.get('q')?.slice(0, 100) || undefined,
    difficulty: Number.isInteger(d) && d >= 1 && d <= 5 ? d : undefined,
    origin: p.get('origin') || undefined,
  });
  return NextResponse.json({ guides });
}
