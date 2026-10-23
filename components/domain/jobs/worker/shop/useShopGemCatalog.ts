"use client";

// useShopGemCatalog — ชนิด/รูปทรง/ขนาดที่เคยใช้ + แม่แบบพลอยของ SKU (ไม่มีราคา) สำหรับ W-4 และแผ่นแก้พลอย (W-10)
// คืน { state, options, optionsState, reload } — options = ชุดตัวเลือกของ GemPicker/ตัวตรวจแถวซ้ำ (types/shapes จากแคตตาล็อก · items จากแม่แบบ + extraLines เช่นพลอยที่บันทึกในใบ) ใช้ร่วมทุกจอ
// loading / error(+ลองใหม่) / ready · error ไม่บล็อกการกรอก (พิมพ์ชื่อเองได้ แต่ตัวดักชื่อซ้ำฝั่งจอทำงานไม่ได้ — DB ยังดักเสมอ)
// เรียกได้เฉพาะ action ใน lib/actions/job-worker.ts (ไม่ใช่ useGemOptions ของออฟฟิศ — นั่นลาก action ฝั่งออฟฟิศ)
// โหลดตอน enabled และ key (SKU) เปลี่ยน · ผลของ SKU เก่าไม่ถูกใช้กับ SKU ใหม่ (state ผูกกับ key) · ผลเก่าที่มาช้ากว่าไม่ทับผลใหม่ (seq) · session หมดเวลา → onSessionLost (แผ่น PIN) แต่ฟอร์มคงอยู่

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { intakeGemCatalog } from "@/lib/actions/job-worker";
import type { GemOptions } from "@/lib/jobs/gems";
import { SHOP_GEM_TH, gemOptionsOf } from "@/lib/jobs/shop-gem-flow";
import type { IntakeGemCatalog, IntakeGemLine } from "@/lib/jobs/worker-server";

export type ShopGemCatalogState = { s: "idle" } | { s: "loading" } | { s: "error"; message: string } | { s: "ready"; data: IntakeGemCatalog };

export interface ShopGemCatalog {
  state: ShopGemCatalogState;
  /** null = ยังไม่พร้อม (loading/error) */
  options: GemOptions | null;
  optionsState: "loading" | "error" | "ready";
  reload: () => Promise<void>;
}

const NO_LINES: readonly IntakeGemLine[] = [];

export function useShopGemCatalog({
  token,
  productId,
  enabled,
  onSessionLost,
  extraLines = NO_LINES,
}: {
  token: string;
  productId: string | null;
  enabled: boolean;
  onSessionLost?: () => void;
  /** แถวที่รู้ id เพิ่ม (พลอยที่บันทึกในใบ) — ให้ "เปลี่ยนรายการ"/ตรวจแถวซ้ำรู้จัก · ต้องเป็นอ้างอิงเสถียร */
  extraLines?: readonly IntakeGemLine[];
}): ShopGemCatalog {
  const [box, setBox] = useState<{ key: string; st: ShopGemCatalogState }>({ key: "", st: { s: "idle" } });
  const seq = useRef(0);
  const alive = useRef(true);
  const loadedKey = useRef<string | null>(null);
  const lost = useRef(onSessionLost);
  useEffect(() => {
    lost.current = onSessionLost;
  });
  const key = productId ?? "-";

  const load = useCallback(async () => {
    const my = ++seq.current;
    loadedKey.current = key;
    setBox({ key, st: { s: "loading" } });
    let r: Awaited<ReturnType<typeof intakeGemCatalog>> | null = null;
    try {
      r = await intakeGemCatalog(token, productId);
    } catch {
      r = null; // เน็ตหลุด — ไม่รู้ผล
    }
    if (!alive.current || my !== seq.current) return;
    if (r === null) {
      setBox({ key, st: { s: "error", message: SHOP_GEM_TH.catalogError } });
      return;
    }
    if (r.ok) {
      const { ok: _ok, ...data } = r;
      void _ok;
      setBox({ key, st: { s: "ready", data } });
      return;
    }
    if (r.code === "session_required") lost.current?.();
    setBox({ key, st: { s: "error", message: SHOP_GEM_TH.catalogError } });
  }, [token, productId, key]);

  useEffect(() => {
    if (enabled && loadedKey.current !== key) void load();
  }, [enabled, key, load]);

  // alive ตั้งใหม่ทุกครั้งที่ effect รัน (StrictMode ของ dev: mount → cleanup → mount ต้องไม่ทิ้งผลที่ยังค้าง)
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // ผลของ SKU อื่น (ยังไม่ทันโหลดใหม่) = ยังไม่มีผล — ห้ามเอาแม่แบบของ SKU เก่ามาใช้กับ SKU ใหม่
  const state: ShopGemCatalogState = box.key === key ? box.st : { s: "idle" };
  const data = state.s === "ready" ? state.data : null;
  const options = useMemo(() => (data ? gemOptionsOf(data.types, data.shapes, [...data.template, ...extraLines]) : null), [data, extraLines]);
  const optionsState: "loading" | "error" | "ready" = state.s === "ready" ? "ready" : state.s === "error" ? "error" : "loading";
  return { state, options, optionsState, reload: load };
}
