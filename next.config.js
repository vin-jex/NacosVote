/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Do not webpack-bundle the Postgres drivers. Bundling mangles ws's binary
    // frame masking (TypeError: t.mask is not a function) and breaks the Neon
    // WebSocket pool. Loaded from node_modules at runtime instead.
    serverComponentsExternalPackages: ['@neondatabase/serverless', 'ws', 'pg'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};
