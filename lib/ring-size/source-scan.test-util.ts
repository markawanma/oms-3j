// ตัวช่วยของเทสต์ "กวาดซอร์ส" ของ ring-size (ไม่ถูก import จากโค้ดที่ส่งขึ้นจริง)
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const RING_APP_DIR = join(ROOT, "app", "(quiz)", "ring-size");
export const RING_LIB_DIR = join(ROOT, "lib", "ring-size");

const SRC_RE = /\.(tsx?|css)$/;
/** ไฟล์เทสต์/ตัวช่วยเทสต์ไม่นับ (ไม่ถูกส่งขึ้นจริง และมีสตริงของกฎอยู่ในตัว) */
const TEST_RE = /\.test(-util)?\.tsx?$/;

export function listSources(dir: string, opts: { includeTests?: boolean } = {}): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return listSources(p, opts);
    if (!SRC_RE.test(p)) return [];
    if (!opts.includeTests && TEST_RE.test(p)) return [];
    return [p];
  });
}

/** ตัดคอมเมนต์ (บรรทัด // และบล็อกคอมเมนต์) ออก เพื่อให้กฎ "ห้ามมีคำ/สตริง" ตรวจเฉพาะโค้ดและข้อความที่ผู้ใช้เห็น */
export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

export function readStripped(file: string): string {
  return stripComments(readFileSync(file, "utf8"));
}

export function rel(file: string): string {
  return relative(ROOT, file).split("\\").join("/");
}
