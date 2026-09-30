import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { CONTENT_SECURITY_POLICY } from './src/shared/security/content-security-policy';

const withNextIntl = createNextIntlPlugin('./src/shared/i18n/request.ts');

const nextConfig: NextConfig = {
  output: 'standalone',
  // Compression would buffer server-sent events; the app runs locally, so nothing is lost.
  compress: false,
  poweredByHeader: false,
  // The dev badge would sit on the sidebar search; errors are still shown in development.
  devIndicators: false,
  // The start page is a new chat. A redirect here answers with a real 307 before rendering.
  async redirects() {
    return [{ source: '/', destination: '/chat', permanent: false }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      // Static policy for the app in production (`next dev` needs eval for Fast Refresh). Not on
      // /api: document files keep the backend's own `sandbox` policy.
      ...(process.env.NODE_ENV === 'production'
        ? [{ source: '/((?!api/).*)', headers: [{ key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY }] }]
        : []),
    ];
  },
};

export default withNextIntl(nextConfig);
