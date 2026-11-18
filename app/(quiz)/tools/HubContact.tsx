import { LINE_OA_URL } from "@/lib/shop/line";
import { TOOLS_HUB_COPY } from "@/lib/tools-hub/config";

// HubContact — ปุ่มทัก LINE ระดับรอง (outline) · ลิงก์ = LINE_OA_URL เดิมที่เจ้าของยืนยัน · ไม่ส่งข้อความสำเร็จรูป · ไม่มีค่าติดต่ออื่น
export function HubContact() {
  return (
    <section aria-labelledby="hub-contact-heading" className="mt-8 text-center">
      <p id="hub-contact-heading" className="text-[14px] text-[var(--gq-text-muted)]">
        {TOOLS_HUB_COPY.contactHeading}
      </p>
      <a
        href={LINE_OA_URL}
        className="mt-3 inline-flex min-h-[48px] w-full items-center justify-center rounded-full border border-[var(--gq-burgundy)] bg-white px-6 text-[15px] font-medium text-[var(--gq-burgundy-dark)] transition-colors hover:bg-[var(--gq-burgundy-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)] sm:w-auto"
      >
        {TOOLS_HUB_COPY.contactCta}
      </a>
    </section>
  );
}
