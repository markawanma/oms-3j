# 3J_AI_SYSTEM — Knowledge Base สำหรับออกแบบเครื่องประดับ 3J ด้วย AI

> **ใช้ตอนไหน**: อ่านไฟล์นี้ก่อนเสมอ เป็นจุดเริ่ม/index ของทั้งระบบ
> ระบบนี้ทำให้ **ChatGPT** (สร้าง reference image + วิเคราะห์ดีไซน์) และ **Claude/`jewelry-designer`** (ทำ CAD spec + RhinoPython) ทำงานร่วมกันได้แบบสม่ำเสมอ ไม่ต้องอธิบายบริบทแบรนด์ใหม่ทุกครั้ง
>
> ⚠️ **ก่อนอ่านไฟล์อื่นใดในระบบนี้ ให้อ่าน [`00_Design_Intent.md`](./00_Design_Intent.md) ก่อนเสมอ** — เป็นเอกสาร design intent ที่เจ้าของแบรนด์ยืนยันแล้ว (authoritative) มีน้ำหนักเหนือไฟล์อื่นทุกไฟล์ที่ขัดแย้งกัน

---

## ระบบนี้คืออะไร

ชุดไฟล์ `.md` ที่เก็บ **ตัวตนแบรนด์ + ภาษาดีไซน์ + มาตรฐาน CAD + workflow เฉพาะประเภทชิ้นงาน** ของ 3J Jewelry
เป้าหมาย: เปิด collection ใหม่ทีไร ไม่ต้องเริ่มจากศูนย์ — feed ไฟล์พวกนี้ให้ AI แล้วสั่งงานต่อได้เลย

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

- **ฝั่ง ChatGPT**: อัปโหลดไฟล์ `01_3J_Brand_DNA.md` + `02_3J_Design_Language.md` เข้า Custom GPT/Project knowledge (ดูวิธีอัปโหลดใน `docs/ops/3j-brand-brief-for-ai.md` ท้ายไฟล์) เพื่อให้ AI คิดธีม/สร้างภาพตรงตัวตนแบรนด์
- **ฝั่ง Claude**: สั่ง `jewelry-designer` โดยอ้างไฟล์ในระบบนี้ตรงๆ ได้เลย เช่น "ให้ jewelry-designer อ่าน `docs/3j-ai-system/03_3J_CAD_Guideline.md` แล้วทำ CAD spec ของ [ชิ้นงาน]..."
- **เปิด collection ใหม่**: เริ่มจาก `09_Collection_Template.md` กรอกให้ครบก่อน แล้วค่อยเข้า workflow เฉพาะประเภท (05–08)

## Index ไฟล์ในระบบ

| ไฟล์ | ใช้ตอนไหน |
|---|---|
| `README.md` | จุดเริ่ม/ภาพรวม pipeline (ไฟล์นี้) |
| `00_Design_Intent.md` | **อ่านก่อนไฟล์อื่นเสมอ** — design intent authoritative (folded satin, ไม่ใช่ twist) ยืนยันจากเจ้าของแบรนด์แล้ว |
| `01_3J_Brand_DNA.md` | ก่อนออกแบบทุกครั้ง — ตัวตนแบรนด์ที่ผลต่อการตัดสินใจดีไซน์ |
| `02_3J_Design_Language.md` | ตอนคิดทรง/เส้น/สัดส่วน — ภาษาดีไซน์ 10 หัวข้อ สอดคล้องกับ `00` (หัวข้อ ribbon/surface/stone ยืนยันแล้ว ที่เหลือยัง v1 draft) |
| `03_3J_CAD_Guideline.md` | ตอนแปลง design → CAD — เกณฑ์ผลิตเงิน 925 ที่ต้องคุมทุกชิ้น |
| `04_Claude_Master_Prompt.md` | ตอนสั่งงาน Claude/jewelry-designer — copy-paste prompt template |
| `05_Ring_Workflow.md` | ทำแหวน — ใช้ Satin Flow เป็นตัวอย่างจริง |
| `06_Pendant_Workflow.md` | ทำจี้ |
| `07_Earrings_Workflow.md` | ทำต่างหู |
| `08_Bracelet_Workflow.md` | ทำกำไล/สร้อยข้อมือ |
| `09_Collection_Template.md` | เริ่ม collection ใหม่ — เทมเพลตกรอกก่อนออกแบบ |

## ไฟล์วัตถุดิบ (ต้นทาง — อยู่นอกโฟลเดอร์นี้ อ้างอิงไม่ก็อปซ้ำ)

- [`docs/ops/3j-brand-brief-for-ai.md`](../ops/3j-brand-brief-for-ai.md) — brand brief เต็ม (ตัวตน/ลูกค้า/โทน/สี/guardrails/NAP) + วิธีอัปโหลดเข้า ChatGPT
- [`docs/ops/3j-jewelry-design-prompts.md`](../ops/3j-jewelry-design-prompts.md) — prompt kit 3 ขั้น (ChatGPT→Claude→Rhino) ต้นฉบับ
- [`docs/cad/satin-flow-half-turn-ring-spec.md`](../cad/satin-flow-half-turn-ring-spec.md) — worked example CAD spec จริง (แหวน Satin Flow, Part 1–6)
- [`docs/cad/satin-flow-half-turn-ring.py`](../cad/satin-flow-half-turn-ring.py) — RhinoPython output จริงของ Satin Flow
- [`docs/cad/satin-flow-preview.html`](../cad/satin-flow-preview.html) — 3D preview (WebGL) ของ Satin Flow

## หมายเหตุสำคัญ

- **`00_Design_Intent.md` คือฐานสูงสุด** — หัวใจคือ "ดีไซน์ 3J = ผ้าซาตินพับ ไม่ใช่การบิดโลหะ" ทุกไฟล์อื่นต้องไม่ขัดกับไฟล์นี้
- ไฟล์ `02_3J_Design_Language.md` หัวข้อ Ribbon/Surface/Stone ยืนยันแล้วจาก `00` ส่วนหัวข้ออื่น (Metal, Proportion ตัวเลข, Symmetry) ยังเป็น **v1 draft** ที่เจ้าของแบรนด์ยืนยัน/แก้เพิ่มได้
- ตัวอย่าง Satin Flow ใน `docs/cad/` เป็นตัวอย่างช่วงก่อนแก้ไข (เคยตีความ ribbon เป็น twist ทั้งวง) — ใช้เป็นแนวทางมิติ/โครงสร้างเท่านั้น ตำแหน่ง twist ต้องปรับตามกฎใหม่ใน `00` (split เฉพาะใกล้หัวแหวน)
- อัปเดตแบรนด์/มาตรฐานเมื่อไหร่ → แก้ที่ต้นทาง (`docs/ops/...`) แล้ว sync มาไฟล์ 01/03 ในนี้ ส่วน design intent (`00`) แก้เฉพาะเมื่อเจ้าของแบรนด์ส่ง correction ใหม่เท่านั้น
