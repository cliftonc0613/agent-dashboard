"use node";

import FirecrawlApp from "@mendable/firecrawl-js";

export interface ScrapeResult {
  markdown: string;
  title?: string;
  description?: string;
  sourceURL?: string;
}

export async function scrapeWebsite(url: string): Promise<ScrapeResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not set");

  const fc = new FirecrawlApp({ apiKey });
  const resp = await fc.scrape(url, {
    formats: ["markdown"],
    onlyMainContent: true,
    waitFor: 2000,
    timeout: 30_000,
  });

  const data = resp as unknown as {
    markdown?: string;
    metadata?: { title?: string; description?: string; sourceURL?: string };
  };
  if (!data.markdown) throw new Error(`Firecrawl returned no markdown for ${url}`);

  return {
    markdown: data.markdown,
    title: data.metadata?.title,
    description: data.metadata?.description,
    sourceURL: data.metadata?.sourceURL,
  };
}
