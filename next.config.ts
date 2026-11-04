import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (demo/test database) ships WASM + data files; keep it out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
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
