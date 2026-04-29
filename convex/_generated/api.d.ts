/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentActions from "../agentActions.js";
import type * as agents__test from "../agents/_test.js";
import type * as agents_ahsoka from "../agents/ahsoka.js";
import type * as agents_chewie from "../agents/chewie.js";
import type * as agents_han from "../agents/han.js";
import type * as agents_leia from "../agents/leia.js";
import type * as agents_luke from "../agents/luke.js";
import type * as agents_r2 from "../agents/r2.js";
import type * as approvalQueue from "../approvalQueue.js";
import type * as crons from "../crons.js";
import type * as errorLog from "../errorLog.js";
import type * as lib_anthropic from "../lib/anthropic.js";
import type * as lib_browserless from "../lib/browserless.js";
import type * as lib_chewieDeterministic from "../lib/chewieDeterministic.js";
import type * as lib_chewieValidator from "../lib/chewieValidator.js";
import type * as lib_cloudflare from "../lib/cloudflare.js";
import type * as lib_cloudflareDns from "../lib/cloudflareDns.js";
import type * as lib_cost from "../lib/cost.js";
import type * as lib_firecrawl from "../lib/firecrawl.js";
import type * as lib_fuzzyDedup from "../lib/fuzzyDedup.js";
import type * as lib_github from "../lib/github.js";
import type * as lib_githubRetry from "../lib/githubRetry.js";
import type * as lib_githubTree from "../lib/githubTree.js";
import type * as lib_hanValidation from "../lib/hanValidation.js";
import type * as lib_htmlStrip from "../lib/htmlStrip.js";
import type * as lib_images from "../lib/images.js";
import type * as lib_linkedinVerify from "../lib/linkedinVerify.js";
import type * as lib_lukeDesignPrompt from "../lib/lukeDesignPrompt.js";
import type * as lib_serpapi from "../lib/serpapi.js";
import type * as lib_telegram from "../lib/telegram.js";
import type * as lib_toolSchemas from "../lib/toolSchemas.js";
import type * as migrations_debugBuildSteps from "../migrations/debugBuildSteps.js";
import type * as migrations_lukeBuildStepsBackfill from "../migrations/lukeBuildStepsBackfill.js";
import type * as migrations_lukePagesBackfill from "../migrations/lukePagesBackfill.js";
import type * as migrations_lukePolishBackfill from "../migrations/lukePolishBackfill.js";
import type * as migrations_resetImagesSourced from "../migrations/resetImagesSourced.js";
import type * as pipeline from "../pipeline.js";
import type * as pipelineControl from "../pipelineControl.js";
import type * as prospectedBusinesses from "../prospectedBusinesses.js";
import type * as prospects from "../prospects.js";
import type * as runs from "../runs.js";
import type * as seed from "../seed.js";
import type * as suppressions from "../suppressions.js";
import type * as triggers from "../triggers.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentActions: typeof agentActions;
  "agents/_test": typeof agents__test;
  "agents/ahsoka": typeof agents_ahsoka;
  "agents/chewie": typeof agents_chewie;
  "agents/han": typeof agents_han;
  "agents/leia": typeof agents_leia;
  "agents/luke": typeof agents_luke;
  "agents/r2": typeof agents_r2;
  approvalQueue: typeof approvalQueue;
  crons: typeof crons;
  errorLog: typeof errorLog;
  "lib/anthropic": typeof lib_anthropic;
  "lib/browserless": typeof lib_browserless;
  "lib/chewieDeterministic": typeof lib_chewieDeterministic;
  "lib/chewieValidator": typeof lib_chewieValidator;
  "lib/cloudflare": typeof lib_cloudflare;
  "lib/cloudflareDns": typeof lib_cloudflareDns;
  "lib/cost": typeof lib_cost;
  "lib/firecrawl": typeof lib_firecrawl;
  "lib/fuzzyDedup": typeof lib_fuzzyDedup;
  "lib/github": typeof lib_github;
  "lib/githubRetry": typeof lib_githubRetry;
  "lib/githubTree": typeof lib_githubTree;
  "lib/hanValidation": typeof lib_hanValidation;
  "lib/htmlStrip": typeof lib_htmlStrip;
  "lib/images": typeof lib_images;
  "lib/linkedinVerify": typeof lib_linkedinVerify;
  "lib/lukeDesignPrompt": typeof lib_lukeDesignPrompt;
  "lib/serpapi": typeof lib_serpapi;
  "lib/telegram": typeof lib_telegram;
  "lib/toolSchemas": typeof lib_toolSchemas;
  "migrations/debugBuildSteps": typeof migrations_debugBuildSteps;
  "migrations/lukeBuildStepsBackfill": typeof migrations_lukeBuildStepsBackfill;
  "migrations/lukePagesBackfill": typeof migrations_lukePagesBackfill;
  "migrations/lukePolishBackfill": typeof migrations_lukePolishBackfill;
  "migrations/resetImagesSourced": typeof migrations_resetImagesSourced;
  pipeline: typeof pipeline;
  pipelineControl: typeof pipelineControl;
  prospectedBusinesses: typeof prospectedBusinesses;
  prospects: typeof prospects;
  runs: typeof runs;
  seed: typeof seed;
  suppressions: typeof suppressions;
  triggers: typeof triggers;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
