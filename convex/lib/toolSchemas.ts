/**
 * toolSchemas.ts — single source of truth for every Anthropic tool JSON Schema
 * in the system.
 *
 * INFRA-05 contract: zero inline schemas in `convex/agents/*.ts`. Every agent
 * imports its schema from here so the shape is grep-able, versioned with the
 * file history, and shared between the agent and any dashboard code that needs
 * to render tool inputs.
 *
 * Phase 3 ships ONLY the test fixture (`addTwoNumbersSchema`) — it's the
 * payload the 03-03 smoke test uses to drive the callAgent wrapper
 * end-to-end against the live Anthropic API.
 *
 * Phase 4 extends this file with the real agent schemas — expected additions:
 *   - prospectScoreSchema     (R2 — prospect triage)
 *   - brandAndContentSchema   (Leia — StoryBrand brief + site.json copy)
 *   - reviewSchema            (Ahsoka — vision QA verdict)
 *   - outreachSchema          (Han — LinkedIn message draft)
 *   - finalizedOutreachSchema (Han — post-human-approval send payload)
 *
 * Why raw JSON Schema rather than zod:
 *   Anthropic's `input_schema` accepts a JSON-Schema object directly and the
 *   API enforces conformance server-side. A client-side zod layer would be
 *   redundant runtime validation of something Claude's tool-use contract
 *   already guarantees. Keeping schemas as plain data (`as const`) also means
 *   this file has zero imports and runs on the default Convex runtime without
 *   any SDK cost.
 */

export const addTwoNumbersSchema = {
  name: "add_two_numbers",
  description: "Add two numbers and return the sum as a string.",
  input_schema: {
    type: "object",
    properties: {
      a: { type: "number", description: "First addend" },
      b: { type: "number", description: "Second addend" },
    },
    required: ["a", "b"],
  },
} as const;
