/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Emits a self-contained server bundle with only the dependencies actually
   * used, so the runtime image does not carry a full node_modules tree. This
   * is what the Dockerfile's runtime stage copies.
   */
  output: 'standalone',
};

export default nextConfig;
