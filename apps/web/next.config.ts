import { resolve } from 'node:path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// One .env at the repo root, shared with the API.
loadEnvConfig(resolve(process.cwd(), '../..'));

const nextConfig: NextConfig = {
  turbopack: { root: resolve(process.cwd(), '../..') },
};

export default nextConfig;
