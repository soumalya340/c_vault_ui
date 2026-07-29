import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* feed store uses JSON files under data/ — no native modules */
  async redirects() {
    return [
      // Section 03 renamed: Vault Ops → Create
      { source: '/vaults-ops', destination: '/create', permanent: true },
      // Vaults catalogue renamed: vaults-all → discover
      { source: '/vaults-all', destination: '/discover', permanent: true },
      { source: '/vaults-all/:vaultId', destination: '/discover/:vaultId', permanent: true },
    ];
  },
};

export default nextConfig;
