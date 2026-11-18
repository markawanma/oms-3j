import { COPY } from "@/lib/ring-size/config";
import { ToolsHubLink } from "../../_components/ToolsHubLink";
import { BackIcon } from "./Icons";
import { FOCUS, SERIF, TEXT, TEXT_2 } from "./styles";

// RsHeader — ปุ่มย้อน 44×44 · ตัวนับขั้น (aria-label "ขั้นที่ 1 จาก 3") · มาร์ก 3J
// ตัวนับ dynamic ตาม state (คนใหม่ 01/03 · คนกลับมา 01/02) — คำนวณที่ lib/ring-size/flow.ts

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** ความสูงจริงของ header = pt-1.5 (6) + ปุ่มย้อน h-11 (44) + pb-0.5 (2) — ใช้เป็นค่าตั้งต้นก่อนวัดจริง (R5B วัดบล็อกบนรวมแถบ G1 เอง) */
export const HEADER_PX = 52;

/** hubLink = มาร์ก 3J ขวาบนกดกลับหน้ารวมเครื่องมือได้ (P3) — ส่งเฉพาะหน้าผล (R6) · ระหว่างวัด (R1–R5/G4) ไม่ส่ง = รูปเฉยๆ กันกดพลาดทิ้งงานกลางทาง */
export function RsHeader({ step, onBack, hubLink = false }: { step?: { current: number; total: number } | null; onBack?: () => void; hubLink?: boolean }) {
  const mark = (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/ring-size/3j-mark.png" alt={COPY.common.markAlt} className="h-[30px] w-auto" />
  );
  return (
    <header className="flex shrink-0 items-center justify-between px-[22px] pb-0.5 pt-1.5">
      {onBack ? (
        <button
          type="button"
          aria-label={COPY.common.back}
          onClick={onBack}
          className={`-ml-2 flex h-11 w-11 items-center justify-center rounded-full ${TEXT} hover:bg-[var(--rs-blush)] ${FOCUS}`}
        >
          <BackIcon />
        </button>
      ) : (
        <span className="h-11 w-11" aria-hidden="true" />
      )}
      {step ? (
        <span
          aria-label={COPY.common.stepAria(step.current, step.total)}
          className={`${SERIF} text-[14px] tracking-[0.18em] ${TEXT_2}`}
        >
          {pad2(step.current)} / {pad2(step.total)}
        </span>
      ) : (
        <span aria-hidden="true" />
      )}
      {hubLink ? (
        <ToolsHubLink variant="mark" className="-mr-2">
          {mark}
        </ToolsHubLink>
      ) : (
        mark
      )}
    </header>
  );
}
