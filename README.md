# OAuth Readiness

How long until your OAuth app works for strangers? Six seeded guides plus a live agent that writes a new one for any app, with every claim tagged **Tested**, **Sourced** or **Unverified** and every step tagged **Agent**, **You** or **Provider**.

Live link: _not deployed yet_

## The insight

"OAuth app created" (S1) and "usable by any user" (S3) are different milestones, often weeks apart. Every guide leads with both times, so the S2→S3 gap shows up on day 0 instead of after the integration is built.

## Run locally

```bash
npm i
cp .env.example .env.local          # add OPENROUTER_API_KEY (or ANTHROPIC_API_KEY) + FIRECRAWL_API_KEY
npm run dev
```

With no `DATABASE_URL` the app uses an embedded Postgres (PGlite) in `.data/pg` and seeds the 6 guides on first start. For Neon: set `DATABASE_URL`, then `npx tsx scripts/seed.ts` (tables are created on first connect).

**No keys?** `MOCK_PIPELINE=1 npm run dev` runs the whole pipeline on canned search/LLM output. Test app names: `mercury` (ambiguous), `broken` (repair call), `stubborn` (publish with warnings), `thin` (not enough docs).

| Command | What |
| --- | --- |
| `npm test` | 30 unit + pipeline tests (score, invariants, quote check, URL ranking, SSRF guard, full mock pipeline) |
| `npm run gen -- calendly` | CLI: generate one guide, print JSON |
| `npm run eval` | The 5 unseen apps, writes `evals/results.json` (~$2 live) |
| `BASE=http://localhost:3000 npx tsx scripts/stress.ts` | Load + abuse test against a running server |
| `npx tsx scripts/build-seeds.ts` | Rebuild `seed/guides/*.json` from PRD section 12 facts |

## How it works

`POST /api/generate` creates a job and runs the pipeline in `waitUntil`. Each stage appends events to `jobs.events`; `GET /api/jobs/:id/stream` replays them over SSE and polls every 700 ms, so a refresh or a shared job link shows full progress.

1. **Resolve** (Haiku + 1 search): name/URL → app, domain, slug; asks the user when ambiguous.
2. **Cache check**: a guide under 30 days old is returned as is.
3. **Discover**: 4 parallel searches, deduped, ranked (official +3, oauth path +2, review path +2, aggregator −2), top 8 with ≥2 official and ≥1 review page.
4. **Read**: Firecrawl scrape, concurrency 4, 40k chars/page, 240k total, 7-day cache.
5. **Probe**: unauthenticated GETs to `.well-known` discovery and the authorize endpoint. Results become `tested` claims.
6. **Extract** (Sonnet, forced tool call, Zod schema): streams partial steps to the UI.
7. **Verify**: quote check in code, then a Sonnet entailment batch; then invariants and deterministic scoring.

## Key decisions

- **Stages over one score.** Time to S1 and time to S3 answer different questions.
- **Deterministic scoring.** `lib/score.ts`; the model's difficulty, times and agent share are overwritten.
- **Quote-checked evidence.** A sourced claim whose quote is not in the doc is downgraded to unverified, visibly.
- **Probe as the agent's safe hands-on step.** GET only, own domain, private IPs blocked on every redirect hop.
- **No console automation.** Filling provider forms would need the developer's session cookies.

## Deviations from the PRD

- **Console probe runs after extract**, because the console URL is only known then.
- **No in-memory event emitter.** SSE polls the DB every 700 ms (the PRD's guaranteed path).
- **Embedded PGlite** when `DATABASE_URL` is empty, so the app runs with zero setup.
- **No shadcn/remark.** Plain Tailwind; Markdown export is a string builder (`lib/markdown.ts`).
- **TypeScript 5 pinned.** TS 7 breaks the Next 15 build.

## Scoring calibration

Seeds score GitHub 1, Notion 1, Slack 2, HubSpot 2, Google 3, LinkedIn 4. The order never inverts, so the PRD weights are unchanged. Three seeds land one level below the PRD's guesses:

- **HubSpot** (Easy, not Moderate): no published listing review time, so only the cap and the review count.
- **Google** (Moderate, not Hard): brand verification is an S3 requirement, so the S0/S1 brand gate doesn't fire.
- **LinkedIn** (Hard, not Gated): 6 points.

Change `POINTS` in `lib/score.ts`, rerun `build-seeds.ts`, and update `tests/score.test.ts` if you want the PRD labels.

## Evidence

Live eval on the 5 unseen apps with free OpenRouter models: **4 of 5 produce a complete guide; 0 of 5 pass**. 49% of claims are backed against an 85% target, and p50 latency is 136 s. Full results, the hand check of each guide and the fixes are in [evals/REPORT.md](evals/REPORT.md).

The 30-claim check (`evals/claims.csv`) and hands-on attempts (`evals/attempts.md`) need a human with provider accounts and are not done yet.

## Stress test results (mock pipeline, local `next start`, Windows laptop)

- 1,000 page/API reads at concurrency 50: 0 errors, p50 91 ms, p95 1.9 s (single-connection embedded DB; Neon will differ).
- 60 concurrent generations: 60/60 done, one terminal event each, p50 4.6 s with mock latency.
- Replay, cache, dedupe, force, rate limit (5/h → 429), 400/404/409 paths, script-tag and SQL-ish queries, and ambiguous choice: all passed.

## Limitations and next steps

Re-crawl schedule for freshness; community-sourced wait times; rate limit and budget are per instance; DNS-rebinding window in the probe (pin resolved IPs); batch runs to reach 100 guides.
