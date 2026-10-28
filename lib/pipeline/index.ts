import { Guide, type GuideDraft, type PipelineEvent } from '../schema';
import { newUsage, MODEL_EXTRACT } from '../llm';
import { appendEvent, getGuide, getJob, updateJob, upsertGuide } from '../repo';
import { recompute } from '../validate';
import { discover } from './discover';
import { PROMPT_VERSION, extractGuide } from './extract';
import { probeConsole, probeDiscovery, probeSummary, type ProbeResult } from './probe';
import { NotEnoughDocs, read, type Doc } from './read';
import { resolve, type Resolved } from './resolve';
import { slugify, sleep, withTimeout, type Emit } from './util';
import { verify } from './verify';

// Per-stage hard timeouts (PRD section 7) and the overall cap.
const TIMEOUT = { resolve: 10_000, discover: 15_000, read: 40_000, probe: 8_000, extract: Number(process.env.EXTRACT_TIMEOUT_MS ?? 90_000), verify: 30_000 };
const hardCap = () => Number(process.env.HARD_CAP_MS ?? 240_000);
const ttlMs = () => Number(process.env.CACHE_TTL_DAYS ?? 30) * 86_400_000;

async function awaitChoice(jobId: string, n: number): Promise<number> {
  const end = Date.now() + Number(process.env.CHOICE_TIMEOUT_MS ?? 60_000);
  while (Date.now() < end) {
    const j = await getJob(jobId);
    if (j?.choice != null) return Math.min(j.choice, n - 1);
    await sleep(500);
  }
  return 0; // auto-select the first candidate after the wait
}

export async function runPipeline(jobId: string, opts: { query: string; force?: boolean; pinUrl?: string }) {
  const t0 = Date.now();
  const usage = newUsage();
  const emit: Emit = (e: PipelineEvent) => appendEvent(jobId, e);
  const state = { closed: false, draft: undefined as GuideDraft | undefined, warnings: [] as string[] };

  const fail = async (message: string, retryable: boolean) => {
    if (state.closed) return;
    state.closed = true;
    await emit({ type: 'error', message, retryable });
    await updateJob(jobId, { status: 'failed', error: message });
  };

  async function publish(draft: GuideDraft, warnings: string[]) {
    if (state.closed) return;
    state.closed = true;
    const durationMs = Date.now() - t0;
    const parsed = Guide.safeParse({
      ...draft,
      meta: {
        origin: 'live', generatedAt: new Date().toISOString(), model: MODEL_EXTRACT(), durationMs,
        tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, costUsd: Math.round(usage.costUsd * 1000) / 1000,
        reviewedByHuman: false, validationWarnings: warnings, promptVersion: PROMPT_VERSION,
      },
    });
    if (!parsed.success) {
      state.closed = false;
      return fail(`Generated guide failed validation: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`, true);
    }
    await upsertGuide(parsed.data);
    await updateJob(jobId, { status: 'done', stage: null, guideSlug: parsed.data.slug });
    await emit({ type: 'done', slug: parsed.data.slug, durationMs, costUsd: parsed.data.meta.costUsd });
  }

  async function stage<T>(name: keyof typeof TIMEOUT, fn: () => Promise<T>): Promise<T> {
    await emit({ type: 'stage', stage: name as any, status: 'start' });
    await updateJob(jobId, { stage: name as string });
    const s = Date.now();
    const r = await withTimeout(fn(), TIMEOUT[name], name as string);
    await emit({ type: 'stage', stage: name as any, status: 'done', ms: Date.now() - s });
    return r;
  }

  async function body() {
    await updateJob(jobId, { status: 'running' });

    let app: Resolved = await stage('resolve', () => resolve(opts.query, usage));
    if (app.ambiguous && app.candidates.length >= 2) {
      await emit({ type: 'needs_choice', candidates: app.candidates });
      const pick = app.candidates[await awaitChoice(jobId, app.candidates.length)];
      app = { ...app, appName: pick.appName, domain: pick.domain, slug: slugify(pick.appName), devDocsHost: undefined, ambiguous: false };
    }
    await emit({ type: 'resolved', appName: app.appName, domain: app.domain, slug: app.slug });
    if (!app.oauthLikely) await emit({ type: 'warn', message: `No public OAuth found for ${app.appName}; the guide will lead with that.` });

    // stage 2: cache check
    if (!opts.force && !opts.pinUrl) {
      const hit = await getGuide(app.slug);
      if (hit && Date.now() - hit.updatedAt.getTime() < ttlMs()) {
        state.closed = true;
        await updateJob(jobId, { status: 'done', stage: null, guideSlug: app.slug });
        await emit({ type: 'done', slug: app.slug, durationMs: Date.now() - t0, costUsd: usage.costUsd });
        return;
      }
    }
    if (state.closed) return;

    const ranked = await stage('discover', () => discover(app));
    if (state.closed) return;
    const docs: Doc[] = await stage('read', () => read(ranked, app, emit, opts.pinUrl));
    if (state.closed) return;

    const probe: ProbeResult = await stage('probe', () => probeDiscovery(app.domain)).catch(async (e) => {
      await emit({ type: 'warn', message: `Probe failed: ${e.message}` });
      return { events: [], facts: {} } as ProbeResult;
    });
    for (const e of probe.events) await emit(e);
    if (state.closed) return;

    const { draft, warnings } = await stage('extract', () => extractGuide({ app, docs, probe: probeSummary(probe), usage, emit }));
    if (state.closed) return;

    // tested facts from the probe become claims the model cannot get wrong
    const tested = probe.events.filter((e) => e.ok).map((e, i) => ({
      id: `clm_probe_${i + 1}`, text: e.detail.slice(0, 400), confidence: 1,
      evidence: { kind: 'tested' as const, sourceIds: [], note: `Probe ${e.check}, unauthenticated GET, ${new Date().toISOString().slice(0, 10)}`.slice(0, 280) },
    }));
    let g: GuideDraft = { ...draft, claims: [...draft.claims, ...tested], pkceSupported: probe.facts.pkce && probe.facts.pkce !== 'unknown' ? probe.facts.pkce : draft.pkceSupported };
    state.draft = g;
    state.warnings = warnings;

    await emit({ type: 'stage', stage: 'verify', status: 'start' });
    await updateJob(jobId, { stage: 'verify' });
    const sv = Date.now();
    try {
      g = await withTimeout(
        (async () => {
          const checked = await verify(g, docs, usage, emit);
          if (draft.developerConsoleUrl) {
            const ev = await probeConsole(draft.developerConsoleUrl, app.domain);
            await emit(ev);
            if (ev.ok) checked.claims.push({ id: 'clm_probe_console', text: ev.detail.slice(0, 400), confidence: 1, evidence: { kind: 'tested', sourceIds: [], note: `Probe console, unauthenticated GET, ${new Date().toISOString().slice(0, 10)}` } });
          }
          return checked;
        })(),
        TIMEOUT.verify,
        'verify',
      );
    } catch (e: any) {
      warnings.push(`Verification incomplete: ${e.message}. Unchecked claims are shown as unverified.`);
      await emit({ type: 'warn', message: warnings[warnings.length - 1] });
      g = downgradeUnchecked(g);
    }
    await emit({ type: 'stage', stage: 'verify', status: 'done', ms: Date.now() - sv });
    await publish(recompute(g), warnings);
  }

  const timeout = sleep(hardCap()).then(() => 'timeout' as const);
  try {
    const r = await Promise.race([body().then(() => 'ok' as const), timeout]);
    if (r === 'timeout' && !state.closed) {
      if (state.draft) {
        const w = [...state.warnings, 'Partial: the 240 s cap was reached before verification finished. Unchecked claims are shown as unverified.'];
        await emit({ type: 'warn', message: w[w.length - 1] });
        await publish(recompute(downgradeUnchecked(state.draft)), w);
      } else await fail('Timed out before a draft existed. Try again, or paste a docs URL.', true);
    }
  } catch (e: any) {
    const nodocs = e instanceof NotEnoughDocs;
    await fail(e?.message ?? String(e), !nodocs);
  }
}

/** Without verification no sourced claim can be trusted: show them as unverified. */
function downgradeUnchecked(g: GuideDraft): GuideDraft {
  return {
    ...g,
    claims: g.claims.map((c) => (c.evidence.kind === 'sourced' ? { ...c, confidence: 0.3, evidence: { ...c.evidence, kind: 'unverified' as const, sourceIds: [] } } : c)),
  };
}
