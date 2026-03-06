import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  transpilePackages: ['@pierre/diffs', '@shikijs/core', '@shikijs/engine-javascript', '@shikijs/langs'],
};

export default nextConfig;
