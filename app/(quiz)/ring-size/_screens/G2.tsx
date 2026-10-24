import { COPY } from "@/lib/ring-size/config";
import { helpLineHref } from "@/lib/ring-size/line-message";
import { RsButton } from "../_components/RsButton";
import { RsHeader } from "../_components/RsHeader";
import { WarnIcon } from "../_components/Icons";
import { SERIF, TEXT, TEXT_3 } from "../_components/styles";

// G2 — จอไม่พอสำหรับไม้บรรทัด 80 มม. (โครงเดียวกับ G4)
// เป็น "เงื่อนไขการแสดงผล" ไม่ใช่ route: viewport เปลี่ยน (หมุนจอ/แถบเบราว์เซอร์หด) แล้วพอ → กลับจอวัดเดิมเอง ค่าเดิมไม่หาย
// role=status (ไม่ใช่ alert — ไม่ใช่ความผิดของผู้ใช้)
// withHeader=false: R5B ถือ header (+ แถบ G1) ไว้เองเพื่อวัดความสูงบล็อกบนต่อเนื่อง จึงให้ G2 วาดเฉพาะเนื้อหา
export function G2({
  step,
  onBack,
  onUseRing,
  withHeader = true,
}: {
  step?: { current: number; total: number } | null;
  onBack?: () => void;
  onUseRing: () => void;
  withHeader?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col">
      {withHeader ? <RsHeader step={step} onBack={onBack} /> : null}
      <div role="status" className="flex flex-1 flex-col items-center gap-4 px-[22px] pb-6 pt-10 text-center">
        <span className="flex h-[76px] w-[76px] items-center justify-center rounded-full border border-[var(--rs-warn-border)] bg-[var(--rs-warn)] text-[var(--rs-warn-icon)]">
          <WarnIcon size={36} />
        </span>
        <h1 className={`${SERIF} m-0 text-[24px] font-semibold leading-snug ${TEXT}`}>{COPY.g2.title}</h1>
        <p className={`m-0 text-[15px] leading-relaxed ${TEXT_3}`}>{COPY.g2.body}</p>
        <div className="mt-2 flex w-full flex-col gap-2.5">
          <RsButton href={helpLineHref()}>{COPY.g2.cta}</RsButton>
          <RsButton variant="secondary" onClick={onUseRing}>
            {COPY.g2.alt}
          </RsButton>
        </div>
      </div>
    </div>
  );
}
