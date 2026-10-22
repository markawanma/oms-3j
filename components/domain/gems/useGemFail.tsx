"use client";

// useGemFail — state ความล้มเหลวของการบันทึกพลอย (ใช้ร่วม: สร้างใบงาน · แก้พลอยของใบ · แม่แบบ SKU · เพิ่มรายการ)
//  rowErrors (กล่องแดงที่แถวนั้น · ฟอร์มคงอยู่) · generalError (ระดับฟอร์ม) · similar (ตัวดักชื่อคล้ายของ DB → GemSimilarPrompt) · force (ผู้ใช้ยืนยัน "เพิ่มใหม่จริงๆ")

import { useCallback, useState } from "react";
import { GemSimilarPrompt } from "@/components/domain/gems/GemSimilarPrompt";
import { applySimilarChoice, interpretGemFail } from "@/lib/jobs/gem-save";
import type { GemFailLike, GemRowErrorMap } from "@/lib/jobs/gem-save";
import type { GemDraftRow } from "@/lib/jobs/gem-draft";
import type { GemOptions, GemSimilarHit } from "@/lib/jobs/gems";

export function useGemFail() {
  const [rowErrors, setRowErrors] = useState<GemRowErrorMap>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [similar, setSimilar] = useState<GemSimilarHit | null>(null);
  const [force, setForce] = useState(false);

  const reset = useCallback(() => {
    setRowErrors({});
    setGeneralError(null);
    setSimilar(null);
  }, []);

  /** บันทึกผลล้ม → state · คืน key ของแถวที่ควรโฟกัส (ถ้ามี) */
  const fail = useCallback((r: GemFailLike, rows: readonly GemDraftRow[]): string | null => {
    const v = interpretGemFail(r, rows);
    setRowErrors(v.rowErrors);
    setGeneralError(v.generalError);
    setSimilar(v.similar);
    return v.focusRowKey;
  }, []);

  return { rowErrors, generalError, similar, force, setForce, reset, fail, clearSimilar: useCallback(() => setSimilar(null), []) };
}

/** กล่องถามตัวดักชื่อคล้ายของ DB — ใช้ตัวที่มี = แก้แถวให้แล้วบันทึกซ้ำ · เพิ่มใหม่จริงๆ = บันทึกซ้ำพร้อม force */
export function GemServerSimilar({
  hit,
  rows,
  options,
  onRows,
  onClose,
  onResubmit,
}: {
  hit: GemSimilarHit | null;
  rows: GemDraftRow[];
  options: GemOptions | null;
  onRows: (rows: GemDraftRow[]) => void;
  onClose: () => void;
  /** บันทึกซ้ำ (force = ยืนยันเพิ่มชื่อใหม่ที่คล้าย) */
  onResubmit: (opts: { force: boolean; rows?: GemDraftRow[] }) => void;
}) {
  if (!hit) return null;
  const kindLabel = hit.kind === "type" ? "ชนิดพลอย" : "รูปทรง";
  return (
    <GemSimilarPrompt
      typed={hit.name}
      kindLabel={kindLabel}
      matches={hit.matches}
      onCancel={onClose}
      onUse={(m) => {
        const next = applySimilarChoice(rows, hit, m, options);
        onRows(next);
        onClose();
        onResubmit({ force: false, rows: next });
      }}
      onForce={() => {
        onClose();
        onResubmit({ force: true });
      }}
    />
  );
}
