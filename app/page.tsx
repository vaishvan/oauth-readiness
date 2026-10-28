import { Library } from '@/components/Library';
import { listGuides } from '@/lib/repo';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const guides = await listGuides();
  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">How long until your OAuth app works for strangers?</h1>
      <p className="mt-2 max-w-2xl text-lg text-muted">
        Creating an OAuth app takes minutes. Getting it approved for any user can take weeks. Pick a guide, or generate one for any app in about a minute.
      </p>
      <Library guides={guides} />
    </main>
  );
}
