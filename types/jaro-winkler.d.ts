// Type shim for jaro-winkler — no @types package is published.
// Mirrors convex/lib/jaro-winkler.d.ts so the Next.js root tsconfig
// (which excludes convex/) can resolve the module when type-checking
// app/* files that follow imports through convex/_generated/api.d.ts.
declare module "jaro-winkler" {
  export default function jaroWinkler(
    a: string,
    b: string,
    options?: { caseSensitive?: boolean },
  ): number;
}
