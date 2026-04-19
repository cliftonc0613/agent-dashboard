"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { callAgent } from "../lib/anthropic";
import { addTwoNumbersSchema } from "../lib/toolSchemas";

/**
 * runSmokeTest — Phase 3 end-to-end validation harness.
 *
 * PRECONDITION: Before invoking, the human must:
 *   1. Set env vars in dev Convex: `npx convex env set ANTHROPIC_API_KEY sk-ant-...`
 *      Also: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (for Telegram delivery).
 *   2. Set pipelineControl.paused to false via the Convex dashboard (default is true).
 *
 * INVOCATION: `npx convex run agents/_test:runSmokeTest`
 *
 * EXPECTED OUTCOMES (INFRA success criteria validated):
 *   - A new agentActions row appears with status="in_flight", then patches to "success".
 *   - Row has inputTokens > 0, outputTokens > 0, costUsd > 0.
 *   - Claude uses the add_two_numbers tool (schema imported from toolSchemas.ts — zero inline).
 *   - A Telegram message arrives on the configured chat.
 *
 * The action returns { ok, actionId, inputTokens, outputTokens, costUsd, turns, retries } on success.
 * On any failure, the agentActions row is patched to "failed" and the error is rethrown.
 *
 * NOT FOR PRODUCTION. Phase 4 agents use their own structured callAgent invocations.
 *
 * Why the `_` prefix: convention, not enforced. Signals "internal test harness,
 * not production." Phase 4 agents will NOT import from this file.
 *
 * Why `tool_choice` is omitted: forces the multi-turn path (Claude decides to
 * use the tool, executor runs, Claude gets the result back, explains it, hits
 * end_turn). This exercises the harder code path in the wrapper — the loop.
 */
export const runSmokeTest = internalAction({
  args: {},
  handler: async (ctx) => {
    const actionId: Id<"agentActions"> = await ctx.runMutation(
      internal.agentActions.startInFlight,
      {
        agentName: "test",
        model: "claude-sonnet-4-6",
        startedAt: Date.now(),
      },
    );

    try {
      const result = await callAgent({
        ctx,
        agentName: "test",
        system:
          "You are a test agent. Use the add_two_numbers tool to compute 7 + 3 and then explain the answer.",
        messages: [
          {
            role: "user",
            content:
              "What is 7 + 3? Use the add_two_numbers tool, then tell me the answer.",
          },
        ],
        // `as any` needed — `as const` narrow type from toolSchemas.ts doesn't
        // match Anthropic.Tool's wider shape. The runtime payload is identical.
        tools: [addTwoNumbersSchema as any],
        executors: {
          add_two_numbers: async (input: unknown) => {
            const { a, b } = input as { a: number; b: number };
            return String(a + b);
          },
        },
        // tool_choice intentionally omitted → Claude picks freely; multi-turn
        // loop exercised (exactly what we want to validate).
      });

      await ctx.runMutation(internal.agentActions.complete, {
        id: actionId,
        status: "success",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        finishedAt: Date.now(),
      });

      await ctx.runAction(internal.lib.telegram.sendTelegram, {
        character: "R2-D2",
        level: "success",
        title: "Phase 3 smoke test passed",
        body: `Tokens in: ${result.inputTokens}\nTokens out: ${result.outputTokens}\nCost: $${result.costUsd.toFixed(6)}\nTurns: ${result.turns}\nRetries: ${result.retries}`,
      });

      return {
        ok: true,
        actionId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        turns: result.turns,
        retries: result.retries,
      };
    } catch (err) {
      await ctx.runMutation(internal.agentActions.fail, {
        id: actionId,
        errorMessage: err instanceof Error ? err.message : String(err),
        finishedAt: Date.now(),
      });
      throw err;
    }
  },
});
