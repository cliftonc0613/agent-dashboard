import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Lock tracing root to this project to avoid picking up a parent-directory
  // lockfile (e.g. ~/package-lock.json). Matches the Phase 0 agent-site-template
  // pattern so Chewie's deployments stay deterministic.
  outputFileTracingRoot: path.resolve(__dirname),
};

export default nextConfig;
