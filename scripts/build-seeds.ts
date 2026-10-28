// Generates seed/guides/*.json from the facts in PRD section 12. Derived fields come from lib/validate.ts,
// so a change to the scoring rules is one `npx tsx scripts/build-seeds.ts` away.
// Facts marked "sourced" were checked against the linked page on 2026-10-27 (PRD); everything else is
// "unverified" until the hands-on attempts in PRD section 11 are done (see evals/attempts.md).
import fs from 'node:fs';
import path from 'node:path';
import { Guide, GuideDraft } from '../lib/schema';
import { checkInvariants, recompute } from '../lib/validate';

const AT = '2026-10-27T00:00:00.000Z';
const CHECKED = 'Checked against the linked page on 2026-10-27.';
type Pub = 'official' | 'third_party' | 'community';
const src = (id: string, url: string, title: string, publisher: Pub) => ({ id, url, title, publisher, fetchedAt: AT });
const S = (id: string, text: string, sourceIds: string[], conf = 0.8) => ({ id, text, confidence: conf, evidence: { kind: 'sourced' as const, sourceIds, note: CHECKED } });
const U = (id: string, text: string, note = 'Not yet tested by hand; confirm in the console.') => ({ id, text, confidence: 0.3, evidence: { kind: 'unverified' as const, sourceIds: [] as string[], note } });
type StepIn = { stage: 'S0' | 'S1' | 'S2' | 'S3'; title: string; detail: string; owner: 'agent' | 'you' | 'provider'; min: [number, number]; wait?: [number, number]; url?: string; claims?: string[]; agentAction?: string };
const steps = (xs: StepIn[]) =>
  xs.map((s, i) => ({
    id: `stp_${i + 1}`, stage: s.stage, title: s.title, detail: s.detail, owner: s.owner, agentAction: s.agentAction,
    estMinutes: { low: s.min[0], high: s.min[1] }, ...(s.wait ? { waitDays: { low: s.wait[0], high: s.wait[1] } } : {}), url: s.url, claimIds: s.claims ?? [],
  }));
const blk = (id: string, symptom: string, cause: string, fix: string, claimIds: string[]) => ({ id, symptom, cause, fix, claimIds });
const req = (id: string, label: string, category: any, requiredAt: any, claimIds: string[] = [], costUsd?: { low: number; high: number }) => ({ id, label, category, requiredAt, claimIds, ...(costUsd ? { costUsd } : {}) });

type Base = Omit<GuideDraft, 'schemaVersion' | 'verdict' | 'oauthVersion' | 'refreshTokens' | 'composioManaged'> & { oneLiner: string; s2Limit: string | null; pkce?: 'yes' | 'no' | 'unknown'; refresh?: 'yes' | 'no' | 'unknown' };

function make(b: Base): Guide {
  const { oneLiner, s2Limit, pkce, refresh, ...rest } = b;
  const draft = recompute({
    ...rest, schemaVersion: 1 as const, oauthVersion: 'oauth2' as const, pkceSupported: pkce ?? 'unknown', refreshTokens: refresh ?? 'unknown',
    composioManaged: 'unknown' as const,
    verdict: { difficulty: 1, label: 'Instant' as const, oneLiner, timeToS1: { lowMin: 0, highMin: 0 }, timeToS3: { lowDays: 0, highDays: 0, hasReview: false }, s2Limit, agentShare: 0 },
  } as GuideDraft);
  const errs = checkInvariants(draft);
  if (errs.length) throw new Error(`${b.slug}: ${errs.join('; ')}`);
  return Guide.parse({
    ...draft,
    meta: { origin: 'seed', generatedAt: AT, model: 'hand-assembled from PRD section 12', durationMs: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, reviewedByHuman: false,
      validationWarnings: ['Seeded from PRD section 12 facts. Hands-on attempts (PRD section 11) are still pending, so console steps are unverified.'] },
  });
}

const guides: Guide[] = [];

guides.push(make({
  slug: 'github', appName: 'GitHub', appUrl: 'https://github.com/', developerConsoleUrl: 'https://github.com/settings/developers',
  docsUrl: 'https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app',
  oneLiner: 'Self-serve and no review: register an OAuth App and any GitHub user can authorize it.', s2Limit: null,
  sources: [
    src('src_1', 'https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app', 'Creating an OAuth app', 'official'),
    src('src_2', 'https://docs.unified.to/skills/github-oauth-app/SKILL.md', 'Unified.to: GitHub OAuth app skill', 'third_party'),
  ],
  claims: [
    S('clm_1', 'GitHub recommends GitHub Apps over OAuth Apps (fine-grained permissions, short-lived tokens).', ['src_1']),
    S('clm_2', 'GitHub docs say an OAuth App cannot have multiple callback URLs.', ['src_1']),
    S('clm_3', 'Unified.to reports up to 10 callback URLs per OAuth App, with wildcard matching as a per-URL setting since 2026-08-03.', ['src_2'], 0.6),
    S('clm_4', 'An account can own up to 100 OAuth Apps (third-party figure).', ['src_2'], 0.6),
    U('clm_5', 'Register under Settings > Developer settings > OAuth Apps > New OAuth App. Fields: name, homepage URL, callback URL.'),
    U('clm_6', 'No review exists for OAuth Apps; any GitHub user can authorize one.'),
    U('clm_7', 'OAuth App user tokens do not expire unless the app opts in to expiring tokens.'),
  ],
  requirements: [req('req_1', 'GitHub account', 'account', 'S0', ['clm_5'])],
  steps: steps([
    { stage: 'S0', title: 'Choose OAuth App or GitHub App', detail: 'GitHub recommends GitHub Apps for new work. Pick an OAuth App only if you need user-level access with a simple flow.', owner: 'agent', min: [2, 5], claims: ['clm_1'], agentAction: 'Compare permission models against your feature list.' },
    { stage: 'S0', title: 'Register the OAuth App', detail: 'Open Developer settings, choose New OAuth App, fill name, homepage URL and callback URL.', owner: 'you', min: [3, 5], url: 'https://github.com/settings/developers', claims: ['clm_5'] },
    { stage: 'S1', title: 'Set one callback URL', detail: 'Register the exact callback you will use. Sources disagree on multiple callbacks (see the uncertainties), so plan for one.', owner: 'agent', min: [1, 2], claims: ['clm_2', 'clm_3'], agentAction: 'Derive the callback URL from your deployment host.' },
    { stage: 'S1', title: 'Create a client secret', detail: 'Generate a secret on the app page and store it in your server environment. Never commit it.', owner: 'you', min: [2, 3] },
    { stage: 'S1', title: 'Run the authorization code flow', detail: 'Authorize with your own account and exchange the code for a token.', owner: 'you', min: [3, 5], claims: ['clm_7'] },
    { stage: 'S3', title: 'Share the authorize link with other users', detail: 'No review stands between you and other users.', owner: 'you', min: [1, 2], claims: ['clm_6'] },
  ]),
  blockers: [blk('blk_1', 'redirect_uri_mismatch', 'The redirect_uri in the request does not match the callback registered on the app.', 'Register the exact URL (scheme, host, port, path) or send the registered one.', ['clm_2'])],
  scopes: [{ name: 'read:user', tier: 'basic' }, { name: 'repo', tier: 'sensitive', note: 'Full private repo access.' }],
  uncertainties: [
    'Sources conflict on multiple callback URLs: GitHub docs say one, Unified.to says up to 10. To be settled by a hands-on test (PRD section 10).',
    'Composio-managed status was not checked; read composio_managed_auth_schemes for the github toolkit.',
  ],
} as any));

guides.push(make({
  slug: 'notion', appName: 'Notion', appUrl: 'https://www.notion.so/', developerConsoleUrl: 'https://www.notion.so/profile/integrations',
  docsUrl: 'https://developers.notion.com/', oneLiner: 'Self-serve: a public integration works without review; Integration Gallery listing is a separate review.', s2Limit: null,
  sources: [
    src('src_1', 'https://docs.n8n.io/integrations/builtin/credentials/notion/', 'n8n: Notion credentials', 'third_party'),
    src('src_2', 'https://www.nango.dev/docs/integrations/all/notion-scim.md', 'Nango: Notion', 'third_party'),
  ],
  claims: [
    S('clm_1', 'Notion issues no refresh token and the access token does not expire (third-party).', ['src_2'], 0.6),
    S('clm_2', 'n8n docs say public integrations need a Notion security review before publishing.', ['src_1'], 0.6),
    U('clm_3', "Notion's own FAQ says the review applies to Integration Gallery listing, not to public OAuth.", 'Conflicts with clm_2. Settle by making an integration public and connecting a second workspace.'),
    U('clm_4', 'Create an integration of type Public, add the redirect URI, and read the OAuth client ID and secret from its page.'),
    U('clm_5', 'During OAuth the user chooses which pages the integration can see.'),
  ],
  requirements: [req('req_1', 'Notion account with workspace owner rights', 'account', 'S0', ['clm_4'])],
  steps: steps([
    { stage: 'S0', title: 'Decide public or internal integration', detail: 'Only a public integration supports OAuth for other workspaces.', owner: 'agent', min: [2, 4], claims: ['clm_4'] },
    { stage: 'S0', title: 'Create a public integration', detail: 'Open the integrations page, create an integration, switch it to Public and fill the required company details.', owner: 'you', min: [5, 8], url: 'https://www.notion.so/profile/integrations', claims: ['clm_4'] },
    { stage: 'S1', title: 'Add the redirect URI', detail: 'Register your callback exactly as your app sends it.', owner: 'agent', min: [1, 2], agentAction: 'Generate the callback URL for dev and prod hosts.' },
    { stage: 'S1', title: 'Run the OAuth flow', detail: 'Authorize from your own workspace, pick pages to share, exchange the code.', owner: 'you', min: [4, 6], claims: ['clm_5', 'clm_1'] },
    { stage: 'S2', title: 'Connect from a second workspace', detail: 'This settles whether public OAuth needs a review (see uncertainties).', owner: 'you', min: [5, 10], claims: ['clm_2', 'clm_3'] },
  ]),
  blockers: [blk('blk_1', 'invalid_grant', 'The authorization code was reused or expired before the token exchange.', 'Exchange the code once, immediately after the redirect.', [])],
  scopes: [], uncertainties: [
    'Sources conflict on whether public OAuth needs a security review. Treated as no review until tested (PRD section 10).',
    'No official Notion page was fetched for this guide; all console steps are unverified.',
  ],
} as any));

guides.push(make({
  slug: 'slack', appName: 'Slack', appUrl: 'https://slack.com/', developerConsoleUrl: 'https://api.slack.com/apps', docsUrl: 'https://docs.slack.dev/slack-marketplace/slack-marketplace-review-guide',
  oneLiner: 'Public distribution is instant; the optional Marketplace listing takes weeks and needs 5+ active workspaces first.',
  s2Limit: 'Unlisted apps may get tighter API rate limits (unverified)',
  sources: [
    src('src_1', 'https://docs.slack.dev/slack-marketplace/slack-marketplace-review-guide', 'Slack Marketplace review guide', 'official'),
    src('src_2', 'https://workos.com/blog/oauth-app-approval-slack-microsoft-atlassian', 'WorkOS: OAuth app approval', 'third_party'),
    src('src_3', 'https://api.slack.com/directory/app-review-guide', 'Slack app review guide (older)', 'official'),
    src('src_4', 'https://slack.com/blog/news/slack-app-directory-review-process', 'Slack blog: app directory review', 'official'),
  ],
  claims: [
    S('clm_1', 'Marketplace review: preliminary review up to 10 business days, functional review up to 10 weeks for new apps.', ['src_1'], 0.85),
    S('clm_2', 'An app must be installed on 5+ active workspaces before Marketplace submission (third-party quoting Slack).', ['src_2'], 0.6),
    S('clm_3', 'Each resubmission resets the preliminary-review queue position.', ['src_3']),
    S('clm_4', 'After listing, config, scopes and endpoints are locked; changes need re-review.', ['src_4']),
    S('clm_5', 'The older guide said up to 1 week and up to 8 weeks; the newer docs.slack.dev figures are longer.', ['src_3', 'src_1']),
    U('clm_6', 'Enabling public distribution lets any workspace install the app without Slack review.', 'Settle by installing to a second free workspace.'),
    U('clm_7', 'Non-Marketplace apps can face stricter rate limits on some read methods.', 'From memory; check the current rate-limit docs.'),
  ],
  requirements: [req('req_1', 'Slack workspace to develop in', 'account', 'S0'), req('req_2', 'Installed on 5+ active workspaces', 'business', 'S3', ['clm_2'])],
  steps: steps([
    { stage: 'S0', title: 'Draft the app manifest', detail: 'List the bot and user scopes you need and the redirect URL.', owner: 'agent', min: [3, 6], agentAction: 'Generate a manifest from your feature list.' },
    { stage: 'S0', title: 'Create the app from the manifest', detail: 'Use Create New App, From a manifest.', owner: 'you', min: [3, 5], url: 'https://api.slack.com/apps' },
    { stage: 'S1', title: 'Install to your workspace and run OAuth', detail: 'Run the OAuth v2 flow once and store the tokens server-side.', owner: 'you', min: [8, 12] },
    { stage: 'S2', title: 'Enable public distribution', detail: 'Activate distribution and install into a second workspace.', owner: 'you', min: [5, 10], claims: ['clm_6', 'clm_7'] },
    { stage: 'S3', title: 'Prepare Marketplace listing materials', detail: 'Draft listing copy, support and privacy links, and a test plan for reviewers.', owner: 'agent', min: [30, 60], agentAction: 'Draft listing text and review answers.' },
    { stage: 'S3', title: 'Reach 5+ active workspaces', detail: 'Marketplace submission needs real usage first.', owner: 'you', min: [30, 120], claims: ['clm_2'] },
    { stage: 'S3', title: 'Wait for Marketplace review (optional)', detail: 'Preliminary then functional review. Docs give upper bounds only.', owner: 'provider', min: [0, 0], wait: [0, 84], claims: ['clm_1', 'clm_3', 'clm_5'] },
  ]),
  blockers: [blk('blk_1', 'redirect_uri_mismatch', 'The redirect_uri differs from one saved in the app settings.', 'Add the exact URL under OAuth & Permissions > Redirect URLs.', [])],
  scopes: [{ name: 'chat:write', tier: 'basic' }, { name: 'channels:history', tier: 'sensitive' }],
  uncertainties: ['Docs give only upper bounds for review time, so the low bound is 0.', 'Marketplace review is optional; S3 here means listed. Distribution to any workspace is already open at S2 (unverified).'],
} as any));

guides.push(make({
  slug: 'hubspot', appName: 'HubSpot', appUrl: 'https://www.hubspot.com/', developerConsoleUrl: 'https://developers.hubspot.com/',
  docsUrl: 'https://developers.hubspot.com/docs/apps/developer-platform/build-apps/manage-apps-in-hubspot.md',
  oneLiner: 'Quick to start; unlisted apps stop at 25 installs until the Marketplace listing is approved.', s2Limit: '25 installs until the Marketplace listing is approved',
  sources: [
    src('src_1', 'https://developers.hubspot.com/docs/apps/developer-platform/build-apps/manage-apps-in-hubspot.md', 'Manage apps in HubSpot', 'official'),
    src('src_2', 'https://community.hubspot.com/t/new-marketplace-distribution-app-install-limits/139886', 'Marketplace distribution app install limits', 'official'),
    src('src_3', 'https://developers.hubspot.com/docs/api/app-marketplace-listing-requirements', 'App Marketplace listing requirements', 'official'),
  ],
  claims: [
    S('clm_1', 'An unlisted marketplace-distribution app is capped at 25 installs until its listing is approved.', ['src_1'], 0.85),
    S('clm_2', 'Private OAuth apps can install into up to 10 accounts, or 100 for Solution Partners.', ['src_2']),
    S('clm_3', 'A Marketplace listing lasts up to 12 months, then needs re-review.', ['src_3']),
    U('clm_4', 'A free HubSpot developer account is enough to create the app.'),
    U('clm_5', 'Create the app in the developer account, set redirect URL and scopes, then copy client ID and secret.'),
    U('clm_6', 'Listing review duration is not published in the pages checked.', 'Left out of the estimates on purpose.'),
  ],
  requirements: [req('req_1', 'HubSpot developer account', 'account', 'S0', ['clm_4']), req('req_2', 'Marketplace listing approval', 'business', 'S3', ['clm_1'])],
  steps: steps([
    { stage: 'S0', title: 'Create a developer account', detail: 'Sign up for a free developer account and a test account.', owner: 'you', min: [5, 10], claims: ['clm_4'] },
    { stage: 'S0', title: 'Pick the minimum scopes', detail: 'Choose only the scopes the integration needs.', owner: 'agent', min: [2, 5], agentAction: 'Map features to the smallest scope set.' },
    { stage: 'S0', title: 'Create the app', detail: 'Create the app in the developer account.', owner: 'you', min: [5, 10], url: 'https://developers.hubspot.com/', claims: ['clm_5'] },
    { stage: 'S1', title: 'Set redirect URL and install in the test account', detail: 'Run the flow end to end with your own account.', owner: 'you', min: [10, 15], claims: ['clm_5'] },
    { stage: 'S2', title: 'Install for early customers', detail: 'Stay within the 25-install cap while the listing is pending.', owner: 'you', min: [5, 15], claims: ['clm_1', 'clm_2'] },
    { stage: 'S3', title: 'Prepare listing materials', detail: 'Draft the listing, privacy and support pages.', owner: 'agent', min: [30, 60], agentAction: 'Draft listing text and screenshots checklist.' },
    { stage: 'S3', title: 'Wait for Marketplace listing approval', detail: 'The duration is not published in the pages checked.', owner: 'provider', min: [0, 0], claims: ['clm_1', 'clm_3', 'clm_6'] },
  ]),
  blockers: [blk('blk_1', 'Install limit reached', 'The unlisted app reached 25 installs.', 'Get the Marketplace listing approved, or move customers to a private app within its account limit.', ['clm_1', 'clm_2'])],
  scopes: [{ name: 'crm.objects.contacts.read', tier: 'basic' }],
  uncertainties: ['Listing review duration was not found in the checked pages, so S3 time counts only developer work.', 'Console steps are unverified until the hands-on attempt (PRD section 11).'],
} as any));

guides.push(make({
  slug: 'google-gmail', appName: 'Google (Gmail)', appUrl: 'https://mail.google.com/', developerConsoleUrl: 'https://console.cloud.google.com/auth/overview',
  docsUrl: 'https://developers.google.com/identity/protocols/oauth2/production-readiness/overview',
  oneLiner: 'Working in 30 minutes, but restricted Gmail scopes need verification plus a paid annual CASA assessment.', s2Limit: '100 test users; test-user authorizations expire after 7 days',
  sources: [
    src('src_1', 'https://developers.google.com/identity/protocols/oauth2/production-readiness/overview', 'OAuth production readiness', 'official'),
    src('src_2', 'https://support.google.com/cloud/answer/15549945', 'Google Cloud help: app publishing status', 'official'),
    src('src_3', 'https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification', 'Restricted scope verification', 'official'),
    src('src_4', 'https://openwearables.io/blog/google-casa-oauth-verification-health-apps', 'Google CASA OAuth verification', 'third_party'),
    src('src_5', 'https://singhamandeep.com/?p=1003', 'Restricted scope verification timeline', 'community'),
  ],
  claims: [
    S('clm_1', 'Testing mode caps the app at 100 test users (hard cap).', ['src_1'], 0.9),
    S('clm_2', 'Test-user authorizations expire 7 days after consent, including the refresh token.', ['src_2'], 0.9),
    S('clm_3', 'Apps requesting only openid, email or profile avoid the 7-day expiry and the test-user allowlist.', ['src_2']),
    S('clm_4', 'A published but unverified app with sensitive scopes shows an unverified-app warning and a 100-user lifetime cap that cannot be reset.', ['src_2']),
    S('clm_5', 'Restricted scopes need a security assessment through the App Defense Alliance CASA program, repeated annually, 12 months after the letter of assessment.', ['src_3'], 0.9),
    S('clm_6', 'CASA costs $500 to $4,500, paid to the assessor (third-party, reported).', ['src_4'], 0.6),
    S('clm_7', 'A realistic restricted-scope timeline is 4 to 8 weeks (third-party, reported).', ['src_5'], 0.5),
    S('clm_8', 'Workspace admins can block any app, even a verified one.', ['src_1']),
    U('clm_9', 'Create the project in Google Cloud Console, configure the consent screen, then create a Web OAuth client.'),
    U('clm_10', 'gmail.readonly is a restricted scope.', 'Confirm on the Gmail scopes list.'),
    U('clm_11', 'The CASA assessment needs several focused days of developer time.', 'Developer effort is a guess; no source states it.'),
  ],
  requirements: [
    req('req_1', 'Google Cloud project', 'account', 'S0', ['clm_9']),
    req('req_2', 'Verified domain and brand', 'brand', 'S3', ['clm_4']),
    req('req_3', 'Published privacy policy', 'legal', 'S3'),
    req('req_4', 'Annual CASA security assessment', 'security', 'S3', ['clm_5', 'clm_6'], { low: 500, high: 4500 }),
  ],
  steps: steps([
    { stage: 'S0', title: 'Create a Cloud project', detail: 'Create a project and enable the Gmail API.', owner: 'you', min: [5, 10], url: 'https://console.cloud.google.com/', claims: ['clm_9'] },
    { stage: 'S0', title: 'Choose the narrowest Gmail scopes', detail: 'Prefer non-restricted scopes. Restricted scopes trigger the CASA path.', owner: 'agent', min: [3, 8], claims: ['clm_10', 'clm_5'], agentAction: 'Compare scopes against the features and flag restricted ones.' },
    { stage: 'S0', title: 'Configure the consent screen', detail: 'Set app name, support email, authorized domain.', owner: 'you', min: [8, 12], claims: ['clm_9'] },
    { stage: 'S1', title: 'Create the OAuth client and add test users', detail: 'Create a Web client, register redirect URIs, add your account as a test user, run the flow.', owner: 'you', min: [10, 15], claims: ['clm_1', 'clm_9'] },
    { stage: 'S2', title: 'Invite up to 100 test users', detail: 'Expect re-consent every 7 days while the app is in Testing.', owner: 'you', min: [5, 15], claims: ['clm_1', 'clm_2', 'clm_3'] },
    { stage: 'S3', title: 'Draft privacy policy, scope justifications and demo script', detail: 'These feed the verification submission.', owner: 'agent', min: [45, 90], agentAction: 'Draft the policy text, per-scope justifications and a video script.' },
    { stage: 'S3', title: 'Verify domain and submit for verification', detail: 'Verify the domain in Search Console and submit the app.', owner: 'you', min: [30, 60], claims: ['clm_4'] },
    { stage: 'S3', title: 'Wait for Google verification review', detail: 'Reported realistic timeline for restricted scopes.', owner: 'provider', min: [0, 0], wait: [28, 56], claims: ['clm_7'] },
    { stage: 'S3', title: 'Complete the CASA assessment with an assessor', detail: 'Engage an authorised assessor, remediate findings, obtain the letter of assessment. Repeats annually.', owner: 'you', min: [240, 960], claims: ['clm_5', 'clm_6', 'clm_11'] },
  ]),
  blockers: [
    blk('blk_1', 'Error 403: access_denied', 'The app is in Testing and the signed-in user is not on the test-user list.', 'Add the user under Audience > Test users, or publish the app.', ['clm_1']),
    blk('blk_2', 'invalid_grant', 'A test-user refresh token is older than 7 days.', 'Ask the user to consent again, or move to production.', ['clm_2']),
    blk('blk_3', 'This app is blocked', 'A Workspace admin blocked the app for their domain.', 'Ask the customer admin to allow the client ID.', ['clm_8']),
  ],
  scopes: [{ name: 'openid', tier: 'basic' }, { name: 'https://www.googleapis.com/auth/gmail.readonly', tier: 'restricted', note: 'Triggers CASA (unverified list membership).' }],
  uncertainties: [
    'CASA price and the 4-8 week timeline come from third parties; Google publishes neither.',
    'Developer effort for CASA is a guess and not sourced.',
    'Console steps are unverified until the hands-on attempt (PRD section 11).',
  ],
} as any));

guides.push(make({
  slug: 'linkedin-community-management', appName: 'LinkedIn (Community Mgmt)', appUrl: 'https://www.linkedin.com/', developerConsoleUrl: 'https://www.linkedin.com/developers/apps',
  docsUrl: 'https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review',
  oneLiner: 'Gated before you can test: approval first, then a tight cap, and a rejected app cannot reapply.', s2Limit: 'Development tier: 500 calls per app per 24 hours',
  sources: [
    src('src_1', 'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-api-migration-guide', 'Community Management API migration guide', 'official'),
    src('src_2', 'https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review', 'Community Management app review', 'official'),
  ],
  claims: [
    S('clm_1', 'Development tier: 500 calls per app per 24 hours, 100 per member, 12-month window.', ['src_1'], 0.9),
    S('clm_2', 'Development tier needs a verified organization website and domain, and the app verified by the company LinkedIn Page.', ['src_2']),
    S('clm_3', 'A rejected app cannot reapply; you must create a new app.', ['src_2']),
    S('clm_4', 'The Standard tier requires a screencast of each use case.', ['src_2']),
    U('clm_5', 'Approval wait times for both tiers are not published in the pages checked.', 'The waits below are ranges to confirm, not sourced figures.'),
    U('clm_6', 'Create the app at linkedin.com/developers/apps and associate it with a company LinkedIn Page.'),
  ],
  requirements: [
    req('req_1', 'Company LinkedIn Page', 'business', 'S0', ['clm_6']),
    req('req_2', 'Verified organization website and domain', 'brand', 'S1', ['clm_2']),
    req('req_3', 'Screencast of each use case', 'technical', 'S3', ['clm_4']),
  ],
  steps: steps([
    { stage: 'S0', title: 'Create the app and link the Company Page', detail: 'Create the app and send the page admin a verification request.', owner: 'you', min: [10, 20], url: 'https://www.linkedin.com/developers/apps', claims: ['clm_6'] },
    { stage: 'S0', title: 'Draft the use-case description', detail: 'Explain what the integration does and why it needs each product.', owner: 'agent', min: [20, 40], agentAction: 'Draft the application text from your feature list.' },
    { stage: 'S1', title: 'Verify website and domain; request Development tier', detail: 'The page admin verifies the app, then you apply for the Development tier.', owner: 'you', min: [15, 30], claims: ['clm_2'] },
    { stage: 'S1', title: 'Wait for Development tier approval', detail: 'Nothing can be tested until this clears. Duration is not published.', owner: 'provider', min: [0, 0], wait: [1, 14], claims: ['clm_5'] },
    { stage: 'S1', title: 'Run the OAuth flow', detail: 'Test inside the Development tier cap.', owner: 'you', min: [15, 30], claims: ['clm_1'] },
    { stage: 'S2', title: 'Operate within the cap', detail: '500 calls per app per day; 12-month window.', owner: 'you', min: [10, 30], claims: ['clm_1'] },
    { stage: 'S3', title: 'Script the use-case screencast', detail: 'Plan one recording per use case.', owner: 'agent', min: [20, 40], agentAction: 'Write the screencast script.' },
    { stage: 'S3', title: 'Record screencasts and apply for Standard tier', detail: 'Submit a screencast for every use case.', owner: 'you', min: [60, 180], claims: ['clm_4'] },
    { stage: 'S3', title: 'Wait for Standard tier review', detail: 'Duration is not published; a rejection means a new app.', owner: 'provider', min: [0, 0], wait: [14, 90], claims: ['clm_3', 'clm_5'] },
  ]),
  blockers: [blk('blk_1', 'Application rejected', 'reapply_penalty: a rejected app cannot reapply.', 'Create a new app, fix the cause in the use-case or screencast, and resubmit.', ['clm_3'])],
  scopes: [{ name: 'r_organization_social', tier: 'sensitive', note: 'Community Management scopes need the product approved.' }],
  uncertainties: ['Approval wait times are estimates; LinkedIn does not publish them in the pages checked.', 'LinkedIn Standard tier approval time cannot be verified without a paid, approved account.'],
} as any));

const dir = path.join(process.cwd(), 'seed', 'guides');
fs.mkdirSync(dir, { recursive: true });
for (const g of guides) {
  fs.writeFileSync(path.join(dir, `${g.slug}.json`), JSON.stringify(g, null, 2) + '\n');
  console.log(`${g.slug.padEnd(32)} difficulty ${g.verdict.difficulty} (${g.verdict.label})  agent ${g.verdict.agentShare}`);
}
