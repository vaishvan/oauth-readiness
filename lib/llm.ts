import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { mockTool } from './mock';

// OpenRouter is used whenever OPENROUTER_API_KEY is set; otherwise the Anthropic API.
const useOpenRouter = () => !!process.env.OPENROUTER_API_KEY;
export const MODEL_EXTRACT = () => process.env.MODEL_EXTRACT || (useOpenRouter() ? 'nvidia/nemotron-3-ultra-550b-a55b:free' : 'claude-sonnet-5-5');
export const MODEL_FAST = () => process.env.MODEL_FAST || (useOpenRouter() ? 'nvidia/nemotron-3.5-lightning:free' : 'claude-haiku-5-5');

export type Usage = { tokensIn: number; tokensOut: number; costUsd: number };
export const newUsage = (): Usage => ({ tokensIn: 0, tokensOut: 0, costUsd: 0 });

// USD per million tokens (in, out). ponytail: hardcoded Anthropic prices; OpenRouter reports the real cost per call.
const price = (model: string) => (model.includes('haiku') ? [1, 5] : [3, 15]);
export function addUsage(u: Usage, model: string, tin: number, tout: number, costUsd?: number) {
  const [pi, po] = price(model);
  u.tokensIn += tin;
  u.tokensOut += tout;
  u.costUsd += costUsd ?? (tin * pi + tout * po) / 1e6;
}

/** OpenAI-compatible chat completion with a forced function call. Returns the parsed arguments. */
async function openRouterCall(c: { model: string; system: string; maxTokens: number; usage: Usage; tool: { name: string; description: string } }, user: string, parameters: object) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'content-type': 'application/json',
      'http-referer': process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000',
      'x-title': 'OAuth Readiness',
    },
    body: JSON.stringify({
      model: c.model,
      max_tokens: c.maxTokens,
      temperature: 0,
      messages: [{ role: 'system', content: c.system }, { role: 'user', content: user }],
      tools: [{ type: 'function', function: { name: c.tool.name, description: c.tool.description, parameters } }],
      tool_choice: { type: 'function', function: { name: c.tool.name } },
      usage: { include: true },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw Object.assign(new Error(`OpenRouter ${res.status}: ${body.error?.message ?? 'request failed'}`), { status: body.error?.code ?? res.status });
  const u = body.usage ?? {};
  addUsage(c.usage, c.model, u.prompt_tokens ?? 0, u.completion_tokens ?? 0, typeof u.cost === 'number' ? u.cost : undefined);
  const call = body.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) return {}; // no tool call: Zod fails it and callTool makes the repair call
  try {
    return JSON.parse(call.function.arguments);
  } catch {
    return {}; // invalid JSON: let Zod fail it so the repair call runs
  }
}

let client: Anthropic | undefined;
const anthropic = () => (client ??= new Anthropic());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e: any) {
      const retryable = e?.status === 429 || e?.status === 529 || (e?.status >= 500 && e?.status < 600);
      if (!retryable || i >= 3) throw e;
      await sleep(1000 * 2 ** i + Math.random() * 250);
    }
  }
}

export type ToolCall<T> = {
  model: string;
  system: string;
  user: string;
  tool: { name: string; description: string; schema: z.ZodType<T, any, any> };
  maxTokens: number;
  usage: Usage;
  /** Called with the partially-parsed tool input while streaming. */
  onPartial?: (partial: any) => void;
};

/** Forced single tool call, validated with Zod; one repair call with the error text appended on invalid output. */
export async function callTool<T>(c: ToolCall<T>): Promise<T> {
  let user = c.user;
  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const input = await rawCall(c, user);
    const parsed = c.tool.schema.safeParse(input);
    if (parsed.success) return parsed.data;
    lastErr = parsed.error.issues.slice(0, 15).map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    user = `${c.user}\n\nYour previous output failed validation. Fix these errors and call the tool again:\n${lastErr}\n\nPrevious output:\n${JSON.stringify(input).slice(0, 20000)}`;
  }
  throw new Error(`Model output failed validation twice:\n${lastErr}`);
}

async function rawCall<T>(c: ToolCall<T>, user: string): Promise<unknown> {
  if (process.env.MOCK_PIPELINE === '1') {
    const r = await mockTool(c.tool.name, user, c.onPartial);
    addUsage(c.usage, c.model, 1500, 400);
    return r;
  }
  const { $schema, ...input_schema } = zodToJsonSchema(c.tool.schema, { $refStrategy: 'none', target: 'jsonSchema7' }) as any;
  if (useOpenRouter()) {
    // ponytail: no token streaming on OpenRouter; partial events arrive in one burst after the call. Stream SSE if the live feed feels empty.
    const input = await withRetry(() => openRouterCall(c, user, input_schema));
    c.onPartial?.(input);
    return input;
  }
  const params = {
    model: c.model,
    max_tokens: c.maxTokens,
    temperature: 0,
    system: c.system,
    messages: [{ role: 'user' as const, content: user }],
    tools: [{ name: c.tool.name, description: c.tool.description, input_schema }],
    tool_choice: { type: 'tool' as const, name: c.tool.name },
  };
  const msg = await withRetry(async () => {
    if (!c.onPartial) return anthropic().messages.create(params);
    const stream = anthropic().messages.stream(params);
    stream.on('inputJson', (_delta: string, snapshot: unknown) => c.onPartial!(snapshot));
    return stream.finalMessage();
  });
  addUsage(c.usage, c.model, msg.usage.input_tokens, msg.usage.output_tokens);
  const block: any = msg.content.find((b: any) => b.type === 'tool_use');
  if (!block) throw new Error('Model did not call the tool');
  return block.input;
}
