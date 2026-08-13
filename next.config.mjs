/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // /crm/import posts the raw .xlsx as multipart FormData (design D1 —
      // file_hash needs the raw bytes server-side, so parsing can't move to
      // the client). Real files run ~100-300KB; 4MB is generous headroom
      // over Next's 1MB server action default.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
