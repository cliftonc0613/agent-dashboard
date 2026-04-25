"use node";

/**
 * chewieValidator.ts — post-Claude sanity checks on the 4 data file
 * TypeScript strings. Cheap substring assertions catch the catastrophic
 * failures (truncated files, missing helpers, left-over placeholders) that
 * would otherwise cause a silent deploy of a broken site.
 *
 * Validator failure is a data-quality issue, not an exception. chewie.ts
 * transitions the prospect to "needs_manual_review" with rejectionReason
 * set to `chewie_validator: <reason>` and completes agentActions with
 * status="success" — no throw, no errorLog.
 */

export interface ChewieOutputForValidation {
  businessTs: string;
  serviceAreasTs: string;
  serviceTypesTs: string;
  seoContentTs: string;
}

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export function validateChewieOutput(
  output: ChewieOutputForValidation,
): ValidationResult {
  // Check 1: minimum length per file (catches catastrophic truncation).
  const mins: Record<keyof ChewieOutputForValidation, number> = {
    businessTs: 1500,
    serviceAreasTs: 600,
    serviceTypesTs: 1200,
    seoContentTs: 800,
  };
  for (const [key, min] of Object.entries(mins) as [
    keyof ChewieOutputForValidation,
    number,
  ][]) {
    if (output[key].length < min) {
      return {
        ok: false,
        reason: `${key} is only ${output[key].length} chars, min ${min} — likely truncated`,
      };
    }
  }

  // Check 2: required exports + helpers preserved verbatim.
  if (!output.businessTs.includes("export const business")) {
    return { ok: false, reason: "businessTs missing `export const business`" };
  }
  if (!output.businessTs.includes("yearsInBusiness")) {
    return { ok: false, reason: "businessTs missing yearsInBusiness helper" };
  }
  if (!output.serviceAreasTs.includes("export const serviceAreas")) {
    return {
      ok: false,
      reason: "serviceAreasTs missing `export const serviceAreas`",
    };
  }
  if (!output.serviceTypesTs.includes("export const serviceTypes")) {
    return {
      ok: false,
      reason: "serviceTypesTs missing `export const serviceTypes`",
    };
  }
  if (!output.seoContentTs.includes("export const reviews")) {
    return {
      ok: false,
      reason: "seoContentTs missing `export const reviews`",
    };
  }
  if (!output.seoContentTs.includes("generateFaqs")) {
    return { ok: false, reason: "seoContentTs missing generateFaqs helper" };
  }

  // Check 3: entry counts hit the voice-skill minimums.
  const areaSlugCount = (output.serviceAreasTs.match(/slug:\s*["']/g) || [])
    .length;
  if (areaSlugCount < 6) {
    return {
      ok: false,
      reason: `serviceAreas has ${areaSlugCount} entries, min 6`,
    };
  }
  if (areaSlugCount > 12) {
    return {
      ok: false,
      reason: `serviceAreas has ${areaSlugCount} entries, max 12`,
    };
  }
  const typeSlugCount = (output.serviceTypesTs.match(/slug:\s*["']/g) || [])
    .length;
  if (typeSlugCount < 6) {
    return {
      ok: false,
      reason: `serviceTypes has ${typeSlugCount} entries, min 6`,
    };
  }
  if (typeSlugCount > 10) {
    return {
      ok: false,
      reason: `serviceTypes has ${typeSlugCount} entries, max 10`,
    };
  }
  const reviewCount = (output.seoContentTs.match(/author:\s*["']/g) || [])
    .length;
  if (reviewCount < 6) {
    return {
      ok: false,
      reason: `reviews has ${reviewCount} entries, min 6`,
    };
  }

  // Check 4: no __PLACEHOLDER__ tokens left unfilled.
  const placeholderPattern = /__[A-Z][A-Z0-9_]*__/;
  for (const [key, content] of Object.entries(output) as [
    keyof ChewieOutputForValidation,
    string,
  ][]) {
    const match = content.match(placeholderPattern);
    if (match) {
      return {
        ok: false,
        reason: `${key} contains unfilled placeholder ${match[0]}`,
      };
    }
  }

  // Check 5: voice rule — no em-dashes in business.ts.
  if (output.businessTs.includes("—")) {
    return { ok: false, reason: "businessTs contains em-dash (—)" };
  }

  return { ok: true };
}
