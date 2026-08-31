// doc-index-check.mjs — ตรวจสุขภาพคลังเอกสาร docs/3j-jewelry ให้ตรงกับ INDEX.md
// ใช้ 2 ที่: (1) git pre-commit hook  (2) Weekly Brief (บรรทัด "สุขภาพคลังเอกสาร")
// กติกา: โฟลเดอร์ active (marketing/web/content) ทุกไฟล์ต้องถูกเอ่ยชื่อใน INDEX.md
//        และทุกชื่อไฟล์ .md ที่ INDEX เอ่ยถึง ต้องมีอยู่จริง (active หรือ _archive)
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = "docs/3j-jewelry";
const ACTIVE_DIRS = ["marketing", "web", "content"]; // โฟลเดอร์ที่ INDEX ลิสต์รายไฟล์
const SKIP_SUBDIRS = new Set(["backups", "velo-fixed", "mockups", "srt"]); // ระบุใน INDEX ระดับโฟลเดอร์แล้ว // สำรอง/โค้ด — INDEX ระบุระดับโฟลเดอร์พอ

const problems = [];
let index;
try {
  index = readFileSync(join(ROOT, "INDEX.md"), "utf8");
} catch {
  console.error(`🔴 ไม่พบ ${ROOT}/INDEX.md`);
  process.exit(1);
}

// (1) ไฟล์ใน active dirs ที่ INDEX ไม่รู้จัก
for (const dir of ACTIVE_DIRS) {
  const full = join(ROOT, dir);
  if (!existsSync(full)) continue;
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_SUBDIRS.has(entry.name)) problems.push(`โฟลเดอร์ใหม่ไม่อยู่ในกติกา checker: ${dir}/${entry.name}/`);
      continue;
    }
    if (!entry.name.endsWith(".md")) continue;
    if (!index.includes(entry.name)) problems.push(`ไฟล์ไม่ถูกลิสต์ใน INDEX: ${dir}/${entry.name}`);
  }
}

// (2) ชื่อไฟล์ .md ที่ INDEX เอ่ยถึงแต่หาไม่เจอทั้ง tree (ยกเว้นชื่อ INDEX เอง)
const mentioned = [...new Set(index.match(/[A-Za-z0-9][\w.-]*\.md/g) || [])].filter((n) => n !== "INDEX.md");
const allFiles = new Set();
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else allFiles.add(entry.name);
  }
};
walk(ROOT);
for (const name of mentioned) {
  if (!allFiles.has(name)) problems.push(`INDEX เอ่ยถึงไฟล์ที่ไม่มีอยู่จริง: ${name}`);
}

if (problems.length) {
  console.error(`🔴 คลังเอกสารไม่ตรงกับ INDEX (${problems.length} ปัญหา):`);
  for (const p of problems) console.error(`   - ${p}`);
  console.error(`\n→ แก้โดยอัปเดต ${ROOT}/INDEX.md ให้ตรงกับความจริง (หรือย้ายไฟล์เข้า _archive/)`);
  process.exit(1);
}
console.log("✅ คลังเอกสารตรงกับ INDEX");
