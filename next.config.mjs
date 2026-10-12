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

// หน้าช่าง /w/<token>: token อยู่ใน URL → ห้ามรั่วผ่าน Referer · ห้าม search engine เก็บ · ห้ามแคช (security J1 §5.5)
nextConfig.headers = async () => [
  {
    source: "/w/:path*",
    headers: [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      { key: "Cache-Control", value: "no-store, max-age=0" },
      { key: "X-Content-Type-Options", value: "nosniff" },
    ],
  },
];

export default nextConfig;
