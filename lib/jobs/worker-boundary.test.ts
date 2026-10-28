// 🔴 ขอบเขตของช่องทางสาธารณะ /w/: ไฟล์ในกราฟของหน้าช่างต้องไม่แตะ RPC/ข้อมูลฝั่งออฟฟิศ และไม่ใช้ session แอป
// (หน้านี้ถูก exempt จาก middleware — ถ้า action ออฟฟิศหลุดเข้ามาใน module graph มันอาจถูกเรียกได้โดยไม่ผ่านด่านล็อกอิน)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

// ไฟล์ทั้งหมดที่อยู่ในกราฟหน้าช่าง (หน้า · layout · component · ชั้น server ของช่าง · action ของช่าง)
const WORKER_FILES = [
  ...walk(join(ROOT, "app", "(worker)")),
  ...walk(join(ROOT, "components", "domain", "jobs", "worker")),
  // 0182: ชั้นแสดงผลล้วนของรูปใบงาน (Thumb/Viewer/AddButtons/PrintPhoto) ใช้ร่วมกับหน้าช่าง — ต้องไม่เรียก action ใดๆ (ชั้นเรียก action ของออฟฟิศอยู่นอกโฟลเดอร์นี้)
  ...walk(join(ROOT, "components", "domain", "jobs", "photos")),
  join(ROOT, "lib", "jobs", "worker-server.ts"),
  join(ROOT, "lib", "actions", "job-worker.ts"),
  join(ROOT, "lib", "jobs", "worker-view.ts"),
  // 0187 W1: ตรรกะ pure ของหน้าผู้จัดการ /w/s/ (ฟอร์ม · ข้อความ error · payload) — อยู่ในกราฟสาธารณะเหมือนกัน
  join(ROOT, "lib", "jobs", "shop-open.ts"),
  // 0189 W2 UI: ตรรกะ pure ของรูปจากหน้างาน (ข้อความ error · คิว · ด่านก่อนออกจากจอ) — อยู่ในกราฟสาธารณะ
  join(ROOT, "lib", "jobs", "shop-photos.ts"),
  // 0189 W2: ชั้น server ของ "แนบรูปจากหน้างาน" (เขียน storage ผ่าน lib/images/job-photo-storage — ไฟล์นอกรายการนี้ เพราะมี `.storage.from(` ตามแบบ lib/images/signing.ts)
  join(ROOT, "lib", "jobs", "shop-photo-server.ts"),
  // 0191 W3: allowlist แถวพลอย (pure · ไม่มีราคา) ที่ action ของผู้จัดการใช้ — อยู่ในกราฟสาธารณะ
  join(ROOT, "lib", "jobs", "gem-wire.ts"),
  // 0191 W3 UI: ตรรกะ pure ของพลอยบนมือถือผู้จัดการ (W-4 · ทวน · W-9 · W-10) + โมเดลแถว/ตัวตรวจชื่อ/ขนาด + leaf อักขระล่องหน — อยู่ในกราฟสาธารณะ (ห้าม lib/oem · gems.ts แบบ runtime)
  join(ROOT, "lib", "jobs", "shop-gem-flow.ts"),
  join(ROOT, "lib", "text", "invisible.ts"),
];

// import ที่ห้ามมีในกราฟหน้าช่าง
const FORBIDDEN_IMPORTS: [RegExp, string][] = [
  [/lib\/actions\/job-office/, "action ออฟฟิศของระบบใบงาน"],
  [/lib\/jobs\/page-gate/, "ด่านสิทธิ์ออฟฟิศ (ช่างไม่มี role)"],
  [/lib\/auth\/(session|role|action-guard)/, "session/role ของแอป (ช่างไม่ได้ login)"],
  [/lib\/dev\/context/, "shop/role จาก DEV context"],
  // อนุญาตเฉพาะ job-worker ตัวเดียว (ลงท้ายด้วย job-worker เป๊ะ) — job-workers (ทะเบียนช่างฝั่งออฟฟิศ) ต้องไม่ผ่าน
  [/lib\/actions\/(?!job-worker$)/, "action อื่นของแอป (ยกเว้น job-worker เท่านั้น)"],
  [/lib\/jobs\/office-server/, "ชั้นกลางของ action ออฟฟิศ"],
  [/lib\/oem\//, "โมดูล OEM (ราคา/ต้นทุน)"],
  [/lib\/production\//, "โมดูลใบผลิต (ต้นทุน)"],
  [/lib\/catalog\//, "โมดูลสินค้า/ต้นทุน"],
];

describe("กราฟหน้าช่าง /w/ — import ต้องห้าม", () => {
  it("พบไฟล์ในกราฟ (กันเทสต์ว่างเปล่า)", () => {
    expect(WORKER_FILES.length).toBeGreaterThanOrEqual(8);
    // 0187 W1: หน้า /w/s/<shopToken> + โฟลเดอร์ components/.../worker/shop ต้องถูกกวาดเข้ากราฟ (ถ้าไม่ — ไฟล์ใหม่ไม่ถูกตรวจ)
    const rels = WORKER_FILES.map((f) => relative(ROOT, f).replace(/\\/g, "/"));
    expect(rels).toContain("app/(worker)/w/s/[shopToken]/page.tsx");
    expect(rels).toContain("components/domain/jobs/worker/shop/ShopIntakeApp.tsx");
    expect(rels).toContain("lib/jobs/shop-open.ts");
  });
  for (const f of WORKER_FILES) {
    const rel = relative(ROOT, f).replace(/\\/g, "/");
    it(rel, () => {
      const src = readFileSync(f, "utf8");
      const imports = [...src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
      for (const spec of imports) {
        for (const [re, why] of FORBIDDEN_IMPORTS) expect(re.test(spec), `${rel} import "${spec}" — ${why}`).toBe(false);
      }
      // ไม่อ้างตาราง/view ฝั่งออฟฟิศตรงๆ (หน้าช่างอ่านผ่าน RPC job_worker_* เท่านั้น)
      expect(/\.from\(/.test(src), `${rel} ใช้ .from( ตรงๆ`).toBe(false);
      expect(/v_job_board|v_oem|oem_quote|production_order|v_dim_product|unit_cost|list_price/i.test(src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")), `${rel} อ้างข้อมูลราคา/ต้นทุน/ออฟฟิศ`).toBe(false);
    });
  }
});

describe("0182 โฟลเดอร์ photos/ (ชั้นแสดงผลล้วน) อยู่ในกราฟหน้าช่าง", () => {
  const rel = (f: string) => relative(ROOT, f).replace(/\\/g, "/");
  const photoFiles = WORKER_FILES.filter((f) => rel(f).startsWith("components/domain/jobs/photos/"));
  it("ตรวจครบทุกชิ้นของชั้นแสดงผล (ถ้าเพิ่ม/ย้ายไฟล์แล้วเทสต์นี้ล้ม = กราฟไม่ครอบคลุม)", () => {
    const names = photoFiles.map((f) => rel(f).split("/").pop());
    for (const n of ["JobPhotoThumb.tsx", "JobPhotoViewer.tsx", "PhotoAddButtons.tsx", "PrintPhoto.tsx", "usePrintPhoto.ts", "PrintPhotoStatus.tsx", "useRefreshGate.ts", "types.ts"]) expect(names, n).toContain(n);
  });
  it("ไม่ import lib/actions/** และ lib/images/client (ย่อรูป/อัปโหลดเป็นงานของออฟฟิศ)", () => {
    for (const f of photoFiles) {
      const src = readFileSync(f, "utf8");
      const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(/lib\/actions\//.test(code), rel(f)).toBe(false);
      expect(/lib\/images\/client/.test(code), rel(f)).toBe(false);
    }
  });
});

describe("เฉพาะ job-worker.ts เป็น 'use server' ในกราฟนี้", () => {
  it("ไม่มีไฟล์อื่นในกราฟหน้าช่างประกาศ 'use server'", () => {
    for (const f of WORKER_FILES) {
      const rel = relative(ROOT, f).replace(/\\/g, "/");
      const isUseServer = /^\s*["']use server["']/m.test(readFileSync(f, "utf8"));
      expect(isUseServer, rel).toBe(rel === "lib/actions/job-worker.ts");
    }
  });
  it("worker-server.ts ไม่ใช่ 'use server' (เรียกจาก client ตรงๆ ไม่ได้) และเป็น server-only", () => {
    const src = readFileSync(join(ROOT, "lib", "jobs", "worker-server.ts"), "utf8");
    expect(/^\s*["']use server["']/m.test(src)).toBe(false);
    expect(src).toContain('import "server-only"');
  });
});

describe("ตัวตรวจ import ต้องจับของจริงได้ (กันเทสต์หลวม)", () => {
  const re = (spec: string) => FORBIDDEN_IMPORTS.some(([r]) => r.test(spec));
  it("จับ action ออฟฟิศ/ทะเบียนช่าง/ชั้นกลาง/session/OEM", () => {
    for (const bad of ["@/lib/actions/job-office", "@/lib/actions/job-office-write", "@/lib/actions/job-workers", "@/lib/jobs/office-server", "@/lib/jobs/page-gate", "@/lib/auth/session", "@/lib/actions/oem", "@/lib/oem/types", "@/lib/dev/context"]) {
      expect(re(bad), bad).toBe(true);
    }
  });
  it("ไม่จับของที่ช่างใช้จริง", () => {
    for (const ok of ["@/lib/actions/job-worker", "@/lib/jobs/worker-server", "@/lib/jobs/hash", "@/lib/jobs/messages", "@/lib/jobs/input", "@/lib/jobs/worker-view", "@/lib/jobs/types", "@/lib/supabase/server", "next/headers"]) {
      expect(re(ok), ok).toBe(false);
    }
  });
});
