// lib/site/no-quiz-actions-manifest.test.ts — security L1 (tools-hub): ยืนยันจาก "ผล build จริง" ว่าไม่มี Server Action ผูกกับหน้า/route สาธารณะ (exempt จาก auth gate)
// ทำไมไม่พึ่งแค่ lib/gem-quiz/no-server-action-graph.test.ts: อันนั้นเดิน import graph ของซอร์ส (static) — อันนี้อ่าน .next/server/server-reference-manifest.json
// ที่ bundler สร้างจริง (รวม layout/shared chunk/route handler) จึงจับกรณีที่ graph test มองไม่เห็นได้ · ไม่มี build (.next) = skip (ไม่ล้มใน CI ที่ยังไม่ build)
// 🔴 hub /tools + 3 หน้าลูกค้า + endpoint สาธารณะ ห้ามมี worker ใน manifest · Next หา action ตาม id จากทุก worker (พบจริงบน next start) จึงต้องสะอาดทั้งไฟล์
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MANIFEST = join(process.cwd(), ".next", "server", "server-reference-manifest.json");
const PUBLIC_WORKER_PREFIXES = ["app/(quiz)/", "app/api/gem-quiz/", "app/api/ring-size/", "app/api/ring-builder/", "app/(public)/", "app/shop/", "app/tools/"];

type Manifest = Record<"node" | "edge", Record<string, { workers: Record<string, unknown> }>>;

describe.skipIf(!existsSync(MANIFEST))("server-reference-manifest (ผล build จริง) — ไม่มี action ผูกกับ route สาธารณะ", () => {
  const manifest = (existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : { node: {}, edge: {} }) as Manifest;
  const workers = new Set<string>();
  for (const runtime of ["node", "edge"] as const) for (const entry of Object.values(manifest[runtime] ?? {})) for (const w of Object.keys(entry.workers)) workers.add(w);

  it("manifest อ่านได้ และมี worker ของหลังบ้านจริง (กัน test ผ่านเพราะ manifest ว่าง)", () => {
    expect(workers.size).toBeGreaterThan(10);
    expect([...workers].some((w) => w.startsWith("app/(dashboard)/"))).toBe(true);
  });
  it.each(PUBLIC_WORKER_PREFIXES)("ไม่มี worker ขึ้นต้น %s", (prefix) => {
    expect([...workers].filter((w) => w.startsWith(prefix))).toEqual([]);
  });
});
