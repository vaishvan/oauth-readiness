import { getJob } from '@/lib/repo';

export const maxDuration = 300;
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ponytail: polling only (700 ms). The PRD's in-memory emitter is a latency optimisation; add it if 700 ms feels slow.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{6,32}$/.test(id) || !(await getJob(id))) return new Response('not found', { status: 404 });

  const enc = new TextEncoder();
  let timer: NodeJS.Timeout | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      let sent = 0;
      let lastWrite = Date.now();
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        try { controller.close(); } catch {}
      };
      req.signal.addEventListener('abort', close);
      const write = (s: string) => { lastWrite = Date.now(); controller.enqueue(enc.encode(s)); };

      const tick = async () => {
        if (closed) return;
        try {
          const job = await getJob(id);
          if (!job) return close();
          for (; sent < job.events.length; sent++) {
            const ev = job.events[sent];
            write(`id: ${sent}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
            if (ev.type === 'done' || ev.type === 'error') return close();
          }
          if (job.status === 'failed' || job.status === 'done') {
            // terminal status without a terminal event (e.g. the function was killed): tell the client
            if (!job.events.some((e) => e.type === 'done' || e.type === 'error'))
              write(`event: error\ndata: ${JSON.stringify({ type: 'error', message: job.error ?? 'Job ended unexpectedly', retryable: true })}\n\n`);
            return close();
          }
          if (Date.now() - lastWrite > 15_000) write(': ping\n\n');
        } catch {
          return close();
        }
        timer = setTimeout(tick, 700);
      };
      tick();
    },
    cancel() { clearTimeout(timer); },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' } });
}
