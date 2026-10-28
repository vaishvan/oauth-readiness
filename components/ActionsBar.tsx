'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ActionsBar({ slug, appName }: { slug: string; appName: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState('');
  const flash = (m: string) => (setMsg(m), setTimeout(() => setMsg(''), 2500));
  const btn = 'rounded-md border border-line bg-card px-3 py-1.5 text-sm font-medium hover:bg-line/40';

  async function copy(text: string, ok: string) {
    try {
      await navigator.clipboard.writeText(text);
      flash(ok);
    } catch {
      flash('Copy blocked by the browser');
    }
  }
  async function regenerate() {
    const r = await fetch('/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: appName, force: true }) });
    const j = await r.json();
    if (r.ok && j.jobId) router.push(`/generate/${j.jobId}`);
    else flash(j.error ?? 'Could not regenerate');
  }

  return (
    <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-b border-line bg-bg/90 px-4 py-2 backdrop-blur" role="toolbar" aria-label="Guide actions">
      <button className={btn} onClick={() => copy(location.href, 'Link copied')}>Copy link</button>
      <button className={btn} onClick={async () => copy(await (await fetch(`/api/guides/${slug}/md`)).text(), 'Markdown copied')}>Copy as Markdown</button>
      <a className={btn} href={`/api/guides/${slug}/md`} download>Download .md</a>
      <button className={btn} onClick={regenerate}>Regenerate</button>
      <span role="status" className="text-sm text-muted">{msg}</span>
    </div>
  );
}
