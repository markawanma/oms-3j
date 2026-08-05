# 3J_AI_SYSTEM — Knowledge Base สำหรับออกแบบเครื่องประดับ 3J ด้วย AI

> **ใช้ตอนไหน**: อ่านไฟล์นี้ก่อนเสมอ เป็นจุดเริ่ม/index ของทั้งระบบ
> ระบบนี้ทำให้ **ChatGPT** (สร้าง reference image + วิเคราะห์ดีไซน์) และ **Claude/`jewelry-designer`** (ทำ CAD spec + RhinoPython) ทำงานร่วมกันได้แบบสม่ำเสมอ ไม่ต้องอธิบายบริบทแบรนด์ใหม่ทุกครั้ง

---

## Mental model: ระบบนี้แบ่ง 2 ชั้นเสมอ

3J ออก collection ใหม่เรื่อยๆ — แต่ละ collection มี motif/design-intent เฉพาะของตัวเอง **ไม่ใช่ทุก collection ต้องเหมือนกัน** ระบบนี้จึงแยกความรู้เป็น 2 ชั้น:

```
docs/3j-jewelry/design-system/
├── 00_Brand_Principles.md      ← ชั้นแบรนด์: สากลทุก collection (วัสดุ, feeling, visual priority, บทบาท AI)
├── 01–03, 04–09 (ไฟล์อื่น)     ← ชั้นแบรนด์: มาตรฐานผลิต, prompt template, workflow ตามประเภทชิ้นงาน
└── collections/
    └── satin-flow/
        └── design-intent.md    ← ชั้น collection: motif "folded satin" เฉพาะของ Satin Flow เท่านั้น
    └── <ชื่อ-collection-ใหม่>/
        └── design-intent.md    ← เปิด collection ใหม่ = สร้างไฟล์นี้ (ดู 09_Collection_Template.md)
```

> ⚠️ **บทเรียนที่แก้แล้ว**: ระบบเดิมเคยเอา motif "folded satin" (ของ Satin Flow) ไปตั้งเป็น DNA ทั้งแบรนด์ — ผิด เพราะ collection อื่นไม่ได้ใช้ motif นี้ ตอนนี้แก้เป็นโครงสร้าง 2 ชั้นแล้ว: **อ่าน `00_Brand_Principles.md` (สากล) คู่กับ `collections/<ชื่อ>/design-intent.md` (เฉพาะ) เสมอ ห้ามอ่านแค่ไฟล์เดียว**

### วิธีเปิด collection ใหม่

1. Copy `09_Collection_Template.md` ไปเป็น `collections/<ชื่อ-collection>/design-intent.md`
2. กรอก motif/metaphor, test คำถามเฉพาะ, NEVER-DO เฉพาะ motif, กฎโครงสร้างเฉพาะ, ตารางสเปกกลาง
3. ใช้คู่กับ `00_Brand_Principles.md` ในทุก prompt/workflow ของ collection นั้นตั้งแต่นี้ไป

---

## Pipeline ภาพรวม

```
[1] ChatGPT — สร้าง reference image (2 มุม) จากธีม collection
        ↓
[2] ChatGPT — วิเคราะห์ภาพเป็น design spec (8 หัวข้อ)
        ↓  copy analysis ทั้งก้อน
[3] Claude / jewelry-designer — CAD spec (ผลิตได้จริง) + RhinoPython script
        ↓
[4] Rhino — paste script รัน → ได้ base geometry/blockout
        ↓
[5] ช่างทอง — เก็บ organic detail + setting จริง → ผลิต
```

รายละเอียด step 1–3 แบบ copy-paste ได้ อยู่ใน `04_Claude_Master_Prompt.md` (ต่อยอดจาก prompt kit เดิม)

## วิธีใช้

- **ฝั่ง ChatGPT**: อัปโหลดไฟล์ `01_3J_Brand_DNA.md` + `02_3J_Design_Language.md` เข้า Custom GPT/Project knowledge (ดูวิธีอัปโหลดใน `docs/3j-jewelry/brand-ops/3j-brand-brief-for-ai.md` ท้ายไฟล์) เพื่อให้ AI คิดธีม/สร้างภาพตรงตัวตนแบรนด์ — ถ้ากำลังทำ collection ที่มีไฟล์ design-intent แล้ว ให้อัปโหลด `collections/<ชื่อ>/design-intent.md` เพิ่มด้วย
- **ฝั่ง Claude**: สั่ง `jewelry-designer` โดยอ้างไฟล์ในระบบนี้ตรงๆ ได้เลย เช่น "ให้ jewelry-designer อ่าน `docs/3j-jewelry/design-system/00_Brand_Principles.md` + `docs/3j-jewelry/design-system/collections/satin-flow/design-intent.md` แล้วทำ CAD spec ของ [ชิ้นงาน]..."
- **เปิด collection ใหม่**: เริ่มจาก `09_Collection_Template.md` กรอกให้ครบเป็น `collections/<ชื่อ>/design-intent.md` แล้วค่อยเข้า workflow เฉพาะประเภท (05–08)

## Index ไฟล์ในระบบ

| ไฟล์ | ระดับ | ใช้ตอนไหน |
|---|---|---|
| `README.md` | — | จุดเริ่ม/ภาพรวม pipeline (ไฟล์นี้) |
| `00_Brand_Principles.md` | **แบรนด์** | **อ่านก่อนไฟล์อื่นเสมอ** — หลักสากลทุก collection (วัสดุ, feeling, visual priority, บทบาท AI) ยืนยันจากเจ้าของแบรนด์แล้ว |
| `01_3J_Brand_DNA.md` | แบรนด์ | ก่อนออกแบบทุกครั้ง — ตัวตนแบรนด์ที่ผลต่อการตัดสินใจดีไซน์ |
| `02_3J_Design_Language.md` | แบรนด์ (หมวด) | ตอนคิดทรง/เส้น/สัดส่วน — หมวดภาษาดีไซน์ 10 หัวข้อที่ทุก collection ต้องนิยาม (บาง หมวดมี brand default, บางหมวด collection นิยามเอง) |
| `03_3J_CAD_Guideline.md` | แบรนด์ | ตอนแปลง design → CAD — เกณฑ์ผลิตเงิน 925 ที่ต้องคุมทุกชิ้น |
| `04_Claude_Master_Prompt.md` | แบรนด์ | ตอนสั่งงาน Claude/jewelry-designer — copy-paste prompt template (มีช่อง `[collection name]`) |
| `05_Ring_Workflow.md` | แบรนด์ | ทำแหวน — ใช้ Satin Flow เป็นตัวอย่างจริง |
| `06_Pendant_Workflow.md` | แบรนด์ | ทำจี้ |
| `07_Earrings_Workflow.md` | แบรนด์ | ทำต่างหู |
| `08_Bracelet_Workflow.md` | แบรนด์ | ทำกำไล/สร้อยข้อมือ |
| `09_Collection_Template.md` | แบรนด์ (เทมเพลต) | เริ่ม collection ใหม่ — copy ไปเป็น `collections/<ชื่อ>/design-intent.md` |
| `collections/satin-flow/design-intent.md` | **collection** | authoritative เฉพาะ collection Satin Flow — motif "folded satin", NEVER-DO twist/rope/spiral, กฎ split-near-head |
| `collections/wave-embrace/design-intent.md` | **collection** | authoritative เฉพาะ collection Wave Embrace — motif "soft ocean wave + hidden sparkle", NEVER-DO sharp wave/deep curve/overly wavy/visible stone, กฎ single soft peak + flush inner setting |
| `collections/auspicious-pixiu/design-intent.md` | **collection** | authoritative เฉพาะ collection Auspicious Pixiu (hero product ใหม่ 3 tier) — motif "ปี่เซียะย่อรูปทรงเหลือ 3 สัญลักษณ์บังคับ (เขาเดี่ยว/ปีกพับ/หน้าสงบ) + river-stone sculpt", NEVER-DO พู่ห้อย/ลายเมฆ/ฐานแท่น/ปากอ้าเขี้ยว, **สถานะ v1 รอเจ้าของแบรนด์ยืนยัน** |

## ไฟล์วัตถุดิบ (ต้นทาง — อยู่นอกโฟลเดอร์นี้ อ้างอิงไม่ก็อปซ้ำ)

- [`docs/3j-jewelry/brand-ops/3j-brand-brief-for-ai.md`](../brand-ops/3j-brand-brief-for-ai.md) — brand brief เต็ม (ตัวตน/ลูกค้า/โทน/สี/guardrails/NAP) + วิธีอัปโหลดเข้า ChatGPT
- [`docs/3j-jewelry/brand-ops/3j-jewelry-design-prompts.md`](../brand-ops/3j-jewelry-design-prompts.md) — prompt kit 3 ขั้น (ChatGPT→Claude→Rhino) ต้นฉบับ
- [`docs/3j-jewelry/cad/satin-flow-half-turn-ring-spec.md`](../cad/satin-flow-half-turn-ring-spec.md) — worked example CAD spec จริง (แหวน Satin Flow, Part 1–6)
- [`docs/3j-jewelry/cad/satin-flow-half-turn-ring.py`](../cad/satin-flow-half-turn-ring.py) — RhinoPython output จริงของ Satin Flow
- [`docs/3j-jewelry/cad/satin-flow-preview.html`](../cad/satin-flow-preview.html) — 3D preview (WebGL) ของ Satin Flow
- [`docs/3j-jewelry/cad/wave-embrace-ring-spec.md`](../cad/wave-embrace-ring-spec.md) — worked example CAD spec จริง (แหวน Wave Embrace WE-R001, Part 1–6)
- [`docs/3j-jewelry/cad/wave-embrace-ring.py`](../cad/wave-embrace-ring.py) — RhinoPython output จริงของ Wave Embrace
- [`docs/3j-jewelry/cad/pixiu-signature-pendant-spec.md`](../cad/pixiu-signature-pendant-spec.md) — CAD spec v1 (จี้ปี่เซียะ Signature tier, hero product ใหม่) — เขียนก่อนมี reference image จริง เป็น design brief + RhinoPython blockout (bail + placeholder mass เท่านั้น ตัวสัตว์ต้องปั้น T-Splines)

## หมายเหตุสำคัญ

- **`00_Brand_Principles.md` คือฐานสูงสุดระดับแบรนด์** — สากลทุก collection ทุกไฟล์อื่นต้องไม่ขัดกับไฟล์นี้
- **`collections/<ชื่อ>/design-intent.md` คือฐานสูงสุดของ collection นั้นๆ** — ต้องอ่านคู่กับ `00_Brand_Principles.md` เสมอ ไม่ใช้แทนกัน และห้ามนำ motif ของ collection หนึ่งไปใช้กับอีก collection
- ไฟล์ `02_3J_Design_Language.md` เป็นหมวด checklist ที่ทุก collection ต้องนิยามค่าตัวเอง — บางหมวดมี brand default (Metal, Surface calm) บางหมวดไม่มี default เลย (Ribbon/Motif) ต้องไปนิยามที่ collection file
- ตัวอย่าง Satin Flow ใน `docs/3j-jewelry/cad/` เป็นตัวอย่างช่วงก่อนแก้ไข (เคยตีความ ribbon เป็น twist ทั้งวง) — ใช้เป็นแนวทางมิติ/โครงสร้างเท่านั้น ตำแหน่ง twist ต้องปรับตามกฎใหม่ใน `collections/satin-flow/design-intent.md` (split เฉพาะใกล้หัวแหวน)
- อัปเดตแบรนด์/มาตรฐานเมื่อไหร่ → แก้ที่ต้นทาง (`docs/3j-jewelry/brand-ops/...`) แล้ว sync มาไฟล์ 01/03 ในนี้ ส่วน brand principles (`00`) และ collection design-intent แก้เฉพาะเมื่อเจ้าของแบรนด์ส่ง correction ใหม่เท่านั้น
