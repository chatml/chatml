import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const __dirname_ = path.dirname(fileURLToPath(import.meta.url));
const shikiShim = path.resolve(__dirname_, "src/lib/shiki-shim.ts");

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  transpilePackages: ['@pierre/diffs', '@shikijs/core', '@shikijs/engine-javascript', '@shikijs/langs'],
  // Redirect 'shiki' imports to our lightweight shim that re-exports from
  // @shikijs/core + @shikijs/engine-javascript, bypassing bundle-full.mjs
  // which pulls in Oniguruma WASM and hundreds of dynamic import() calls
  // that fail in Tauri release builds.
  // Uses @/ path alias because Turbopack's resolveAlias prepends './' to
  // both relative and absolute paths, breaking resolution in CI.
  turbopack: {
    resolveAlias: {
      shiki: '@/lib/shiki-shim',
    },
  },
  webpack: (config) => {
    config.resolve.alias['shiki'] = shikiShim;
    return config;
  },
};

export default nextConfig;
