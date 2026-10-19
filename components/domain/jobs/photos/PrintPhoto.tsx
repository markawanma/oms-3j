// PrintPhoto — รูปหลักบนใบพิมพ์ A5 (ชั้นแสดงผลล้วน · ไม่ใช้ hook → ใช้ได้ทั้ง server/client component)
// 30×30 มม. ลอยขวา (float-right) ในคอลัมน์ข้อความซ้ายของหัวใบ ติด QR · วางเป็นลูกแรกของคอลัมน์เพื่อให้ข้อความไหลอ้อม
// object-contain — ห้ามตัดขอบ (ช่างต้องเห็นชิ้นงานครบ) · ห่าง QR ≥ 4 มม. (กัน scan สับสน) · ไม่เพิ่มแถว/ไม่ย่อตาราง/ไม่แตะ QR
// ใบที่ไม่มีรูปไม่ render คอมโพเนนต์นี้เลย (ผู้เรียกตัดสิน) = markup เดิมทุกประการ
// รับ url (signed URL md) ไม่ใช่ path · onLoad/onError ให้ผู้เรียกกั้นปุ่มพิมพ์/ตัดรูปออกเมื่อพัง

import type { ReactNode, Ref } from "react";

/** imgRef: ให้ผู้เรียก (usePrintPhoto) อ่าน complete/naturalWidth ได้ — รูปที่โหลดเสร็จก่อน hydrate จะไม่มี event (B1) */
export function PrintPhoto({ url, alt, onLoad, onError, imgRef, className = "", children }: { url: string; alt: string; onLoad?: () => void; onError?: () => void; imgRef?: Ref<HTMLImageElement>; className?: string; children?: ReactNode }) {
  return (
    <div data-testid="print-photo" className={`float-right ml-[3mm] mr-[1mm] mb-[1mm] w-[30mm] shrink-0 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- signed URL อายุสั้น · พิมพ์ต้องเป็น <img> ธรรมดา */}
      <img ref={imgRef} src={url} alt={alt} referrerPolicy="no-referrer" onLoad={onLoad} onError={onError} className="block h-[30mm] w-[30mm] border border-zinc-700 bg-white object-contain" />
      {children}
    </div>
  );
}
