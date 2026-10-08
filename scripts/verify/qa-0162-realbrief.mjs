#!/usr/bin/env node
// scripts/verify/qa-0162-realbrief.mjs  (QA R2-D2 · 7 ต.ค. 69)
// ป้อน Weekly Brief "ฉบับจริง" ทุกฉบับใน docs/3j-jewelry/marketing/weekly-brief/ เข้า content_weekly_summary_upsert ตามที่ Tech Lead จะส่งจริง
// (ตัวอย่างสังเคราะห์ใน verify-0162 ไม่รู้ว่าฉบับจริงยาว/มี CRLF/มีอักขระล่องหนแค่ไหน)
//
// ไม่ต่อ DB เอง — พิมพ์ SQL (do-block ที่ rollback เสมอ) ออก stdout แล้วให้ run-sql รัน:
//   node scripts/verify/qa-0162-realbrief.mjs > tmp-real.sql
//   cat supabase/migrations/0161_*.sql supabase/migrations/0162_*.sql tmp-real.sql > tmp-all.sql && node scripts/run-sql.mjs tmp-all.sql     # dry-run ก่อน apply
//   node scripts/run-sql.mjs tmp-real.sql                                                                                                     # หลัง apply (ROLLBACK เสมอ)
// ผลออกทาง error message ของ run-sql: [OK]/[FAIL] ต่อฉบับ × {เนื้อหาเต็ม · สรุปตามที่เขียนจริง · สรุปตัดที่ 300 ตัวอักษร}

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'docs/3j-jewelry/marketing/weekly-brief';
const files = readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
if (files.length === 0) {
  console.error('ไม่พบไฟล์ Brief');
  process.exit(2);
}

const lit = (s) => {
  // dollar-quote ด้วยแท็กที่ไม่ชนเนื้อหา
  let tag = 'qa_b';
  while (s.includes(`$${tag}$`)) tag += 'x';
  return `$${tag}$${s}$${tag}$`;
};

// จันทร์ของสัปดาห์ที่ไฟล์ลงวัน (ISO) — week_start ของ RPC ต้องเป็นวันจันทร์
const mondayOf = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // จันทร์=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
};

const cases = [];
for (const f of files) {
  const iso = f.replace('.md', '');
  const raw = readFileSync(join(DIR, f), 'utf8'); // CRLF คงไว้ตามที่ไฟล์จริงเป็น
  const lf = raw.replace(/\r\n/g, '\n');
  const m = lf.match(/## สรุป 5 บรรทัด\n([\s\S]*?)\n## /);
  const lines = m
    ? m[1].split('\n').filter((l) => /^\d+\.\s/.test(l)).map((l) => l.replace(/^\d+\.\s*/, '').replace(/\s+/g, ' ').trim())
    : [];
  const no = (lf.match(/Weekly Marketing Brief #(\d+)/) || [])[1];
  cases.push({ iso, week: mondayOf(iso), raw, lines, no: no ? Number(no) : null, path: `${DIR}/${f}` });
}

const arr = (a) => `array[${a.map((x) => lit(x)).join(', ')}]::text[]`;

let sql = `-- สร้างโดย qa-0162-realbrief.mjs — ไม่ commit ผลลง DB (raise ท้ายไฟล์ rollback)
do $qareal$
declare
  v_log  text := E'\\n=== qa-0162-realbrief ===\\n';
  v_shop uuid;
  v_r    text;
  v_ok   int;
  v_fail int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  select id into v_shop from public.shop;
  if (select count(*) from public.shop) <> 1 then raise exception 'ต้องมีร้านเดียว'; end if;
  if to_regprocedure('analytics.content_weekly_summary_upsert(uuid,date,date,text[],text,text,integer,text)') is null then
    raise exception 'ไม่พบ content_weekly_summary_upsert — ต้องต่อ 0161+0162 ก่อน';
  end if;
`;

for (const c of cases) {
  const lens = c.lines.map((l) => [...l].length);
  const cut = c.lines.map((l) => [...l].slice(0, 300).join(''));
  const tag = c.iso;
  sql += `
  -- ${c.path}: ${[...c.raw].length} ตัวอักษร · สรุป ${c.lines.length} บรรทัด ยาว ${lens.join('/')}
  begin
    v_r := analytics.content_weekly_summary_upsert(v_shop, date '${c.week}', date '${c.iso}', ${arr(c.lines)}, ${lit(c.raw)}, 'ai', ${c.no ?? 'null'}, '${c.path}')::text;
    v_log := v_log || '[OK] ${tag} สรุปตามที่เขียนจริง (${lens.join('/')} ตัวอักษร) + เนื้อหาเต็ม ผ่าน → ' || left(v_r, 80) || E'\\n';
  exception when others then
    v_log := v_log || format(E'[FAIL] ${tag} สรุปตามที่เขียนจริง (${lens.join('/')} ตัวอักษร) + เนื้อหาเต็ม ตก sqlstate=%s → %s\\n', sqlstate, left(sqlerrm, 160));
  end;
  begin
    v_r := analytics.content_weekly_summary_upsert(v_shop, date '${c.week}', date '${c.iso}', ${arr(cut)}, ${lit(c.raw)}, 'ai', ${c.no ?? 'null'}, '${c.path}')::text;
    v_log := v_log || '[OK] ${tag} สรุปตัดที่ 300 ตัวอักษร + เนื้อหาเต็ม (CRLF ตามไฟล์) ผ่าน → ' || left(v_r, 80) || E'\\n';
    if (select position(E'\\r' in body_md) from analytics.content_weekly_summary where shop_id = v_shop and week_start = date '${c.week}') <> 0 then
      v_log := v_log || E'[FAIL] ${tag} body ยังมี CR ค้างหลังเก็บ\\n';
    end if;
    if (select length(body_md) from analytics.content_weekly_summary where shop_id = v_shop and week_start = date '${c.week}') <> ${[...c.raw.replace(/\r\n/g, '\n')].length} then
      v_log := v_log || E'[FAIL] ${tag} ความยาว body ที่เก็บ ≠ ต้นฉบับ (LF) — เนื้อหาถูกตัด/แก้\\n';
    end if;
  exception when others then
    v_log := v_log || format(E'[FAIL] ${tag} สรุปตัดที่ 300 + เนื้อหาเต็ม ตก sqlstate=%s → %s\\n', sqlstate, left(sqlerrm, 160));
  end;
`;
}

sql += `
  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_ok   := (length(v_log) - length(replace(v_log, '[OK]', ''))) / 4;
  v_log := v_log || format(E'\\n=== สรุป: [OK] %s · [FAIL] %s — raise ด้านล่างบังคับ ROLLBACK ===\\n', v_ok, v_fail);
  raise exception '%', v_log;
end;
$qareal$;
`;

process.stdout.write(sql);
