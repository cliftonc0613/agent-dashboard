"use node";

/**
 * images.ts — image search with provider fallback chain.
 *
 * Chain: Unsplash → Pexels → Lorem Picsum.
 *
 * UNSPLASH_ACCESS_KEY and PEXELS_API_KEY may be set to "demo" / "placeholder"
 * (or simply too short) while real-key approval is pending. Both providers
 * short-circuit to an empty result in that case so the caller falls through
 * to picsumFallback. This is a first-class code path, not an error.
 */

export interface SearchedImage {
  url: string;
  alt: string;
  attribution: string;
  source: "unsplash" | "pexels" | "picsum";
  downloadTrackUrl?: string;
}

export const BUSINESS_TYPE_QUERIES: Record<
  string,
  { hero: string; supporting: string[] }
> = {
  plumber: {
    hero: "experienced plumber inspecting copper pipe under sink, professional, natural light",
    supporting: [
      "plumber installing water heater, residential",
      "clean bathroom renovation, modern fixtures",
    ],
  },
  electrician: {
    hero: "licensed electrician working on electrical panel, professional uniform",
    supporting: [
      "electrician installing outlets, residential",
      "modern home electrical work, safety equipment",
    ],
  },
  hvac: {
    hero: "HVAC technician servicing air conditioning unit, professional",
    supporting: [
      "indoor air quality, modern home comfort",
      "hvac system installation, residential",
    ],
  },
  roofing: {
    hero: "roofer installing shingles on residential home, clear sky",
    supporting: [
      "new roof installation, suburban house",
      "roofing inspection, professional contractor",
    ],
  },
  landscaping: {
    hero: "professional landscaper designing garden, lush greenery",
    supporting: [
      "lawn care service, manicured suburban yard",
      "landscape design, colorful garden",
    ],
  },
  cleaning: {
    hero: "professional house cleaner with supplies, bright clean home",
    supporting: [
      "spotless kitchen after cleaning service",
      "professional cleaning team, residential",
    ],
  },
  painting: {
    hero: "professional painter rolling exterior wall, clean work",
    supporting: [
      "freshly painted interior room, modern colors",
      "exterior house painting, professional crew",
    ],
  },
  pest_control: {
    hero: "pest control technician inspecting home, professional equipment",
    supporting: [
      "pest inspector examining property exterior",
      "safe pest treatment, family home",
    ],
  },
  locksmith: {
    hero: "locksmith working on door lock, professional tools",
    supporting: [
      "locksmith installing high-security lock",
      "residential lock repair, professional service",
    ],
  },
};

export function composeImageQuery(
  businessType: string,
  _leiaContext: string,
): string {
  const norm = businessType.toLowerCase().replace(/[^a-z]+/g, "_");
  return BUSINESS_TYPE_QUERIES[norm]?.hero ?? `${businessType} professional service`;
}

function isPlaceholderKey(key: string): boolean {
  return key === "demo" || key === "placeholder" || key.length < 10;
}

interface UnsplashPhoto {
  urls: { regular: string };
  description: string | null;
  alt_description: string | null;
  user: { name: string; links: { html: string } };
  links: { html: string; download_location: string };
}

export async function searchUnsplash(
  query: string,
  count: number,
  accessKey: string,
): Promise<SearchedImage[]> {
  if (isPlaceholderKey(accessKey)) return [];

  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(
    query,
  )}&per_page=${count}&orientation=landscape`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Client-ID ${accessKey}`,
      "Accept-Version": "v1",
    },
  });
  if (!resp.ok) return [];
  const json = (await resp.json()) as { results?: UnsplashPhoto[] };
  const photos = json.results ?? [];

  return photos.slice(0, count).map((photo) => {
    // Fire-and-forget Unsplash download tracking — required by Unsplash API
    // ToS for any photo we actually use. Errors swallowed; tracking is
    // best-effort and never blocks the pipeline.
    fetch(photo.links.download_location, {
      headers: { Authorization: `Client-ID ${accessKey}` },
    }).catch(() => {});

    return {
      url: photo.urls.regular,
      alt:
        photo.description ??
        photo.alt_description ??
        `${query} professional service`,
      attribution: `Photo by ${photo.user.name} on Unsplash (${photo.user.links.html})`,
      source: "unsplash" as const,
      downloadTrackUrl: photo.links.download_location,
    };
  });
}

interface PexelsPhoto {
  src: { large2x: string };
  alt: string | null;
  photographer: string;
  url: string;
}

export async function searchPexels(
  query: string,
  count: number,
  apiKey: string,
): Promise<SearchedImage[]> {
  if (isPlaceholderKey(apiKey)) return [];

  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(
    query,
  )}&per_page=${count}&orientation=landscape`;
  const resp = await fetch(url, {
    headers: { Authorization: apiKey },
  });
  if (!resp.ok) return [];
  const json = (await resp.json()) as { photos?: PexelsPhoto[] };
  const photos = json.photos ?? [];

  return photos.slice(0, count).map((photo) => ({
    url: photo.src.large2x,
    alt: photo.alt ?? `${query} professional service`,
    attribution: `Photo by ${photo.photographer} on Pexels (${photo.url})`,
    source: "pexels" as const,
  }));
}

function picsumFallback(query: string, count: number): SearchedImage[] {
  const seed = query.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
  return Array.from({ length: count }, (_, i) => ({
    url: `https://picsum.photos/seed/${seed}${i || ""}/1600/900`,
    alt: `${query} professional service`,
    attribution: "Photo by Lorem Picsum",
    source: "picsum" as const,
  }));
}

export async function searchImagesWithFallback(
  query: string,
  count: number,
  unsplashKey: string,
  pexelsKey: string,
): Promise<SearchedImage[]> {
  try {
    const unsplash = await searchUnsplash(query, count, unsplashKey);
    if (unsplash.length >= count) return unsplash;
    const remaining = count - unsplash.length;
    const pexels = await searchPexels(query, remaining, pexelsKey);
    const combined = [...unsplash, ...pexels];
    if (combined.length > 0) return combined;
  } catch {
    // fall through to Picsum
  }
  return picsumFallback(query, count);
}
