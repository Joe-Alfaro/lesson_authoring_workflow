import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The Docker image runs .next/standalone/server.js with only the traced node_modules (D-042).
  output: 'standalone',
  // Enables forbidden() so requireRole() can answer 403 from pages, actions and route handlers.
  experimental: {
    authInterrupts: true,
  },
  serverExternalPackages: ['pg', 'pg-boss'],
}

export default nextConfig
