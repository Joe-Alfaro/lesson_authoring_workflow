import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Enables forbidden() so requireRole() can answer 403 from pages, actions and route handlers.
  experimental: {
    authInterrupts: true,
  },
  serverExternalPackages: ['pg', 'pg-boss'],
}

export default nextConfig
