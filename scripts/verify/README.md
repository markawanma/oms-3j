# scripts/verify/ — ชุดทดสอบของ migration แต่ละตัว

ไฟล์ `verify-NNNN*.sql` คู่กับ `supabase/migrations/NNNN_*.sql` — ย้ายมาจาก `scripts/` ตรงๆ
เมื่อ 5 ต.ค. 69 (เดิม 32 ไฟล์ปนกับสคริปต์ใช้งานจริงจนหาอะไรไม่เจอ) · คอมเมนต์ในไฟล์ migration เก่า
ที่ยังเขียนว่า `scripts/verify-NNNN.sql` หมายถึงไฟล์ในโฟลเดอร์นี้

รัน (dry-run เสมอ — ทุกไฟล์ปิดท้ายด้วย `raise` บังคับ rollback, exit 1 คือผลที่คาด):

```bash
node scripts/run-sql.mjs scripts/verify/verify-0157.sql
```

กติกาเขียนชุดทดสอบ: skill `3j-migration-traps` ข้อ 11 + ตารางแมป "ข้อในบรีฟ → เทสต์ที่ครอบ"
ไฟล์ที่แปะหัวว่า **SUPERSEDED** (เช่น `verify-0131.sql`) ห้ามรันซ้ำ — เก็บไว้เป็นประวัติ
