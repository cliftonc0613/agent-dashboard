// Minimal type shim for jaro-winkler — no @types package is published.
// Shipped untyped from 04-02 (commit 47e1aa5); surfaced as a bundling blocker
// during 04-03 verification because `npx convex dev --once` typechecks
// convex/lib/* under its own stricter tsconfig than the Next project root.
declare module "jaro-winkler" {
  export default function jaroWinkler(
    a: string,
    b: string,
    options?: { caseSensitive?: boolean },
  ): number;
}
