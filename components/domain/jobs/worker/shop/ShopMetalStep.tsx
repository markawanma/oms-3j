"use client";

// ShopMetalStep — W-2b "ทำจากอะไร?" (เฉพาะสินค้าใหม่ไม่มี SKU · UX B.4)
// โลหะผิดแล้วแก้ไม่ได้ (ล็อกพร้อมใบงาน — ทางเดียวคือยกเลิกแล้วเปิดใหม่) จึงได้ทั้งหน้า · ค่าเริ่ม = เงิน 92.50 แต่ทวนอีกครั้งที่ W-6/7 ด้วยป้ายสี
// ทอง: เนื้อว่างบังคับ — กดถัดไปตอนว่าง = error ใต้ช่อง + focus + scrollIntoView (ปุ่ม sticky บังข้อความไม่ได้)
// ไม่มีการถามราคา/ต้นทุนใดๆ (🔴)

import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { BigButton } from "@/components/domain/jobs/worker/WorkerParts";
import { StickyAction, focusField } from "@/components/domain/jobs/worker/WorkerPanels";
import { ShopMetalFields } from "@/components/domain/jobs/worker/shop/ShopMetalFields";
import type { ShopProfileReady } from "@/components/domain/jobs/worker/shop/ShopMetalSummary";
import { changeMetal, metalIssues, profileBlockMessage } from "@/lib/jobs/shop-open";
import type { ShopForm } from "@/lib/jobs/shop-open";

export function ShopMetalStep({ form, setForm, ready, onNext }: { form: ShopForm; setForm: Dispatch<SetStateAction<ShopForm>>; ready: ShopProfileReady; onNext: () => void }) {
  const [notes, setNotes] = useState<string[]>([]);
  const [force, setForce] = useState(false);
  const issues = metalIssues(form);
  const block = profileBlockMessage(form.metal, ready);

  function next() {
    if (issues.purity || issues.weight) {
      setForce(true);
      focusField(issues.purity ? "shop-metal-purity" : "shop-metal-weight");
      return;
    }
    if (block) return;
    onNext();
  }

  return (
    <>
      <div className="mt-4">
        <ShopMetalFields
          idBase="shop-metal"
          metal={form.metal}
          purityText={form.purityText}
          weightText={form.weightText}
          onMetalChange={(m) => {
            const r = changeMetal(form, m);
            setForm(r.form);
            setNotes(r.notes);
            setForce(false);
          }}
          onPurityChange={(v) => setForm((f) => ({ ...f, purityText: v }))}
          onWeightChange={(v) => setForm((f) => ({ ...f, weightText: v }))}
          issues={issues}
          forceShow={force}
          notes={notes}
          profileBlock={block}
        />
      </div>
      <StickyAction>
        <BigButton type="button" aria-disabled={block ? true : undefined} onClick={next}>
          {block ? "เปิดงานวัสดุนี้ไม่ได้ตอนนี้" : "ถัดไป"}
        </BigButton>
      </StickyAction>
    </>
  );
}
