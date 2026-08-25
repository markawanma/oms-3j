"use client";

// RatesPageClient — /oem/rates (T4), the most important OEM screen: the owner
// fills this in one field at a time, across days, not in one sitting. Layout
// follows the production sequence (§1.1), not alphabetical or DB order.

import { useMemo } from "react";
import { CheckCircle2, ChevronRight } from "lucide-react";
import type { OemMetalPriceMap, OemRateStatusRow, OemReadiness, OemSettingData } from "@/lib/oem/types";
import type { SellerProfile } from "@/lib/oem/sellerProfile";
import { OEM_GROUP_LABEL_TH, OEM_GROUP_ORDER, oemScopeLabel, oemScopeSort } from "@/lib/oem/display";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { RateCell } from "./RateCell";
import { MetalPriceSection } from "./MetalPriceSection";
import { OemPolicySection } from "./OemPolicySection";
import { SellerProfileSection } from "./SellerProfileSection";

const PRIORITY_TONE: Record<string, BadgeTone> = { P0: "amber", P1: "blue", P2: "slate" };

interface RateGroup {
  rateKey: string;
  groupCode: string;
  seq: number;
  labelTh: string;
  questionTh: string;
  priority: string;
  scopeKind: OemRateStatusRow["scopeKind"];
  rows: OemRateStatusRow[];
}

function groupRows(rows: OemRateStatusRow[]): RateGroup[] {
  const byKey = new Map<string, RateGroup>();
  for (const row of rows) {
    let g = byKey.get(row.rateKey);
    if (!g) {
      g = {
        rateKey: row.rateKey,
        groupCode: row.groupCode,
        seq: row.seq,
        labelTh: row.labelTh,
        questionTh: row.questionTh,
        priority: row.priority,
        scopeKind: row.scopeKind,
        rows: [],
      };
      byKey.set(row.rateKey, g);
    }
    g.rows.push(row);
  }
  const groups = Array.from(byKey.values());
  for (const g of groups) g.rows.sort((a, b) => oemScopeSort(g.scopeKind, a.scope, b.scope));
  return groups.sort((a, b) => a.seq - b.seq);
}

function jumpTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  (el instanceof HTMLInputElement ? el : el.querySelector("input"))?.focus();
}

export function RatesPageClient({
  rows,
  readiness,
  setting,
  metalPrices,
  sellerProfile,
  sellerLoadError,
}: {
  rows: OemRateStatusRow[];
  readiness: OemReadiness | null;
  setting: OemSettingData;
  metalPrices: OemMetalPriceMap;
  sellerProfile: SellerProfile;
  sellerLoadError?: string | null;
}) {
  const groupsByCode = useMemo(() => {
    const groups = groupRows(rows);
    const byCode = new Map<string, RateGroup[]>();
    for (const g of groups) {
      const list = byCode.get(g.groupCode) ?? [];
      list.push(g);
      byCode.set(g.groupCode, list);
    }
    for (const list of byCode.values()) list.sort((a, b) => a.seq - b.seq);
    return byCode;
  }, [rows]);

  const missingP0 = useMemo(
    () =>
      rows
        .filter((r) => r.priority === "P0" && r.appliesWhen === "always" && r.isMissing)
        .sort((a, b) => a.seq - b.seq),
    [rows]
  );

  const p0Total = readiness?.p0Total ?? 0;
  const p0Filled = readiness?.p0Filled ?? 0;
  const canQuote = readiness?.canQuote ?? false;
  const pct = p0Total > 0 ? Math.round((p0Filled / p0Total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-zinc-900">ต้นทุนงาน OEM</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          กรอกทีละช่องได้ ไม่ต้องกรอกรวดเดียว — ระบบจะตีราคาได้ก็ต่อเมื่อกรอกครบทุกข้อ P0
        </p>
      </div>

      {/* readiness bar */}
      <div
        className={`rounded-lg border p-3.5 shadow-sm ${
          canQuote ? "border-green-300 bg-green-50/50" : "border-amber-300 bg-amber-50/50"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-bold text-zinc-800">
              {canQuote && <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />}
              P0 กรอกแล้ว {p0Filled}/{p0Total}
            </p>
            <p className="mt-0.5 text-xs text-zinc-600">
              {canQuote ? "พร้อมตีราคางาน OEM แล้ว" : "ยังตีราคางาน OEM ไม่ได้ — กรอก P0 ให้ครบก่อน"}
            </p>
          </div>
          <div className="text-lg font-bold tabular-nums text-zinc-700">{pct}%</div>
        </div>
        {missingP0.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {missingP0.map((r) => (
              <button
                key={`${r.rateKey}-${r.scope}`}
                type="button"
                onClick={() => jumpTo(`oem-rate-${r.rateKey}-${r.scope}`)}
                className="flex min-h-9 items-center gap-1 rounded-md border border-amber-300 bg-white px-2.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
              >
                {r.labelTh}
                {r.scopeKind !== "none" && ` (${oemScopeLabel(r.scopeKind, r.scope)})`}
                <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ข้อมูลร้านเรา (หัวกระดาษ) — ยกไว้บนสุด (เหนือช่องต้นทุน) เพราะเป็น
          ด่านบล็อกการพิมพ์ใบเสนอราคาจริง เจ้าของควรเห็น/กรอกได้ทันทีที่เข้าหน้านี้ */}
      <SellerProfileSection profile={sellerProfile} loadError={sellerLoadError} />

      {OEM_GROUP_ORDER.map((code) => {
        const groups = groupsByCode.get(code);
        if (!groups || groups.length === 0) return null;
        return (
          <section key={code} className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
            <h2 className="text-sm font-bold text-zinc-800">{OEM_GROUP_LABEL_TH[code] ?? code}</h2>
            <div className="mt-3 space-y-4">
              {groups.map((g) => (
                <div key={g.rateKey} className="border-t border-zinc-100 pt-3 first:border-0 first:pt-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-zinc-800">{g.questionTh}</p>
                      <p className="mt-0.5 text-xs text-zinc-400">{g.labelTh}</p>
                    </div>
                    <Badge tone={PRIORITY_TONE[g.priority] ?? "slate"}>{g.priority}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {g.rows.map((row) => (
                      <RateCell key={`${row.rateKey}-${row.scope}`} row={row} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <MetalPriceSection prices={metalPrices} />
      <OemPolicySection setting={setting} />
    </div>
  );
}
