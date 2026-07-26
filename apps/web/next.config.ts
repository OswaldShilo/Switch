import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @switch/shared is a workspace package whose "main" points at raw TypeScript
  // source (src/index.ts), not a compiled dist/ — Next.js only transpiles
  // node_modules-resolved TS for packages listed here.
  transpilePackages: ['@switch/shared'],
};

export default nextConfig;
