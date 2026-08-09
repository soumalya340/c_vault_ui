import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* feed store uses JSON files under data/ — no native modules */
  experimental: {
    // Barrel-file packages: only pull the modules actually used instead of the
    // whole export surface. `lucide-react` is omitted deliberately — Next
    // optimizes it by default, so listing it here would be a no-op.
    optimizePackageImports: ['radix-ui', 'motion'],
  },
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
