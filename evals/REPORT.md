# Eval report: live generation on 5 unseen apps

Run: 2026-10-28 · Models: `nvidia/nemotron-3-ultra-550b-a55b:free` (extract, verify) and `nvidia/nemotron-3.5-lightning:free` (resolve), via OpenRouter · Search and scrape: Firecrawl · Raw results: [`results.json`](results.json), guides in [`out/`](out/)

## Summary

**0 of 5 apps pass the PRD bar (4 needed). 4 of 5 produce a complete, schema-valid guide.**

The pipeline ran end to end on real documentation for four apps. They fail on evidence: 49% of claims are backed by a checked quote or a live test, against a target of 85%. The model attached a quote to 42 of 45 claims, but 20 of those quotes were not in the source text, and the verifier downgraded them to unverified. Those 20 are the gap.

The verifier is doing its job. What fails is the model's quoting. Every downgraded claim is listed on the guide page under "What we're not sure about", so a reader sees the weakness instead of trusting it.

## Results

Pass criteria (PRD §13): finishes under 150 s, valid schema, at least 85% of claims backed, at least 1 official source.

| App | Status | Time | Claims backed | Official sources | Difficulty | Pass |
| --- | --- | --- | --- | --- | --- | --- |
| Zoho CRM | done | 136 s | 50% (5 of 10) | 7 | 1 Instant | no: evidence |
| Pipedrive | done | 115 s | 36% (5 of 14) | 8 | 2 Easy | no: evidence |
| Calendly | done | 116 s | 67% (6 of 9) | 8 | 1 Instant | no: evidence |
| Dropbox | done | 150 s | 50% (6 of 12) | 1 | 1 Instant | no: evidence, time |
| Typeform | failed | 211 s | n/a | n/a | n/a | no: extract timed out at 200 s |

| Metric | Target | Measured |
| --- | --- | --- |
| Latency p50 | ≤ 90 s | 136 s |
| Latency, slowest completed | ≤ 150 s (p95) | 150 s |
| Claims backed | ≥ 85% | 49% (22 of 45) |
| Guides that render | 5 of 5 | 4 of 5 |
| Cost per guide | ~$0.38 | $0 (free tier) |

Tokens per guide: 18k–28k in and 5.5k–7.7k out. That is well under the 75k/10k budget, because the corpus was capped at 80k characters (see below).

## How we got here

This was the third run. The first two exposed pipeline problems, which are now fixed and covered by tests (32 passing).

| Run | Guides produced | What failed | Fix |
| --- | --- | --- | --- |
| 1 | 0 of 1 | The free resolve model answered without calling its tool | A missing tool call now triggers the repair call, and resolve falls back to deterministic parsing of the search results |
| 2 | 1 of 5 | Resolve hit its 10 s stage timeout before the fallback could run; extract timed out on 240k characters of docs | The resolve model gets its own 5.5 s timeout, then falls back; corpus and page caps became settings (80k / 15k chars for free models) |
| 3 | 4 of 5 | Evidence below target; Typeform still too slow | Reported here |

Before the eval I compared 4 free models on the same Calendly docs. Nemotron Ultra wrote the most complete guide (6 steps, 13 claims, 154 s). Nemotron Lightning was a little faster but thin (3 steps). Super-VL and Laguna-S failed to return a tool call.

## Hand check of the guides

I read each guide against its cited pages.

| App | Verdict | Notes |
| --- | --- | --- |
| Calendly | Correct | Developer console URL, HTTP localhost redirects allowed in sandbox only, PKCE, client secret shown once. "Instant" fits. |
| Zoho CRM | Correct | API Console at `api-console.zoho.com`, five client types, redirect URI rules, token endpoint. It leaves out Zoho Marketplace publishing, so S3 has no steps. |
| Pipedrive | Doubtful | The "2+ months" Marketplace review comes from a single community-forum thread title, which feeds a 9–17 week S3 estimate. The PRD says a forum post must not be the only source for a time estimate. The "3 users" private-app limit is unverified. |
| Dropbox | Probably wrong | It says development apps work for any user with "no published limit". My understanding is that Dropbox caps development apps at 500 linked users until production approval; not re-checked here. The model also put "no published limit" in the S2-limit field, which scored as a gate. |
| Typeform | n/a | No guide. |

## Bugs the check found (fixed after run 3)

1. **Sister domains counted as third-party.** Dropbox's docs live on `docs.dropboxapi.com`, so the guide showed 1 official source although 6 of its 8 sources are Dropbox sites (dropboxapi.com, dropbox.tech, dropbox.com). Hosts whose brand label extends the app's (dropboxapi for dropbox) now count as official; hyphenated lookalikes do not. Test added.
2. **Empty S2 limit written as text.** The extract prompt now requires `null` when the docs state no cap, and says a dev-mode user cap counts.
3. **Forum-only time estimates.** The prompt now requires an official or vendor doc for `waitDays`; a forum or blog post goes into uncertainties instead.

These fixes are not yet measured: run 3 predates them.

## What would move the numbers

- **Evidence (49% → 85%).** The shortfall is quote fidelity. Options, cheapest first:
  - Ask for shorter quotes (≤ 20 words; the prompt currently allows 40).
  - Run one repair pass that sends only the failed claims back with their source text.
  - Use a model that copies text verbatim more reliably.
- **Latency (136 s p50 → 90 s).** About 85% of the time is the single extract call. A faster model, or splitting extract into steps and requirements in parallel, would cut it.
- **Typeform.** The same latency issue. The 240 s hard cap should publish a partial guide rather than fail, but extract had produced no draft yet.

## Not verified

- The 30-claim hand-verification log (`claims.csv`) and the hands-on console attempts (`attempts.md`) are not done; they need provider accounts.
- The six seed guides are built from facts checked against their sources on 2026-10-27, but nobody has walked through their console steps by hand. They are marked unverified on the page.
