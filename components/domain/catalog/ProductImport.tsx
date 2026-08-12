"use client";

// ProductImport — bulk CSV upload for /catalog (docs/3j-jewelry/analytics/
// product-import-guide.md). Flow: pick .csv -> parse client-side -> preview
// (count + first rows + client-side flags) -> confirm -> importProducts()
// (analytics.product_upsert_bulk) -> per-row result summary. Rendered in a Modal.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, UploadCloud } from "lucide-react";
import { importProducts } from "@/lib/actions/catalog";
import { parseProductCsv } from "@/lib/catalog/csv";
import { PRODUCT_IMPORT_COLUMNS, type ProductImportRow, type ProductImportSummary } from "@/lib/catalog/types";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

const PREVIEW_LIMIT = 8;

// Example rows kept in sync with docs/3j-jewelry/analytics/product-import-
// template.csv — one 'fixed' + one 'spot' the user deletes then replaces.
const TEMPLATE_EXAMPLE_ROWS = [
  "R-SILVER-01,แหวนเงินแท้ลายเกลียว,แหวน,fixed,180,,,,490,,,ตัวอย่าง fixed ลบทิ้งได้,true",
  "BAR-1B-999,เงินแท่ง 999 หนัก 1 บาท,เงินแท่ง,spot,,15.244,0.999,50,,8850001234567,โรงหลอม A,ตัวอย่าง spot ลบทิ้งได้,true",
];

/** Build + download the template CSV client-side (leading BOM so Excel reads
 * Thai as UTF-8; CRLF line endings for Excel). No server round-trip. */
function downloadTemplate() {
  const csv = "﻿" + [PRODUCT_IMPORT_COLUMNS.join(","), ...TEMPLATE_EXAMPLE_ROWS].join("\r\n") + "\r\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "product-import-template.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ProductImport({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const toast = useToast();

  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ProductImportRow[]>([]);
  const [unknownHeaders, setUnknownHeaders] = useState<string[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ProductImportSummary | null>(null);
  const [pending, startTransition] = useTransition();

  // rows flagged as obviously invalid before we even hit the server (missing
  // required sku/name) — the server double-checks, this is just early feedback.
  const missingRequired = rows.filter((r) => !r.sku?.trim() || !r.name?.trim()).length;

  async function handleFile(file: File) {
    setParseError(null);
    setSummary(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      const parsed = parseProductCsv(text);
      if (parsed.rows.length === 0) {
        setRows([]);
        setUnknownHeaders(parsed.unknownHeaders);
        setParseError("ไม่พบข้อมูลในไฟล์ (ต้องมีหัวคอลัมน์ + อย่างน้อย 1 แถว)");
        return;
      }
      if (!parsed.headers.map((h) => h.toLowerCase()).includes("sku")) {
        setRows([]);
        setUnknownHeaders(parsed.unknownHeaders);
        setParseError('ไม่พบคอลัมน์ "sku" — ใช้ไฟล์ template แล้วอย่าเปลี่ยนชื่อหัวคอลัมน์');
        return;
      }
      setRows(parsed.rows);
      setUnknownHeaders(parsed.unknownHeaders);
    } catch {
      setRows([]);
      setParseError("อ่านไฟล์ไม่สำเร็จ — ตรวจว่าเป็นไฟล์ .csv");
    }
  }

  function handleImport() {
    if (rows.length === 0) return;
    startTransition(async () => {
      const result = await importProducts(rows);
      if (!result.ok) {
        setParseError(result.error);
        toast.push(result.error, "error");
        return;
      }
      setSummary(result.data);
      if (result.data.ok > 0) {
        toast.push(`นำเข้าสำเร็จ ${result.data.ok} รายการ${result.data.error > 0 ? ` · ผิดพลาด ${result.data.error}` : ""}`);
        router.refresh();
      } else {
        toast.push(`นำเข้าไม่สำเร็จทุกแถว (${result.data.error} ผิดพลาด)`, "error");
      }
    });
  }

  // ----- result view (after import) -----
  if (summary) {
    const errorRows = summary.results.filter((r) => r.status === "error");
    return (
      <div className="flex flex-col gap-3">
        <div className="flex gap-3">
          <div className="flex-1 rounded-md bg-green-50 px-3 py-2 text-center">
            <div className="text-2xl font-bold tabular-nums text-green-700">{summary.ok}</div>
            <div className="text-xs text-green-700">สำเร็จ</div>
          </div>
          <div className="flex-1 rounded-md bg-red-50 px-3 py-2 text-center">
            <div className="text-2xl font-bold tabular-nums text-red-600">{summary.error}</div>
            <div className="text-xs text-red-600">ผิดพลาด</div>
          </div>
        </div>

        {errorRows.length > 0 && (
          <div className="rounded-md border border-zinc-200">
            <p className="border-b border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-600">
              แถวที่ผิดพลาด (แก้ในไฟล์แล้วนำเข้าใหม่เฉพาะแถวนั้นได้)
            </p>
            <div className="max-h-56 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <tbody>
                  {errorRows.map((r) => (
                    <tr key={r.rowIndex} className="border-b border-zinc-100 last:border-0">
                      <td className="px-3 py-1.5 whitespace-nowrap text-zinc-400">แถว {r.rowIndex}</td>
                      <td className="px-3 py-1.5 font-mono text-zinc-700">{r.sku || "—"}</td>
                      <td className="px-3 py-1.5 text-red-600">{r.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <Button type="button" variant="primary" onClick={onDone}>
            เสร็จสิ้น
          </Button>
        </div>
      </div>
    );
  }

  // ----- upload + preview view -----
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-zinc-500">
          อัปโหลดไฟล์ CSV ตาม template. SKU ซ้ำ = อัปเดตทับ.
        </p>
        <button
          type="button"
          onClick={downloadTemplate}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          ดาวน์โหลด template
        </button>
      </div>

      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-6 text-center hover:border-primary-400 hover:bg-primary-50">
        <UploadCloud className="h-8 w-8 text-zinc-400" aria-hidden="true" />
        <span className="text-sm font-medium text-zinc-700">{fileName ?? "เลือกไฟล์ .csv"}</span>
        <span className="text-xs text-zinc-400">คลิกเพื่อเลือกไฟล์</span>
        <input
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
      </label>

      {parseError && <p className="text-xs text-red-600">{parseError}</p>}

      {unknownHeaders.length > 0 && (
        <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
          คอลัมน์ที่ไม่รู้จัก (จะถูกข้าม): {unknownHeaders.join(", ")}
        </p>
      )}

      {rows.length > 0 && (
        <>
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-zinc-800">พบ {rows.length} แถว</span>
            {missingRequired > 0 && (
              <span className="text-xs text-amber-600">{missingRequired} แถวขาด sku/name (จะผิดพลาด)</span>
            )}
          </div>

          <div className="overflow-x-auto rounded-md border border-zinc-200">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-500">
                  <th className="px-2 py-1.5">sku</th>
                  <th className="px-2 py-1.5">name</th>
                  <th className="px-2 py-1.5">โหมด</th>
                  <th className="px-2 py-1.5 text-right">ต้นทุน/น้ำหนัก</th>
                  <th className="px-2 py-1.5 text-right">ราคาตั้ง</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, PREVIEW_LIMIT).map((r, idx) => (
                  <tr key={idx} className="border-b border-zinc-100 last:border-0">
                    <td className="px-2 py-1.5 font-mono text-zinc-700">{r.sku || <span className="text-red-500">(ว่าง)</span>}</td>
                    <td className="px-2 py-1.5 text-zinc-700">{r.name || <span className="text-red-500">(ว่าง)</span>}</td>
                    <td className="px-2 py-1.5 text-zinc-500">{r.cost_type || "fixed"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600">
                      {r.cost_type === "spot" ? `${r.silver_weight_g || "—"} ก.` : r.unit_cost || "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600">{r.list_price || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > PREVIEW_LIMIT && (
              <p className="px-2 py-1.5 text-center text-xs text-zinc-400">…และอีก {rows.length - PREVIEW_LIMIT} แถว</p>
            )}
          </div>
        </>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onDone} disabled={pending}>
          ยกเลิก
        </Button>
        <Button type="button" variant="primary" onClick={handleImport} loading={pending} disabled={rows.length === 0}>
          ยืนยันนำเข้า {rows.length > 0 ? `${rows.length} แถว` : ""}
        </Button>
      </div>
    </div>
  );
}
