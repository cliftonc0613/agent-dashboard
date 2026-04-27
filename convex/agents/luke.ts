"use node";

/**
 * luke.ts — Luke Skywalker, the visual design Jedi.
 *
 * Phase 5.5 main agent. Runs after Chewie sets status="site_built". Performs
 * three idempotent gated steps so a crash + re-run skips already-completed work:
 *
 *   Step 1 — dnsCreated   : POST CNAME for customSubdomain → cfProjectName.pages.dev
 *   Step 2 — imagesSourced: source 3 images (hero + 2 supporting), inject CDN
 *                           URLs into business.ts via single atomic Trees commit
 *   Step 3 — designApplied: one Claude call (LUKE_SYSTEM_PROMPT + lukeDesignSchema),
 *                           regenerate global.css, atomic Trees commit of
 *                           global.css + DESIGN.md (single CF Pages rebuild)
 *
 * Failure model:
 *   - DNS failure is warn-and-continue — site stays on .pages.dev URL, set
 *     dnsWarn=true, log to chewieNotes, proceed. Pipeline never blocks on DNS.
 *   - Image search fully exhausting (Unsplash + Pexels + Picsum all throw) is
 *     fatal — Luke marks lukeFailedReason and the action throws.
 *   - Claude call failure is fatal.
 *   - Luke does NOT change prospect.status — stays "site_built" so Ahsoka picks
 *     it up regardless. lukeFailedReason is the visible signal for failures.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createCnameRecord } from "../lib/cloudflareDns";
import {
  searchImagesWithFallback,
  composeImageQuery,
  BUSINESS_TYPE_QUERIES,
  type SearchedImage,
} from "../lib/images";
import { commitTree } from "../lib/githubTree";
import {
  stageTasteDesignSchema,
  stageColorizeSchema,
  stageTypesetSchema,
  stageBolderSchema,
} from "../lib/toolSchemas";
import {
  LUKE_PROMPT_TASTE,
  LUKE_PROMPT_COLORIZE,
  LUKE_PROMPT_TYPESET,
  LUKE_PROMPT_BOLDER,
} from "../lib/lukeDesignPrompt";
import { callAgent, CostCeilingError } from "../lib/anthropic";
import {
  generateGlobalCss,
  deriveBrandColorScale,
  type BrandColorScale,
} from "../lib/chewieDeterministic";
import { pollDeploymentReady } from "../lib/cloudflare";

interface LukeDesignToolInput {
  brandColorScale: BrandColorScale;
  fonts: { display: string; body: string };
  atmosphere: string;
  designPrinciples: string[];
  imageQueries: { hero: string; supporting: string[] };
  designMdBody: string;
}

interface ProspectImageRecord {
  role: "hero" | "about" | "extra";
  url: string;
  source: SearchedImage["source"];
  attribution: string;
  alt: string;
}

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const BRAND_KEYS: ReadonlyArray<keyof BrandColorScale> = [
  "brand50",
  "brand100",
  "brand200",
  "brand300",
  "brand400",
  "brand500",
  "brand600",
  "brand700",
  "brand800",
  "brand900",
  "brand950",
];

function isValidBrandColorScale(scale: unknown): scale is BrandColorScale {
  if (!scale || typeof scale !== "object") return false;
  const obj = scale as Record<string, unknown>;
  return BRAND_KEYS.every(
    (k) => typeof obj[k] === "string" && HEX_RE.test(obj[k] as string),
  );
}

/**
 * upsertField — robust regex update of `key: 'value'` (or `"value"`) inside the
 * `business` object literal. If the key is missing, append before the closing
 * `};` of the const block.
 */
function upsertField(src: string, key: string, val: string): string {
  const re = new RegExp(`(${key}\\s*:\\s*)(["'])([^"']*)(["'])`, "g");
  if (re.test(src)) {
    return src.replace(re, `$1$2${val}$4`);
  }
  return src.replace(/(\n\}\s*;\s*)$/, `,\n  ${key}: '${val}',\n};`);
}

function summarizeLeiaForLuke(leia: unknown): string {
  if (!leia || typeof leia !== "object") return "(no Leia output available)";
  const l = leia as Record<string, unknown>;
  const brand = l.brand as Record<string, unknown> | undefined;
  const palette = brand?.palette as Record<string, string> | undefined;
  const fonts = brand?.fonts as Record<string, string> | undefined;
  const sb = l.storyBrandCopy as Record<string, unknown> | undefined;
  const hero = sb?.hero as Record<string, unknown> | undefined;
  const lines: string[] = [];
  if (brand?.emotion) lines.push(`Emotion: ${brand.emotion}`);
  if (brand?.voice) lines.push(`Voice: ${brand.voice}`);
  if (palette?.primary) lines.push(`Leia primary hex: ${palette.primary}`);
  if (palette?.secondary) lines.push(`Leia secondary hex: ${palette.secondary}`);
  if (palette?.accent) lines.push(`Leia accent hex: ${palette.accent}`);
  if (fonts?.heading) lines.push(`Leia heading font: ${fonts.heading}`);
  if (fonts?.body) lines.push(`Leia body font: ${fonts.body}`);
  if (l.layoutVariant) lines.push(`Layout variant: ${String(l.layoutVariant)}`);
  if (hero?.headline) lines.push(`Hero headline: ${String(hero.headline)}`);
  return lines.join("\n");
}

function composeLukeUserPrompt(prospect: {
  businessName: string;
  industry: string;
  market: string;
  websiteDomain: string;
  leiaOutput?: unknown;
  lukeOutput?: { images?: ProspectImageRecord[] } | null;
}): string {
  const images = prospect.lukeOutput?.images ?? [];
  const imageBlock =
    images.length > 0
      ? images
          .map(
            (img) =>
              `- ${img.role}: ${img.url} (source: ${img.source}; alt: ${img.alt}; attribution: ${img.attribution})`,
          )
          .join("\n")
      : "(images not yet sourced)";

  return [
    "## Business",
    `Name: ${prospect.businessName}`,
    `Industry: ${prospect.industry}`,
    `Market: ${prospect.market}`,
    `Website: ${prospect.websiteDomain}`,
    "",
    "## Leia Brand Brief Summary",
    summarizeLeiaForLuke(prospect.leiaOutput),
    "",
    "## Images Already Sourced (use these for image direction context)",
    imageBlock,
    "",
    "Now call submit_design_pass with the complete design output. brand500 should anchor on Leia's primary hex unless that hex is wrong for the atmosphere — in which case shift hue minimally and explain in designMdBody.",
  ].join("\n");
}

export const run = internalAction({
  args: {
    prospectId: v.id("prospects"),
    runId: v.optional(v.id("runs")),
  },
  handler: async (ctx, args) => {
    const actionId: Id<"agentActions"> = await ctx.runMutation(
      internal.agentActions.startInFlight,
      {
        agentName: "luke",
        prospectId: args.prospectId,
        runId: args.runId,
        model: "claude-sonnet-4-6",
        startedAt: Date.now(),
      },
    );

    try {
      let prospect = await ctx.runQuery(internal.prospects.get, {
        id: args.prospectId,
      });
      if (!prospect) throw new Error(`Prospect ${args.prospectId} not found`);
      if (prospect.status !== "site_built") {
        throw new Error(
          `Luke requires status=site_built, got: ${prospect.status}`,
        );
      }
      if (!prospect.repoName) throw new Error("Luke: missing prospect.repoName");
      if (!prospect.cfProjectName)
        throw new Error("Luke: missing prospect.cfProjectName");
      if (!prospect.customSubdomain)
        throw new Error("Luke: missing prospect.customSubdomain");
      if (!prospect.leiaOutput)
        throw new Error("Luke: missing prospect.leiaOutput");

      // Snapshot the naming triple — Chewie sets these once per prospect and
      // never changes them, so they remain valid across post-mutation re-reads.
      // Capturing as local consts also satisfies the type narrower since
      // re-reading prospect resets the optional types to undefined-eligible.
      const repoName: string = prospect.repoName;
      const cfProjectName: string = prospect.cfProjectName;
      const customSubdomain: string = prospect.customSubdomain;

      const githubToken = process.env.GITHUB_TOKEN;
      const githubUsername = process.env.GITHUB_USERNAME;
      const cfApiToken = process.env.CF_API_TOKEN;
      const cfZoneId = process.env.CF_ZONE_ID;
      const cfAccountId = process.env.CF_ACCOUNT_ID;
      const unsplashKey = process.env.UNSPLASH_ACCESS_KEY ?? "";
      const pexelsKey = process.env.PEXELS_API_KEY ?? "";
      if (
        !githubToken ||
        !githubUsername ||
        !cfApiToken ||
        !cfZoneId ||
        !cfAccountId
      ) {
        throw new Error(
          "Luke: missing required env vars (GITHUB_TOKEN, GITHUB_USERNAME, CF_API_TOKEN, CF_ZONE_ID, CF_ACCOUNT_ID)",
        );
      }

      // ---------------------------------------------------------------------
      // STEP 1 — dnsCreated (warn-and-continue on failure)
      // ---------------------------------------------------------------------
      if (!prospect.buildSteps.dnsCreated) {
        try {
          const target = `${cfProjectName}.pages.dev`;
          await createCnameRecord({
            cfApiToken,
            cfZoneId,
            name: customSubdomain,
            content: target,
          });
          await ctx.runMutation(internal.prospects.markBuildStep, {
            id: args.prospectId,
            step: "dnsCreated",
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const note = `\n[luke] DNS create failed: ${msg}`;
          await ctx.runMutation(internal.prospects.patch, {
            id: args.prospectId,
            dnsWarn: true,
            chewieNotes: (prospect.chewieNotes ?? "") + note,
          });
          console.warn(
            `[luke] DNS create failed for ${customSubdomain}: ${msg} — continuing without DNS`,
          );
        }
        prospect = await ctx.runQuery(internal.prospects.get, {
          id: args.prospectId,
        });
        if (!prospect) throw new Error(`Prospect ${args.prospectId} disappeared`);
      }

      // ---------------------------------------------------------------------
      // STEP 2 — imagesSourced (single atomic Trees commit: business.ts)
      // ---------------------------------------------------------------------
      if (!prospect.buildSteps.imagesSourced) {
        const industryRaw = prospect.industry ?? "";
        const industryKey = industryRaw.toLowerCase().replace(/[^a-z]+/g, "_");
        const mapping = BUSINESS_TYPE_QUERIES[industryKey];
        const heroQuery =
          mapping?.hero ?? composeImageQuery(industryRaw || "service", "");
        const supportingQueries = mapping?.supporting ?? [
          `${industryRaw || "service"} work, professional`,
          `${industryRaw || "service"} service, residential`,
        ];

        const heroResults = await searchImagesWithFallback(
          heroQuery,
          1,
          unsplashKey,
          pexelsKey,
        );
        const aboutResults = await searchImagesWithFallback(
          supportingQueries[0],
          1,
          unsplashKey,
          pexelsKey,
        );
        const extraResults = await searchImagesWithFallback(
          supportingQueries[1] ?? supportingQueries[0],
          1,
          unsplashKey,
          pexelsKey,
        );

        const hero = heroResults[0];
        const aboutImg = aboutResults[0];
        const extraImg = extraResults[0];
        if (!hero) {
          throw new Error("Luke: image search returned no hero image");
        }

        // Read current business.ts via GitHub Contents API. The Contents API
        // always returns content as base64 — running upsertField regex against
        // the raw base64 string would corrupt the file. Decode first.
        const contentsUrl = `https://api.github.com/repos/${githubUsername}/${repoName}/contents/src/data/business.ts`;
        const contentsResp = await fetch(contentsUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "rebel-alliance-luke",
          },
        });
        if (!contentsResp.ok) {
          const body = await contentsResp.text();
          throw new Error(
            `Luke: GET business.ts failed ${contentsResp.status}: ${body.slice(0, 200)}`,
          );
        }
        const contentsJson = (await contentsResp.json()) as {
          content: string;
          encoding: string;
          sha: string;
        };
        if (contentsJson.encoding !== "base64") {
          throw new Error(
            `Luke: unexpected encoding from GitHub Contents API: ${contentsJson.encoding}`,
          );
        }
        const currentBusinessTs = Buffer.from(
          contentsJson.content,
          "base64",
        ).toString("utf8");

        let updatedBusinessTs = upsertField(
          currentBusinessTs,
          "heroImage",
          hero.url,
        );
        if (aboutImg) {
          updatedBusinessTs = upsertField(
            updatedBusinessTs,
            "aboutImage",
            aboutImg.url,
          );
        }

        const { commitSha: imageCommitSha } = await commitTree({
          githubToken,
          owner: githubUsername,
          repoName,
          files: [{ path: "src/data/business.ts", content: updatedBusinessTs }],
          commitMessage: "feat(luke): inject heroImage + aboutImage CDN URLs",
        });

        const images: ProspectImageRecord[] = [
          {
            role: "hero",
            url: hero.url,
            source: hero.source,
            attribution: hero.attribution,
            alt: hero.alt,
          },
        ];
        if (aboutImg) {
          images.push({
            role: "about",
            url: aboutImg.url,
            source: aboutImg.source,
            attribution: aboutImg.attribution,
            alt: aboutImg.alt,
          });
        }
        if (extraImg) {
          images.push({
            role: "extra",
            url: extraImg.url,
            source: extraImg.source,
            attribution: extraImg.attribution,
            alt: extraImg.alt,
          });
        }

        await ctx.runMutation(internal.prospects.patch, {
          id: args.prospectId,
          lukeOutput: {
            ...((prospect.lukeOutput as Record<string, unknown> | null) ?? {}),
            images,
            imageCommitSha,
          },
        });
        await ctx.runMutation(internal.prospects.markBuildStep, {
          id: args.prospectId,
          step: "imagesSourced",
        });
        prospect = await ctx.runQuery(internal.prospects.get, {
          id: args.prospectId,
        });
        if (!prospect) throw new Error(`Prospect ${args.prospectId} disappeared`);
      }

      // ---------------------------------------------------------------------
      // STEP 3 — designApplied (Claude call + atomic Trees commit)
      // ---------------------------------------------------------------------
      if (!prospect.buildSteps.designApplied) {
        const businessContext = composeLukeUserPrompt({
          businessName: prospect.businessName,
          industry: prospect.industry,
          market: prospect.market,
          websiteDomain: prospect.websiteDomain,
          leiaOutput: prospect.leiaOutput,
          lukeOutput: prospect.lukeOutput as
            | { images?: ProspectImageRecord[] }
            | null,
        });

        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let totalCostUsd = 0;

        // --- Stage 1: taste-design -------------------------------------------
        const tasteResult = await callAgent({
          ctx,
          agentName: "luke",
          system: LUKE_PROMPT_TASTE,
          messages: [{ role: "user", content: businessContext }],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tools: [stageTasteDesignSchema as any],
          toolChoice: { type: "tool", name: stageTasteDesignSchema.name },
          runId: args.runId,
          prospectId: args.prospectId,
        });
        const taste = tasteResult.toolUseResults[0]?.input as {
          atmosphereSentence: string;
          emotionalCore: string;
          clichesToAvoid: string[];
        } | undefined;
        if (!taste) throw new Error("Luke: stage_taste_design returned no output");
        totalInputTokens += tasteResult.inputTokens;
        totalOutputTokens += tasteResult.outputTokens;
        totalCostUsd += tasteResult.costUsd;

        // --- Stage 2: colorize -----------------------------------------------
        const colorizeContext = `${businessContext}\n\n## Stage 1 — Taste-Design Output\nAtmosphere: ${taste.atmosphereSentence}\nEmotional core: ${taste.emotionalCore}\nClichés to avoid: ${taste.clichesToAvoid.join(", ")}`;
        const colorizeResult = await callAgent({
          ctx,
          agentName: "luke",
          system: LUKE_PROMPT_COLORIZE,
          messages: [{ role: "user", content: colorizeContext }],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tools: [stageColorizeSchema as any],
          toolChoice: { type: "tool", name: stageColorizeSchema.name },
          runId: args.runId,
          prospectId: args.prospectId,
        });
        const colorOutput = colorizeResult.toolUseResults[0]?.input as Record<string, string> | undefined;
        if (!colorOutput) throw new Error("Luke: stage_colorize returned no output");
        totalInputTokens += colorizeResult.inputTokens;
        totalOutputTokens += colorizeResult.outputTokens;
        totalCostUsd += colorizeResult.costUsd;

        // --- Stage 3: typeset ------------------------------------------------
        const typesetContext = `${businessContext}\n\n## Stage 1 — Taste-Design\nAtmosphere: ${taste.atmosphereSentence}\nEmotional core: ${taste.emotionalCore}\n\n## Stage 2 — Color Scale\nbrand500: ${colorOutput.brand500}\nRationale: ${colorOutput.colorRationale}`;
        const typesetResult = await callAgent({
          ctx,
          agentName: "luke",
          system: LUKE_PROMPT_TYPESET,
          messages: [{ role: "user", content: typesetContext }],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tools: [stageTypesetSchema as any],
          toolChoice: { type: "tool", name: stageTypesetSchema.name },
          runId: args.runId,
          prospectId: args.prospectId,
        });
        const fontOutput = typesetResult.toolUseResults[0]?.input as {
          display: string;
          body: string;
          fontRationale: string;
        } | undefined;
        if (!fontOutput) throw new Error("Luke: stage_typeset returned no output");
        totalInputTokens += typesetResult.inputTokens;
        totalOutputTokens += typesetResult.outputTokens;
        totalCostUsd += typesetResult.costUsd;

        // --- Stage 4: bolder + polish ----------------------------------------
        const bolderContext = `${businessContext}\n\n## Stage 1 — Taste-Design\nAtmosphere: ${taste.atmosphereSentence}\nEmotional core: ${taste.emotionalCore}\nClichés to avoid: ${taste.clichesToAvoid.join(", ")}\n\n## Stage 2 — Color Scale\nbrand500: ${colorOutput.brand500}\nRationale: ${colorOutput.colorRationale}\n\n## Stage 3 — Typography\nDisplay: ${fontOutput.display}\nBody: ${fontOutput.body}\nRationale: ${fontOutput.fontRationale}`;
        const bolderResult = await callAgent({
          ctx,
          agentName: "luke",
          system: LUKE_PROMPT_BOLDER,
          messages: [{ role: "user", content: bolderContext }],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tools: [stageBolderSchema as any],
          toolChoice: { type: "tool", name: stageBolderSchema.name },
          runId: args.runId,
          prospectId: args.prospectId,
        });
        const bolderOutput = bolderResult.toolUseResults[0]?.input as {
          designPrinciples: string[];
          imageQueries: { hero: string; supporting: string[] };
          designMdBody: string;
        } | undefined;
        if (!bolderOutput) throw new Error("Luke: stage_bolder returned no output");
        totalInputTokens += bolderResult.inputTokens;
        totalOutputTokens += bolderResult.outputTokens;
        totalCostUsd += bolderResult.costUsd;

        // --- Assemble final design from all 4 stages -------------------------
        const design: LukeDesignToolInput = {
          brandColorScale: {
            brand50: colorOutput.brand50,
            brand100: colorOutput.brand100,
            brand200: colorOutput.brand200,
            brand300: colorOutput.brand300,
            brand400: colorOutput.brand400,
            brand500: colorOutput.brand500,
            brand600: colorOutput.brand600,
            brand700: colorOutput.brand700,
            brand800: colorOutput.brand800,
            brand900: colorOutput.brand900,
            brand950: colorOutput.brand950,
          } as BrandColorScale,
          fonts: { display: fontOutput.display, body: fontOutput.body },
          atmosphere: taste.atmosphereSentence,
          designPrinciples: bolderOutput.designPrinciples,
          imageQueries: bolderOutput.imageQueries,
          designMdBody: bolderOutput.designMdBody,
        };

        const claudeResult = {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          costUsd: totalCostUsd,
        };

        let brandColorScale: BrandColorScale;
        if (isValidBrandColorScale(design.brandColorScale)) {
          brandColorScale = design.brandColorScale;
        } else {
          const leia = prospect.leiaOutput as
            | { brand?: { palette?: { primary?: string } } }
            | null;
          const fallbackPrimary = leia?.brand?.palette?.primary;
          if (!fallbackPrimary || !HEX_RE.test(fallbackPrimary)) {
            throw new Error(
              "Luke: invalid brandColorScale and no usable Leia primary hex for fallback",
            );
          }
          brandColorScale = deriveBrandColorScale(fallbackPrimary);
        }

        const newGlobalCss = generateGlobalCss({
          brandColorScale,
          fonts: design.fonts,
        });

        const lukeImages =
          ((prospect.lukeOutput as { images?: ProspectImageRecord[] } | null)
            ?.images) ?? [];
        const attributionLines =
          lukeImages.length > 0
            ? lukeImages
                .map((img) => `- ${img.role}: ${img.attribution}`)
                .join("\n")
            : "- (no images sourced)";

        const designMd = `# Design — ${prospect.businessName}

${design.designMdBody}

## Atmosphere
${design.atmosphere}

## Design Principles
${design.designPrinciples.map((p, i) => `${i + 1}. ${p}`).join("\n")}

## Brand Colors
${BRAND_KEYS.map((k) => `- ${k}: ${brandColorScale[k]}`).join("\n")}

## Typography
- Display: ${design.fonts.display}
- Body: ${design.fonts.body}

## Image Direction
- Hero: ${design.imageQueries.hero}
- Supporting: ${design.imageQueries.supporting.join(" | ")}

## Image Attribution
${attributionLines}

---
Generated by Luke Skywalker (Phase 5.5 design pass) — ${new Date().toISOString()}
`;

        const { commitSha: designCommitSha } = await commitTree({
          githubToken,
          owner: githubUsername,
          repoName,
          files: [
            { path: "src/styles/global.css", content: newGlobalCss },
            { path: "DESIGN.md", content: designMd },
          ],
          commitMessage:
            "feat(luke): apply visual design pass — brand tokens + DESIGN.md",
        });

        await ctx.runMutation(internal.prospects.patch, {
          id: args.prospectId,
          lukeOutput: {
            ...((prospect.lukeOutput as Record<string, unknown> | null) ?? {}),
            brandColorScale,
            fonts: design.fonts,
            atmosphere: design.atmosphere,
            designPrinciples: design.designPrinciples,
            imageQueries: design.imageQueries,
            designMdBody: design.designMdBody,
            designCommitSha,
            completedAt: Date.now(),
          },
        });
        await ctx.runMutation(internal.prospects.markBuildStep, {
          id: args.prospectId,
          step: "designApplied",
        });

        // Wait for the new CF Pages build to go green so Ahsoka doesn't
        // screenshot a stale deployment.
        await pollDeploymentReady({
          cfApiToken,
          cfAccountId,
          projectName: cfProjectName,
        });

        await ctx.runMutation(internal.agentActions.complete, {
          id: actionId,
          status: "success",
          inputTokens: claudeResult.inputTokens,
          outputTokens: claudeResult.outputTokens,
          costUsd: claudeResult.costUsd,
          finishedAt: Date.now(),
        });

        return {
          ok: true as const,
          prospectId: args.prospectId,
          designCommitSha,
          brand500: brandColorScale.brand500,
          fonts: design.fonts,
          inputTokens: claudeResult.inputTokens,
          outputTokens: claudeResult.outputTokens,
          costUsd: claudeResult.costUsd,
        };
      }

      // All three steps already complete — idempotent no-op resume path.
      await ctx.runMutation(internal.agentActions.complete, {
        id: actionId,
        status: "success",
        finishedAt: Date.now(),
      });
      return { ok: true as const, prospectId: args.prospectId, alreadyDone: true };
    } catch (err) {
      const isCostCeiling = err instanceof CostCeilingError;
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.prospects.patch, {
        id: args.prospectId,
        lukeFailedReason: msg,
      });
      await ctx.runMutation(internal.agentActions.complete, {
        id: actionId,
        status: isCostCeiling ? "cost_ceiling_hit" : "failed",
        errorMessage: msg,
        finishedAt: Date.now(),
      });
      throw err;
    }
  },
});
