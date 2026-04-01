/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: true,
  images: {
    unoptimized: true
  },
  turbopack: {
    root: process.cwd()
  }
};

export default nextConfig;
