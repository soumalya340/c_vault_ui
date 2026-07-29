import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* feed store uses JSON files under data/ — no native modules */
  async redirects() {
    return [
      // Section 03 renamed: Vault Ops → Create
      { source: '/vaults-ops', destination: '/create', permanent: true },
    ];
  },
};

export default nextConfig;
