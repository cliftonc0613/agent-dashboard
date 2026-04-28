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
      v.literal("partial"),
    ),
    prospectsFound: v.number(),
    sitesBuilt: v.number(),
    totalCostUsd: v.number(),
    errorCount: v.number(),
    triggeredBy: v.optional(v.union(v.literal("cron"), v.literal("manual"))),
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

    // Leia Stage 1 output — brand brief + 4 data files + StoryBrand copy. v.any()
    // because the schema is structured JSON whose shape is owned by Leia's tool
    // schema (brandAndContentSchema in toolSchemas.ts) not enforced at the DB
    // layer. Validated by Leia's tool_use response contract.
    leiaOutput: v.optional(v.any()),

    // Ahsoka's review — 5-dim scores + verdict + findings. v.any() for the same
    // reason as leiaOutput: shape owned by reviewSchema.
    ahsokaReview: v.optional(v.any()),

    // Han's LinkedIn DM draft body. Contains exactly one {{SITE_URL}} placeholder
    // until Phase 8 finalize step swaps the real deployed URL in.
    hanDraft: v.optional(v.string()),

    // Rejection reason populated when any agent validator rejects a prospect
    // (e.g. Han draft had banned phrase, R2 scored disqualify=true, Ahsoka
    // verdict=rejected). Read by the approval dashboard so humans can see why.
    rejectionReason: v.optional(v.string()),

    // Chewie naming contract — set ONCE on first attempt; reused verbatim on every retry
    repoName: v.optional(v.string()),
    customSubdomain: v.optional(v.string()),
    cfProjectName: v.optional(v.string()),

    // Two-URL pattern:
    //   pagesDevUrl — *.pages.dev URL, written after step 5 (deployment).
    //   siteUrl     — already exists in schema from Phase 4.
    pagesDevUrl: v.optional(v.string()),

    // Chewie's audit trail for inferences beyond literal prospect data
    chewieNotes: v.optional(v.string()),

    // Phase 5.5 (Luke) — agent output + signal fields. lukeOutput shape owned by
    // Luke's tool schema (lukeOutputSchema in toolSchemas.ts), validated at
    // tool_use response time, not at the DB layer.
    lukeOutput: v.optional(v.any()),
    dnsWarn: v.optional(v.boolean()),
    lukeFailedReason: v.optional(v.string()),

    buildSteps: v.object({
      repoCreated: v.boolean(),
      siteJsonPushed: v.boolean(),
      projectCreated: v.boolean(),
      domainAdded: v.boolean(),
      deployed: v.boolean(),
      certReady: v.boolean(),
      verified: v.boolean(),
      // Phase 5.5 (Luke) — required after one-shot backfill via migrations/lukeBuildStepsBackfill.
      dnsCreated: v.boolean(),
      imagesSourced: v.boolean(),
      designApplied: v.boolean(),
      polishApplied: v.boolean(),
      pagesPolished: v.boolean(),
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
      v.literal("cost_ceiling_hit"),
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
    pausedReason: v.optional(v.string()),
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
