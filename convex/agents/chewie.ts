"use node";

/**
 * chewie.ts — Chewie, Builder of the Rebel Alliance.
 *
 * Phase 5 Plan 5-02 — Claude call + deterministic config assembly only. NO
 * external side effects. Plans 5-03 (GitHub) and 5-04 (Cloudflare Pages)
 * consume the in-memory `fileMap` produced here.
 *
 * Lifecycle on success: prospect.status STAYS at "brief_ready" — Plan 5-02
 * deliberately does not transition status so the same prospect can be
 * re-tested while we iterate the prompt + validator. Plans 5-03/5-04 flip
 * to "site_built" after a successful Cloudflare Pages deployment.
 *
 * Naming contract (set ONCE per prospect, reused on retry — CHEWIE-03):
 *   repoName        = `site-${slug}-${suffix}`
 *   customSubdomain = `${slug}-${suffix}.${OUTREACH_DOMAIN}`
 *   cfProjectName   = repoName
 * If `prospect.repoName` is already set, every value is reused verbatim and
 * `makeShortSuffix` is NOT called again.
 */

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { callAgent, CostCeilingError } from "../lib/anthropic";
import { chewieDataFilesSchema } from "../lib/toolSchemas";
import {
  validateChewieOutput,
  type ChewieOutputForValidation,
} from "../lib/chewieValidator";
import {
  slugifyBusinessName,
  makeShortSuffix,
  generateAstroConfig,
  generatePackageJson,
  generateRobotsTxt,
  generateGlobalCss,
  deriveBrandColorScale,
  type BrandColorScale,
} from "../lib/chewieDeterministic";
import {
  generateRepoFromTemplate,
  pollRepoReady,
  pushFiles,
  fetchTemplateSha,
} from "../lib/github";
import {
  createPagesProject,
  triggerDeployment,
  attachCustomDomain,
  pollDeploymentReady,
  pollSslReady,
} from "../lib/cloudflare";

// ---------------------------------------------------------------------------
// System prompt — composed from rebel-alliance-chewie-voice SKILL.md.
// Chewie has minimal personality on purpose. The work product is precise
// TypeScript matching frozen interfaces; voice rules below must stay strict
// because Claude WILL drift toward generic marketing copy without them.
// ---------------------------------------------------------------------------

const CHEWIE_SYSTEM_PROMPT = `You are Chewie, Builder of the Rebel Alliance.

## Who You Are
You don't talk much. You build. You take a brief and you produce exactly the data files the template needs — no more, no less. You are precise, not creative. When data is missing you make the best defensible inference, not a guess. You document inferences in the optional _notes field so a human can review them.

## Your Job
Generate the 4 TypeScript data files for the Astro site template:
  src/data/business.ts
  src/data/serviceAreas.ts
  src/data/serviceTypes.ts
  src/data/seoContent.ts

Use the prospect record and Leia's brand brief as your sources. The full TypeScript interface signatures for each file are quoted in the user message — your output MUST conform to them exactly. Preserve every required helper function VERBATIM.

You also produce an 11-shade brandColorScale derived from Leia's primary hex. brand500 MUST be Leia's primary hex unchanged. Other shades are tints/shades of the primary.

## Hard Rules
1. Never use em dashes (—) anywhere in business.ts. Use periods, commas, colons, or rewrite. (Other files may use em dashes inside service descriptions or review text only when natural.)
2. Schema @type (\`schemaType\`) must match the industry exactly. Use Schema.org types: "Plumber", "Electrician", "HVACBusiness", "RoofingContractor", "Locksmith", "Landscaper", "HousePainter", "Cleaner", "Notary", "AutoRepair", "PestControlService", "Restaurant", "DentalClinic", "MedicalBusiness", "ProfessionalService" as a final fallback.
3. All icon values use RAW lucide names with NO prefix. Examples: "droplets", "wrench", "hammer", "wind", "sparkles", "shield-check", "phone", "clock", "map-pin". NEVER prefix with "lucide:" — the iconify resolver in Astro is configured to assume the lucide collection.
4. serviceAreas MUST have between 6 and 12 entries inclusive. The first entry is the prospect's home market.
5. serviceTypes MUST have between 6 and 10 entries inclusive.
6. processSteps MUST have exactly 4 steps per service: contact, assess, execute, verify (your phrasing — but the four-step structure is fixed).
7. reviews MUST have at least 6 entries with realistic author names, ratings 4-5, dates as ISO strings within the last 12 months (today's year minus 0 or 1).
8. brand color comes from Leia's brief primary first. Never invent a color.
9. Price ranges must be realistic for the industry and US region.
10. Output VALID TypeScript that matches the interface signatures in the user message exactly. Imports preserved. Helpers preserved. Type annotations preserved.

## What goes in each file

### business.ts
Single \`export const business: Business = {...}\`. Required fields: name, legalName, owner, tagline, description, schemaType, phone, phoneHref (\`tel:+1\` + 10 digits), email, website, address {street, city, state, stateCode, zip, country}, coordinates {lat, lng}, serviceRadius (e.g. "Travis & Williamson Counties"), hours (array of {days, hours} entries), license, yearEstablished (number).
Then preserve \`export function yearsInBusiness(): number { return new Date().getFullYear() - business.yearEstablished; }\` VERBATIM.
If a field has no source data: empty string for strings, 0 for unknown coordinates, current year - 5 for yearEstablished (note in _notes).

### serviceAreas.ts
\`export const serviceAreas: ServiceArea[]\` with 6-12 entries. Each entry: slug (kebab-case), name, county, zipCodes (array of strings), population (number), lat (number), lng (number), description (1-2 sentences), priority ("primary" | "secondary" | "tertiary"), responseTime (e.g. "30 minutes"), nearby (array of slugs from this same list), featured (optional boolean), state (optional 2-letter abbreviation).
First entry is the prospect's home city, priority="primary".
Preserve VERBATIM: getAreaBySlug, getNearbyAreas, getAreaName, getFeaturedAreas, getCounties.

### serviceTypes.ts
\`export const serviceTypes: ServiceType[]\` with 6-10 entries. Each entry: slug, name, shortDescription (≤120 chars, 1 sentence), description (2-3 sentences), image ("/images/services/<slug>.webp"), icon (raw lucide name, no prefix), emergency (boolean), processSteps (exactly 4 with title + description), priceRange ({min, max} numbers in USD).
Preserve VERBATIM: getServiceBySlug, getServiceName, getEmergencyServices, getFeaturedServices, getRelatedServices.

### seoContent.ts
At the top: local string constants BUSINESS_NAME, PHONE, LICENSE, CITY, STATE — set them to match business.ts values (do NOT import from business.ts; circular import risk).
\`export function generateFaqs(area?, service?)\` returning the 5 universal FAQs (licensed/insured, areas served, free estimates, payment, emergency) plus area-specific FAQs when an area is provided.
\`export const reviews: Review[]\` with 6+ realistic entries.
Preserve VERBATIM: getReviewsForPage, getAggregateRating.

## brandColorScale Rules
- brand500 MUST equal Leia's primary hex EXACTLY.
- brand50 is the lightest tint (~95% lightness in HSL).
- brand950 is the darkest shade (~15% lightness).
- Hue and saturation roughly preserved across the ramp.

## Final Rules
- Call submit_data_files ONCE with the 4 TypeScript file source strings + brandColorScale + templateVersion. Do NOT narrate. Do NOT explain first.
- Every string is on-voice: no corporate jargon, no AI hype, no "leverage", "synergy", "robust", "seamless", "world-class", "best-in-class", "cutting-edge".
- Empty string is fine for unknown values. Do not fabricate phone numbers, addresses, license numbers, owner names, or years in business.
- echo back the templateVersion you were given in the user message verbatim.`;

// ---------------------------------------------------------------------------
// 4 interface signatures — quoted into the user message verbatim so Claude
// produces TypeScript that matches the template repo's frozen contract.
// ---------------------------------------------------------------------------

const BUSINESS_INTERFACE = `// src/data/business.ts — interface contract
export interface BusinessHours {
  days: string;
  hours: string;
}

export interface Address {
  street: string;
  city: string;
  state: string;
  stateCode?: string;
  zip: string;
  country?: string;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface Business {
  name: string;
  legalName: string;
  owner: string;
  tagline: string;
  description: string;
  schemaType: string;
  phone: string;
  phoneHref: string;
  email: string;
  website: string;
  address: Address;
  coordinates: Coordinates;
  serviceRadius: string;
  hours: BusinessHours[];
  license: string;
  yearEstablished: number;
  shortName?: string;
  googleBusinessUrl?: string;
  socialMedia?: {
    facebook: string;
    instagram: string;
    twitter: string;
    youtube: string;
    linkedin: string;
    nextdoor: string;
    yelp: string;
  };
  emergencyService?: boolean;
  emergencyCta?: string;
  certifications?: string[];
  logo?: string;
  logoWhite?: string;
  ogImage?: string;
  heroImage?: string;
  aboutImage?: string;
}

// REQUIRED helper to preserve verbatim:
export function yearsInBusiness(): number {
  return new Date().getFullYear() - business.yearEstablished;
}`;

const SERVICE_AREAS_INTERFACE = `// src/data/serviceAreas.ts — interface contract
export interface ServiceArea {
  slug: string;
  name: string;
  county: string;
  zipCodes: string[];
  population: number;
  lat: number;
  lng: number;
  description: string;
  priority: 'primary' | 'secondary' | 'tertiary';
  responseTime: string;
  nearby: string[];
  featured?: boolean;
  state?: string;
}

// REQUIRED helpers to preserve verbatim:
//   getAreaBySlug, getNearbyAreas, getAreaName, getFeaturedAreas, getCounties`;

const SERVICE_TYPES_INTERFACE = `// src/data/serviceTypes.ts — interface contract
export interface ProcessStep {
  title: string;
  description: string;
}

export interface PriceRange {
  min: number;
  max: number;
}

export interface ServiceType {
  slug: string;
  name: string;
  shortDescription: string;
  description: string;
  image: string;
  icon: string;
  emergency: boolean;
  processSteps: ProcessStep[];
  priceRange: PriceRange;
  featured?: boolean;
  shortName?: string;
  keywords?: string[];
  relatedServices?: string[];
}

// REQUIRED helpers to preserve verbatim:
//   getServiceBySlug, getServiceName, getEmergencyServices, getFeaturedServices, getRelatedServices`;

const SEO_CONTENT_INTERFACE = `// src/data/seoContent.ts — interface contract
import type { ServiceArea } from './serviceAreas';
import type { ServiceType } from './serviceTypes';

export interface FaqItem {
  question: string;
  answer: string;
}

export interface Review {
  author: string;
  rating: number;
  text: string;
  date: string;
  service?: string;
  area?: string;
  source: string;
}

// REQUIRED exports to preserve:
//   generateFaqs(area?: ServiceArea, service?: ServiceType): FaqItem[]
//   export const reviews: Review[]
//   getReviewsForPage(areaSlug?, serviceSlug?, count?): Review[]
//   getAggregateRating(): { ratingValue, reviewCount, bestRating, worstRating }
// Use local constants BUSINESS_NAME/PHONE/LICENSE/CITY/STATE at top of file —
// do NOT import from business.ts (circular import risk).`;

// ---------------------------------------------------------------------------
// Narrowed shape for prospect.leiaOutput (schema is v.any()).
// ---------------------------------------------------------------------------

interface LeiaOutputShape {
  layoutVariant: string;
  brand: {
    emotion: string;
    voice: string;
    palette: { primary: string; secondary: string; accent: string };
    fonts: { heading: string; body: string };
  };
  businessData: unknown;
  storyBrandCopy: unknown;
}

interface ChewieToolInput {
  businessTs: string;
  serviceAreasTs: string;
  serviceTypesTs: string;
  seoContentTs: string;
  brandColorScale: BrandColorScale;
  templateVersion: string;
  _notes?: string;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export const run = internalAction({
  args: {
    prospectId: v.id("prospects"),
    runId: v.optional(v.id("runs")),
  },
  handler: async (ctx, args) => {
    const actionId: Id<"agentActions"> = await ctx.runMutation(
      internal.agentActions.startInFlight,
      {
        agentName: "chewie",
        prospectId: args.prospectId,
        runId: args.runId,
        model: "claude-sonnet-4-6",
        startedAt: Date.now(),
      },
    );

    try {
      const prospect = await ctx.runQuery(internal.prospects.get, {
        id: args.prospectId,
      });
      if (!prospect) {
        throw new Error(`Prospect ${args.prospectId} not found`);
      }
      if (prospect.status !== "brief_ready") {
        throw new Error(
          `Prospect ${args.prospectId} status is "${prospect.status}", expected "brief_ready"`,
        );
      }
      if (!prospect.leiaOutput) {
        throw new Error(
          `Prospect ${args.prospectId} has no leiaOutput — Leia must run first`,
        );
      }

      const leiaOutput = prospect.leiaOutput as LeiaOutputShape;
      if (!leiaOutput.brand?.palette?.primary) {
        throw new Error(
          `Prospect ${args.prospectId} leiaOutput is malformed: missing brand.palette.primary`,
        );
      }
      if (!leiaOutput.brand?.fonts?.heading || !leiaOutput.brand?.fonts?.body) {
        throw new Error(
          `Prospect ${args.prospectId} leiaOutput is malformed: missing brand.fonts.heading or brand.fonts.body`,
        );
      }

      const githubToken = process.env.GITHUB_TOKEN;
      const githubUsername = process.env.GITHUB_USERNAME;
      const templateRepo = process.env.TEMPLATE_REPO;
      const outreachDomain = process.env.OUTREACH_DOMAIN;
      const cfAccountId = process.env.CF_ACCOUNT_ID;
      const cfApiToken = process.env.CF_API_TOKEN;
      if (
        !githubToken ||
        !githubUsername ||
        !templateRepo ||
        !outreachDomain ||
        !cfAccountId ||
        !cfApiToken
      ) {
        throw new Error(
          "Chewie: missing required env vars (GITHUB_TOKEN, GITHUB_USERNAME, TEMPLATE_REPO, OUTREACH_DOMAIN, CF_ACCOUNT_ID, CF_API_TOKEN)",
        );
      }

      // Naming contract — set ONCE per prospect, reused on retry.
      let repoName: string;
      let customSubdomain: string;
      let cfProjectName: string;
      let slug: string;

      if (
        prospect.repoName &&
        prospect.customSubdomain &&
        prospect.cfProjectName
      ) {
        repoName = prospect.repoName;
        customSubdomain = prospect.customSubdomain;
        cfProjectName = prospect.cfProjectName;
        // Recover slug from existing repoName (`site-${slug}-${6charSuffix}`).
        const match = repoName.match(/^site-(.+)-[a-z0-9]{6}$/);
        slug = match ? match[1] : slugifyBusinessName(prospect.businessName);
      } else {
        slug = slugifyBusinessName(prospect.businessName);
        const suffix = makeShortSuffix();
        repoName = `site-${slug}-${suffix}`;
        customSubdomain = `${slug}-${suffix}.${outreachDomain}`;
        cfProjectName = repoName;
      }
      const customDomainUrl = `https://${customSubdomain}`;

      const templateVersion = await fetchTemplateSha({
        ctx,
        githubToken,
        templateRepo,
        runId: args.runId,
        prospectId: args.prospectId,
      });

      const contextBlob = [
        "## Prospect",
        JSON.stringify(
          {
            businessName: prospect.businessName,
            websiteDomain: prospect.websiteDomain,
            market: prospect.market,
            industry: prospect.industry,
            specificHooks: prospect.specificHooks,
          },
          null,
          2,
        ),
        "",
        "## Leia Output (brand + businessData + storyBrandCopy + layoutVariant)",
        JSON.stringify(leiaOutput, null, 2),
        "",
        "## TypeScript Interface Signatures (reproduce exactly)",
        "",
        BUSINESS_INTERFACE,
        "",
        SERVICE_AREAS_INTERFACE,
        "",
        SERVICE_TYPES_INTERFACE,
        "",
        SEO_CONTENT_INTERFACE,
        "",
        "## Required Helpers (preserve VERBATIM in your output)",
        "- business.ts: yearsInBusiness()",
        "- serviceAreas.ts: getAreaBySlug, getNearbyAreas, getAreaName, getFeaturedAreas, getCounties",
        "- serviceTypes.ts: getServiceBySlug, getServiceName, getEmergencyServices, getFeaturedServices, getRelatedServices",
        "- seoContent.ts: generateFaqs, getReviewsForPage, getAggregateRating",
        "",
        "## Template Version",
        templateVersion,
        "",
        "## Brand Colors (for the brandColorScale tool field)",
        `Primary: ${leiaOutput.brand.palette.primary}`,
        `Secondary: ${leiaOutput.brand.palette.secondary}`,
        `Accent: ${leiaOutput.brand.palette.accent}`,
        "Derive 11 shades (brand50..brand950) from the primary. brand500 MUST be exactly the primary hex.",
        "",
        "## Site URLs (for context — Chewie deterministically generates the config files, you only produce the 4 data files)",
        `Site URL (custom domain): ${customDomainUrl}`,
        `Project slug: ${slug}`,
        "",
        "Now call submit_data_files with the 4 TypeScript file sources and brandColorScale.",
      ].join("\n");

      const result = await callAgent({
        ctx,
        agentName: "chewie",
        system: CHEWIE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: contextBlob }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: [chewieDataFilesSchema as any],
        toolChoice: { type: "tool", name: chewieDataFilesSchema.name },
        runId: args.runId,
        prospectId: args.prospectId,
      });

      const rawOutput = result.toolUseResults[0]?.input as
        | ChewieToolInput
        | undefined;
      if (!rawOutput) {
        throw new Error("Chewie: no tool_use in Claude response");
      }

      const validatorInput: ChewieOutputForValidation = {
        businessTs: rawOutput.businessTs ?? "",
        serviceAreasTs: rawOutput.serviceAreasTs ?? "",
        serviceTypesTs: rawOutput.serviceTypesTs ?? "",
        seoContentTs: rawOutput.seoContentTs ?? "",
      };
      const validation = validateChewieOutput(validatorInput);
      if (!validation.ok) {
        await ctx.runMutation(internal.prospects.patch, {
          id: args.prospectId,
          status: "needs_manual_review",
          rejectionReason: `chewie_validator: ${validation.reason}`,
        });
        await ctx.runMutation(internal.agentActions.complete, {
          id: actionId,
          status: "success",
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costUsd: result.costUsd,
          finishedAt: Date.now(),
        });
        return {
          ok: false as const,
          reason: validation.reason,
          prospectId: args.prospectId,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costUsd: result.costUsd,
        };
      }

      const brandColorScale: BrandColorScale =
        rawOutput.brandColorScale ??
        deriveBrandColorScale(leiaOutput.brand.palette.primary);

      const astroConfigMjs = generateAstroConfig(customDomainUrl);
      const packageJson = generatePackageJson(slug);
      const robotsTxt = generateRobotsTxt(customDomainUrl);
      const globalCss = generateGlobalCss({
        fonts: {
          display: leiaOutput.brand.fonts.heading,
          body: leiaOutput.brand.fonts.body,
        },
        brandColorScale,
      });

      // fileMap order is the GitHub push order Plan 5-03 will use. seoContent.ts
      // is LAST so the final push triggers a single Cloudflare Pages build.
      const fileMap: Array<{ path: string; content: string }> = [
        { path: "package.json", content: packageJson },
        { path: "astro.config.mjs", content: astroConfigMjs },
        { path: "public/robots.txt", content: robotsTxt },
        { path: "src/styles/global.css", content: globalCss },
        { path: "src/data/business.ts", content: rawOutput.businessTs },
        { path: "src/data/serviceAreas.ts", content: rawOutput.serviceAreasTs },
        { path: "src/data/serviceTypes.ts", content: rawOutput.serviceTypesTs },
        { path: "src/data/seoContent.ts", content: rawOutput.seoContentTs },
      ];

      console.log(
        `[chewie] naming triple: repoName=${repoName} customSubdomain=${customSubdomain} cfProjectName=${cfProjectName}`,
      );
      console.log(
        `[chewie] tokens: input=${result.inputTokens} output=${result.outputTokens} cost=$${result.costUsd.toFixed(4)}`,
      );
      for (const file of fileMap) {
        console.log(
          `[chewie] ${file.path} (${file.content.length} chars): ${file.content.slice(0, 200).replace(/\n/g, " | ")}`,
        );
      }

      // chewieNotes is written via patch (markBuildStep extras handles the
      // naming triple + templateVersion below). Splitting these writes keeps
      // each mutation aligned with its semantic owner.
      await ctx.runMutation(internal.prospects.patch, {
        id: args.prospectId,
        chewieNotes: rawOutput._notes ?? "",
      });

      // Re-read prospect so buildSteps reflects anything marked by a
      // concurrent or prior run attempt before we hit any external API.
      const prospectPost = await ctx.runQuery(internal.prospects.get, {
        id: args.prospectId,
      });
      if (!prospectPost) {
        throw new Error(`Prospect ${args.prospectId} disappeared`);
      }

      // ---------------------------------------------------------------------
      // STEP 1 — repoCreated
      // ---------------------------------------------------------------------
      if (!prospectPost.buildSteps.repoCreated) {
        await generateRepoFromTemplate({
          ctx,
          githubToken,
          templateRepo,
          owner: githubUsername,
          repoName,
          isPrivate: true,
          runId: args.runId,
          prospectId: args.prospectId,
        });

        await pollRepoReady({
          ctx,
          githubToken,
          owner: githubUsername,
          repoName,
          runId: args.runId,
          prospectId: args.prospectId,
        });

        await ctx.runMutation(internal.prospects.markBuildStep, {
          id: args.prospectId,
          step: "repoCreated",
          extra: {
            repoName,
            customSubdomain,
            cfProjectName,
            templateVersion,
          },
        });
      }

      // ---------------------------------------------------------------------
      // STEP 2 — siteJsonPushed
      // ---------------------------------------------------------------------
      const prospectAfterStep1 = await ctx.runQuery(internal.prospects.get, {
        id: args.prospectId,
      });
      if (!prospectAfterStep1) {
        throw new Error(`Prospect ${args.prospectId} disappeared`);
      }

      if (!prospectAfterStep1.buildSteps.siteJsonPushed) {
        await pushFiles({
          ctx,
          githubToken,
          owner: githubUsername,
          repoName,
          files: fileMap,
          commitMessage: "chewie: populate site data",
          runId: args.runId,
          prospectId: args.prospectId,
        });

        await ctx.runMutation(internal.prospects.markBuildStep, {
          id: args.prospectId,
          step: "siteJsonPushed",
        });
      }

      // ---------------------------------------------------------------------
      // STEP 3 — projectCreated
      // ---------------------------------------------------------------------
      const prospectAfterStep2 = await ctx.runQuery(internal.prospects.get, {
        id: args.prospectId,
      });
      if (!prospectAfterStep2)
        throw new Error(`Prospect ${args.prospectId} disappeared`);

      let pagesDevUrl: string | undefined = prospectAfterStep2.pagesDevUrl as string | undefined;
      if (!prospectAfterStep2.buildSteps.projectCreated) {
        const cfResult = await createPagesProject({
          cfAccountId,
          cfApiToken,
          projectName: cfProjectName,
          githubOwner: githubUsername,
          repoName,
        });
        pagesDevUrl = `https://${cfResult.subdomain}`;
        await ctx.runMutation(internal.prospects.markBuildStep, {
          id: args.prospectId,
          step: "projectCreated",
          extra: { cfProjectName, pagesDevUrl },
        });
      }

      // ---------------------------------------------------------------------
      // STEP 4 — domainAdded
      // ---------------------------------------------------------------------
      const prospectAfterStep3 = await ctx.runQuery(internal.prospects.get, {
        id: args.prospectId,
      });
      if (!prospectAfterStep3)
        throw new Error(`Prospect ${args.prospectId} disappeared`);

      if (!prospectAfterStep3.buildSteps.domainAdded) {
        await attachCustomDomain({
          cfAccountId,
          cfApiToken,
          projectName: cfProjectName,
          domainName: customSubdomain,
        });
        await ctx.runMutation(internal.prospects.markBuildStep, {
          id: args.prospectId,
          step: "domainAdded",
          extra: { customSubdomain },
        });
      }

      // ---------------------------------------------------------------------
      // STEP 5 — deployed
      // ---------------------------------------------------------------------
      const prospectAfterStep4 = await ctx.runQuery(internal.prospects.get, {
        id: args.prospectId,
      });
      if (!prospectAfterStep4)
        throw new Error(`Prospect ${args.prospectId} disappeared`);

      if (!prospectAfterStep4.buildSteps.deployed) {
        try {
          // Trigger deployment every time deployed=false — handles both fresh
          // runs and crash-resume (CF won't auto-deploy on existing commits).
          await triggerDeployment({ cfAccountId, cfApiToken, projectName: cfProjectName });
          const deployment = await pollDeploymentReady({
            cfAccountId,
            cfApiToken,
            projectName: cfProjectName,
          });
          if (!pagesDevUrl) pagesDevUrl = deployment.url;
          await ctx.runMutation(internal.prospects.markBuildStep, {
            id: args.prospectId,
            step: "deployed",
            extra: { pagesDevUrl },
          });
        } catch (buildErr) {
          const reason =
            buildErr instanceof Error ? buildErr.message : String(buildErr);
          await ctx.runMutation(internal.prospects.patch, {
            id: args.prospectId,
            status: "failed",
            rejectionReason: `chewie_build: ${reason}`,
          });
          throw buildErr;
        }
      }

      // ---------------------------------------------------------------------
      // STEP 6 — certReady + final status transition
      // ---------------------------------------------------------------------
      const prospectAfterStep5 = await ctx.runQuery(internal.prospects.get, {
        id: args.prospectId,
      });
      if (!prospectAfterStep5)
        throw new Error(`Prospect ${args.prospectId} disappeared`);

      if (!prospectAfterStep5.buildSteps.certReady) {
        let resolvedSiteUrl = customDomainUrl;
        try {
          await pollSslReady({
            cfAccountId,
            cfApiToken,
            projectName: cfProjectName,
            domainName: customSubdomain,
          });
        } catch {
          // Cert not ready within polling window — fall back to pages.dev URL.
          // The cert will propagate on its own; Ahsoka can review the pages.dev URL.
          resolvedSiteUrl = pagesDevUrl ?? customDomainUrl;
        }
        await ctx.runMutation(internal.prospects.markBuildStep, {
          id: args.prospectId,
          step: "certReady",
          extra: { siteUrl: resolvedSiteUrl },
        });
      }

      await ctx.runMutation(internal.prospects.patch, {
        id: args.prospectId,
        status: "site_built",
      });

      // Phase 6: Luke is now scheduled by the pipeline orchestrator (convex/pipeline.ts), not by Chewie.

      await ctx.runMutation(internal.agentActions.complete, {
        id: actionId,
        status: "success",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        finishedAt: Date.now(),
      });

      return {
        ok: true as const,
        prospectId: args.prospectId,
        repoName,
        repoUrl: `https://github.com/${githubUsername}/${repoName}`,
        customSubdomain,
        pagesDevUrl,
        siteUrl: customDomainUrl,
        templateVersion,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
      };
    } catch (err) {
      const isCostCeiling = err instanceof CostCeilingError;
      await ctx.runMutation(internal.agentActions.complete, {
        id: actionId,
        status: isCostCeiling ? "cost_ceiling_hit" : "failed",
        errorMessage: err instanceof Error ? err.message : String(err),
        finishedAt: Date.now(),
      });
      throw err;
    }
  },
});
