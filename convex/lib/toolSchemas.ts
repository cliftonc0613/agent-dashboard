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
 * Phase 4 extends this file with the real agent schemas:
 *   - prospectScoreSchema     (R2 — prospect triage)
 *   - brandAndContentSchema   (Leia — StoryBrand brief + site.json copy)
 *   - reviewSchema            (Ahsoka — vision QA verdict)
 *   - outreachSchema          (Han — LinkedIn message draft)
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

export const prospectScoreSchema = {
  name: "submit_prospect_score",
  description:
    "Submit R2's triage of a single candidate local business. Includes site quality scoring, rebuild opportunity, 3-5 verbatim specificHooks, and a disqualify flag for wrong-fit candidates.",
  input_schema: {
    type: "object",
    properties: {
      siteQualityScore: {
        type: "integer",
        minimum: 0,
        maximum: 10,
        description:
          "0=broken/dead, 10=modern professional. Most local-service sites score 2-5.",
      },
      mobileIssues: {
        type: "array",
        items: { type: "string" },
        maxItems: 5,
        description:
          "Observed mobile rendering problems: 'no viewport meta', 'text overflows', 'buttons too small', etc.",
      },
      seoIssues: {
        type: "array",
        items: { type: "string" },
        maxItems: 5,
        description:
          "Observed SEO gaps: 'no meta description', 'no H1', 'no schema.org LocalBusiness', 'no Google Business link'.",
      },
      rebuildOpportunity: {
        type: "integer",
        minimum: 0,
        maximum: 10,
        description: "0=already great, 10=total rebuild earns huge lift.",
      },
      disqualify: {
        type: "boolean",
        description:
          "TRUE if business is wrong-fit: out of business, corporate chain, wrong industry, already-great site, obvious competitor.",
      },
      disqualifyReason: {
        type: "string",
        description:
          "Short explanation (required when disqualify=true, ignored otherwise).",
      },
      inferredBusinessType: {
        type: "string",
        description:
          "Specific type as observed, e.g. 'residential plumbing', 'commercial HVAC', 'auto detailing mobile'.",
      },
      specificHooks: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 5,
        description:
          "VERBATIM factual details from the business: named services, review quotes, years in business, specific areas. NO generic hooks. These are cited in outreach.",
      },
      painPointSignals: {
        type: "array",
        items: { type: "string" },
        maxItems: 5,
        description:
          "Concrete problems observable in the current site: 'copyright 2019', 'no contact form', 'phone number is an image (uncrawlable)', 'no service pages', 'no reviews'.",
      },
    },
    required: [
      "siteQualityScore",
      "mobileIssues",
      "seoIssues",
      "rebuildOpportunity",
      "disqualify",
      "inferredBusinessType",
      "specificHooks",
      "painPointSignals",
    ],
  },
} as const;

export const brandAndContentSchema = {
  name: "submit_brand_and_content",
  description:
    "Produce complete brand brief + local-business-builder data + StoryBrand homepage copy for a single prospect. Chewie (Phase 5) writes this into the Astro site files.",
  input_schema: {
    type: "object",
    properties: {
      layoutVariant: {
        type: "string",
        enum: ["trades-trust", "service-warmth", "premium-professional"],
        description:
          "trades-trust = plumbers/electricians/HVAC/roofers. service-warmth = cleaners/landscapers/pest. premium-professional = contractors/pool services/auto detailing.",
      },
      brand: {
        type: "object",
        properties: {
          emotion: { type: "string", description: "One-line emotional register to hit." },
          voice: { type: "string", description: "One-line voice description." },
          palette: {
            type: "object",
            properties: {
              primary: { type: "string", description: "Hex color #RRGGBB." },
              secondary: { type: "string", description: "Hex color #RRGGBB." },
              accent: { type: "string", description: "Hex color #RRGGBB." },
            },
            required: ["primary", "secondary", "accent"],
          },
          fonts: {
            type: "object",
            properties: {
              heading: { type: "string", description: "Google Font name for headings." },
              body: { type: "string", description: "Google Font name for body." },
            },
            required: ["heading", "body"],
          },
        },
        required: ["emotion", "voice", "palette", "fonts"],
      },
      businessData: {
        type: "object",
        description: "The 4 local-business-builder data files as JSON.",
        properties: {
          business: {
            type: "object",
            description:
              "Core business facts: name, tagline, phone, email, address, hours, license, years in business, owner name.",
          },
          serviceAreas: {
            type: "array",
            items: { type: "string" },
            description:
              "City/neighborhood names to generate programmatic pages for. Typically 5-15.",
          },
          serviceTypes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                slug: { type: "string" },
                name: { type: "string" },
                shortDescription: { type: "string" },
                longDescription: { type: "string" },
              },
              required: ["slug", "name", "shortDescription", "longDescription"],
            },
            description: "Distinct services with SEO-ready descriptions. Typically 5-10.",
          },
          seoContentSeed: {
            type: "object",
            description:
              "Seed data for FAQ generator: audience-level questions, niche-specific concerns, local landmarks/references.",
          },
        },
        required: ["business", "serviceAreas", "serviceTypes", "seoContentSeed"],
      },
      storyBrandCopy: {
        type: "object",
        description:
          "Homepage copy using StoryBrand 7-part framework. Customer is hero, business is guide.",
        properties: {
          headline: { type: "string", description: "6-word-max tagline." },
          subheadline: { type: "string", description: "One sentence expanding the headline." },
          problem: {
            type: "object",
            properties: {
              external: { type: "string" },
              internal: { type: "string" },
              philosophical: { type: "string" },
              villain: { type: "string" },
            },
            required: ["external", "internal", "philosophical", "villain"],
          },
          guide: {
            type: "object",
            properties: {
              empathy: { type: "string" },
              authority: { type: "string" },
              authorityStats: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["empathy", "authority", "authorityStats"],
          },
          plan: {
            type: "array",
            minItems: 3,
            maxItems: 3,
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                description: { type: "string" },
              },
              required: ["title", "description"],
            },
            description: "EXACTLY 3 steps.",
          },
          directCta: { type: "string" },
          transitionalCta: { type: "string" },
          successVision: { type: "string" },
          stakes: {
            type: "array",
            minItems: 3,
            maxItems: 3,
            items: { type: "string" },
            description: "EXACTLY 3 negative outcomes if customer does nothing.",
          },
          elevatorPitch: {
            type: "object",
            properties: {
              long: { type: "string" },
              condensed: { type: "string" },
            },
            required: ["long", "condensed"],
          },
        },
        required: [
          "headline",
          "subheadline",
          "problem",
          "guide",
          "plan",
          "directCta",
          "transitionalCta",
          "successVision",
          "stakes",
          "elevatorPitch",
        ],
      },
    },
    required: ["layoutVariant", "brand", "businessData", "storyBrandCopy"],
  },
} as const;

export const reviewSchema = {
  name: "submit_review",
  description:
    "Ahsoka's review of a built site. Scores 5 dimensions (0-10 each), computes overall average, returns verdict.",
  input_schema: {
    type: "object",
    properties: {
      visualDesignScore: {
        type: "integer",
        minimum: 0,
        maximum: 10,
        description: "Professional hierarchy, spacing, layout coherence.",
      },
      storyBrandCopyScore: {
        type: "integer",
        minimum: 0,
        maximum: 10,
        description:
          "Hero message clarity, customer-as-hero framing, CTA legibility.",
      },
      mobileRenderingScore: {
        type: "integer",
        minimum: 0,
        maximum: 10,
        description:
          "iPhone 14 viewport. No broken layouts, text overflow, or invisible elements.",
      },
      seoBasicsScore: {
        type: "integer",
        minimum: 0,
        maximum: 10,
        description:
          "Meta description present, heading structure correct, LocalBusiness JSON-LD schema present.",
      },
      speedScore: {
        type: "integer",
        minimum: 0,
        maximum: 10,
        description:
          "Scored from the provided Browserless page-load-ms. 10=<1500ms, 7=1500-2500ms, 4=2500-4000ms, 1=>4000ms.",
      },
      overallScore: {
        type: "number",
        minimum: 0,
        maximum: 10,
        description:
          "Average of the 5 dimension scores. Verdict thresholds: 8+ approved, 6-7 needs_manual_review, <6 rejected.",
      },
      verdict: {
        type: "string",
        enum: ["approved", "needs_manual_review", "rejected"],
        description:
          "MUST match overall score thresholds. 8+ = approved, 6.0-7.9 = needs_manual_review, <6 = rejected.",
      },
      findings: {
        type: "array",
        items: { type: "string" },
        maxItems: 10,
        description: "Each finding cites which dimension.",
      },
      criticalFixes: {
        type: "array",
        items: { type: "string" },
        description:
          "MUST-fix issues blocking approval (empty if verdict=approved).",
      },
    },
    required: [
      "visualDesignScore",
      "storyBrandCopyScore",
      "mobileRenderingScore",
      "seoBasicsScore",
      "speedScore",
      "overallScore",
      "verdict",
      "findings",
      "criticalFixes",
    ],
  },
} as const;

export const outreachSchema = {
  name: "submit_outreach",
  description:
    "Han's LinkedIn DM draft. Must contain exactly one {{SITE_URL}} placeholder and cite at least one verbatim specificHook from the prospect row.",
  input_schema: {
    type: "object",
    properties: {
      channel: {
        type: "string",
        enum: ["linkedin_dm"],
        description: "Phase 4 locks to LinkedIn DM only.",
      },
      body: {
        type: "string",
        maxLength: 1200,
        description:
          "The DM body. 50-100 words. Contains EXACTLY ONE {{SITE_URL}} placeholder. Cites at least one verbatim specificHook. No banned AI-speak.",
      },
      personalizationHooks: {
        type: "array",
        items: { type: "string" },
        description:
          "The specificHooks from the prospect row that this draft cites verbatim.",
      },
      personalizationDepthScore: {
        type: "integer",
        minimum: 0,
        maximum: 10,
        description:
          "Self-score: how specifically personalized is this to THIS business?",
      },
      conversationalToneScore: {
        type: "integer",
        minimum: 0,
        maximum: 10,
        description:
          "Self-score: how naturally conversational is this vs. corporate outreach speak?",
      },
      humanScore: {
        type: "integer",
        minimum: 0,
        maximum: 10,
        description:
          "MUST equal MIN(personalizationDepthScore, conversationalToneScore).",
      },
      humanScoreReason: {
        type: "string",
        description: "One-line explanation of the floor score.",
      },
    },
    required: [
      "channel",
      "body",
      "personalizationHooks",
      "personalizationDepthScore",
      "conversationalToneScore",
      "humanScore",
      "humanScoreReason",
    ],
  },
} as const;

export const chewieDataFilesSchema = {
  name: "submit_data_files",
  description:
    "Submit the 4 Astro data file contents as TypeScript source strings, an 11-shade brand color scale derived from Leia's primary, and the short template SHA. The 4 config files are generated deterministically by Chewie — you don't need to produce them.",
  input_schema: {
    type: "object",
    properties: {
      businessTs: {
        type: "string",
        description:
          "Full TypeScript source for src/data/business.ts. MUST export `business: Business` matching the Business interface (provided in the user message) and preserve the yearsInBusiness() helper verbatim. No __PLACEHOLDER__ tokens may remain. No em-dashes anywhere in the business voice.",
      },
      serviceAreasTs: {
        type: "string",
        description:
          "Full TypeScript source for src/data/serviceAreas.ts. MUST export `serviceAreas: ServiceArea[]` with 6-12 entries, each with slug/name/county/state/zipCodes/population/lat/lng/description/featured/nearby. Preserve the getAreaBySlug/getNearbyAreas/getAreaName/getFeaturedAreas/getCounties helpers verbatim.",
      },
      serviceTypesTs: {
        type: "string",
        description:
          "Full TypeScript source for src/data/serviceTypes.ts. MUST export `serviceTypes: ServiceType[]` with 6-10 entries. Each entry MUST have exactly 4 process steps and at least 1 priceRange. Icon field uses raw lucide names (e.g. 'droplets', 'wrench') without any prefix. Preserve the getServiceBySlug/getServiceName/getEmergencyServices/getFeaturedServices/getRelatedServices helpers verbatim.",
      },
      seoContentTs: {
        type: "string",
        description:
          "Full TypeScript source for src/data/seoContent.ts. MUST export generateFaqs(service?, area?) with the 5 universal FAQs and per-service map. MUST export `reviews: Review[]` with 6+ entries, realistic author names, ratings 4-5, dates within the last 12 months as ISO strings. Preserve the getReviewsForPage/getAggregateRating helpers verbatim.",
      },
      brandColorScale: {
        type: "object",
        description:
          "11-shade palette derived from Leia's primary hex. Used by Chewie's deterministic global.css generator to fill the __BRAND_50__..__BRAND_950__ placeholders. Each value is a hex string #RRGGBB.",
        properties: {
          brand50: { type: "string", description: "Hex #RRGGBB — lightest tint (~95% lightness)" },
          brand100: { type: "string", description: "Hex #RRGGBB" },
          brand200: { type: "string", description: "Hex #RRGGBB" },
          brand300: { type: "string", description: "Hex #RRGGBB" },
          brand400: { type: "string", description: "Hex #RRGGBB" },
          brand500: { type: "string", description: "Hex #RRGGBB — Leia's primary hex, unchanged" },
          brand600: { type: "string", description: "Hex #RRGGBB" },
          brand700: { type: "string", description: "Hex #RRGGBB" },
          brand800: { type: "string", description: "Hex #RRGGBB" },
          brand900: { type: "string", description: "Hex #RRGGBB" },
          brand950: { type: "string", description: "Hex #RRGGBB — darkest shade (~15% lightness)" },
        },
        required: [
          "brand50", "brand100", "brand200", "brand300", "brand400",
          "brand500", "brand600", "brand700", "brand800", "brand900", "brand950",
        ],
      },
      templateVersion: {
        type: "string",
        description:
          "8-char short SHA of the agent-site-template commit Chewie targeted. Passed in via the user message — echo it back so it lands on the prospect row for drift detection.",
      },
      _notes: {
        type: "string",
        description:
          "Optional audit notes for inferences that went beyond literal prospect/leiaOutput data. Keep to a single paragraph. Empty string is fine if no inferences were needed.",
      },
    },
    required: [
      "businessTs",
      "serviceAreasTs",
      "serviceTypesTs",
      "seoContentTs",
      "brandColorScale",
      "templateVersion",
    ],
  },
} as const;

export const lukeDesignSchema = {
  name: "submit_design_pass",
  description:
    "Submit Luke's complete design pass output for a prospect site",
  input_schema: {
    type: "object",
    properties: {
      brandColorScale: {
        type: "object",
        description:
          "11-stop brand color ramp from brand50 (lightest) to brand950 (darkest)",
        properties: {
          brand50: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
          brand100: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
          brand200: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
          brand300: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
          brand400: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
          brand500: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
          brand600: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
          brand700: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
          brand800: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
          brand900: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
          brand950: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
        },
        required: [
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
        ],
      },
      fonts: {
        type: "object",
        properties: {
          display: {
            type: "string",
            description: "Google Font name for headings",
          },
          body: {
            type: "string",
            description: "Google Font name for body text",
          },
        },
        required: ["display", "body"],
      },
      atmosphere: {
        type: "string",
        description:
          "One-paragraph atmosphere description for this specific business",
      },
      designPrinciples: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 5,
        description: "3-5 concrete design principles that guided choices",
      },
      imageQueries: {
        type: "object",
        properties: {
          hero: { type: "string" },
          supporting: {
            type: "array",
            items: { type: "string" },
            minItems: 2,
            maxItems: 2,
          },
        },
        required: ["hero", "supporting"],
      },
      designMdBody: {
        type: "string",
        maxLength: 2000,
        description:
          "Full DESIGN.md body content (atmosphere, palette rationale, fonts, image direction, principles)",
      },
    },
    required: [
      "brandColorScale",
      "fonts",
      "atmosphere",
      "designPrinciples",
      "imageQueries",
      "designMdBody",
    ],
  },
} as const;

// --- Luke stage schemas (Phase 5.5 multi-stage design pipeline) --------------

export const stageTasteDesignSchema = {
  name: "stage_taste_design",
  description: "Stage 1 — taste-design: establish atmosphere, emotional core, and industry clichés to avoid",
  input_schema: {
    type: "object",
    properties: {
      atmosphereSentence: {
        type: "string",
        description: "ONE concrete sensory sentence. No abstractions. Forbidden: 'modern and clean', 'professional and trustworthy'.",
      },
      emotionalCore: {
        type: "string",
        description: "ONE word capturing the feeling this site must produce on first glance",
      },
      clichesToAvoid: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 3,
        description: "2-3 specific design clichés dominant in this industry that will NOT be done",
      },
    },
    required: ["atmosphereSentence", "emotionalCore", "clichesToAvoid"],
  },
} as const;

export const stageColorizeSchema = {
  name: "stage_colorize",
  description: "Stage 2 — colorize: 11-stop brand color scale anchored on the emotional core",
  input_schema: {
    type: "object",
    properties: {
      brand50:  { type: "string", pattern: "^#[0-9A-Fa-f]{6}$", description: "Near-white ~95% lightness, tinted toward brand hue" },
      brand100: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
      brand200: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
      brand300: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
      brand400: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
      brand500: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$", description: "Primary action color — deliberate, confident, chosen for THIS business" },
      brand600: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
      brand700: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
      brand800: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
      brand900: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
      brand950: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$", description: "Near-black ~8% lightness, tinted toward brand hue" },
      colorRationale: {
        type: "string",
        description: "Why THESE colors for THIS business — hue, emotional core connection, clichés avoided",
      },
    },
    required: [
      "brand50","brand100","brand200","brand300","brand400",
      "brand500","brand600","brand700","brand800","brand900","brand950",
      "colorRationale",
    ],
  },
} as const;

export const stageTypesetSchema = {
  name: "stage_typeset",
  description: "Stage 3 — typeset: font pairing with genuine contrast in mood",
  input_schema: {
    type: "object",
    properties: {
      display: {
        type: "string",
        description: "Exact Google Fonts name for headings. FORBIDDEN: Inter, Roboto, Open Sans, Montserrat, Poppins, Lato, Raleway, Nunito, Source Sans Pro.",
      },
      body: {
        type: "string",
        description: "Exact Google Fonts name for body text. Must contrast in mood with display. Same forbidden list applies.",
      },
      fontRationale: {
        type: "string",
        description: "Why this pairing — contrast in mood, how it serves the emotional core",
      },
    },
    required: ["display", "body", "fontRationale"],
  },
} as const;

export const stageCssSchema = {
  name: "stage_write_css",
  description: "Stage 5 — write the complete production global.css file with real component styles, typography scale, and interaction states",
  input_schema: {
    type: "object",
    properties: {
      css: {
        type: "string",
        description: "The complete global.css file content. Must be valid Tailwind v4 CSS using @theme, @utility, @layer components. Must include brand colors, typography scale, component styles, hover states, and transitions.",
      },
    },
    required: ["css"],
  },
} as const;

export const stagePolishHtmlSchema = {
  name: "stage_polish_html",
  description: "Stage 6 — rewrite src/pages/index.astro to apply impeccable polish: fix industry copy, apply atmosphere to section structure, improve interaction classes, remove generic gradients.",
  input_schema: {
    type: "object",
    properties: {
      indexAstro: {
        type: "string",
        description: "The complete rewritten src/pages/index.astro. Full file from line 1 to end. All dynamic Astro expressions ({business.name} etc.) preserved exactly.",
      },
      changes: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 8,
        description: "What changed in each section and why — e.g. 'Hero: replaced radial-gradient overlay with brand-900/60 solid — the atmosphere is warmth not tech glow'",
      },
    },
    required: ["indexAstro", "changes"],
  },
} as const;

export const stagePolishPageSchema = {
  name: "stage_polish_page",
  description: "Polish a single Astro page — fix industry copy, apply atmosphere, fix colors. Return the complete rewritten file.",
  input_schema: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "Complete rewritten file content from line 1 to end. All dynamic Astro expressions preserved exactly.",
      },
      changes: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 6,
        description: "What changed and why — one bullet per section modified",
      },
    },
    required: ["content", "changes"],
  },
} as const;

export const stagePolishDuoSchema = {
  name: "stage_polish_duo",
  description: "Polish two related Astro files at once — fix industry copy, apply atmosphere, fix colors. Return both complete rewritten files.",
  input_schema: {
    type: "object",
    properties: {
      fileA: {
        type: "string",
        description: "Complete rewritten content of the FIRST file (as labeled in the prompt).",
      },
      fileB: {
        type: "string",
        description: "Complete rewritten content of the SECOND file (as labeled in the prompt).",
      },
      changes: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 8,
        description: "What changed across both files and why",
      },
    },
    required: ["fileA", "fileB", "changes"],
  },
} as const;

export const stageBolderSchema = {
  name: "stage_bolder",
  description: "Stage 4 — bolder + polish: design principles, art-directed image queries, DESIGN.md body",
  input_schema: {
    type: "object",
    properties: {
      designPrinciples: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 5,
        description: "3-5 principles SPECIFIC to this business. FORBIDDEN: generic advice like 'use consistent spacing'.",
      },
      imageQueries: {
        type: "object",
        properties: {
          hero: {
            type: "string",
            description: "Art-directed hero query: composition + lighting + mood + foreground subject. FORBIDDEN: vague genre searches.",
          },
          supporting: {
            type: "array",
            items: { type: "string" },
            minItems: 2,
            maxItems: 2,
            description: "Two equally art-directed supporting queries",
          },
        },
        required: ["hero", "supporting"],
      },
      designMdBody: {
        type: "string",
        maxLength: 2000,
        description: "Rationale: why these colors, why these fonts, which 2-3 clichés were avoided and what was done instead",
      },
    },
    required: ["designPrinciples", "imageQueries", "designMdBody"],
  },
} as const;
