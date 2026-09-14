import type { NextConfig } from 'next';

const config: NextConfig = {
  // Workspace packages ship TypeScript source (ADR 0001). List each one here
  // as the web app starts importing it.
  transpilePackages: [],
};

export default config;
