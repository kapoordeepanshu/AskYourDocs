import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['unpdf', 'mammoth', 'jsdom', 'postgres'],
  experimental: {
    // Uploads are streamed to storage, but the parsed buffer still passes
    // through the route handler. Keep this in step with MAX_UPLOAD_MB.
    serverActions: { bodySizeLimit: '32mb' },
  },
}

export default nextConfig
