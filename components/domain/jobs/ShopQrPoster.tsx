// ShopQrPoster — โปสเตอร์ QR ร้าน (A4 แนวตั้ง · พิมพ์ติดหน้าร้าน/โต๊ะผู้จัดการ) · UX B.10.4
// แสดงเฉพาะตอนพิมพ์ (hidden print:block) · โลโก้ 3J ซ้ายบน · หัว "เปิดงานใหม่" · QR 12 ซม. · ขั้น 1-2-3 · "สำหรับช่างที่ได้รับสิทธิ์เท่านั้น"
// 🔴 ไม่พิมพ์ URL/ตัวเลขใดๆ (ผู้สแกนเห็นลิงก์จากโทรศัพท์เอง) · ไม่มีส่วนที่ซ่อนด้วย print:hidden ที่มีข้อมูลภายใน · SVG QR = ดำบนขาว ไม่มีสคริปต์ (lib vendored)

export function ShopQrPoster({ svg }: { svg: string }) {
  return (
    <article data-print-keep aria-label="โปสเตอร์ QR ร้าน" className="hidden bg-white p-[8mm] text-black print:block">
      <header className="flex items-center border-b-2 border-primary-600 pb-[4mm]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/3j-logo.png" alt="3J" className="h-[26px] w-auto" />
      </header>
      <h1 className="mt-[14mm] text-center text-[44pt] leading-tight font-extrabold">เปิดงานใหม่</h1>
      <div className="mt-[10mm] flex justify-center">
        {/* QR สร้างในเบราว์เซอร์จากไลบรารี vendored (ดำบนขาว ไม่มีสคริปต์) — ไม่ใช่ข้อมูลจากผู้ใช้ */}
        <div role="img" aria-label="QR ร้าน" className="h-[120mm] w-[120mm] [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
      <ol className="mt-[12mm] flex items-start justify-center gap-[10mm] text-center text-[20pt] font-bold">
        {["สแกน", "เลือกชื่อ", "ใส่ PIN"].map((t, i) => (
          <li key={t} className="flex flex-col items-center gap-[2mm]">
            <span className="flex h-[16mm] w-[16mm] items-center justify-center rounded-full border-[1.2mm] border-black text-[22pt]">{i + 1}</span>
            {t}
          </li>
        ))}
      </ol>
      <p className="mt-[16mm] text-center text-[16pt]">สำหรับช่างที่ได้รับสิทธิ์เท่านั้น</p>
    </article>
  );
}
