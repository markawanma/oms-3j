#!/usr/bin/env node
// scripts/run-sql.mjs — รันไฟล์ .sql ตรงเข้าฐานข้อมูล โดยไม่ต้องพิมพ์ SQL ใหม่ด้วยมือ
//
// ทำไมต้องมี: MCP ของ Supabase รับ SQL แบบ inline อย่างเดียว ⇒ ทุก migration
// ต้องถูกพิมพ์ใหม่ทั้งไฟล์ ซึ่งไฟล์โตขึ้นเรื่อยๆ (0140 = 72,377 ตัวอักษร)
// การพิมพ์ใหม่ด้วยมือกับฟังก์ชันที่ออกใบกำกับภาษีจริง = ความเสี่ยงที่ไม่ควรรับ
//
// 🔴 ห้ามใช้ `supabase db push` กับรีโปนี้: ไฟล์ในเครื่องชื่อ `0139_xxx.sql`
//    แต่ประวัติบน remote ใช้ timestamp (20260918185129) ⇒ CLI จะมองว่ายังไม่เคย
//    ลง migration ไหนเลย แล้วไล่รันใหม่ตั้งแต่ 0001 = พังทั้งระบบ
//
// การใช้งาน:
//   node scripts/run-sql.mjs <path/to/file.sql>            # รันแบบซ้อม แล้ว ROLLBACK เสมอ
//   node scripts/run-sql.mjs <path/to/file.sql> --commit   # รันจริง COMMIT
//   node scripts/run-sql.mjs <path/to/file.sql> --commit --record   # + บันทึกประวัติ migration
//
// ต้องมี SUPABASE_DB_URL ใน .env.local (เจ้าของเป็นคนใส่เอง — สคริปต์นี้ไม่เคย
// พิมพ์ค่านั้นออกมา ไม่ว่ากรณีใด)

import { readFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import pg from 'pg';

const { Client } = pg;

// ---------- อ่าน env เอง ไม่ใช้ --env-file (มีกับดักบน Windows) ----------
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
const file = args.find((a) => !a.startsWith('--'));
const doCommit = args.includes('--commit');
const doRecord = args.includes('--record');

if (!file) {
  console.error('ใช้: node scripts/run-sql.mjs <file.sql> [--commit] [--record]');
  process.exit(2);
}

loadEnvLocal();
const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error('🔴 ไม่พบ SUPABASE_DB_URL ใน .env.local');
  console.error('   เอามาจาก Supabase Dashboard > Connect > Session pooler (URI)');
  console.error('   ใส่เป็นบรรทัด:  SUPABASE_DB_URL=postgresql://...');
  process.exit(2);
}

const path = resolve(file);
const sql = readFileSync(path, 'utf8');
const name = basename(path).replace(/\.sql$/i, '');

// version แบบเดียวกับที่ apply_migration ใช้: YYYYMMDDHHMMSS (เวลา UTC)
const version = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

console.log(`ไฟล์      : ${path}`);
console.log(`ขนาด      : ${sql.length.toLocaleString()} ตัวอักษร`);
console.log(`โหมด      : ${doCommit ? '🔴 COMMIT จริง' : 'ซ้อม (ROLLBACK เสมอ)'}`);
if (doRecord) console.log(`บันทึกประวัติ: ${version}  ${name}`);
console.log('—'.repeat(60));

const client = new Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  // ให้ NOTICE จาก raise notice ไหลกลับมาครบ (golden replay ใช้บอกผล)
  application_name: '3j-run-sql',
});

client.on('notice', (n) => {
  const sev = n.severity || 'NOTICE';
  console.log(`[${sev}] ${n.message}`);
});

let exitCode = 0;
try {
  await client.connect();
  await client.query('begin');
  await client.query(sql);

  if (doRecord) {
    await client.query(
      `insert into supabase_migrations.schema_migrations (version, name, statements)
       values ($1, $2, $3)`,
      [version, name, [sql]]
    );
  }

  if (doCommit) {
    await client.query('commit');
    console.log('—'.repeat(60));
    console.log('✅ COMMIT แล้ว');
  } else {
    await client.query('rollback');
    console.log('—'.repeat(60));
    console.log('↩️  ROLLBACK (โหมดซ้อม) — ไม่มีอะไรถูกบันทึก');
  }
} catch (err) {
  try { await client.query('rollback'); } catch {}
  console.error('—'.repeat(60));
  console.error('🔴 ล้มเหลว — ถอยทั้งก้อนแล้ว ไม่มีอะไรถูกบันทึก');
  console.error(`   sqlstate : ${err.code ?? '-'}`);
  console.error(`   message  : ${err.message}`);
  if (err.where) console.error(`   where    : ${err.where}`);
  if (err.detail) console.error(`   detail   : ${err.detail}`);
  if (err.hint) console.error(`   hint     : ${err.hint}`);
  exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
process.exit(exitCode);
