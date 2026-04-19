"use node";

/**
 * anthropic.ts — the callAgent wrapper. The single load-bearing file for every
 * Phase 4+ agent (R2, Leia, Ahsoka, Han). All model/retry/cost policy lives
 * here; agents just supply a system prompt + tool schema + (optionally) an
 * executor map.
 *
 * Design contract (locked for Phase 3+):
 *   - Model is hardcoded (see MODEL constant below) — no per-agent override
 *   - Anthropic client uses maxRetries: 0 so our loop is the sole retry authority
 *   - Retry delays: 1000ms / 2000ms / 4000ms + 0-500ms jitter (up to 3 retries)
 *   - retry-after-ms (ms) and retry-after (seconds) headers floor the delay
 *   - Retryable statuses: 408, 409, 425, 429, 500, 502, 503, 504, 529
 *   - Cost ceiling is checked BEFORE each turn using a worst-case estimate
 *     (MAX_TOKENS_PER_TURN × output price) — pitfall 7 defense
 *   - Two execution modes:
 *       1. Structured output: no `executors` → return after first tool_use turn
 *          (Phase 4 agents with tool_choice={type:"tool",name:X})
 *       2. Agentic: executors present → multi-turn loop until end_turn
 *   - Tool-result blocks go FIRST in the user reply content array, never
 *     interleaved with text (Anthropic API requirement, pitfall 2 defense)
 *   - Caller (not this file) writes agentActions rows — wrapper throws on
 *     terminal failure; caller's catch block is responsible for complete()/fail()
 *
 * CostCeilingError is exported so callers can `instanceof`-check it and tag
 * the agentActions row with status="cost_ceiling_hit" (distinct from generic
 * "failed"). Every other throw from this file is a standard Error and should
 * be logged as status="failed".
 */

import Anthropic from "@anthropic-ai/sdk";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { calculateCost } from "./cost";

// --- Constants (locked) -----------------------------------------------------

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS_PER_TURN = 4096;
const RETRY_DELAYS_MS = [1000, 2000, 4000];
const JITTER_MAX_MS = 500;
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);
const CLIENT_TIMEOUT_MS = 10 * 60 * 1000; // 10 min — matches Convex action budget

// --- Public error type ------------------------------------------------------

/**
 * Thrown when a Claude call is blocked pre-flight because the pipeline is
 * paused OR the per-run / daily cost ceiling would be exceeded by the
 * worst-case output cost of this next turn. Callers should catch this
 * separately from generic Error and patch agentActions.status =
 * "cost_ceiling_hit" (NOT "failed") so cost-ceiling trips are visible and
 * distinguishable from real failures in the dashboard.
 */
export class CostCeilingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CostCeilingError";
  }
}

// --- Public types -----------------------------------------------------------

export interface CallAgentParams {
  ctx: ActionCtx;
  agentName: string;
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  /**
   * Optional map of tool name → async executor. When undefined the wrapper
   * runs in structured-output mode and returns after the first tool_use turn
   * (Phase 4 single-tool agents). When provided the wrapper runs the full
   * multi-turn loop until stop_reason === "end_turn".
   */
  executors?: Record<string, (input: unknown) => Promise<unknown>>;
  toolChoice?: Anthropic.ToolChoice;
  runId?: string;
  prospectId?: string;
}

export interface CallAgentResult {
  finalMessage: Anthropic.Message;
  /** Every tool_use block seen across every turn (useful for structured-output agents). */
  toolUseResults: Array<{ name: string; input: unknown }>;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  turns: number;
  retries: number;
}

// --- Main wrapper -----------------------------------------------------------

export async function callAgent(params: CallAgentParams): Promise<CallAgentResult> {
  // Instantiate client once per invocation. No API-key presence check here —
  // the SDK throws a clear AuthenticationError if ANTHROPIC_API_KEY is missing.
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxRetries: 0, // we own retry
    timeout: CLIENT_TIMEOUT_MS,
  });

  // One pricing read per callAgent invocation — prices don't change mid-call.
  const pricing = await params.ctx.runQuery(internal.lib.cost.getPricing, {});

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalRetries = 0;
  let turns = 0;
  const messages: Anthropic.MessageParam[] = [...params.messages];
  const toolUseResults: Array<{ name: string; input: unknown }> = [];

  while (true) {
    // ----- Pre-turn cost-ceiling check (pitfall 7 defense) --------------------
    const ceiling = await params.ctx.runQuery(
      internal.agentActions.getCeilingState,
      // runId comes in as a string param but the query expects v.id("runs").
      // Convex validates the id at the call boundary; the `as any` is required
      // tech debt until a v.string()-accepting variant ships. Flagged in SUMMARY.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { runId: params.runId as any },
    );

    if (ceiling.paused) {
      throw new CostCeilingError("pipeline paused");
    }

    const currentCost = calculateCost(
      totalInputTokens,
      totalOutputTokens,
      pricing.inputPricePerMTok,
      pricing.outputPricePerMTok,
    );
    const estimatedMaxCost =
      (MAX_TOKENS_PER_TURN / 1_000_000) * pricing.outputPricePerMTok;

    if (
      ceiling.runCostSoFar + currentCost + estimatedMaxCost >
      ceiling.perRunCostCeilingUsd
    ) {
      throw new CostCeilingError(
        `per-run cost ceiling $${ceiling.perRunCostCeilingUsd} would be exceeded`,
      );
    }
    if (
      ceiling.dailyCostSoFar + currentCost + estimatedMaxCost >
      ceiling.dailyCostCeilingUsd
    ) {
      throw new CostCeilingError(
        `daily cost ceiling $${ceiling.dailyCostCeilingUsd} would be exceeded`,
      );
    }

    // ----- Retry loop wrapping a single client.messages.create ---------------
    let response: Anthropic.Message | undefined;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        response = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS_PER_TURN,
          system: params.system,
          tools: params.tools,
          tool_choice: params.toolChoice,
          messages,
        });
        break;
      } catch (err) {
        const isRetryable =
          err instanceof Anthropic.APIError &&
          RETRYABLE_STATUSES.has(err.status ?? 0);
        if (!isRetryable || attempt === RETRY_DELAYS_MS.length) {
          throw err;
        }

        let delayMs =
          RETRY_DELAYS_MS[attempt] + Math.random() * JITTER_MAX_MS;
        if (err instanceof Anthropic.APIError && err.headers) {
          const retryAfterMs = err.headers.get("retry-after-ms");
          const retryAfter = err.headers.get("retry-after");
          if (retryAfterMs) {
            delayMs = Math.max(delayMs, Number(retryAfterMs));
          } else if (retryAfter) {
            delayMs = Math.max(delayMs, Number(retryAfter) * 1000);
          }
        }

        console.warn(
          `[callAgent/${params.agentName}] turn ${turns + 1} attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : "unknown"}; retrying in ${Math.round(delayMs)}ms`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
        totalRetries++;
      }
    }
    if (!response) {
      throw new Error("callAgent: retry loop exited without response");
    }

    // ----- Accumulate tokens + capture tool_use inputs -----------------------
    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;
    turns++;

    for (const block of response.content) {
      if (block.type === "tool_use") {
        toolUseResults.push({ name: block.name, input: block.input });
      }
    }

    // ----- Exit conditions ---------------------------------------------------
    const returnResult = (): CallAgentResult => {
      const costUsd = calculateCost(
        totalInputTokens,
        totalOutputTokens,
        pricing.inputPricePerMTok,
        pricing.outputPricePerMTok,
      );
      return {
        finalMessage: response!,
        toolUseResults,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        costUsd,
        turns,
        retries: totalRetries,
      };
    };

    if (
      response.stop_reason === "end_turn" ||
      response.stop_reason === "stop_sequence" ||
      response.stop_reason === "max_tokens"
    ) {
      return returnResult();
    }

    if (response.stop_reason !== "tool_use") {
      throw new Error(`Unexpected stop_reason: ${response.stop_reason}`);
    }

    // Structured-output shortcut: when the caller didn't supply executors we're
    // only here to capture tool_use.input (Phase 4 single-tool agents). Saves
    // ~300 output tokens that would otherwise go to a wasted "I'll now explain"
    // second turn.
    if (!params.executors) {
      return returnResult();
    }

    // ----- Agentic mode: execute tools and loop ------------------------------
    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      const executor = params.executors[block.name];
      if (!executor) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `No executor for tool: ${block.name}`,
          is_error: true,
        });
        continue;
      }

      try {
        const output = await executor(block.input);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content:
            typeof output === "string" ? output : JSON.stringify(output),
        });
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: err instanceof Error ? err.message : "Unknown tool error",
          is_error: true,
        });
      }
    }

    // CRITICAL: tool_result blocks come FIRST in a user turn's content array,
    // never interleaved with text. Anthropic API returns HTTP 400 otherwise.
    messages.push({ role: "user", content: toolResults });
    // Loop continues — next iteration re-checks ceiling, fires next turn.
  }
}
