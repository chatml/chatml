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
  // Turbopack resolveAlias requires a relative path (prefixed with ./) —
  // absolute paths get treated as relative to the server root and fail in CI.
  turbopack: {
    resolveAlias: {
      shiki: './src/lib/shiki-shim.ts',
    },
  },
  webpack: (config) => {
    config.resolve.alias['shiki'] = shikiShim;
    return config;
  },
};

export default nextConfig;
