import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

/**
 * Phase 6: daily Rebel Alliance pipeline cron.
 *
 * Schedule: "0 10 * * *" UTC = 6:00am EDT (Mar–Nov) / 5:00am EST (Nov–Mar).
 * The DST one-hour winter drift is accepted. Convex cron runs UTC only.
 *
 * Convex prevents the same cron from overlapping itself (skips next fire if
 * previous is still running). The orchestrator also has a createIfNotActive
 * re-entrancy guard for manual dashboard triggers overlapping a cron run.
 *
 * Uses api.pipeline.runDaily (PUBLIC) — cron supports both api.X and internal.X,
 * but the dashboard also calls this action via useAction, so public = one path.
 */
const crons = cronJobs();

crons.cron(
  "rebel-alliance-daily-pipeline",
  "0 10 * * *",
  api.pipeline.runDaily,
  { triggeredBy: "cron" },
);

export default crons;
