# Phase Import-UI — หน้าเว็บนำเข้ารายงานยอดขายรายเดือน (Excel)

> architect (Yoda) · 2026-08-14 · ห่อ pipeline เดิม (`scripts/import-aug.mjs` + migrations 0011/0013/0016/0019/0026) เป็นหน้าเว็บ — **ไม่สร้าง pipeline ใหม่**
> ผู้ใช้: เจ้าของร้าน/แอดมิน อัปโหลดรายงานยอดขายรายเดือน (ไฟล์เดียวครอบทุกช่องทาง LINE/TikTok/FB แยกด้วย `channel_raw`) ~300–500 แถว/เดือน
> ยืนยันโครงสร้างไฟล์จริงแล้ว: "1-10 Aug sell report.xlsx" = 334 แถว, 25 คอลัมน์ header ไทย ตรง COLUMN_MAP เป๊ะ (คอลัมน์ 23/24 = URL ภายใน unmapped ถูกแล้ว)

## 0. Scope

- **In**: หน้า `/crm/import` — upload → preview → confirm → transform → สรุปผล + ประวัติ batch + โหมด backfill หลายไฟล์ (ม.ค.–ก.ค. 7 ไฟล์)
- **Out**: TikTok PDF label/slip (source_type อื่น — phase หลัง), แก้ transform proc, auth จริง
- **Migration ใหม่: ไม่มี** (ดู D7) — งานนี้คือ frontend + server action wrapper + shared parse lib ล้วนๆ

## 1. Data flow (reuse vs ใหม่)

```
[Browser] เลือกไฟล์ .xlsx 1..n ไฟล์ (File objects ค้างใน client state)
    │  FormData (multipart) ทีละไฟล์
    ▼
[NEW] previewOrderImport(formData)          ← server action, dry-run ไม่เขียน DB
    │  parse ด้วย [NEW lib/import/order-report.ts]  ← PORT ตรงจาก import-aug.mjs
    │  (COLUMN_MAP 25 คอลัมน์ positional / parseThaiDateText / toNumberOrNull — semantics เดิมเป๊ะ)
    │  + [NEW] shape validation (จำนวนคอลัมน์ + วันที่ parse ได้) ก่อนเชื่อ index
    │  + เช็ค file_hash ชน stg_import_batch [REUSE 0011]
    │  + เช็ค dedup_key ชน stg_order_import → "จะอัปเดตทับ X ออเดอร์เดิม"
    ▼
[UI] Preview: กี่แถว / channel (normalize แล้ว) / ช่วงวันที่ / warning / ไฟล์ซ้ำไหม
    │  กด "ยืนยันนำเข้า" → ส่ง File ตัวเดิมซ้ำ
    ▼
[NEW] commitOrderImport(formData)           ← server action, ครบใน call เดียว
    1. parse + validate ใหม่ (lib เดียวกับ preview — stateless ไม่มีอะไรค้าง server)
    2. insert stg_import_batch               [REUSE 0011, idempotent file_hash]
    3. UPSERT stg_order_import chunk 200     [REUSE 0011 — เปลี่ยน insert→upsert, ดู D7]
    4. rpc transform_pending_orders          [REUSE proc ตัวล่าสุดใน DB (0026) — ไม่แตะเลย]
    5. update batch status → transformed | failed
    ▼
fact_order / dim_customer / dim_address / pii_customer   [REUSE — proc จัดการเองทั้งหมด]
    │
แถว error → stg_order_import.import_status='error' → [REUSE หน้า /crm/import-errors เดิม]
```

สิ่งที่ "ใหม่" มีแค่ชั้น wrapper: parse lib (TS port + shape validation), 4 server actions, 1 หน้า + 2 component. Database layer ไม่ขยับสัก byte

## 2. Decisions (เคาะแล้ว พร้อม trade-off)

### D1 — Parse ที่ไหน: **server action (FormData multipart), parse ด้วย `xlsx` ฝั่ง server**
- `xlsx@0.18.5` อยู่ใน dependencies แล้ว (CLI ใช้อยู่) — server action import ได้ทันที (Node runtime default, ไม่ใช่ edge)
- เหตุผลที่ **ไม่** parse ฝั่ง client (ต่างจาก precedent `ProductImport.tsx` ที่ parse CSV client-side):
  1. **file_hash ต้อง hash จาก byte ดิบ** เพื่อ idempotency — ไฟล์ต้องถึง server ทั้งก้อนอยู่ดี parse client แล้วส่ง rows JSON = เสีย byte ดิบ = เสีย contract เดิม
  2. `xlsx` เข้า client bundle หนัก ~1MB (CSV ของ catalog parse มือได้ ไฟล์นี้ binary xlsx ทำมือไม่ได้)
  3. mapping อยู่ที่เดียวฝั่ง server → CLI เดิมกับ UI เชื่อ semantics ชุดเดียวกัน
- **Body size limit**: server action default 1MB — ไฟล์จริง ~100–300KB ผ่านสบาย แต่กันเหนียวเพิ่มใน `next.config.mjs`: `experimental.serverActions.bodySizeLimit = "4mb"` + client guard: reject ไฟล์ >4MB / ไม่ใช่ .xlsx ก่อนส่ง พร้อมข้อความไทย
- ตัดทิ้ง: อัปโหลดขึ้น Supabase Storage แล้วให้ server อ่าน — over-engineer สำหรับไฟล์ระดับ KB เดือนละครั้ง (ค่อยทำเมื่อถึง phase PDF ที่ไฟล์ใหญ่จริง)

### D1.5 — Shape validation (ความเสี่ยงหลักของ positional mapping — บังคับมี ไม่ใช่ nice-to-have)
- Import อ่านตาม **index** ไม่ใช่ชื่อ header (header จริงเป็นไทย: [0]เลขที่ออเดอร์ … [3]ช่องทางติดต่อ … [20]ยอดขาย … [24]slip/logs) — ถ้าคอลัมน์ถูกสลับ/แทรก **เงินเข้าผิดช่องเงียบๆ** (เช่น ส่วนลดลง revenue) = failure mode ที่แพงที่สุดของหน้านี้
- Validate ก่อนเชื่อ index ทุกครั้ง (ทั้ง preview และ commit):
  1. **จำนวนคอลัมน์ header อยู่ช่วง 23–25** (คอลัมน์ 23/24 unmapped อยู่แล้ว เผื่อไฟล์เก่าตัดท้าย · นอกช่วง → block)
  2. **Header fingerprint แบบหลวม** — anchor 5 จุด: [0] มี "เลขที่ออเดอร์", [3] มี "ช่องทาง", [13] มี "วันที่สร้าง", [16] มี "Marketplace" หรือ "เลขที่บน", [20] มี "ยอดขาย" (trim + contains กัน space เพี้ยน) — ผิดจุดไหน block พร้อมระบุคอลัมน์
  3. **Date sanity**: คอลัมน์ 13 ต้อง parse `dd/MM/yyyy HH:mm` ได้ ≥90% ของแถวที่ไม่ว่าง — ต่ำกว่า = คอลัมน์เลื่อน/format เปลี่ยน → block
- Block = `ok:false` ข้อความไทยระบุสาเหตุ ("หัวคอลัมน์ที่ 4 เป็น 'X' ไม่ใช่ 'ช่องทางติดต่อ' — ไฟล์อาจถูกแก้/คนละ format") — **fail-loud ห้าม import ต่อ** ตามหลัก stg-import-schema.md §ความเสี่ยง #1
- ตัดทิ้ง: map ตามชื่อ header แทน index — แก้ที่รากก็จริง แต่เปลี่ยน semantics จาก CLI ที่พิสูจน์แล้ว (ส.ค. 334 แถว) + header ไทยมี variation risk ของตัวเอง → positional + fingerprint = defensive พอและ regression-safe กว่า

### D2 — Preview ก่อน commit: **ใช่ (two-step, stateless)**
- นี่คือการคีย์ "ยอดขายทั้งเดือน" — ผิดไฟล์/ผิดเดือน = fact_order เละ. การเห็น "334 แถว · TikTok 245 / LINE 88 / FB 1 · ช่วง 1–10 ส.ค." ก่อนกดยืนยันคือ safety net ที่ถูกมาก. Precedent catalog bulk import ก็ preview→confirm — UX consistent
- **Stateless**: preview/commit คนละ action, client ถือ `File` ไว้ส่งซ้ำตอน commit → parse 2 รอบ. Trade-off: เปลือง 2 เท่าของไฟล์ ~300KB = ไม่มีนัยยะ แลกกับไม่มี temp storage / ไม่มี batch ครึ่งๆ ค้าง staging
- **Channel ใน preview ต้อง normalize ก่อนโชว์**: ไฟล์จริง casing เละ ({Tiktok:245, line_oa:86, LINE_OA:2, facebook:1}) — transform ครอบแล้ว (0019 case-insensitive) แต่ preview โชว์ดิบจะเห็น "LINE_OA 2" แยกจาก "line_oa 86" = งง → lib รวมด้วย `lower(trim())` แล้วโชว์ label สวย (LINE 88 / TikTok 245 / Facebook 1). ค่า `channel_raw` ที่ insert **ยังเป็นค่าดิบเดิม** — normalize เฉพาะชั้นแสดงผล (อย่าแก้ข้อมูลก่อนถึง transform ที่เป็นเจ้าของ logic นี้)
- ตัดทิ้ง: (ก) one-shot — เสีย safety net แลก 1 คลิก ไม่คุ้ม (ข) preview = insert staging สถานะ loaded แล้ว confirm ค่อย transform — กดยกเลิก/ปิด browser = orphan batch ที่ file_hash block รอบหน้า ต้องมี cleanup path → ซับซ้อนกว่าโดยไม่ได้อะไร

### D3 — Idempotency + backfill + ประวัติ: **file_hash เดิมคุม · period derive จากข้อมูล · ประวัติในหน้าเดียว · มีโหมดหลายไฟล์**
- **Backfill ม.ค.–ก.ค. (เจ้าของมีไฟล์ครบ 7 ไฟล์ format เดิม)**: dropzone รับ `multiple` — เลือก >1 ไฟล์ → "โหมดหลายไฟล์": client วน `previewOrderImport` ทีละไฟล์ → ตารางสรุปต่อไฟล์ (ชื่อ / แถว / เดือน / ซ้ำ? / shape ผ่าน?) → กดยืนยันครั้งเดียว → client วน `commitOrderImport` **ทีละไฟล์ sequential** (ห้าม parallel — transform เป็น per-row loop อย่าให้แย่งกัน) โชว์สถานะรายไฟล์สด. Server actions ไม่ต้องรู้จักโหมดนี้ — queue อยู่ client ล้วน, ไฟล์ไหนพังกลางคัน → รันซ้ำทั้งชุดได้ ไฟล์ที่เข้าแล้วโดน file_hash skip เองฟรี
- **Period: derive จาก `order_created_at` (คอลัมน์ 13) ไม่ใช่จากชื่อไฟล์ และไม่ให้เลือกเอง** — ชื่อไฟล์ ("1-10 Aug sell report") มนุษย์ตั้ง เชื่อไม่ได้, dropdown เลือกเดือน = ช่องให้เลือกผิด. ข้อมูลพูดเอง: เดือนเดียว → `period_hint="2026-08"`, คร่อมเดือน → `"2026-01..2026-02"` + warning เหลืองใน preview (ไม่ block — ไฟล์ half-month/คร่อมเดือนเป็นเรื่องจริง dedup คุมอยู่)
- **`period_hint` ใน 0011 มีอยู่แต่ CLI ไม่เคยกรอก → UI กรอกให้** — schema ไม่ต้องแก้ คอลัมน์รออยู่แล้ว
- **ประวัติ batch ในหน้าเดียวกัน** (query `stg_import_batch` ตรง): ไฟล์ / เดือน / parsed→loaded / error / status / วันที่ — ตอบ "เดือนไหนเข้าแล้ว" โดยไม่ต้องถาม dev
- ไฟล์ซ้ำ (hash ชน batch `transformed`) → preview บอกก่อนกด: "ไฟล์นี้นำเข้าแล้วเมื่อ 11 ส.ค." ปุ่ม disabled — สถานะปกติสีเทา/เขียว ไม่ใช่ error แดง (ระบบกันซ้ำให้ = ข่าวดี)

### D4 — Error surfacing: **reuse `/crm/import-errors` — ห้ามสร้างซ้ำ**
- ผล commit โชว์ 3 ตัวเลข: นำเข้า / แปลงสำเร็จ / แปลงไม่ผ่าน — errored>0 → ปุ่ม link `/crm/import-errors` (หน้าเดิม + `v_import_error_summary` (0020) query ทุก batch อยู่แล้ว batch ใหม่โผล่เอง ไม่ต้องแก้อะไร)
- ตาราง history เพิ่มคอลัมน์ error count ต่อ batch — แถวที่มี error link ไปหน้าเดิมเช่นกัน
- ตัดทิ้ง: โชว์ error รายแถวในหน้า import — ซ้ำหน้าที่ 100%

### D5 — สิทธิ์: **owner/admin เท่านั้น, `requireOwnerAdmin()` pattern เดิมจาก catalog.ts**
- ทุก action (รวม read `getImportBatches` — staging มี PII ดิบ, RLS 0012 ตั้งใจ owner/admin-only) เช็ค `getDevRole()` ก่อน, staff → error ไทย. Fail-closed อยู่แล้ว (DEV_ROLE unset = staff)
- Page ฝั่ง server เช็ค role ด้วย → staff เห็น EmptyState "เฉพาะเจ้าของร้าน/แอดมิน" แทน form (ไม่ใช่แค่ปุ่มพังตอนกด)
- **พูดตรง**: นี่คือ app-level check บน service-role client ที่ bypass RLS — H1 debt เดิมทั้งแอป (documented ใน `lib/dev/context.ts`) งานนี้ไม่เพิ่มความเสี่ยงใหม่แต่ไม่ได้แก้ของเก่า พอ auth จริงมา swap ที่ seam เดิมจุดเดียว

### D6 — Route + โครง: **`/crm/import` ใต้ nav group CRM ป้าย "นำเข้ายอดขาย"**
- ข้อมูลที่ import เลี้ยง fact_order/dim_customer = หัวใจ CRM ทุกหน้า และ `/crm/import-errors` (ปลายทาง error) อยู่ group นี้แล้ว — "นำเข้า" กับ "ตรวจ import" ควรยืนติดกัน
- ตัดทิ้ง: `/marketing/import` (marketing เป็นผู้บริโภคข้อมูล ไม่ใช่เจ้าของ ingest) · top-level `/import` (สร้าง group ใหม่เพื่อ 1 หน้า ไม่คุ้ม) · ฝากไว้ `/tiktok/upload` (อันนั้น fixture-backed คนละ pipeline อย่าพัวพัน)
- **ไม่ใช้ชื่อ "upload LINE"** ตามที่เจ้าของเรียก — ไฟล์ครอบทุกช่องทาง ใส่คำอธิบายใต้หัวข้อ: "รายงานยอดขายรายเดือนจาก Shipnity — ทุกช่องทาง LINE/TikTok/Facebook อยู่ในไฟล์เดียว" กันเข้าใจผิดว่าต้องหาไฟล์แยกช่องทาง
- แก้ nav 2 จุด: `components/layout/DashboardShell.tsx` NAV_GROUPS (CRM group แทรกก่อน "ตรวจ import", icon `FileUp`) + `components/domain/crm/CrmSubNav.tsx` TABS ตำแหน่งเดียวกัน

### D7 — เพิ่ม vs reuse: **zero migration แต่มี 1 behavior fix ระดับ app: insert → UPSERT บน dedup_key**
- ตอนอ่าน CLI เจอ **gap จริง**: spec (stg-import-schema.md §7ฉ) ตั้งใจ "dedup_key ซ้ำ → upsert ทับ" แต่ `import-aug.mjs` ใช้ `insert` เฉยๆ → เคส "เจ้าของแก้ไฟล์ (เติมแถวตกหล่น/แก้ยอด) แล้วอัปโหลดใหม่" = hash ใหม่ ผ่าน file_hash แต่ **ตาย 23505 ที่ `uq_stg_order_import_shop_dedup_key`** ทั้ง chunk. CLI ไม่เคยเจอเพราะ import ไฟล์ละครั้งเดียว — UI ที่เจ้าของใช้เองจะเจอแน่
- แก้ที่ commit action: `.upsert(chunk, { onConflict: "shop_id,dedup_key" })` + ใส่ `import_status:"pending"`, `error_detail:null` ใน payload ชัดๆ. Upsert อัปเดตเฉพาะคอลัมน์ที่ส่ง — **ไม่ส่ง** `fact_order_id` (รักษา lineage เดิม; transform จะ upsert fact_order ด้วย unique (shop_id, source_order_no) ของมันเอง → ยอดใหม่ทับยอดเก่า ถูกต้อง). หมายเหตุ: `dedup_key` เป็น generated column ห้ามอยู่ใน payload
- ผลข้างเคียงที่ยอมรับ: แถว upsert ย้าย `batch_id` ไป batch ใหม่ → row_count ของ batch เก่าใน history stale (known limitation ไม่ fix — ความจริงอยู่ที่ fact_order เสมอ)
- **Migration ใหม่: ไม่มีจริงๆ** — ตาราง/proc/view/RLS ครบตั้งแต่ 0011–0026, `period_hint` มีคอลัมน์รอ, error view (0020) มีแล้ว. นอก DB แก้แค่ `next.config.mjs` บรรทัดเดียว

### D8 — Profit (ยืนยันจากไฟล์จริง): คอลัมน์กำไร (21) เป็น "-" ทุกแถว → `toNumberOrNull` ให้ null → transform ใช้ estimated margin ตาม proc ปัจจุบัน. หน้า import **ไม่ยุ่งเรื่อง profit เลย** — กำไรจริงต้องรอ line-item + SKU cost (Phase C ต่อ) ไม่ได้มาจากไฟล์นี้. ใส่ note ใน UI ใต้ผลลัพธ์: "กำไรเป็นค่าประเมิน จนกว่าจะผูกรายการสินค้า"

## 3. Contracts

### 3.1 `lib/import/order-report.ts` (ใหม่ — TS port ของ import-aug.mjs, `server-only`)
```ts
import "server-only";

export interface StgOrderInsertRow {
  // field ตาม COLUMN_MAP เดิมทั้ง 23 mapped cols + raw: jsonb + source_row_no + source_kind: "excel"
}

export type ShapeIssue =
  | { kind: "column_count"; found: number }
  | { kind: "header_mismatch"; colIndex: number; expected: string; found: string }
  | { kind: "date_column_unparseable"; parsedPct: number };

export interface ParsedOrderReport {
  fileHash: string;                        // sha256 hex ของ byte ดิบ
  rowCountParsed: number;                  // data rows ไม่รวม header
  rows: StgOrderInsertRow[];               // เฉพาะแถวมี source_order_no
  skippedRowNos: number[];                 // แถวไม่มีเลขออเดอร์ (ข้ามเหมือน CLI)
  shapeIssues: ShapeIssue[];               // ไม่ว่าง = ห้าม commit (D1.5)
  dateWarningCount: number;                // parseThaiDateText คืน null ทั้งที่มีค่า
  channelCounts: { key: string; label: string; count: number }[]; // normalize แล้ว (D2)
  periodHint: string | null;               // "2026-08" หรือ "2026-01..2026-02"
  periodMin: string | null;                // ISO — โชว์ช่วงวันที่ใน preview
  periodMax: string | null;
  crossesMonth: boolean;
}

export function parseOrderReportXlsx(buf: Buffer): ParsedOrderReport;
// throw ImportParseError(messageไทย) เฉพาะกรณีอ่านไฟล์ไม่ได้เลย (ไม่มี sheet/แถว)
```
กติกา port: COLUMN_MAP / parseThaiDateText (fixed +07:00) / toNumberOrNull / toIntOrNull / filter no-source_order_no — **copy semantics เดิมทุกบรรทัด ห้าม "ปรับปรุง" ระหว่าง port** (ไฟล์ ส.ค. = regression baseline: parse แล้วต้องได้ hash เดิม + 334 แถวเท่าเดิม)

### 3.2 `lib/actions/import-orders.ts` (ใหม่ — ไฟล์แยก อย่ายัดใส่ crm.ts ที่ 1,300 บรรทัดแล้ว)
```ts
"use server";
// ทุก action: requireOwnerAdmin() ก่อน (pattern lib/actions/catalog.ts), คืน ActionResult<T>

export interface ImportPreview {
  fileName: string;
  fileHash: string;
  rowCount: number;
  skippedCount: number;
  shapeIssues: string[];                   // ข้อความไทยพร้อมโชว์ — ไม่ว่าง = ปุ่มยืนยัน disabled
  channelCounts: { label: string; count: number }[];
  periodHint: string | null;
  periodMin: string | null;
  periodMax: string | null;
  crossesMonth: boolean;
  dateWarningCount: number;
  duplicateFile: { batchId: string; importedAt: string; status: string } | null;
  updateExistingCount: number;             // dedup_key ชน stg เดิม → "อัปเดตทับ X ออเดอร์"
}
export async function previewOrderImport(formData: FormData): Promise<ActionResult<ImportPreview>>;
// formData: file: File — dry-run: parse+validate, select ชน hash, select ชน dedup_key (chunk .in() ละ 200) — ไม่เขียนอะไร

export interface ImportCommitResult {
  batchId: string;
  inserted: number;                        // upsert สำเร็จ
  transformed: number;                     // จาก proc
  errored: number;                         // จาก proc
}
export async function commitOrderImport(formData: FormData): Promise<ActionResult<ImportCommitResult>>;
// flow: parse+validate (shapeIssues ไม่ว่าง → ok:false ทันที) → เช็ค batch เดิมด้วย hash:
//   transformed → ok:false "ไฟล์นี้นำเข้าแล้ว…" (กัน race หลัง preview)
//   failed      → delete batch เก่า (FK cascade ลบ stg rows) แล้วไปต่อ  ← retry หลังพังกลางทาง ทำงานเอง
//   loaded      → ok:false "มี batch ค้างอยู่ — ลบจากตารางประวัติแล้วลองใหม่" (ไม่ auto-ลบ กัน race กับ commit ที่กำลังวิ่ง)
// → insert batch (status='loaded', period_hint) → upsert stg chunk 200 (D7) → update row_count_loaded
// → rpc transform_pending_orders(shopId, batchId) → update status='transformed'
// ถ้า step ไหน throw → best-effort update status='failed' แล้วคืน error ไทย
// → revalidatePath: /crm/import, /crm/overview, /crm/orders, /crm/customers, /crm/import-errors, /dashboard

export interface ImportBatchRow {
  batchId: string;
  fileName: string | null;
  periodHint: string | null;
  rowCountParsed: number | null;
  rowCountLoaded: number | null;
  errorCount: number;                      // stg_order_import: import_status='error' ต่อ batch
  status: "loaded" | "merged" | "transformed" | "failed";
  importedAt: string;                      // ISO
}
export async function getImportBatches(): Promise<ActionResult<ImportBatchRow[]>>;
// select stg_import_batch where source_type='excel_order_report' order by imported_at desc
// + error count: select batch_id from stg_order_import where import_status='error' → group ฝั่ง JS (แถวหลักร้อย พอ)

export async function deleteStuckBatch(batchId: string): Promise<ActionResult<null>>;
// ลบได้เฉพาะ status IN ('failed','loaded') — batch 'transformed' ห้ามลบ (fact ผูกแล้ว) → error ไทย
```

### 3.3 Route + components

```
app/(dashboard)/crm/import/page.tsx      server component, force-dynamic
                                          — เช็ค role → staff เห็น EmptyState
                                          — await getImportBatches() → props
app/(dashboard)/crm/import/loading.tsx   skeleton (pattern เดียวกับ crm หน้าอื่น)

components/domain/crm/OrderImportClient.tsx   "use client" — ทั้ง flow อัปโหลด (เดี่ยว + หลายไฟล์)
components/domain/crm/ImportBatchHistory.tsx  ตารางประวัติ + ปุ่มลบเฉพาะแถว failed/loaded
                                              (→ deleteStuckBatch → router.refresh)
```

**State machine — OrderImportClient** (ถือ `File[]` ใน state ตลอด flow):

| state | UI |
|---|---|
| `idle` | dropzone (pattern label+hidden input แบบ ProductImport) accept `.xlsx` `multiple` · client เช็คขนาด ≤4MB + นามสกุลก่อนส่ง |
| `previewing` | dropzone disabled + spinner "กำลังอ่านไฟล์…" (หลายไฟล์ = progress x/n) |
| `preview` (1 ไฟล์) | card สรุป: N แถว (ข้าม M) · channel breakdown (normalize แล้ว) · ช่วงวันที่+เดือน · เตือนเหลือง: คร่อมเดือน / dateWarning / "จะอัปเดตทับ X ออเดอร์เดิม" · เตือนแดง block: shapeIssues · ปุ่ม [ยืนยันนำเข้า N แถว] [เลือกไฟล์ใหม่] |
| `preview` (หลายไฟล์) | ตารางต่อไฟล์: ชื่อ / แถว / เดือน / สถานะ (พร้อม·ซ้ำ·shape พัง) · ปุ่ม [ยืนยันนำเข้า k ไฟล์] — ไฟล์ซ้ำ/shape พังถูก skip อัตโนมัติ ระบุชัดในแถว |
| `duplicate` | duplicateFile ≠ null → card เทา/เขียว "ไฟล์นี้นำเข้าแล้วเมื่อ …" ปุ่มยืนยัน disabled เหลือ [เลือกไฟล์ใหม่] |
| `committing` | ปุ่ม loading + "กำลังนำเข้า อย่าปิดหน้านี้" · หลายไฟล์ = วิ่ง sequential โชว์ผลรายไฟล์สดๆ (✓/✗ ทีละแถว) |
| `done` | 3 กล่องตัวเลข (นำเข้า/สำเร็จ/ไม่ผ่าน — pattern summary ของ ProductImport) · errored>0 → ปุ่ม link `/crm/import-errors` · toast + router.refresh() (history อัปเดต) · ปุ่ม [นำเข้าไฟล์ถัดไป] กลับ idle |
| `error` | ErrorState ข้อความไทยจาก action + ปุ่มลองใหม่ (batch โดน mark failed แล้ว → commit รอบใหม่ auto-clean เอง) |

Reuse: `Button`, `Toast`, `EmptyState`, `ErrorState`. หน้านี้เป็น page เต็ม ไม่ใช่ modal (ต่างจาก catalog) — เพราะมี history table อยู่ด้วยกันและเป็น flow หลักของหน้า

## 4. Phase breakdown — **รอบเดียวจบ (S–M)**

1 lib port + 1 actions file + 1 page + 2 components + nav 2 จุด + next.config 1 บรรทัด. ลำดับทำ: lib parse (พร้อม unit test เทียบไฟล์ ส.ค.) → actions → UI.
ถ้าต้องหั่นให้เล็กลง: ตัดออกเป็นรอบสองได้ = `deleteStuckBatch` + `updateExistingCount` + โหมดหลายไฟล์ (backfill 7 ไฟล์ใช้โหมดเดี่ยว 7 รอบไปก่อนได้ ไฟล์ละไม่ถึงนาที) — สามอย่างนี้คือ hardening/convenience ไม่ใช่ happy path

## 5. การทดสอบก่อนบอกว่าเสร็จ

1. Unit: `parseOrderReportXlsx` กับ fixture ไฟล์ ส.ค. จริง → 334 แถว + hash ตรงกับใน `stg_import_batch` ปัจจุบัน (พิสูจน์ port ไม่เพี้ยน) + channelCounts รวมเป็น TikTok 245 / LINE 88 / Facebook 1
2. Unit: shape validation — ไฟล์สลับคอลัมน์ / ตัดคอลัมน์ / header เพี้ยน → block พร้อมข้อความถูกจุด
3. Manual: อัปโหลดไฟล์ ส.ค. ผ่าน UI → ต้องเจอสถานะ duplicate (hash อยู่ใน DB แล้ว) — e2e test ฟรีของ idempotency
4. Manual: backfill ไฟล์เดือนอื่น 1 ไฟล์ → fact_order count ขยับ + `/crm/overview` ขยับ + error (ถ้ามี) โผล่ `/crm/import-errors`

## 6. Technical debt / ข้อจำกัด (บอกตรงๆ)

| # | เรื่อง | สถานะ |
|---|---|---|
| 1 | **Auth stub** — requireOwnerAdmin อ่าน DEV_ROLE, service client bypass RLS 0012 ทั้งหมด | H1 เดิมทั้งแอป ไม่แย่ลงจากงานนี้ แต่หน้านี้เขียนข้อมูลเงินทั้งเดือน → ควรเป็นหน้าแรกๆ ที่ผูก auth จริง |
| 2 | **CLI ↔ lib ซ้ำ logic** — `import-aug.mjs` (JS) กับ `lib/import/order-report.ts` (TS) mapping 2 ก๊อป | หลัง UI พิสูจน์ด้วยไฟล์จริง 1 เดือน → mark CLI deprecated ใน header เก็บเป็น emergency path (แก้ mapping = แก้ที่ lib เดียว) |
| 3 | **Upsert ย้าย batch_id** → row_count batch เก่า stale เมื่อ re-import ไฟล์ที่แก้แล้ว | ยอมรับ (D7) — ความจริงอยู่ที่ fact_order |
| 4 | **Transform เป็น per-row loop** (0013) — 500 แถว/เดือนสบาย หลักหลายพันเริ่มช้าใน 1 server action | ยังไม่ถึง ไม่แก้ (YAGNI) เจอ timeout ค่อยย้าย background job |
| 5 | **PII retention 180 วันบน staging ยังไม่มี job** (note ใน 0011) | debt เดิม ทวงซ้ำ: เจ้าของ self-serve = PII เข้า staging เร็วขึ้น ยิ่งต้องมี pg_cron job |
| 6 | **ไฟล์วิ่ง 2 รอบ + parse 2 รอบ** (preview+commit) | ตั้งใจ (D2) — ถูกกว่า state ค้าง server ทุกกรณีที่ไฟล์ระดับ KB |
| 7 | **กำไรเป็นค่าประเมิน** — คอลัมน์กำไรในไฟล์เป็น "-" ทุกแถว กำไรจริงรอ line-item + SKU cost | ไม่ใช่งานของหน้านี้ (D8) — note ใน UI กันเจ้าของเข้าใจผิด |
| 8 | **Positional mapping** — ต่อให้มี fingerprint การสลับคอลัมน์ที่ header ยังตรง (ค่าข้างในสลับ) ตรวจไม่ได้ 100% | mitigation = preview ให้เจ้าของเห็นตัวเลขรวมก่อนยืนยัน + reconcile กับยอดใน `/crm/overview` หลัง import |
