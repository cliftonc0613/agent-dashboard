"use node";

import jaroWinkler from "jaro-winkler";

export function normalizeBusinessName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.,'"()]+/g, " ")
    .replace(/\b(llc|inc|co|corp|ltd|the|and)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface DedupCandidate {
  normalizedName: string;
  phone?: string;
  linkedinURL?: string;
  websiteDomain?: string;
}

export function isFuzzyMatch(
  a: DedupCandidate,
  b: DedupCandidate,
  threshold = 0.85,
): boolean {
  if (a.phone && b.phone && a.phone === b.phone) return true;
  if (a.linkedinURL && b.linkedinURL && a.linkedinURL === b.linkedinURL) return true;
  if (a.websiteDomain && b.websiteDomain && a.websiteDomain === b.websiteDomain) return true;

  if (!a.normalizedName || !b.normalizedName) return false;
  const sim = jaroWinkler(a.normalizedName, b.normalizedName);
  return sim >= threshold;
}
