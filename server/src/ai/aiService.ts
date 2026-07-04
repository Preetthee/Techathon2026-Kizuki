/**
 * AI Service — orchestrator
 *
 * Full pipeline:
 *
 *   buildOfficeContext()          ← grounded, live data from state store
 *        ↓
 *   getCannedResponse()           ← short-circuit trivial queries (no LLM call)
 *        ↓
 *   buildSystemPrompt(context)    ← structured prompt with context injected
 *   buildUserMessage(question)
 *        ↓
 *   provider.complete(sys, user)  ← OpenAI / Gemini / DeepSeek / Ollama
 *        ↓
 *   AIResponse                    ← answer + metadata (provider, latency, etc.)
 *
 * Rate limiting
 * ─────────────
 * A simple in-process token bucket (10 requests / 60 s per caller ID).
 * Caller ID = socketId | IP address | Discord userId.
 * This prevents accidental loops from hammering the LLM API.
 */

import { buildOfficeContext, OfficeContext } from './contextBuilder';
import { buildSystemPrompt, buildUserMessage, getCannedResponse } from './promptBuilder';
import { getProvider } from './providers';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AIQuery {
  question:  string;
  callerId:  string;   // Discord userId, IP, socketId — used for rate limiting
}

export interface AIResponse {
  answer:      string;
  provider:    string;
  model:       string;
  latencyMs:   number;
  canned:      boolean;   // true if answered without an LLM call
  context:     OfficeContext;
  capturedAt:  string;
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────

const RATE_WINDOW_MS = 60_000;
const RATE_MAX       = 10;

const _rateBuckets = new Map<string, number[]>();

function isRateLimited(callerId: string): boolean {
  const now   = Date.now();
  const hits  = (_rateBuckets.get(callerId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  _rateBuckets.set(callerId, hits);
  return hits.length > RATE_MAX;
}

// ─── Core ask function ────────────────────────────────────────────────────────

export async function ask(query: AIQuery): Promise<AIResponse> {
  const start = Date.now();

  if (isRateLimited(query.callerId)) {
    throw Object.assign(
      new Error('Too many requests — please wait a moment before asking again.'),
      { statusCode: 429 }
    );
  }

  // Step 1: build grounded context from live state store (never from LLM)
  const context = buildOfficeContext();

  // Step 2: check for canned responses (no LLM call, instant)
  const canned = getCannedResponse(context, query.question);
  if (canned) {
    return {
      answer:     canned,
      provider:   'canned',
      model:      'none',
      latencyMs:  Date.now() - start,
      canned:     true,
      context,
      capturedAt: context.capturedAt,
    };
  }

  // Step 3: build prompts
  const systemPrompt = buildSystemPrompt(context);
  const userMessage  = buildUserMessage(query.question);

  // Step 4: call the LLM
  const provider = getProvider();

  try {
    const answer = await provider.complete(systemPrompt, userMessage);
    return {
      answer,
      provider:   provider.name,
      model:      provider.model,
      latencyMs:  Date.now() - start,
      canned:     false,
      context,
      capturedAt: context.capturedAt,
    };
  } catch (err: any) {
    console.error(`[ai] ${provider.name} error:`, err.message);
    throw Object.assign(
      new Error(`AI provider (${provider.name}) failed: ${err.message}`),
      { statusCode: 502 }
    );
  }
}

/** Returns the current office context without querying any LLM (useful for /ai/context debug endpoint). */
export function getContext(): OfficeContext {
  return buildOfficeContext();
}
