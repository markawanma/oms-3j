// doc-index-check.mjs — ตรวจสุขภาพคลังเอกสาร docs/3j-jewelry ให้ตรงกับ INDEX.md
// ใช้ 2 ที่: (1) git pre-commit hook  (2) Weekly Brief (บรรทัด "สุขภาพคลังเอกสาร")
// กติกา: โฟลเดอร์ active (marketing/web/content) ทุกไฟล์ต้องถูกเอ่ยชื่อใน INDEX.md
//        และทุกชื่อไฟล์ .md ที่ INDEX เอ่ยถึง ต้องมีอยู่จริง (active หรือ _archive)
//        และทุก path/skill/migration ที่ READING-LISTS.md อ้าง ต้องมีอยู่จริง (ข้อ 3)
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = "docs/3j-jewelry";
const ACTIVE_DIRS = ["marketing", "web", "content"]; // โฟลเดอร์ที่ INDEX ลิสต์รายไฟล์
// ระบุใน INDEX ระดับโฟลเดอร์แล้ว — สำรอง/โค้ด/ไฟล์ที่งอกทุกสัปดาห์ (weekly-brief: 1 ไฟล์/จันทร์
// ลิสต์รายไฟล์ใน INDEX จะบวมโดยไม่มีใครได้ประโยชน์ INDEX ชี้แม่แบบ + กติกาตั้งชื่อพอ)
const SKIP_SUBDIRS = new Set(["backups", "velo-fixed", "mockups", "srt", "weekly-brief", "content-calendar", "trend-radar", "ui-handoff-round2"]);

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

// (3) READING-LISTS.md — ทุก path/skill/migration ที่อ้างต้องมีอยู่จริง (เพิ่ม 5 ต.ค. 69)
//     ไฟล์นี้คือ "ทำเรื่องนี้อ่านไฟล์เหล่านี้พอ" ถ้า path ในนั้นเน่า agent จะกลับไปกวาดอ่านทั้งโฟลเดอร์
const RL_PATH = join(ROOT, "READING-LISTS.md");
if (existsSync(RL_PATH)) {
  const rl = readFileSync(RL_PATH, "utf8");
  const REPO_PREFIX = /^(docs|lib|app|components|scripts|supabase|public|\.claude|\.githooks)\//;
  const migrationFiles = readdirSync("supabase/migrations");
  const hasMigration = (num) => migrationFiles.some((f) => f.startsWith(num));
  for (const line of rl.split(/\r?\n/)) {
    const tokens = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (/^- skill:/.test(line)) {
      for (const t of tokens) if (!existsSync(join(".claude/skills", t, "SKILL.md"))) problems.push(`READING-LISTS อ้าง skill ที่ไม่มี: ${t}`);
    } else if (/^- migrations:/.test(line)) {
      for (const t of tokens) {
        const m = t.match(/^(\d{4})(?:-(\d{4}))?/);
        if (!m) { problems.push(`READING-LISTS migration token แปลก: ${t}`); continue; }
        const full = /^\d{4}_/.test(t) ? t : null; // เช่น 0120_crm_retention (เลขซ้ำ)
        if (full && !migrationFiles.some((f) => f.startsWith(full))) problems.push(`READING-LISTS อ้าง migration ที่ไม่มี: ${t}`);
        if (!full) for (const n of [m[1], m[2]].filter(Boolean)) if (!hasMigration(n)) problems.push(`READING-LISTS อ้าง migration ที่ไม่มี: ${n} (ใน ${t})`);
      }
    } else {
      for (const t of tokens) {
        if (t === "middleware.ts" || REPO_PREFIX.test(t)) {
          if (!existsSync(t.replace(/\/$/, ""))) problems.push(`READING-LISTS อ้าง path ที่ไม่มี: ${t}`);
        }
      }
    }
  }
}

if (problems.length) {
  console.error(`🔴 คลังเอกสารไม่ตรงกับ INDEX (${problems.length} ปัญหา):`);
  for (const p of problems) console.error(`   - ${p}`);
  console.error(`\n→ แก้โดยอัปเดต ${ROOT}/INDEX.md ให้ตรงกับความจริง (หรือย้ายไฟล์เข้า _archive/)`);
  process.exit(1);
}
console.log("✅ คลังเอกสารตรงกับ INDEX");
