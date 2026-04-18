import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Rebel Alliance — 9-table Convex schema.
 *
 * Every agent in the pipeline (R2, Leia, Chewie, Ahsoka, Han, Yoda) reads and
 * writes through these tables. Foreign keys use v.id("tableName") so the
 * Convex type system enforces referential shape across queries.
 *
 * Indexes are declared inline on defineTable() — any new query pattern should
 * add an index here rather than scanning a table at runtime.
 */
export default defineSchema({
  // ─────────────────────────────────────────────────────────────────────────
  // 1. runs — one row per daily pipeline run.
  //    Populated when the 6am ET cron kicks off; updated as agents progress.
  // ─────────────────────────────────────────────────────────────────────────
  runs: defineTable({
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("paused"),
    ),
    prospectsFound: v.number(),
    sitesBuilt: v.number(),
    totalCostUsd: v.number(),
    errorCount: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_startedAt", ["startedAt"]),

  // ─────────────────────────────────────────────────────────────────────────
  // 2. prospects — one row per business being processed end-to-end.
  //    buildSteps is Chewie's idempotency ledger — resumable deploys.
  // ─────────────────────────────────────────────────────────────────────────
  prospects: defineTable({
    businessName: v.string(),
    websiteDomain: v.string(),
    linkedinProfileUrl: v.optional(v.string()),
    market: v.string(),
    industry: v.string(),
    specificHooks: v.array(v.string()),
    status: v.union(
      v.literal("prospected"),
      v.literal("brief_ready"),
      v.literal("site_built"),
      v.literal("approved"),
      v.literal("queued_for_send"),
      v.literal("sent"),
      v.literal("rejected"),
      v.literal("failed"),
      v.literal("needs_manual_review"),
    ),
    runId: v.id("runs"),
    site_json: v.optional(v.any()),
    siteUrl: v.optional(v.string()),
    humanScore: v.optional(v.number()),
    retryCount: v.number(),
    takedownAt: v.optional(v.number()),
    templateVersion: v.optional(v.string()),
    buildSteps: v.object({
      repoCreated: v.boolean(),
      siteJsonPushed: v.boolean(),
      projectCreated: v.boolean(),
      domainAdded: v.boolean(),
      deployed: v.boolean(),
      certReady: v.boolean(),
      verified: v.boolean(),
    }),
  })
    .index("by_status", ["status"])
    .index("by_runId", ["runId"]),

  // ─────────────────────────────────────────────────────────────────────────
  // 3. prospectedBusinesses — 90-day dedup ledger.
  //    R2 checks this table before adding any new prospect to avoid
  //    re-contacting the same business within a quarter.
  // ─────────────────────────────────────────────────────────────────────────
  prospectedBusinesses: defineTable({
    businessNameNormalized: v.string(),
    websiteDomain: v.string(),
    linkedinProfileUrl: v.optional(v.string()),
    prospectedAt: v.number(),
  })
    .index("by_domain", ["websiteDomain"])
    .index("by_name", ["businessNameNormalized"]),

  // ─────────────────────────────────────────────────────────────────────────
  // 4. agentActions — every Claude call logged here.
  //    callAgent wrapper writes one row per LLM invocation with token/cost
  //    accounting so the dashboard and cost ceilings stay honest.
  // ─────────────────────────────────────────────────────────────────────────
  agentActions: defineTable({
    agentName: v.string(),
    prospectId: v.optional(v.id("prospects")),
    runId: v.optional(v.id("runs")),
    status: v.union(
      v.literal("in_flight"),
      v.literal("success"),
      v.literal("failed"),
    ),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    model: v.string(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  })
    .index("by_prospectId", ["prospectId"])
    .index("by_runId", ["runId"])
    .index("by_status", ["status"]),

  // ─────────────────────────────────────────────────────────────────────────
  // 5. approvalQueue — prospects awaiting human approval before outreach.
  //    Queue drains as humans approve/reject in the /approvals dashboard.
  // ─────────────────────────────────────────────────────────────────────────
  approvalQueue: defineTable({
    prospectId: v.id("prospects"),
    queuedAt: v.number(),
    reviewedAt: v.optional(v.number()),
    verdict: v.optional(
      v.union(v.literal("approved"), v.literal("rejected")),
    ),
    reviewerNote: v.optional(v.string()),
  })
    .index("by_prospectId", ["prospectId"])
    .index("by_verdict", ["verdict"]),

  // ─────────────────────────────────────────────────────────────────────────
  // 6. feedback — human verdicts for prompt tuning (feedback learning loop).
  //    Phase 10 reads this table to produce weekly prompt-improvement hints.
  // ─────────────────────────────────────────────────────────────────────────
  feedback: defineTable({
    prospectId: v.id("prospects"),
    agentName: v.string(),
    verdict: v.union(v.literal("approved"), v.literal("rejected")),
    reviewerNote: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_agentName", ["agentName"])
    .index("by_verdict", ["verdict"]),

  // ─────────────────────────────────────────────────────────────────────────
  // 7. errorLog — failures with stack traces for debugging/observability.
  // ─────────────────────────────────────────────────────────────────────────
  errorLog: defineTable({
    prospectId: v.optional(v.id("prospects")),
    runId: v.optional(v.id("runs")),
    agentName: v.optional(v.string()),
    message: v.string(),
    stack: v.optional(v.string()),
    createdAt: v.number(),
    severity: v.union(
      v.literal("warning"),
      v.literal("error"),
      v.literal("critical"),
    ),
  })
    .index("by_runId", ["runId"])
    .index("by_severity", ["severity"]),

  // ─────────────────────────────────────────────────────────────────────────
  // 8. pipelineControl — singleton safety controls (kill switch + ceilings).
  //    Exactly one row; seeded by initPipelineControl on first deploy.
  //    No indexes needed.
  // ─────────────────────────────────────────────────────────────────────────
  pipelineControl: defineTable({
    paused: v.boolean(),
    dryRun: v.boolean(),
    dailyCostCeilingUsd: v.number(),
    perRunCostCeilingUsd: v.number(),
    dailySendCap: v.number(),
    inputTokenCostPer1M: v.optional(v.number()),
    outputTokenCostPer1M: v.optional(v.number()),
  }),

  // ─────────────────────────────────────────────────────────────────────────
  // 9. suppressions — businesses to never contact (hard deny list).
  //    R2 consults this before adding a prospect; Han consults before sending.
  // ─────────────────────────────────────────────────────────────────────────
  suppressions: defineTable({
    businessNameNormalized: v.string(),
    linkedinProfileUrl: v.optional(v.string()),
    websiteDomain: v.optional(v.string()),
    reason: v.optional(v.string()),
    suppressedAt: v.number(),
  })
    .index("by_name", ["businessNameNormalized"])
    .index("by_linkedin", ["linkedinProfileUrl"])
    .index("by_domain", ["websiteDomain"]),
});
