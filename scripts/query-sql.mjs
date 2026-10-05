#!/usr/bin/env node
// scripts/query-sql.mjs — รัน SELECT อ่านอย่างเดียวแล้วพิมพ์แถวออกมา (คู่กับ run-sql.mjs ที่ใช้ apply)
//
// ทำไมต้องมี: run-sql.mjs ออกแบบไว้สำหรับ migration (พิมพ์แค่ NOTICE ไม่พิมพ์ผล SELECT)
// และ session ที่ไม่มี Supabase MCP ก็ยังต้องอ่านสถานะจริงจาก DB ก่อนตัดสินใจ
// (กติกา CLAUDE.md: ตัวเลข operational → query สด ไม่เชื่อเอกสาร)
//
// ปลอดภัยโดยโครงสร้าง: เปิด transaction แบบ READ ONLY + ROLLBACK เสมอ — ต่อให้ไฟล์มี
// UPDATE/INSERT หลุดมา Postgres จะปฏิเสธ (25006) ไม่มีทางเขียนอะไรลง DB ผ่านสคริปต์นี้
//
// การใช้งาน:
//   node scripts/query-sql.mjs <file.sql>          # ไฟล์มีได้หลาย statement คั่นด้วย ;
//   node scripts/query-sql.mjs --sql "select 1"    # inline สั้นๆ
//   เพิ่ม --json เพื่อพิมพ์เป็น JSON แทนตาราง
//
// ต้องมี SUPABASE_DB_URL ใน .env.local (สคริปต์นี้ไม่พิมพ์ค่านั้นออกมา)

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const { Client } = pg;

function loadEnvLocal() {
  for (const f of ['.env.local', '.env']) {
    if (!existsSync(f)) continue;
    for (const raw of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i < 0) continue;
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(k in process.env)) process.env[k] = v;
    }
  }
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const inlineIdx = args.indexOf('--sql');
let sql;
if (inlineIdx >= 0) {
  sql = args[inlineIdx + 1];
} else {
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('ใช้: node scripts/query-sql.mjs <file.sql> [--json]  หรือ  --sql "select ..."');
    process.exit(2);
  }
  sql = readFileSync(resolve(file), 'utf8');
}

loadEnvLocal();
const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error('🔴 ไม่พบ SUPABASE_DB_URL ใน .env.local');
  process.exit(2);
}

function cell(v) {
  if (v === null || v === undefined) return '∅';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function printTable(res) {
  const cols = res.fields.map((f) => f.name);
  if (!cols.length) { console.log(`(${res.command} — ไม่มีคอลัมน์)`); return; }
  const rows = res.rows.map((r) => cols.map((c) => cell(r[c])));
  const width = cols.map((c, i) => Math.min(60, Math.max(c.length, ...rows.map((r) => r[i].length))));
  const trim = (s, w) => (s.length > w ? s.slice(0, w - 1) + '…' : s.padEnd(w));
  console.log(cols.map((c, i) => trim(c, width[i])).join(' │ '));
  console.log(width.map((w) => '─'.repeat(w)).join('─┼─'));
  for (const r of rows) console.log(r.map((v, i) => trim(v, width[i])).join(' │ '));
  console.log(`(${rows.length} แถว)`);
}

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, application_name: '3j-query-sql' });
client.on('notice', (n) => console.log(`[${n.severity || 'NOTICE'}] ${n.message}`));

let exitCode = 0;
try {
  await client.connect();
  await client.query('begin transaction read only');
  const results = await client.query(sql);
  const list = Array.isArray(results) ? results : [results];
  if (asJson) {
    console.log(JSON.stringify(list.map((r) => r.rows), null, 2));
  } else {
    list.forEach((r, i) => { if (list.length > 1) console.log(`\n=== statement ${i + 1} ===`); printTable(r); });
  }
} catch (err) {
  console.error(`🔴 ${err.code ?? '-'} ${err.message}`);
  if (err.position) console.error(`   ตำแหน่ง offset ${err.position}`);
  exitCode = 1;
} finally {
  try { await client.query('rollback'); } catch {}
  await client.end().catch(() => {});
}
process.exit(exitCode);
