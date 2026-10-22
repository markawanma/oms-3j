// @vitest-environment jsdom
// QA G1a UI (R2-D2 · 22 ต.ค. 69) — "ใบ A5 ไม่มีพลอย = เดิมเป๊ะ": เทียบ innerHTML ของ JobSheet กับ golden hash ที่คำนวณจาก JobSheet "ก่อน G1a UI" (commit 0294517)
// วิธีได้ hash: เอา components/domain/jobs/JobPrintClient.tsx ณ 0294517 มา render ด้วย PrintableJob เดียวกัน (gems=[] · gemsState=not_needed) แล้ว sha256(innerHTML) 16 ตัวแรก
// ล้ม = markup ของใบที่ไม่มีพลอยเปลี่ยน (ช่างที่ถือกระดาษเดิมเห็นต่าง) — ถ้าตั้งใจเปลี่ยน ต้องตัดสินใจพร้อมอัปเดต hash นี้
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createHash } from "node:crypto";

afterEach(cleanup);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/jobs/x/print" }));
vi.mock("@/lib/actions/job-office-write", () => ({ issueJobQr: vi.fn() }));

import { JobSheet } from "@/components/domain/jobs/JobPrintClient";
import type { PrintableJob } from "@/lib/jobs/print";

const PHOTO = "https://x.supabase.co/storage/v1/object/sign/job-photos/s/j/p1_md.jpg?token=a";
const st = (n: number, w = true) => Array.from({ length: n }, (_, i) => ({ seq: i + 1, name: `ขั้น ${i + 1}`, weighRequired: w && i % 2 === 0, scrapQtyAsk: i % 3 === 0, scrapWeightAsk: i === 4 }));
const base = (o: Partial<PrintableJob> = {}): PrintableJob => ({
  jobId: "11111111-1111-4111-8111-111111111111", jobNo: "JB-0031", designLabel: "แหวนโกเมนไข่", sku: "RG-0418", metalLabel: "เงิน", qtyOrder: 35, qtyPlanned: 35, targetPieceG: 4, metalPlanG: 150, dueDate: "2026-11-01",
  sourceLabel: "งานลูกค้า", weightStartG: null, profileName: null, primaryPhotoUrl: null, gems: [], gemsState: "not_needed", stages: st(7), ...o,
});

const GOLDEN: [string, PrintableJob, string, number][] = [
  ["7 ขั้น ใบเดิม", base(), "14b15ac760986c3d", 5351],
  ["9 ขั้น", base({ stages: st(9) }), "4cdf32569f7cbf5f", 6329],
  ["11 ขั้น หัวยาว", base({ stages: st(11), designLabel: "ก".repeat(120) }), "dc25545d7fc327d5", 7419],
  ["มีแบบ", base({ profileName: "แบบ 1 — ชั่งเฉพาะ", stages: st(9) }), "edfd4690282e611d", 6964],
  ["มีรูปหลัก", base({ primaryPhotoUrl: PHOTO }), "f89f1bd339052d9f", 5672],
  ["ทอง", base({ metalLabel: "ทอง", targetPieceG: null, metalPlanG: null }), "a15a8aac148e27a0", 5225],
  ["ผลิตเข้าสต็อก", base({ sourceLabel: "ผลิตเข้าสต็อก", sku: null, weightStartG: 12.5 }), "6758e1748376346b", 5337],
];

describe("JobSheet ใบที่ไม่มีขั้นฝังและไม่มีพลอย = markup เดิมเป๊ะ (golden จาก 0294517)", () => {
  for (const [name, job, hash, len] of GOLDEN) {
    it(name, () => {
      const html = render(<JobSheet job={job} qrSvg={null} />).container.innerHTML;
      expect(html.length).toBe(len);
      expect(createHash("sha256").update(html).digest("hex").slice(0, 16)).toBe(hash);
    });
  }
});
