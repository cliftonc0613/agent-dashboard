"use node";

export const BANNED_PATTERNS: RegExp[] = [
  // Corporate speak
  /\bleverag(e|ing|ed|es)\b/i,
  /\bsynergy\b/i,
  /\bsynergi(es|ze|zing|zed)\b/i,
  /\bparadigm shift\b/i,
  /\butiliz(e|ing|ed|ation|es)\b/i,
  /\bfacilitat(e|ing|ed|ion)\b/i,
  /\brobust\b/i,
  /\bseamless(ly)?\b/i,
  /\bholistic\b/i,
  /\bstreamlin(e|ing|ed|es)\b/i,
  /\bunlock\b/i,
  /\bscalab(le|ility)\b/i,
  /\bfuture-proof\b/i,
  /\bmission-critical\b/i,
  /\bbest-in-class\b/i,
  /\bcutting-edge\b/i,
  /\bnext-gen(eration)?\b/i,

  // SaaS/marketing hype
  /\bdigital transformation\b/i,
  /\boptimize your (funnel|pipeline)\b/i,
  /\blead generation ecosystem\b/i,
  /\bgrowth hack(s|ing|ed)?\b/i,
  /\bcustomer(-)?centric\b/i,
  /\bvalue proposition\b/i,

  // Bot/outreach tells
  /\bcircle back\b/i,
  /\btouch base\b/i,
  /\breach(ing|ed) out\b/i,
  /\bi (hope|trust) this (finds|email finds|message finds) you well\b/i,
  /\bjust checking in\b/i,
  /\bi wanted to (reach|follow up|connect)\b/i,
  /\bquick question\b/i,
  /\bpick your brain\b/i,
  /\bdive (in|deep|into)\b/i,
  /\bmoving forward\b/i,
  /\bper my (last|previous) (email|message)\b/i,

  // Empty modifier spam
  /\bgame-chang(er|ing|ed)\b/i,
  /\bworld-class\b/i,
  /\bcutting(-| )edge\b/i,
  /\btop-notch\b/i,
];

export interface HanDraft {
  body: string;
  humanScore: number;
  personalizationDepthScore?: number;
  conversationalToneScore?: number;
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateHanDraft(
  draft: HanDraft,
  specificHooks: string[],
): ValidationResult {
  // 1. Exactly one {{SITE_URL}} placeholder.
  const placeholderCount = (draft.body.match(/\{\{SITE_URL\}\}/g) ?? []).length;
  if (placeholderCount !== 1) {
    return {
      ok: false,
      reason: `{{SITE_URL}} count is ${placeholderCount} (need exactly 1)`,
    };
  }

  // 2. At least one specificHook quoted verbatim.
  const hasHook = specificHooks.some((h) => h && draft.body.includes(h));
  if (!hasHook) {
    return { ok: false, reason: "no specificHook cited verbatim" };
  }

  // 3. Word count 50–100.
  const words = draft.body.trim().split(/\s+/).filter(Boolean);
  if (words.length < 50 || words.length > 100) {
    return { ok: false, reason: `word count ${words.length} (need 50–100)` };
  }

  // 4. No banned phrase.
  for (const pattern of BANNED_PATTERNS) {
    const match = draft.body.match(pattern);
    if (match) {
      return { ok: false, reason: `banned phrase: "${match[0]}"` };
    }
  }

  // 5. humanScore floor = 7. Double-check MIN if both sub-scores provided.
  if (draft.humanScore < 7) {
    return { ok: false, reason: `humanScore ${draft.humanScore} < 7` };
  }
  if (
    draft.personalizationDepthScore !== undefined &&
    draft.conversationalToneScore !== undefined
  ) {
    const expected = Math.min(draft.personalizationDepthScore, draft.conversationalToneScore);
    if (draft.humanScore !== expected) {
      return {
        ok: false,
        reason: `humanScore ${draft.humanScore} != MIN(${draft.personalizationDepthScore}, ${draft.conversationalToneScore})`,
      };
    }
  }

  return { ok: true };
}
