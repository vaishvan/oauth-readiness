import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getJob, setChoice } from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = z.object({ candidateIndex: z.number().int().min(0).max(2) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'candidateIndex must be 0..2' }, { status: 400 });
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const ask = job.events.find((e) => e.type === 'needs_choice');
  if (!ask || job.status !== 'running' || job.choice != null || job.events.some((e) => e.type === 'resolved'))
    return NextResponse.json({ error: 'no choice pending' }, { status: 409 });
  if (ask.type === 'needs_choice' && body.data.candidateIndex >= ask.candidates.length) return NextResponse.json({ error: 'no such candidate' }, { status: 400 });
  await setChoice(id, body.data.candidateIndex);
  return NextResponse.json({ ok: true });
}
