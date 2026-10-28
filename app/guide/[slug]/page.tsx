import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ActionsBar } from '@/components/ActionsBar';
import { Blockers, Requirements, Sources, StageTimeline, Steps, Unsure, VerdictCard } from '@/components/GuideSections';
import { getGuide } from '@/lib/repo';

export const dynamic = 'force-dynamic';

const load = async (slug: string) => (/^[a-z0-9-]{2,60}$/.test(slug) ? (await getGuide(slug))?.guide : undefined);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const g = await load((await params).slug);
  if (!g) return { title: 'Not found' };
  const title = `${g.appName} OAuth setup: ${g.verdict.label}`;
  return { title, description: g.verdict.oneLiner, openGraph: { title, description: g.verdict.oneLiner, type: 'article' }, twitter: { card: 'summary', title, description: g.verdict.oneLiner } };
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const g = await load((await params).slug);
  if (!g) notFound();
  return (
    <main className="mx-auto max-w-4xl px-4 pb-24">
      <ActionsBar slug={g.slug} appName={g.appName} />
      <div className="mt-5">
        <VerdictCard g={g} />
        <StageTimeline g={g} />
        <Requirements g={g} />
        <Steps g={g} />
        <Blockers g={g} />
        <Unsure g={g} />
        <Sources g={g} />
      </div>
    </main>
  );
}
