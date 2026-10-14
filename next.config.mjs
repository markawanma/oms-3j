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
// L3 (12 ต.ค.): ห้ามถูกฝังใน iframe/เว็บอื่น (clickjacking ปุ่มรับงาน/ส่งต่อ + ช่องใส่ PIN) — ทั้ง X-Frame-Options (เบราว์เซอร์เก่า) และ CSP frame-ancestors (มาตรฐานปัจจุบัน)
nextConfig.headers = async () => [
  {
    source: "/w/:path*",
    headers: [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      { key: "Cache-Control", value: "no-store, max-age=0" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    ],
  },
];

export default nextConfig;
