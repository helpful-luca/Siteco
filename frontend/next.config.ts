import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

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
    ];
  },
};

export default withNextIntl(nextConfig);
