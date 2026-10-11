import type { NextConfig } from 'next';

// Built, the interface is a set of static files embedded in the Go binary.
// In development, Next serves the pages and hands the API to the Go server.
const dev = process.env.NODE_ENV === 'development';

const config: NextConfig = {
  reactStrictMode: true,
  trailingSlash: true,
  ...(dev
    ? {
        async rewrites() {
          return [{ source: '/api/:path*', destination: `${process.env.GAMES_API ?? 'http://127.0.0.1:3778'}/api/:path*` }];
        },
        // The Go server does the same for the address players share.
        async redirects() {
          return [{ source: '/u/:name', destination: '/u/?n=:name', permanent: false }];
        },
      }
    : { output: 'export' as const }),
};

export default config;
