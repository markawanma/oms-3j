# Deploy Checklist — TikTok Ops App Phase 1

> devops (Lando) · 2026-08-10 · Next.js บน OMS/Vercel

## 🚨 BLOCKER — ห้ามข้าม (security H1)
ทั้ง platform รัน `DEV_SHOP_ID` **ไม่มี auth** · หน้า `/tiktok/sales` ดึงยอดขายจริง → **ห้าม deploy ขึ้น URL สาธารณะจนกว่าจะมี:**
- (A) Supabase Auth จริง + RLS ผูก `shop_member` (fix ถาวร — งานแยก), **หรือ**
- (B) `middleware.ts` basic-auth gate ชั่วคราว (demo เท่านั้น) — **โปรเจกต์ยังไม่มี middleware.ts ต้องสร้างใหม่**

```ts
// middleware.ts (root) — fail-closed: ไม่มี env = บล็อก 503 ไม่ปล่อยผ่าน
import { NextRequest, NextResponse } from 'next/server'
export function middleware(req: NextRequest) {
  const expected = process.env.PREVIEW_GATE_PASSWORD
  if (!expected) return new NextResponse('Gate not configured', { status: 503 })
  const valid = 'Basic ' + Buffer.from(`3j:${expected}`).toString('base64')
  if (req.headers.get('authorization') !== valid)
    return new NextResponse('Auth required', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="3J OMS Preview"' } })
  return NextResponse.next()
}
export const config = { matcher: '/((?!_next/static|_next/image|favicon.ico).*)' }
```
⚠️ matcher ครอบทุก route → ถ้า env ผิดจะบล็อก OMS core ด้วย — เทสบน preview ก่อน merge เสมอ

## Pre-merge (ผู้ใช้รันเอง — environment ไม่มี Node)
```bash
npx tsc --noEmit && npm run lint && npm run build
```
ต้องผ่านทั้ง 3 (M1/M2 แก้แล้ว) · เช็ค `git status supabase/migrations/` = ต้องว่าง (Phase 1 ไม่มี schema change)

## Visual QA ก่อน ship (test จับไม่ได้)
- [ ] sub-nav alignment (top-16) ไม่ซ้อน header
- [ ] SVG chart edge: 1-2 เดือน (จุดน้อย) / 12+ เดือน (จุดเยอะ) ไม่ overflow
- [ ] มือถือ 375px sub-nav ไม่ล้น
- [ ] empty state อ่านได้ ไม่ใช่กราฟว่าง
- [ ] **Upload label "ระบบอ่านไฟล์ยังไม่เปิดใช้ (จำลอง)" เด่นพอ** กันเข้าใจผิดว่าบันทึกแล้ว

## Env vars (Vercel)
| Var | หมายเหตุ |
|---|---|
| NEXT_PUBLIC_SUPABASE_URL / ANON_KEY | มีแล้วถ้า OMS deploy อยู่ |
| SUPABASE_URL / SERVICE_ROLE_KEY | server-only, service_role ห้ามหลุด client |
| DEV_SHOP_ID | ชั่วคราว (ทั้งแอปพึ่ง) |
| **PREVIEW_GATE_PASSWORD** | ใหม่ — ถ้าใช้ middleware gate |

## DB migration: **ไม่ต้องรัน** (sales action read-only จาก orders เดิม)

## Deploy steps
1. commit (แยก feature จาก layout/tailwind) → 2. (ถ้าทำ gate) commit middleware แยก → 3. push feature branch → Vercel preview → **เทส gate ทำงาน (401)** → 4. ตั้ง env vars → 5. merge main → production → 6. เช็ค production: gate 401, dashboard โหลด, sales query จริง
- ⚠️ **อย่า deploy ศุกร์เย็น** (middleware ใหม่ fail-closed เสี่ยงบล็อกทั้งแอป ต้องมีคน monitor)

## Rollback
- `/tiktok/*` พัง → `git revert <tiktok-sha>` (ไม่กระทบ OMS core)
- middleware บล็อก OMS → `git revert <middleware-sha>` หรือ Vercel Dashboard → Promote previous deployment (<1 นาที)
- เงื่อนไขถอย: OMS core (`/orders`/`/stock`) error/401 ผิดที่ → ถอยทันที ไม่ debug บน prod

## Monitoring (30 นาทีแรก)
- `/tiktok/sales` load < 2-3 วิ (aggregate JS ~700 order/เดือน) · Vercel function logs error rate · gate 401 จาก browser ใหม่
- **debt:** ยังไม่มี index `(shop_id,created_at)` — พอไหวที่สเกลนี้ · โต >หมื่นแถวค่อยย้าย SQL function + index (additive)

## ความเสี่ยงสูงสุด
1. **Auth gate = blocker จริง** — ข้าม = ยอดขายจริงหลุดสาธารณะ
2. **middleware ใหม่ครอบทุก route** — config ผิดบล็อกทั้ง OMS (เทส preview ก่อน)
3. **Upload label "จำลอง"** ไม่เด่นพอ = เข้าใจผิดว่าอัปโหลดจริง

## สรุปสิ่งที่ผู้ใช้ต้องทำก่อน deploy
1. `tsc && lint && build` ผ่าน
2. ตัดสิน: auth gate (B) หรือรอ auth จริง — **ไม่มีทางที่ 3**
3. ถ้า gate: สร้าง middleware.ts + ตั้ง PREVIEW_GATE_PASSWORD
4. Visual QA 5 จุด
5. commit + push ตามลำดับ
