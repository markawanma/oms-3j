import type { ReactNode } from "react";

// Public route group — ไม่มี dashboard chrome / internal nav / auth gate ใดๆ
// (ดู docs/3j-jewelry/web/shop-route-design.md §1) ห้าม import จาก (dashboard)
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b-[3px] border-[#A2191D] px-4 pb-4 pt-7 text-center">
        <div
          aria-hidden="true"
          className="mx-auto mb-2 h-11 w-11 -rotate-45 rounded-full border-4 border-[#A2191D] border-t-transparent"
        />
        <h1 className="text-xl font-bold tracking-wide text-slate-900">3J JEWELRY</h1>
        <p className="mt-1.5 text-sm text-slate-500">เงินแท้ 92.5 · ใส่ได้ทุกวัน · ไม่แพ้ผิว</p>
      </header>
      <main>{children}</main>
      <footer className="mt-8 border-t border-slate-200 px-4 pb-6 pt-4 text-center text-xs text-slate-500">
        <p>
          3J Jewelry · เงินแท้ 92.5 · LINE:{" "}
          <a
            href="https://line.me/R/ti/p/@3jsilver"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#A2191D] hover:underline"
          >
            @3jsilver
          </a>
        </p>
        <p className="mt-1">ราคาอาจมีการเปลี่ยนแปลง กรุณาทักแชทยืนยันราคาก่อนสั่งซื้อ</p>
      </footer>
    </div>
  );
}
