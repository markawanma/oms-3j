# READING LISTS — ทำเรื่องนี้ อ่านไฟล์เหล่านี้พอ (5 ต.ค. 69)

> **วิธีใช้**: เริ่มงานในหัวข้อใด → หาหัวข้อนั้นด้านล่าง → เปิดเฉพาะไฟล์ในนั้น · brief ถึง subagent ให้**ลอกรายชื่อไฟล์จากหัวข้อ**ไปวาง ไม่สั่ง "ดูใน docs/"
> **กติกาดูแล**: ไฟล์/migration ใหม่ในหัวข้อไหน → เพิ่มในหัวข้อนั้นทันทีในคอมมิตเดียวกัน · `node scripts/doc-index-check.mjs` ตรวจว่าทุก path ในไฟล์นี้มีอยู่จริง (pre-commit รันให้)
> ชั้นข้อมูล: `memory:` = ไฟล์ใน memory dir (นอก repo, ชื่อตาม MEMORY.md) · `skill:` = SKILL.md ของชื่อนั้นใน .claude/skills/ · `docs:` ใต้ `docs/3j-jewelry/` · `migrations:` = ช่วงเลขใน `supabase/migrations/` · `code:` path ใน repo
> ไม่ต้องเปิดทุกไฟล์ในหัวข้อ — เปิดเท่าที่งานแตะ · อะไรที่เป็น "สถานะตอนนี้" ให้เช็ค git/DB ไม่ใช่เชื่อเอกสาร

---

## 1. OEM quote · ใบเสร็จ · ราคาโลหะ (โรงงานรับผลิต)
- memory: `oem-quote-v2-status` · `oem-pricing` (🔴 ตัวเลขห้ามจด) · `pricing-disclosure-policy` · `silver-price-capture`
- skill: `oem-quote-invariants`
- docs: `docs/3j-jewelry/analytics/design-oem-bar-quote.md` · `docs/3j-jewelry/analytics/design-oem-bar-price-override.md` (ราคาพิเศษเงินแท่ง 0163) · `docs/3j-jewelry/analytics/design-oem-payment-invoice.md` · `docs/3j-jewelry/oem/design-email-sku-phase1.md` · `docs/3j-jewelry/marketing/oem-pricing-floor.md` (ภายใน ห้ามขึ้นสาธารณะ)
- migrations: `0061-0067` (cost rate / quote calc) · `0073-0088` (quote v2 · deposit · VAT · receipt · doc integrity) · `0125-0129` (silver spot) · `0140` (cost calc extract) · `0163` (ราคาพิเศษเงินแท่ง) · `0164` (แก้ชื่อ/ช่องทางติดต่อลูกค้าบนใบ) · `0165` (แก้ตาม security: actor + audit + ด่านอักขระล่องหน)
- code: `app/(dashboard)/oem/` · `lib/oem/` · `components/domain/oem/` · `app/(dashboard)/catalog/silver-price/`

## 2. ต้นทุน · spot · สต็อก · ใบผลิต · SKU
- memory: `production-order-and-spot-cost` · `spec-cost-mode` · `stock-and-lot-costing-status` (🔴 ห้ามต่อ UI ก่อนปิด H1) · `stock-tracking-decisions` · `silver-bar-cost-basis` · `silver-bar-profit-fake-markup` · `catalog-cost-margin` · `sku-autofill-decisions` · `sku-generator-status`
- skill: `oversell-safe-inventory-rpc` · `3j-migration-traps`
- docs: `docs/3j-jewelry/oms/system-flow-2026-09.md` (มติเจ้าของ 17 ก.ย. — ขัดกับ memory ให้ถือไฟล์นี้) · `docs/3j-jewelry/oms/design-production-order.md` · `docs/3j-jewelry/oms/design-inventory-lot-costing.md` · `docs/3j-jewelry/oms/design-own-production-costing.md` · `docs/3j-jewelry/analytics/phase-c1-sku-cost-margin.md` · `docs/3j-jewelry/analytics/ref-sku-prefix.md`
- migrations: `0003-0007` (stock RPC) · `0028-0031` (cost/margin · catalog) · `0042` · `0089-0096` (SKU gen) · `0131-0144` (ใบผลิต · หักสต็อก · lot FIFO · spec cost)
- code: `app/(dashboard)/production/` · `app/(dashboard)/stock/` · `app/(dashboard)/catalog/` · `app/(dashboard)/products/new/` · `lib/production/` · `lib/stock/` · `lib/catalog/` · `components/domain/production/` · `components/domain/stock/` · `components/domain/catalog/` · `supabase/tests/`

## 3. import ออเดอร์ · ยกเลิก · คุณภาพข้อมูลยอดขาย
- memory: `data-source-split` (ยอดจริงอยู่ fact_order) · `analytics-import-pipeline` · `order-import-ui` · `import-upsert-no-blank-overwrite` · `cancel-detection-system` · `order-numbering-and-cancellations` · `orders-accumulate-across-days` · `data-coverage-status`
- skill: `3j-migration-traps`
- docs: `docs/3j-jewelry/analytics/phase-import-ui-design.md` · `docs/3j-jewelry/analytics/stg-import-schema.md` · `docs/3j-jewelry/analytics/phase-lineitem-import-design.md` · `docs/3j-jewelry/analytics/product-import-guide.md`
- migrations: `0010-0019` (analytics schema · staging · transform) · `0041` · `0068-0069` · `0107-0118` (perf · upsert rules · tombstone · write gate)
- code: `app/(dashboard)/crm/import/` · `app/(dashboard)/crm/import-errors/` · `lib/import/` · `lib/crm/import-client.ts` · `scripts/import-aug.mjs` · `scripts/import-line-report.mjs`

## 4. TikTok ใบปะหน้า → จังหวัด
- memory: `tiktok-label-province` (กับดักฟอนต์ PUA) · `label-upload-system`
- docs: `docs/3j-jewelry/analytics/design-label-upload.md` · `docs/3j-jewelry/analytics/upload-page-layout-design.md`
- migrations: `0014-0016` (provinces · alias) · `0097-0098` · `0116`
- code: `app/(dashboard)/tiktok/upload/` · `lib/labels/` · `components/domain/tiktok/` · `scripts/import-tiktok-labels.mjs` · `scripts/check-label-coverage.mjs`

## 5. CRM · ลูกค้า · retention · audience
- memory: `crm-phase-b` · `customer-affinity-split` (affinity มีแล้ว อย่าสร้างใหม่) · `retention-baseline-and-reach` · `marketing-campaign-audience` · `wholesale-not-in-system`
- docs: `docs/3j-jewelry/analytics/phase-b-crm-design.md` · `docs/3j-jewelry/analytics/phase-b3-design.md` · `docs/3j-jewelry/analytics/deploy-checklist-b1.md` · `docs/3j-jewelry/analytics/deploy-checklist-b2.md`  · `docs/3j-jewelry/analytics/rfm-at-risk-and-new-cohort-2026-10-06.md` (T1 at_risk + T6 cohort freeze · snapshot 6 ต.ค. 69) · `docs/3j-jewelry/analytics/cohorts/new-freeze-2026-09-08.csv` · `docs/3j-jewelry/analytics/winback-cohorts-2026-10-06.md` (T11 cohort win-back (d)/(f) · `cohorts/winback-d-2026-09-13.csv` · `cohorts/second-purchase-f-2026-09-14.csv`) · `docs/3j-jewelry/analytics/design-rfm-snapshot.md` (snapshot RFM รายสัปดาห์ — design, migration 0158/0159 ยังไม่เขียน)
- migrations: `0020-0026` (CRM B1-B2 · merge · PII retention) · `0033` (v_audience) · `0043` · `0055-0056` · `0099-0100` (affinity) · `0110` · `0120_crm_retention` · `0130`
- code: `app/(dashboard)/crm/` · `app/(dashboard)/marketing/audience/` · `lib/crm/` · `components/domain/crm/`  · `scripts/analysis/rfm-asof.sql` (RFM as-of รันซ้ำได้)

## 6. ไลฟ์ · dashboard ยอดขาย · ธีม UI
- memory: `live-selling-rhythm` · `live-sku-identification` · `live-session-log` · `ui-theme-dashboard` (brand red มีแล้ว อย่า re-palette)
- docs: `docs/3j-jewelry/analytics/phase-dashboard-charts-design.md` · `docs/3j-jewelry/analytics/sales-2026-h1-summary.md` (snapshot) · `docs/3j-jewelry/ops-app/3j-theme-spec.md` · `docs/3j-jewelry/design/ui-refresh-plan.md`
- migrations: `0008` (live sessions) · `0039` · `0044` · `0051-0054` · `0070-0071` · `0119` · `0121` (live log) · `0146` · `0158` (live_host + host_id ใน live log · live_session_upsert v2)
- code: `app/(dashboard)/dashboard/` · `app/(dashboard)/tiktok/` · `app/(dashboard)/live/` · `lib/dashboard/` · `lib/tiktok/` · `components/domain/dashboard/` · `components/brand/`

## 7. content · marketing · แคมเปญ · วัดผล content
- memory: `business-portfolio` · `content-measurement-project` (🔴 88% ไม่มีชื่อลาย) · `content-calendar-chunli-style` · `campaign-playbook` · `platform-engagement-apis` · `ads-organic-only` · `3j-website-seo-positioning`
- skill: `3j-content-orchestration` (โหลดก่อนสั่งทีม content เสมอ) · `3j-brand-and-market` · `3j-founder-brand` · `3j-seo-playbook`
- docs: `docs/3j-jewelry/marketing/ai-marketing-os-decision-31aug.md` (ทิศทางใหญ่) · `docs/3j-jewelry/marketing/content-workflow-v1.md` (วงจร workflow 8 ขั้น + research/hook + MVP — อ่านก่อนออกแบบ/แก้หน้า marketing ใดๆ) · `docs/3j-jewelry/marketing/content-workflow-ui-brief.md` (ฉบับส่งออก UI ภายนอก) · `docs/3j-jewelry/marketing/content-ui-round2-request.md` (คำขอ UI รอบ 2) · `docs/3j-jewelry/analytics/design-content-workflow-schema-gap.md` (schema gap + phase C1 = `0158` · C2–C3 เลขถัดไป) · `docs/3j-jewelry/marketing/pricing-disclosure-policy.md` · `docs/3j-jewelry/analytics/content-kpi-definition.md` (ชี้ขาด KPI) · `docs/3j-jewelry/analytics/ux-content-measurement.md` · `docs/3j-jewelry/analytics/content-kpi-screen-design.md` · `docs/3j-jewelry/analytics/phase-campaign-playbook-design.md` · `docs/3j-jewelry/marketing/campaign-tracking-taxonomy-v2.md` · `docs/3j-jewelry/marketing/weekly-brief/` · `docs/3j-jewelry/marketing/content-calendar/` · `docs/3j-jewelry/content/`
- migrations: `0027` · `0034-0036` · `0040` · `0049-0050` · `0053` · `0057-0060` (content calendar) · `0101` (recommendation log) · `0145` · `0148-0153` (content post/metric) · `0158` (content_signal · content_hook · live_host — C1 workflow ใหม่) · `0159` (piece workflow C2: piece_status · content_piece_advance · event · confirm · gate 3 ด่าน) · `0161` (C3: แก้ยอดย้อนหลัง · ผลต่อโพสต์ · rollup hook · metric orders) · `0162` (C3: คำตัดสินแคมเปญ · inbox ข้อเสนอ AI · Weekly Brief ในแอป) · `0160` (C2 ฝั่งโพสต์: content_piece_post · link/unlink · defer · view calendar/inbox/โควตา LINE/คลัง hook)
- code: `app/(dashboard)/marketing/` · `lib/marketing/` (`clip-brief.ts` = สัญญา storyboard) · `components/domain/marketing/`
- เขียนลงบอร์ดจากนอกแอป: RPC `campaign_step_set_content_type` (สีประเภท) · `campaign_ai_draft_artifact` (AI ร่าง → "รอตรวจ" ห้ามทับของที่คนแก้/อนุมัติแล้ว) · `campaign_set_artifact_content` (คนแก้) — เรียกผ่าน `scripts/run-sql.mjs` ภายใต้ `set local request.jwt.claim.role = 'service_role'` ซ้อม rollback ก่อนเสมอ
- scheduled tasks (นอก repo `~/.claude/scheduled-tasks/`): `weekly-marketing-brief` · `daily-trend-radar`

## 8. Gem quiz (หน้าสาธารณะ /gem-quiz)
- docs: `docs/3j-jewelry/analytics/design-gem-quiz.md` (v1 — §1/§2/§5/§6 ยังมีผล) · `docs/3j-jewelry/analytics/design-gem-quiz-v2-reconcile.md` · `docs/3j-jewelry/analytics/gem-quiz-v2-handoff/` (ห้ามแก้)
- migrations: `0154-0157`
- code: `app/(quiz)/gem-quiz/` · `app/api/gem-quiz/submit/route.ts` · `lib/gem-quiz/` · `middleware.ts` (matcher exempt — exact path เท่านั้น) · `app/(dashboard)/marketing/gem-quiz/` · `components/domain/marketing/GemQuizStats.tsx` · `public/gem-quiz/` · `scripts/gen-gem-quiz-og.cjs`
- ข้อห้ามที่พังง่าย: ห้าม `"use server"` ใน graph ของ `app/(quiz)/` (มี test บังคับ) · ห้ามเพิ่ม sub-route ใต้ /gem-quiz (middleware เด้ง /login) · env `GEM_QUIZ_TOKEN_SECRET` ≥32 ตัว

## 9. Auth · สิทธิ์ · security · PII
- memory: `auth-hardening` · `role-single-level` · `supabase-project` · `supabase-error-logging-trap` · `next-security-upgrade`
- skill: `supabase-migrate` · `3j-migration-traps` (ข้อ 18 grant บน analytics)
- docs: `docs/3j-jewelry/analytics/phase-auth-pii-hardening-design.md` · `docs/3j-jewelry/legal/` (ร่าง ห้ามเผยแพร่)
- migrations: `0002` · `0004` · `0012` · `0018` · `0046` · `0103` · `0122-0124` (no REST for users) · `0130` · `0147` · `0155-0156`
- code: `app/(auth)/` · `lib/auth/` · `middleware.ts` · `app/(dashboard)/settings/` · `scripts/provision-member.mjs` · `scripts/check-analytics-grants.sql`

## 10. เขียน/รีวิว migration (ทุกหัวข้อ)
- memory: `run-migrations-from-file` (🔴 ห้าม supabase db push) · `migrations-0107-0109-off-main` · `migration-file-lost-0129` · `migration-replay-crlf-trap`
- skill: `3j-migration-traps` · `supabase-migrate`
- code: `scripts/run-sql.mjs` (apply/dry-run) · `scripts/query-sql.mjs` (อ่านอย่างเดียว พิมพ์แถว — ใช้แทน Supabase MCP เมื่อไม่มี) · `scripts/verify/` · `supabase/migrations/`

## 11. ราคาเงิน · เว็บ 3jthailand.com (Wix)
- memory: `silver-price-capture` · `3j-silver-bar-facts` · `silver-value-chain` · `silver-bar-demand-collapse` · `3j-website-seo-positioning`
- skill: `3j-seo-playbook` · `3j-brand-and-market`
- docs: `docs/3j-jewelry/web/` (ชุด 29 ส.ค. — ดู INDEX ว่าตัวไหน current) · `docs/3j-jewelry/marketing/pricing-disclosure-policy.md`
- migrations: `0072` · `0074` · `0102` · `0125-0128`
- code: `scripts/capture-silver-price-sheet.mjs` · `scripts/scrape-silver-price.mjs` · `scripts/run-silver-price.bat` · `scripts/setup-silver-price-task.ps1` · `scripts/velo-silver-price-parse.test.mjs` · `lib/catalog/silver-price-history.ts`

## 12. ออกแบบเครื่องประดับ · brand ops
- memory: `3j-design-system` (DNA = folded satin) · `3j-silver-bar-facts`
- docs: `docs/3j-jewelry/design-system/` · `docs/3j-jewelry/cad/` · `docs/3j-jewelry/brand-ops/`
- agent: `jewelry-designer` (Sabé) ใต้ ux-ui

## 13. วิธีทำงานของทีม · dev environment
- memory: `delegate-dont-diy` · `branch-convention` · `qa-workflow-rules` · `parallel-agents-worktree` (🔴) · `vitest-worktree-server-only` · `dev-server-duplicates-break-hydration` · `environment-no-node` · `notify-on-completion` · `owner-preferences`
- skill: `3j-team-lessons` · `3j-qa-regression-map`
- code: `.claude/agents/` · `.claude/launch.json` · `.githooks/` · `scripts/hooks/` · `scripts/doc-index-check.mjs`
