import { Logo } from "@/components/brand/Logo";
import { HUB_TOOLS, TOOLS_HUB_COPY } from "@/lib/tools-hub/config";
import { HubContact } from "./HubContact";
import { LastSizeChip } from "./LastSizeChip";
import { ToolCard } from "./ToolCard";

// ToolsHub — หน้ารวมเครื่องมือลูกค้า (server component · static) · ไม่มี async จึงไม่มี loading/error จริง
//   empty = ไม่เคยวัดไซซ์ → ไม่มี chip · error (storage พัง) = เหมือน empty (เงียบ) · success = การ์ด 3 + (chip) + ปุ่ม LINE
// ไม่มีรูปแหวน/3D/ราคาแยกชิ้น (โหลดเร็วใน LINE browser) · ราคาเดียวที่แสดงมาจาก formatPriceThb() ผ่าน config
export function ToolsHub() {
  return (
    <div className="px-5 pb-10 pt-8 sm:px-8">
      <div className="flex justify-center">
        <Logo />
      </div>
      <h1 className="mt-5 text-center font-quiz-serif text-[24px] font-semibold leading-snug text-[var(--gq-burgundy-dark)] [overflow-wrap:anywhere]">
        {TOOLS_HUB_COPY.heading}
      </h1>
      <p className="mt-2 text-center text-[14px] leading-relaxed text-[var(--gq-text-muted)]">{TOOLS_HUB_COPY.subheading}</p>

      <ul role="list" aria-label={TOOLS_HUB_COPY.toolsLabel} className="mt-6 space-y-3">
        {HUB_TOOLS.map((tool) => (
          <ToolCard key={tool.id} tool={tool}>
            {tool.id === "ring-size" ? <LastSizeChip /> : null}
          </ToolCard>
        ))}
      </ul>

      <HubContact />
      <p className="mt-6 text-center text-[12px] leading-relaxed text-[var(--gq-text-faint)]">{TOOLS_HUB_COPY.footnote}</p>
    </div>
  );
}
