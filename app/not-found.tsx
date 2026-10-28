import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-20 text-center">
      <h1 className="text-2xl font-bold">Not found</h1>
      <p className="mt-2 text-muted">That guide or job does not exist.</p>
      <Link href="/" className="mt-4 inline-block text-accent underline">Back to the library</Link>
    </main>
  );
}
