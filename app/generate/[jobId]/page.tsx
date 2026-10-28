import { notFound } from 'next/navigation';
import { GenerateView } from '@/components/GenerateView';
import { getJob } from '@/lib/repo';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Generating a guide' };

export default async function GeneratePage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = /^[A-Za-z0-9_-]{6,32}$/.test(jobId) ? await getJob(jobId) : null;
  if (!job) notFound();
  return <GenerateView jobId={jobId} query={job.query} />;
}
