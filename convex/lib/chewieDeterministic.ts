"use node";

/**
 * chewieDeterministic.ts — pure helpers for Chewie's naming contract and
 * deterministic file generation. No DB, no env, no fetch — inputs to outputs
 * so unit tests are trivial and the same prospect always produces the same
 * repoName on retry.
 *
 * The 4 config-file template literals below are copied verbatim from
 * agent-site-template — Convex sandboxes have no filesystem access, so the
 * template content must live as string constants in this file. Placeholders
 * (__SITE_URL__, __PROJECT_SLUG__, __FONT_DISPLAY__, __FONT_BODY__,
 * __BRAND_50__..__BRAND_950__) are substituted at generation time.
 */

// ---------------------------------------------------------------------------
// Template constants — match agent-site-template HEAD verbatim with explicit
// placeholders inserted in place of the hardcoded defaults.
// ---------------------------------------------------------------------------

const ASTRO_CONFIG_TEMPLATE = `// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import icon from 'astro-icon';

export default defineConfig({
  site: '__SITE_URL__',
  output: 'static',
  trailingSlash: 'always',
  integrations: [
    icon(),
    sitemap({
      filter: (page) => !page.includes('/admin/') && !page.includes('/api/'),
      changefreq: 'weekly',
      priority: 0.7,
    }),
  ],
  vite: { plugins: [tailwindcss()] },
});
`;

const PACKAGE_JSON_TEMPLATE = `{
  "name": "__PROJECT_SLUG__",
  "type": "module",
  "version": "0.0.1",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "astro": "astro",
    "typecheck": "astro check"
  },
  "dependencies": {
    "@astrojs/cloudflare": "^12.6.12",
    "@astrojs/sitemap": "^3.7.0",
    "@tailwindcss/typography": "^0.5.19",
    "@tailwindcss/vite": "^4.1.18",
    "astro": "^5.17.2",
    "astro-icon": "^1.1.5",
    "tailwindcss": "^4.1.18"
  },
  "devDependencies": {
    "@iconify-json/lucide": "^1.2.91"
  }
}
`;

const ROBOTS_TXT_TEMPLATE = `User-agent: *
Allow: /
Sitemap: __SITE_URL__/sitemap-index.xml
`;

const GLOBAL_CSS_TEMPLATE = `@import "tailwindcss";
@plugin "@tailwindcss/typography";

@theme {
  --font-display: '__FONT_DISPLAY__', serif;
  --font-body: '__FONT_BODY__', sans-serif;

  --color-brand-50: __BRAND_50__;
  --color-brand-100: __BRAND_100__;
  --color-brand-200: __BRAND_200__;
  --color-brand-300: __BRAND_300__;
  --color-brand-400: __BRAND_400__;
  --color-brand-500: __BRAND_500__;
  --color-brand-600: __BRAND_600__;
  --color-brand-700: __BRAND_700__;
  --color-brand-800: __BRAND_800__;
  --color-brand-900: __BRAND_900__;
  --color-brand-950: __BRAND_950__;

  --color-stone-50: #fafaf9;
  --color-stone-100: #f5f5f4;
  --color-stone-200: #e7e5e4;
  --color-stone-300: #d6d3d1;
  --color-stone-400: #a8a29e;
  --color-stone-500: #78716c;
  --color-stone-600: #57534e;
  --color-stone-700: #44403c;
  --color-stone-800: #292524;
  --color-stone-900: #1c1917;
  --color-stone-950: #0c0a09;

  --color-amber-50: #fffbeb;
  --color-amber-100: #fef3c7;
  --color-amber-200: #fde68a;
  --color-amber-300: #fcd34d;
  --color-amber-400: #fbbf24;
  --color-amber-500: #f59e0b;
  --color-amber-600: #d97706;
  --color-amber-700: #b45309;
  --color-amber-800: #92400e;
  --color-amber-900: #78350f;
  --color-amber-950: #451a03;

  --animate-fade-up: fadeUp 0.6s ease-out both;
  --animate-fade-in: fadeIn 0.5s ease-out both;
  --animate-slide-down: slideDown 0.4s ease-out both;
  --animate-scale-in: scaleIn 0.3s ease-out both;
}

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(24px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-12px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}

@utility stagger-1 { animation-delay: 0.1s; }
@utility stagger-2 { animation-delay: 0.2s; }
@utility stagger-3 { animation-delay: 0.3s; }
@utility stagger-4 { animation-delay: 0.4s; }
@utility stagger-5 { animation-delay: 0.5s; }
@utility stagger-6 { animation-delay: 0.6s; }

@utility glass {
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.3);
}

@utility glass-dark {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

@utility editorial-line {
  position: relative;
  padding-left: 1.25rem;
}

@layer components {
  .editorial-line::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: var(--color-brand-600);
    border-radius: 9999px;
  }

  .card-hover {
    transition: transform 0.25s ease, box-shadow 0.25s ease;
  }

  .card-hover:hover {
    transform: translateY(-4px);
    box-shadow:
      0 10px 25px -5px rgba(0, 0, 0, 0.1),
      0 8px 10px -6px rgba(0, 0, 0, 0.05);
  }

  .prose-editorial {
    font-family: var(--font-body);
    line-height: 1.8;
    color: var(--color-stone-700);
  }

  .prose-editorial h1,
  .prose-editorial h2,
  .prose-editorial h3,
  .prose-editorial h4 {
    font-family: var(--font-display);
    color: var(--color-stone-900);
    line-height: 1.3;
  }

  .prose-editorial h2 {
    margin-top: 2.5rem;
    margin-bottom: 1rem;
    font-size: 1.625rem;
  }

  .prose-editorial h3 {
    margin-top: 2rem;
    margin-bottom: 0.75rem;
    font-size: 1.25rem;
  }

  .prose-editorial a {
    color: var(--color-brand-700);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .prose-editorial a:hover {
    color: var(--color-brand-500);
  }

  .prose-editorial blockquote {
    border-left: 3px solid var(--color-brand-400);
    padding-left: 1.25rem;
    font-style: italic;
    color: var(--color-stone-600);
  }

  .prose-editorial ul {
    list-style-type: disc;
    padding-left: 1.5rem;
  }

  .prose-editorial ol {
    list-style-type: decimal;
    padding-left: 1.5rem;
  }

  .prose-editorial li {
    margin-bottom: 0.5rem;
  }
}
`;

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/**
 * slugifyBusinessName — lowercase-alphanumeric-hyphens URL slug, max 40 chars.
 *
 * "Acme Plumbing & Heating LLC" -> "acme-plumbing-heating-llc"
 * "O'Malley's Hot Dogs"         -> "o-malley-s-hot-dogs"
 * "  Multiple   Spaces  "       -> "multiple-spaces"
 */
export function slugifyBusinessName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/**
 * makeShortSuffix — 6-character base36 suffix from Date.now().
 * Solves slug collisions for repeated business names across markets.
 * Called ONCE per prospect — chewie.ts reuses prospect.repoName on retry.
 */
export function makeShortSuffix(): string {
  return Date.now().toString(36).slice(-6);
}

// ---------------------------------------------------------------------------
// Config file generators
// ---------------------------------------------------------------------------

export function generateAstroConfig(siteUrl: string): string {
  return ASTRO_CONFIG_TEMPLATE.replaceAll("__SITE_URL__", siteUrl);
}

export function generatePackageJson(projectSlug: string): string {
  return PACKAGE_JSON_TEMPLATE.replaceAll("__PROJECT_SLUG__", projectSlug);
}

export function generateRobotsTxt(siteUrl: string): string {
  return ROBOTS_TXT_TEMPLATE.replaceAll("__SITE_URL__", siteUrl);
}

export interface BrandColorScale {
  brand50: string;
  brand100: string;
  brand200: string;
  brand300: string;
  brand400: string;
  brand500: string;
  brand600: string;
  brand700: string;
  brand800: string;
  brand900: string;
  brand950: string;
}

export function generateGlobalCss(input: {
  fonts: { display: string; body: string };
  brandColorScale: BrandColorScale;
}): string {
  const { fonts, brandColorScale } = input;
  return GLOBAL_CSS_TEMPLATE
    .replaceAll("__FONT_DISPLAY__", fonts.display)
    .replaceAll("__FONT_BODY__", fonts.body)
    .replaceAll("__BRAND_50__", brandColorScale.brand50)
    .replaceAll("__BRAND_100__", brandColorScale.brand100)
    .replaceAll("__BRAND_200__", brandColorScale.brand200)
    .replaceAll("__BRAND_300__", brandColorScale.brand300)
    .replaceAll("__BRAND_400__", brandColorScale.brand400)
    .replaceAll("__BRAND_500__", brandColorScale.brand500)
    .replaceAll("__BRAND_600__", brandColorScale.brand600)
    .replaceAll("__BRAND_700__", brandColorScale.brand700)
    .replaceAll("__BRAND_800__", brandColorScale.brand800)
    .replaceAll("__BRAND_900__", brandColorScale.brand900)
    .replaceAll("__BRAND_950__", brandColorScale.brand950);
}

// ---------------------------------------------------------------------------
// Brand shade derivation — algorithmic 11-shade palette from one primary hex
// ---------------------------------------------------------------------------

interface HSL {
  h: number;
  s: number;
  l: number;
}

function hexToHsl(hex: string): HSL {
  if (hex.length !== 7 || !hex.startsWith("#")) {
    throw new Error(`hexToHsl: invalid hex "${hex}", expected #RRGGBB`);
  }
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToHex({ h, s, l }: HSL): string {
  const sat = s / 100;
  const lig = l / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else if (hp < 6) [r1, g1, b1] = [c, 0, x];
  const m = lig - c / 2;
  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * deriveBrandColorScale — 11 shades from a single primary hex. Used as a
 * fallback when Claude's brandColorScale is missing or invalid.
 *
 * Hue + saturation preserved. Lightness ramped per stop:
 *   brand50 = ~95% L ... brand500 = primary verbatim ... brand950 = ~15% L.
 */
export function deriveBrandColorScale(primaryHex: string): BrandColorScale {
  if (primaryHex.length !== 7 || !primaryHex.startsWith("#")) {
    throw new Error(
      `deriveBrandColorScale: invalid primaryHex "${primaryHex}", expected #RRGGBB`,
    );
  }
  const { h, s } = hexToHsl(primaryHex);
  const sat = Math.max(s, 10);

  const lightnessFor = (stop: number): number => {
    if (stop === 500) return 50;
    if (stop < 500) return 95 - ((stop - 50) / 450) * 45;
    return 50 - ((stop - 500) / 450) * 35;
  };

  const shadeAt = (stop: number): string =>
    stop === 500 ? primaryHex : hslToHex({ h, s: sat, l: lightnessFor(stop) });

  return {
    brand50: shadeAt(50),
    brand100: shadeAt(100),
    brand200: shadeAt(200),
    brand300: shadeAt(300),
    brand400: shadeAt(400),
    brand500: primaryHex,
    brand600: shadeAt(600),
    brand700: shadeAt(700),
    brand800: shadeAt(800),
    brand900: shadeAt(900),
    brand950: shadeAt(950),
  };
}
