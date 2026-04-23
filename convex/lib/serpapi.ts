"use node";

import { getJson } from "serpapi";

export interface LocalResult {
  position?: number;
  place_id?: string;
  title: string;
  type?: string;
  types?: string[];
  address?: string;
  phone?: string;
  website?: string;
  rating?: number;
  reviews?: number;
}

export async function searchLocalBusinesses(
  niche: string,
  market: string,
  start = 0,
): Promise<LocalResult[]> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) throw new Error("SERPAPI_KEY not set");

  const result = await getJson({
    engine: "google_maps",
    q: `${niche} in ${market}`,
    type: "search",
    start,
    api_key: apiKey,
  });

  return (result.local_results ?? []) as LocalResult[];
}

export async function searchLinkedInProfile(
  businessName: string,
  city: string,
): Promise<string | null> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) throw new Error("SERPAPI_KEY not set");

  const result = await getJson({
    engine: "google",
    q: `"${businessName}" ${city} site:linkedin.com/in`,
    api_key: apiKey,
  });

  const organic = (result.organic_results ?? []) as Array<{ link?: string }>;
  const first = organic[0]?.link;
  return first && first.includes("linkedin.com/in/") ? first : null;
}
