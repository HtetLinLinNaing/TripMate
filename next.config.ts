import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.TRIPMATE_TEST_BUILD === '1' ? '.next-test' : '.next',
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
