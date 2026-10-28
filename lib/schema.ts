import { z } from 'zod';

export const EvidenceKind = z.enum(['tested', 'sourced', 'unverified']);
export const Owner = z.enum(['agent', 'you', 'provider']); // provider = waiting on their review
export const Stage = z.enum(['S0', 'S1', 'S2', 'S3']);

export const Source = z.object({
  id: z.string(),
  url: z.string().url(),
  title: z.string().max(200),
  publisher: z.enum(['official', 'third_party', 'community']),
  fetchedAt: z.string().datetime(),
});

export const Evidence = z.object({
  kind: EvidenceKind,
  sourceIds: z.array(z.string()).default([]), // length >= 1 when kind = 'sourced'
  note: z.string().max(280).optional(),
  quote: z.string().max(300).optional(), // exact text from the source, checked in verify stage
});

export const Claim = z.object({
  id: z.string(),
  text: z.string().max(400),
  evidence: Evidence,
  confidence: z.number().min(0).max(1),
});

export const Step = z.object({
  id: z.string(),
  stage: Stage,
  title: z.string().max(80),
  detail: z.string().max(1200),
  owner: Owner,
  agentAction: z.string().max(300).optional(),
  estMinutes: z.object({ low: z.number().int(), high: z.number().int() }),
  waitDays: z.object({ low: z.number(), high: z.number() }).optional(),
  url: z.string().url().optional(),
  claimIds: z.array(z.string()),
});

export const Requirement = z.object({
  id: z.string(),
  label: z.string().max(120),
  category: z.enum(['account', 'legal', 'brand', 'technical', 'security', 'business', 'cost']),
  requiredAt: Stage,
  costUsd: z.object({ low: z.number(), high: z.number() }).optional(),
  claimIds: z.array(z.string()),
});

export const Blocker = z.object({
  id: z.string(),
  symptom: z.string().max(200),
  cause: z.string().max(400),
  fix: z.string().max(600),
  claimIds: z.array(z.string()),
});

export const Guide = z.object({
  schemaVersion: z.literal(1),
  slug: z.string().regex(/^[a-z0-9-]{2,60}$/),
  appName: z.string(),
  appUrl: z.string().url(),
  developerConsoleUrl: z.string().url().nullable(),
  docsUrl: z.string().url().nullable(),
  oauthVersion: z.enum(['oauth2', 'oauth1a', 'unknown']),
  pkceSupported: z.enum(['yes', 'no', 'unknown']),
  refreshTokens: z.enum(['yes', 'no', 'unknown']),
  composioManaged: z.enum(['yes', 'no', 'unknown']),
  verdict: z.object({
    difficulty: z.number().int().min(1).max(5),
    label: z.enum(['Instant', 'Easy', 'Moderate', 'Hard', 'Gated']),
    oneLiner: z.string().max(160),
    timeToS1: z.object({ lowMin: z.number(), highMin: z.number() }),
    timeToS3: z.object({ lowDays: z.number(), highDays: z.number(), hasReview: z.boolean() }),
    s2Limit: z.string().max(160).nullable(),
    agentShare: z.number().min(0).max(1),
  }),
  scopes: z
    .array(
      z.object({
        name: z.string(),
        tier: z.enum(['basic', 'sensitive', 'restricted', 'unknown']),
        note: z.string().max(200).optional(),
      }),
    )
    .max(30),
  requirements: z.array(Requirement),
  steps: z.array(Step).min(3).max(25),
  blockers: z.array(Blocker).max(12),
  claims: z.array(Claim),
  sources: z.array(Source).min(1),
  uncertainties: z.array(z.string().max(300)).max(10),
  meta: z.object({
    origin: z.enum(['seed', 'live']),
    generatedAt: z.string().datetime(),
    model: z.string(),
    durationMs: z.number().int(),
    tokensIn: z.number().int(),
    tokensOut: z.number().int(),
    costUsd: z.number(),
    reviewedByHuman: z.boolean(),
    validationWarnings: z.array(z.string()).default([]),
    promptVersion: z.string().optional(),
  }),
});
export type Guide = z.infer<typeof Guide>;
export type Step = z.infer<typeof Step>;
export type Source = z.infer<typeof Source>;
export type Claim = z.infer<typeof Claim>;

export const GuideDraft = Guide.omit({ meta: true });
export type GuideDraft = z.infer<typeof GuideDraft>;

export type PipelineEvent =
  | { type: 'stage'; stage: 'resolve' | 'discover' | 'read' | 'probe' | 'extract' | 'verify'; status: 'start' | 'done'; ms?: number }
  | { type: 'resolved'; appName: string; domain: string; slug: string }
  | { type: 'needs_choice'; candidates: { appName: string; domain: string }[] }
  | { type: 'source'; id: string; url: string; title: string; publisher: 'official' | 'third_party' | 'community' }
  | { type: 'probe'; check: 'oidc' | 'console' | 'authorize'; ok: boolean; detail: string }
  | { type: 'partial'; field: 'verdict' | 'steps' | 'blockers'; value: unknown }
  | { type: 'claim_checked'; claimId: string; from: string; to: string; confidence: number }
  | { type: 'warn'; message: string }
  | { type: 'done'; slug: string; durationMs: number; costUsd: number }
  | { type: 'error'; message: string; retryable: boolean };

export type GuideSummary = {
  slug: string;
  appName: string;
  domain: string;
  difficulty: number;
  label: Guide['verdict']['label'];
  timeToS1: Guide['verdict']['timeToS1'];
  timeToS3: Guide['verdict']['timeToS3'];
  composioManaged: Guide['composioManaged'];
  origin: 'seed' | 'live';
  oneLiner: string;
};
