import type { NextConfig } from 'next';

const config: NextConfig = {
  // Workspace packages ship TypeScript source (ADR 0001). List each one here
  // as the web app starts importing it.
  transpilePackages: [],
  // No page is ever shown inside another site's frame (so no click on it can
  // be borrowed), a response is read as the type it says it is, a link out
  // does not carry the address it left, and no page may ask for the camera
  // or location — the live microphone is this app's own.
  headers: () =>
    Promise.resolve([
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self)' },
        ],
      },
    ]),
};

export default config;
