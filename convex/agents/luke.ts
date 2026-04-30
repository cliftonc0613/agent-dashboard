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
  stageCssSchema,
  stagePolishHtmlSchema,
  stagePolishPageSchema,
  stagePolishDuoSchema,
} from "../lib/toolSchemas";
import {
  LUKE_PROMPT_TASTE,
  LUKE_PROMPT_COLORIZE,
  LUKE_PROMPT_TYPESET,
  LUKE_PROMPT_BOLDER,
  LUKE_PROMPT_CSS,
  LUKE_PROMPT_POLISH_HTML,
  LUKE_PROMPT_POLISH_COMPONENTS,
  LUKE_PROMPT_POLISH_CONTENT_PAGES,
  LUKE_PROMPT_POLISH_DETAIL_PAGE,
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
  role: "hero" | "about" | "extra" | string;
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
  // Match the closing `};` of the `export const business` object. The file
  // has content after that closing brace (e.g. yearsInBusiness), so we can't
  // anchor with `$`. Instead match `};` preceded by the last property line.
  return src.replace(/(export const business[\s\S]*?)(,?\n\};)(\s*\nexport function)/, `$1,\n  ${key}: '${val}',\n};$3`);
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
      if (!prospect.buildSteps?.deployed) {
        throw new Error(
          `Luke requires buildSteps.deployed=true, got status: ${prospect.status}`,
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

        const images: ProspectImageRecord[] = [
          { role: "hero", url: hero.url, source: hero.source, attribution: hero.attribution, alt: hero.alt },
        ];
        if (aboutImg) {
          images.push({ role: "about", url: aboutImg.url, source: aboutImg.source, attribution: aboutImg.attribution, alt: aboutImg.alt });
        }
        if (extraImg) {
          images.push({ role: "extra", url: extraImg.url, source: extraImg.source, attribution: extraImg.attribution, alt: extraImg.alt });
        }

        // Determine image pool size from the number of service areas in the deployed repo.
        // Pool size = how many unique images to source per service slot so each city gets its own image.
        const areasUrl = `https://api.github.com/repos/${githubUsername}/${repoName}/contents/src/data/serviceAreas.ts`;
        const areasResp = await fetch(areasUrl, {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "rebel-alliance-luke",
          },
        });
        let POOL_SIZE = 8;
        if (areasResp.ok) {
          const areasJson = (await areasResp.json()) as { content: string };
          const areasTs = Buffer.from(areasJson.content, "base64").toString("utf8");
          const areaCount = (areasTs.match(/slug:\s*["']/g) ?? []).length;
          POOL_SIZE = Math.max(6, Math.min(12, areaCount));
        }

        // Also patch serviceTypes.ts — replace local /images/services/* paths
        // with real CDN URLs, sourcing a pool of POOL_SIZE images per service slot.
        const serviceTypesUrl = `https://api.github.com/repos/${githubUsername}/${repoName}/contents/src/data/serviceTypes.ts`;
        const serviceTypesResp = await fetch(serviceTypesUrl, {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "rebel-alliance-luke",
          },
        });
        let updatedServiceTypesTs: string | null = null;
        if (serviceTypesResp.ok) {
          const stJson = (await serviceTypesResp.json()) as {
            content: string;
            encoding: string;
          };
          let serviceTypesTs = Buffer.from(stJson.content, "base64").toString("utf8");

          // Extract service names paired with their current image URL (local OR CDN).
          // Match any image: value — not just local paths — so re-runs work correctly.
          const pairRe = /name:\s*["']([^"']+)["'][^}]*?image:\s*["']([^"']+)["']/gs;
          const pairs: { name: string; currentUrl: string }[] = [];
          let m: RegExpExecArray | null;
          while ((m = pairRe.exec(serviceTypesTs)) !== null) {
            // Skip if this match is actually the secondaryImage field (name mis-matched)
            pairs.push({ name: m[1], currentUrl: m[2] });
          }

          for (const { name, currentUrl } of pairs) {
            // Source a full pool of images per slot — one call each returning POOL_SIZE results.
            // Picsum padding ensures we always get exactly POOL_SIZE back.
            const [primaryResults, secondaryResults] = await Promise.all([
              searchImagesWithFallback(`${name}, professional service`, POOL_SIZE, unsplashKey, pexelsKey),
              searchImagesWithFallback(`${name}, residential close-up`, POOL_SIZE, unsplashKey, pexelsKey),
            ]);
            const primary = primaryResults[0];
            const secondary = secondaryResults[0];
            const primaryUrls = primaryResults.map((r) => r.url);
            const secondaryUrls = secondaryResults.map((r) => r.url);

            const targetUrl = primary?.url ?? currentUrl;

            // Replace local path OR existing CDN url with primary CDN url.
            if (primary && primary.url !== currentUrl) {
              serviceTypesTs = serviceTypesTs.replace(currentUrl, primary.url);
              images.push({ role: `service:${name}`, url: primary.url, source: primary.source, attribution: primary.attribution, alt: primary.alt });
            }

            // Inject images pool, secondaryImage (single, legacy), and secondaryImages pool
            // line-by-line after the image: field for this service.
            const lines = serviceTypesTs.split("\n");
            const out: string[] = [];
            for (let i = 0; i < lines.length; i++) {
              out.push(lines[i]);
              if (lines[i].includes(targetUrl) && lines[i].trimStart().startsWith("image:")) {
                const indent = lines[i].match(/^\s*/)?.[0] ?? "    ";
                const nextLine = lines[i + 1] ?? "";
                // images pool (NEW) — skip if already injected
                if (!nextLine.includes("images:")) {
                  out.push(`${indent}images: [${primaryUrls.map((u) => `'${u}'`).join(", ")}],`);
                }
                // secondaryImage single string (legacy, used by listings/cards)
                if (!nextLine.includes("secondaryImage")) {
                  if (secondary) {
                    out.push(`${indent}secondaryImage: '${secondary.url}',`);
                    images.push({ role: `service-secondary:${name}`, url: secondary.url, source: secondary.source, attribution: secondary.attribution, alt: secondary.alt });
                  }
                }
                // secondaryImages pool (NEW) — skip if already injected
                if (!nextLine.includes("secondaryImages:")) {
                  out.push(`${indent}secondaryImages: [${secondaryUrls.map((u) => `'${u}'`).join(", ")}],`);
                }
              }
            }
            serviceTypesTs = out.join("\n");
          }
          updatedServiceTypesTs = serviceTypesTs;
        }

        const filesToCommit: { path: string; content: string }[] = [
          { path: "src/data/business.ts", content: updatedBusinessTs },
        ];
        if (updatedServiceTypesTs) {
          filesToCommit.push({ path: "src/data/serviceTypes.ts", content: updatedServiceTypesTs });
        }

        const { commitSha: imageCommitSha } = await commitTree({
          githubToken,
          owner: githubUsername,
          repoName,
          files: filesToCommit,
          commitMessage: "feat(luke): inject heroImage, aboutImage, and service CDN URLs",
        });

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

      // Accumulators for all Claude stages across steps 3 and 4.
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCostUsd = 0;

      // Captured inside step 3 for use in the return value.
      let capturedDesignCommitSha: string | undefined;
      let capturedPolishCommitSha: string | undefined;
      let capturedBrand500: string | undefined;
      let capturedFonts: { display: string; body: string } | undefined;

      // ---------------------------------------------------------------------
      // STEP 3 — designApplied (5-stage Claude pipeline + CSS/DESIGN.md commit)
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

        // --- Stage 5: write_css ----------------------------------------------
        const cssContext = `${businessContext}\n\n## Stage 1 — Taste-Design\nAtmosphere: ${taste.atmosphereSentence}\nEmotional core: ${taste.emotionalCore}\nClichés to avoid: ${taste.clichesToAvoid.join(", ")}\n\n## Stage 2 — Color Scale\n${BRAND_KEYS.map((k) => `${k}: ${colorOutput[k]}`).join("\n")}\nRationale: ${colorOutput.colorRationale}\n\n## Stage 3 — Typography\nDisplay: ${fontOutput.display}\nBody: ${fontOutput.body}\nRationale: ${fontOutput.fontRationale}\n\n## Stage 4 — Design Direction\nPrinciples:\n${bolderOutput.designPrinciples.map((p) => `- ${p}`).join("\n")}\n\nDESIGN.md:\n${bolderOutput.designMdBody}`;
        const cssResult = await callAgent({
          ctx,
          agentName: "luke",
          system: LUKE_PROMPT_CSS,
          messages: [{ role: "user", content: cssContext }],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tools: [stageCssSchema as any],
          toolChoice: { type: "tool", name: stageCssSchema.name },
          runId: args.runId,
          prospectId: args.prospectId,
        });
        const cssOutput = cssResult.toolUseResults[0]?.input as { css: string } | undefined;
        if (!cssOutput?.css) throw new Error("Luke: stage_write_css returned no CSS");
        totalInputTokens += cssResult.inputTokens;
        totalOutputTokens += cssResult.outputTokens;
        totalCostUsd += cssResult.costUsd;

        // --- Assemble final design from all 5 stages -------------------------
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

        capturedBrand500 = brandColorScale.brand500;
        capturedFonts = design.fonts;

        const newGlobalCss = cssOutput.css;

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

        capturedDesignCommitSha = designCommitSha;

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
        prospect = await ctx.runQuery(internal.prospects.get, {
          id: args.prospectId,
        });
        if (!prospect) throw new Error(`Prospect ${args.prospectId} disappeared`);
      }

      // ---------------------------------------------------------------------
      // STEP 4 — polishApplied
      //   4a. Deterministic: swap Google Fonts link in BaseLayout.astro
      //   4b. Claude: rewrite index.astro with impeccable HTML polish
      // Both files committed in one atomic Trees commit.
      // ---------------------------------------------------------------------
      if (!prospect.buildSteps.polishApplied) {
        const savedOutput = prospect.lukeOutput as Record<string, unknown> | null;
        const fonts =
          (savedOutput?.fonts as { display: string; body: string } | undefined) ??
          capturedFonts;
        const savedAtmosphere = savedOutput?.atmosphere as string | undefined;
        const savedBrandColorScale = savedOutput?.brandColorScale as BrandColorScale | undefined;
        const savedPrinciples = savedOutput?.designPrinciples as string[] | undefined;

        const polishFiles: { path: string; content: string }[] = [];

        // --- 4a: fetch BaseLayout + patch font link (no Claude) --------------
        const baseLayoutUrl = `https://api.github.com/repos/${githubUsername}/${repoName}/contents/src/layouts/BaseLayout.astro`;
        const baseResp = await fetch(baseLayoutUrl, {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "rebel-alliance-luke",
          },
        });
        if (baseResp.ok && fonts) {
          const baseJson = (await baseResp.json()) as { content: string; encoding: string };
          if (baseJson.encoding === "base64") {
            const baseSrc = Buffer.from(baseJson.content, "base64").toString("utf8");
            const displayFamily = fonts.display.replace(/ /g, "+");
            const bodyFamily = fonts.body.replace(/ /g, "+");
            const newFontUrl = `https://fonts.googleapis.com/css2?family=${displayFamily}:wght@400;500;600;700;800;900&family=${bodyFamily}:wght@300;400;500;600&display=swap`;
            const patchedBase = baseSrc.replace(
              /https:\/\/fonts\.googleapis\.com\/css2\?[^"']+/,
              newFontUrl,
            );
            if (patchedBase !== baseSrc) {
              polishFiles.push({ path: "src/layouts/BaseLayout.astro", content: patchedBase });
              console.log(`[luke] font patch ready: ${fonts.display} + ${fonts.body}`);
            }
          }
        }

        // --- 4b: fetch index.astro + Claude polish call ----------------------
        const indexUrl = `https://api.github.com/repos/${githubUsername}/${repoName}/contents/src/pages/index.astro`;
        const indexResp = await fetch(indexUrl, {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "rebel-alliance-luke",
          },
        });
        if (indexResp.ok) {
          const indexJson = (await indexResp.json()) as { content: string; encoding: string };
          if (indexJson.encoding === "base64") {
            const indexSrc = Buffer.from(indexJson.content, "base64").toString("utf8");

            const polishContext = [
              "## Business",
              `Name: ${prospect.businessName}`,
              `Industry: ${prospect.industry}`,
              `Market: ${prospect.market}`,
              "",
              "## Design Direction",
              savedAtmosphere ? `Atmosphere: ${savedAtmosphere}` : "",
              fonts ? `Display font: ${fonts.display}\nBody font: ${fonts.body}` : "",
              savedBrandColorScale
                ? `brand500: ${savedBrandColorScale.brand500}\nbrand50: ${savedBrandColorScale.brand50}\nbrand950: ${savedBrandColorScale.brand950}`
                : "",
              savedPrinciples?.length
                ? `Design principles:\n${savedPrinciples.map((p) => `- ${p}`).join("\n")}`
                : "",
              "",
              "## Current src/pages/index.astro",
              "```",
              indexSrc,
              "```",
            ]
              .filter(Boolean)
              .join("\n");

            const polishResult = await callAgent({
              ctx,
              agentName: "luke",
              system: LUKE_PROMPT_POLISH_HTML,
              messages: [{ role: "user", content: polishContext }],
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              tools: [stagePolishHtmlSchema as any],
              toolChoice: { type: "tool", name: stagePolishHtmlSchema.name },
              runId: args.runId,
              prospectId: args.prospectId,
            });
            const polishOutput = polishResult.toolUseResults[0]?.input as {
              indexAstro: string;
              changes: string[];
            } | undefined;

            if (polishOutput?.indexAstro) {
              polishFiles.push({ path: "src/pages/index.astro", content: polishOutput.indexAstro });
              totalInputTokens += polishResult.inputTokens;
              totalOutputTokens += polishResult.outputTokens;
              totalCostUsd += polishResult.costUsd;
              console.log(`[luke] index.astro polish ready — ${polishOutput.changes.length} changes`);

              await ctx.runMutation(internal.prospects.patch, {
                id: args.prospectId,
                lukeOutput: {
                  ...((prospect.lukeOutput as Record<string, unknown> | null) ?? {}),
                  polishChanges: polishOutput.changes,
                },
              });
            }
          }
        } else {
          console.warn(`[luke] could not fetch index.astro: ${indexResp.status} — skipping HTML polish`);
        }

        // --- commit both files atomically ------------------------------------
        if (polishFiles.length > 0) {
          const fileList = polishFiles.map((f) => f.path).join(", ");
          const { commitSha: polishCommitSha } = await commitTree({
            githubToken,
            owner: githubUsername,
            repoName,
            files: polishFiles,
            commitMessage: `feat(luke): polish pass — fonts + index.astro (${fileList})`,
          });
          capturedPolishCommitSha = polishCommitSha;
        }

        await ctx.runMutation(internal.prospects.markBuildStep, {
          id: args.prospectId,
          step: "polishApplied",
        });

        // Wait for CF Pages rebuild so Ahsoka screenshots the final polished state.
        await pollDeploymentReady({
          cfApiToken,
          cfAccountId,
          projectName: cfProjectName,
        });
      }

      // ---------------------------------------------------------------------
      // STEP 5 — pagesPolished (Header, Footer, content pages, detail templates)
      //   5 Claude calls, one file or two per call, all committed atomically.
      // ---------------------------------------------------------------------
      if (!prospect.buildSteps.pagesPolished) {
        const savedOutput = prospect.lukeOutput as Record<string, unknown> | null;
        const fonts =
          (savedOutput?.fonts as { display: string; body: string } | undefined) ??
          capturedFonts;
        const savedAtmosphere = savedOutput?.atmosphere as string | undefined;
        const savedBrandColorScale = savedOutput?.brandColorScale as BrandColorScale | undefined;
        const savedPrinciples = savedOutput?.designPrinciples as string[] | undefined;

        const designContext = [
          `Industry: ${prospect.industry}`,
          `Market: ${prospect.market}`,
          savedAtmosphere ? `Atmosphere: ${savedAtmosphere}` : "",
          fonts ? `Display font: ${fonts.display} | Body font: ${fonts.body}` : "",
          savedBrandColorScale
            ? `brand500: ${savedBrandColorScale.brand500} | brand50: ${savedBrandColorScale.brand50} | brand950: ${savedBrandColorScale.brand950}`
            : "",
          savedPrinciples?.length
            ? `Design principles: ${savedPrinciples.join(" | ")}`
            : "",
        ].filter(Boolean).join("\n");

        // Helper: fetch a file from the prospect's GitHub repo.
        async function fetchFile(filePath: string): Promise<string | null> {
          const encoded = filePath.replace(/\[/g, "%5B").replace(/\]/g, "%5D");
          const url = `https://api.github.com/repos/${githubUsername}/${repoName}/contents/${encoded}`;
          const resp = await fetch(url, {
            headers: {
              Authorization: `Bearer ${githubToken}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
              "User-Agent": "rebel-alliance-luke",
            },
          });
          if (!resp.ok) {
            console.warn(`[luke pages] Could not fetch ${filePath}: ${resp.status}`);
            return null;
          }
          const json = (await resp.json()) as { content: string; encoding: string };
          if (json.encoding !== "base64") return null;
          return Buffer.from(json.content, "base64").toString("utf8");
        }

        const pagesFiles: { path: string; content: string }[] = [];

        // --- Call 1: Header + Footer -----------------------------------------
        const [headerSrc, footerSrc] = await Promise.all([
          fetchFile("src/components/Header.astro"),
          fetchFile("src/components/Footer.astro"),
        ]);
        if (headerSrc && footerSrc) {
          const duoCtx = `## Business\nName: ${prospect.businessName}\n${designContext}\n\n## FILE A — src/components/Header.astro\n\`\`\`\n${headerSrc}\n\`\`\`\n\n## FILE B — src/components/Footer.astro\n\`\`\`\n${footerSrc}\n\`\`\``;
          const r = await callAgent({
            ctx, agentName: "luke", system: LUKE_PROMPT_POLISH_COMPONENTS,
            messages: [{ role: "user", content: duoCtx }],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tools: [stagePolishDuoSchema as any],
            toolChoice: { type: "tool", name: stagePolishDuoSchema.name },
            runId: args.runId, prospectId: args.prospectId,
          });
          const out = r.toolUseResults[0]?.input as { fileA: string; fileB: string } | undefined;
          if (out?.fileA) pagesFiles.push({ path: "src/components/Header.astro", content: out.fileA });
          if (out?.fileB) pagesFiles.push({ path: "src/components/Footer.astro", content: out.fileB });
          totalInputTokens += r.inputTokens; totalOutputTokens += r.outputTokens; totalCostUsd += r.costUsd;
          console.log(`[luke pages] Header + Footer polished`);
        }

        // --- Call 2: about.astro + contact.astro -----------------------------
        const [aboutSrc, contactSrc] = await Promise.all([
          fetchFile("src/pages/about.astro"),
          fetchFile("src/pages/contact.astro"),
        ]);
        if (aboutSrc && contactSrc) {
          const duoCtx = `## Business\nName: ${prospect.businessName}\n${designContext}\n\n## FILE A — src/pages/about.astro\n\`\`\`\n${aboutSrc}\n\`\`\`\n\n## FILE B — src/pages/contact.astro\n\`\`\`\n${contactSrc}\n\`\`\``;
          const r = await callAgent({
            ctx, agentName: "luke", system: LUKE_PROMPT_POLISH_CONTENT_PAGES,
            messages: [{ role: "user", content: duoCtx }],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tools: [stagePolishDuoSchema as any],
            toolChoice: { type: "tool", name: stagePolishDuoSchema.name },
            runId: args.runId, prospectId: args.prospectId,
          });
          const out = r.toolUseResults[0]?.input as { fileA: string; fileB: string } | undefined;
          if (out?.fileA) pagesFiles.push({ path: "src/pages/about.astro", content: out.fileA });
          if (out?.fileB) pagesFiles.push({ path: "src/pages/contact.astro", content: out.fileB });
          totalInputTokens += r.inputTokens; totalOutputTokens += r.outputTokens; totalCostUsd += r.costUsd;
          console.log(`[luke pages] about + contact polished`);
        }

        // --- Call 3: services/index.astro + areas/index.astro ----------------
        const [svcIndexSrc, areaIndexSrc] = await Promise.all([
          fetchFile("src/pages/services/index.astro"),
          fetchFile("src/pages/areas/index.astro"),
        ]);
        if (svcIndexSrc && areaIndexSrc) {
          const duoCtx = `## Business\nName: ${prospect.businessName}\n${designContext}\n\n## FILE A — src/pages/services/index.astro\n\`\`\`\n${svcIndexSrc}\n\`\`\`\n\n## FILE B — src/pages/areas/index.astro\n\`\`\`\n${areaIndexSrc}\n\`\`\``;
          const r = await callAgent({
            ctx, agentName: "luke", system: LUKE_PROMPT_POLISH_CONTENT_PAGES,
            messages: [{ role: "user", content: duoCtx }],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tools: [stagePolishDuoSchema as any],
            toolChoice: { type: "tool", name: stagePolishDuoSchema.name },
            runId: args.runId, prospectId: args.prospectId,
          });
          const out = r.toolUseResults[0]?.input as { fileA: string; fileB: string } | undefined;
          if (out?.fileA) pagesFiles.push({ path: "src/pages/services/index.astro", content: out.fileA });
          if (out?.fileB) pagesFiles.push({ path: "src/pages/areas/index.astro", content: out.fileB });
          totalInputTokens += r.inputTokens; totalOutputTokens += r.outputTokens; totalCostUsd += r.costUsd;
          console.log(`[luke pages] services/index + areas/index polished`);
        }

        // --- Call 4: services/[service].astro --------------------------------
        const serviceSrc = await fetchFile("src/pages/services/[service].astro");
        if (serviceSrc) {
          const pageCtx = `## Business\nName: ${prospect.businessName}\n${designContext}\n\n## File: src/pages/services/[service].astro\n\`\`\`\n${serviceSrc}\n\`\`\``;
          const r = await callAgent({
            ctx, agentName: "luke", system: LUKE_PROMPT_POLISH_DETAIL_PAGE,
            messages: [{ role: "user", content: pageCtx }],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tools: [stagePolishPageSchema as any],
            toolChoice: { type: "tool", name: stagePolishPageSchema.name },
            runId: args.runId, prospectId: args.prospectId,
          });
          const out = r.toolUseResults[0]?.input as { content: string } | undefined;
          if (out?.content) pagesFiles.push({ path: "src/pages/services/[service].astro", content: out.content });
          totalInputTokens += r.inputTokens; totalOutputTokens += r.outputTokens; totalCostUsd += r.costUsd;
          console.log(`[luke pages] services/[service].astro polished`);
        }

        // --- Call 5: areas/[area].astro --------------------------------------
        const areaSrc = await fetchFile("src/pages/areas/[area].astro");
        if (areaSrc) {
          const pageCtx = `## Business\nName: ${prospect.businessName}\n${designContext}\n\n## File: src/pages/areas/[area].astro\n\`\`\`\n${areaSrc}\n\`\`\``;
          const r = await callAgent({
            ctx, agentName: "luke", system: LUKE_PROMPT_POLISH_DETAIL_PAGE,
            messages: [{ role: "user", content: pageCtx }],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tools: [stagePolishPageSchema as any],
            toolChoice: { type: "tool", name: stagePolishPageSchema.name },
            runId: args.runId, prospectId: args.prospectId,
          });
          const out = r.toolUseResults[0]?.input as { content: string } | undefined;
          if (out?.content) pagesFiles.push({ path: "src/pages/areas/[area].astro", content: out.content });
          totalInputTokens += r.inputTokens; totalOutputTokens += r.outputTokens; totalCostUsd += r.costUsd;
          console.log(`[luke pages] areas/[area].astro polished`);
        }

        // --- Commit all polished pages atomically ----------------------------
        if (pagesFiles.length > 0) {
          await commitTree({
            githubToken,
            owner: githubUsername,
            repoName,
            files: pagesFiles,
            commitMessage: `feat(luke): polish all pages — ${pagesFiles.length} files updated`,
          });
          console.log(`[luke pages] committed ${pagesFiles.length} polished files`);
        }

        await ctx.runMutation(internal.prospects.markBuildStep, {
          id: args.prospectId,
          step: "pagesPolished",
        });

        await pollDeploymentReady({
          cfApiToken,
          cfAccountId,
          projectName: cfProjectName,
        });
      }

      // All five steps complete — mark the action and return.
      await ctx.runMutation(internal.agentActions.complete, {
        id: actionId,
        status: "success",
        inputTokens: totalInputTokens || undefined,
        outputTokens: totalOutputTokens || undefined,
        costUsd: totalCostUsd || undefined,
        finishedAt: Date.now(),
      });

      return {
        ok: true as const,
        prospectId: args.prospectId,
        designCommitSha: capturedDesignCommitSha,
        polishCommitSha: capturedPolishCommitSha,
        brand500: capturedBrand500,
        fonts: capturedFonts,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        costUsd: totalCostUsd,
      };
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
