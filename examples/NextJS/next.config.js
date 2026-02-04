/** @type {import('next').NextConfig} */
const nextConfig = {
  // Transpile local agent-backend package from TypeScript
  transpilePackages: ['agent-backend'],

  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  webpack: (config, { isServer }) => {
    config.externals = config.externals || []

    if (isServer) {
      config.externals.push({
        'ssh2': 'commonjs ssh2',
      })
    }

    return config
  },
}

module.exports = nextConfig
