# 3J / Markawan — AI Visual Prompt Pack

> ชุด prompt สำเร็จรูปสำหรับเอาไปวางใน AI สร้างภาพ/วิดีโอ (Gemini/Veo, Midjourney, Runway, Kling, Sora ฯลฯ)
> **Claude สร้างภาพเองไม่ได้** — เอกสารนี้คือส่วนที่ Claude ทำได้ดีที่สุด: บทและคำสั่งที่ทำให้ผลลัพธ์ออกมาเป็นแบรนด์เดียวกันทุกครั้ง
> อัปเดต 2026-08-24

---

## กฎเหล็ก 3 ข้อ ก่อนใช้ prompt ใดๆ ในเอกสารนี้

### 1. 🔴 ห้ามให้ AI วาดตัวสินค้าขึ้นมาเอง

ลิปกลอสในคลิปอ้างอิงเป็นหลอดทรงเรียบๆ AI วาดผิดไปนิดหน่อยไม่มีใครจับได้ **แต่เครื่องประดับไม่ใช่** — แหวนที่ AI วาดจะมีพลอยคนละเม็ด ก้านคนละทรง จำนวนเหลี่ยมคนละแบบ

ลูกค้าที่กดสั่งเพราะเห็นรูปนั้น แล้วได้ของที่ไม่เหมือน = เคลม + รีวิวเสีย + สำหรับ Markawan Ganesha ที่ขาย ฿1,590 บนเรื่องเล่าล้วนๆ **ถูกจับได้ครั้งเดียวเรื่องเล่าพังทั้งไลน์**

**ทางที่ถูก: image-to-video** — ถ่ายรูปแหวนจริงก่อน แล้วให้ AI ทำแค่ "ทำให้ภาพนี้เคลื่อนไหว" (กล้องเลื่อน แสงกวาด ฝุ่นแสงลอย) ของยังเป็นของจริง AI แตะแค่การเคลื่อนไหว

**text-to-video ใช้ได้เฉพาะ** ช็อตที่ไม่มีตัวสินค้า — ฉากเปิด พื้นหลัง ฉากบรรยากาศ b-roll

### 2. ห้ามใส่ตัวเลขราคาลงในภาพ/วิดีโอ
ขายตามกรัม ราคาเงินขยับทุกวัน คลิปเก่าที่ค้างราคาไว้ = ดราม่าหน้าไลฟ์ (มติ CMO)

### 3. ห้ามใช้นายแบบ/นางแบบ AI สวมสินค้าจริง
มือ AI + แหวนจริง = ภาพที่ดูเหมือนโฆษณาแต่พิสูจน์ไม่ได้ ถ้าจะมีมือ **ใช้มือคนจริงถ่ายเอง**

---

## STYLE BLOCK — วางต่อท้าย prompt ทุกครั้ง

คัดลอกทั้งก้อนนี้ไปต่อท้าย prompt เสมอ เพื่อให้ทุกคลิปดูเป็นแบรนด์เดียวกัน

```
STYLE: warm neutral palette — cream, sand beige, warm grey, soft ivory.
One soft directional key light from upper left, gentle falloff, no harsh
specular hotspots. Shallow depth of field, creamy bokeh background.
Surfaces: raw silk or matte satin fabric, honed marble riser, unglazed
ceramic. Natural imperfection welcome — a fold in the silk, a single dried
gypsophila sprig. Muted, calm, unhurried. Editorial jewelry photography,
not e-commerce catalog. Shot on 100mm macro, f/2.8, natural window light
at 4pm. 9:16 vertical. No text overlay, no logo, no watermark, no price.
```

```
NEGATIVE: no plastic shine, no neon, no blue-cold lighting, no glitter
particles, no CGI sparkle bursts, no busy background, no multiple products,
no hands unless specified, no text, no watermark, no oversaturation.
```

**ทำไมต้องมี STYLE BLOCK** — ถ้าไม่มี AI จะสุ่มสไตล์ใหม่ทุกครั้ง คลิป 10 ตัวจะดูเหมือนมาจาก 10 ร้าน ซึ่งเป็นสิ่งที่ทำให้แบรนด์ไม่เกิด

---

# STORYBOARD A — Markawan Ganesha (แหวนพรีเมียม ฿1,590)

**ความยาว 15 วินาที · 5 ช็อต · เป้าหมาย: สร้างความรู้สึกว่าแหวนวงนี้มีเรื่องเล่า ไม่ใช่แหวนพลอยทั่วไป**

**ธีม:** พลอย 3 เม็ด = 3 ช่วงของเส้นทางคนหนึ่งคน — วันที่เริ่ม (ม่วง Amethyst) · วันที่ติด (ใส White Zircon) · วันที่ข้ามผ่าน (เหลืองส้ม Citrine)

| # | วิ | ภาพ | วิธีสร้าง |
|---|---|---|---|
| 1 | 0–3 | ผ้าไหมสีครีมพับเป็นคลื่น แสงกวาดผ่านช้าๆ ยังไม่เห็นแหวน | text-to-video ได้ |
| 2 | 3–7 | แหวนวางบนแท่นหินอ่อน กล้องดันเข้าช้าๆ | **image-to-video จากรูปจริง** |
| 3 | 7–10 | มาโครพลอย 3 เม็ดเรียงกัน ไล่โฟกัสจากม่วง→ใส→เหลือง | **image-to-video จากรูปจริง** |
| 4 | 10–13 | มือคนจริงสวมแหวน หมุนข้อมือเบาๆ | **ถ่ายจริงเท่านั้น** |
| 5 | 13–15 | แหวนวางคู่การ์ดเรื่องเล่าและกล่อง | **ถ่ายจริง** |

### PROMPT ช็อต 1 (text-to-video — ไม่มีสินค้า ปลอดภัย)

```
Slow cinematic push across folded cream raw silk fabric, deep soft folds
catching a single warm directional light that sweeps gently left to right
over 3 seconds. Dust motes drifting in the light beam. Extremely shallow
depth of field. Nothing else in frame. Calm, reverent, like the opening of
a documentary. Duration 3 seconds, no cuts.

[+ STYLE BLOCK] [+ NEGATIVE]
```

### PROMPT ช็อต 2 (image-to-video — อัปรูปแหวนจริงก่อน)

```
[ATTACH: real photo of the ring on a marble riser]

Animate this still photograph. Camera slowly pushes in toward the ring over
4 seconds, a very subtle dolly move, no rotation. The key light sweeps
gently across the metal so the polished silver band catches a soft moving
highlight. Background silk stays still. The ring itself must not change
shape, colour, stone count, or position — animate camera and light only.
Photoreal, no stylisation.

[+ STYLE BLOCK] [+ NEGATIVE]
```

> ⚠️ ประโยค *"The ring itself must not change shape, colour, stone count, or position"* คือหัวใจ — ถ้าไม่ใส่ AI จะแอบเปลี่ยนพลอย

### PROMPT ช็อต 3 (มาโครพลอย — image-to-video)

```
[ATTACH: real macro photo of the three stones]

Animate this macro still. Focus racks slowly from the leftmost purple stone,
to the clear centre stone, to the right amber stone, over 3 seconds — one
continuous smooth focus pull, each stone sharp for about one second. Tiny
internal light refraction inside each stone as focus lands on it. Camera
static. Stones must not move, change colour, or change count.

[+ STYLE BLOCK] [+ NEGATIVE]
```

### ช็อต 4 และ 5 — ถ่ายเองด้วยมือถือ ไม่ต้องใช้ AI

| | |
|---|---|
| อุปกรณ์ | มือถือ + ผ้าไหมสีครีม + แผ่นหินอ่อน/จานเซรามิก + ยิปโซแห้ง |
| แสง | หน้าต่างบ่าย 3-4 โมง ผ้าม่านบางกรอง **ห้ามใช้แฟลช** |
| มุม | 45 องศา + มาโครชิดพลอย + มือสวมจริง |
| กฎ | ถ่ายแนวตั้ง 9:16 · ล็อกโฟกัส · ถ่าย 3 เทคทุกช็อต |

---

# STORYBOARD B — เงินแท่ง (กลุ่ม A+B ที่คุยเรื่องราคาได้)

**ความยาว 12 วินาที · 4 ช็อต · เป้าหมาย: ความน่าเชื่อถือ ไม่ใช่ความสวย**

เงินแท่งขายด้วย *ของจริง ชั่งได้ ตรวจได้ ขายคืนได้* ไม่ใช่ความหรู — สไตล์จึงต้องต่างจาก Ganesha

| # | วิ | ภาพ | วิธีสร้าง |
|---|---|---|---|
| 1 | 0–3 | แท่งเงินเรียงซ้อนบนพื้นผิวเรียบ แสงกวาดผ่านผิวแท่ง | image-to-video จากรูปจริง |
| 2 | 3–6 | **มือวางแท่งลงตาชั่ง ตัวเลขขึ้น** | ถ่ายจริง (นี่คือช็อตที่ขายของ) |
| 3 | 6–9 | มาโครตราประทับบนแท่ง | image-to-video จากรูปจริง |
| 4 | 9–12 | **สแกน NFC ด้วยมือถือ ข้อมูลเด้งขึ้น** | ถ่ายจริง (จุดต่างที่คู่แข่งไม่มี) |

### PROMPT ช็อต 1

```
[ATTACH: real photo of stacked silver bars]

Animate this still. A single warm light sweeps slowly across the brushed
metal surface from left to right over 3 seconds, revealing the texture and
the stamped markings as it passes. Camera perfectly static. Bars must not
move, change count, or change markings. Photoreal, documentary feel, not
glamorous — this is about authenticity, not luxury.

STYLE: neutral cool-warm grey, matte dark wood or slate surface, single
soft key light, minimal props, honest and plain. Shallow depth of field.
9:16 vertical. No text, no logo, no price.

NEGATIVE: no gold tint, no sparkle, no CGI, no luxury clichés, no silk,
no flowers, no text, no watermark.
```

> ช็อต 2 กับ 4 **ห้ามให้ AI ทำ** — ค่าของมันอยู่ที่ "นี่คือของจริงที่ชั่งได้/สแกนได้" ถ้าเป็น AI มันหมดความหมายทันที

---

# STORYBOARD C — ช่วงเด็ดจากไลฟ์ (คลิปที่ CMO บอกให้ทำก่อน)

**ไม่ต้องใช้ AI สร้างภาพเลย** — ตัดจากฟุตเทจไลฟ์จริง AI ช่วยแค่ซับกับกราฟิก

| # | ส่วน | เนื้อหา |
|---|---|---|
| 1 | 0–2 วิ | จังหวะที่คนสั่งพรึ่บ (หา timestamp จากเวลาออเดอร์จริงในระบบ) |
| 2 | 2–10 วิ | ช่วงพูดที่ทำให้คนตัดสินใจ ตัดตรงๆ ไม่แต่ง |
| 3 | 10–12 วิ | การ์ดปิด "ไลฟ์ทุกคืน 2 ทุ่ม" |

**PROMPT สำหรับ AI ทำซับ** (ใช้ Whisper / CapCut auto-caption)
```
ถอดเสียงภาษาไทยจากคลิปนี้เป็นซับไตเติล
- แบ่งบรรทัดไม่เกิน 12 ตัวอักษรต่อบรรทัด สูงสุด 2 บรรทัด
- ห้ามใส่ตัวเลขราคาลงในซับ ถ้าในเสียงพูดถึงราคาให้เขียนว่า "ราคาตามหน้าไลฟ์"
- คงคำพูดเดิมทั้งหมด ห้ามเรียบเรียงใหม่
```

---

## ลำดับที่แนะนำให้ลงมือ

1. **ถ่ายรูปจริงก่อน** — ไม่มีรูปจริง = ทำ image-to-video ไม่ได้ = เหลือแค่ text-to-video ซึ่งห้ามใช้กับตัวสินค้า
2. เริ่มที่ **Storyboard C** (ช่วงเด็ดจากไลฟ์) เพราะไม่ต้องรออะไรเลย ฟุตเทจมีอยู่แล้ว 90 ชม.
3. **Storyboard B** เมื่อถ่ายรูปแท่งเงินได้
4. **Storyboard A** เมื่อตัวอย่างแหวน Ganesha มาถึง

## เครื่องมือที่ต้องใช้ (Claude ทำแทนไม่ได้)

| งาน | เครื่องมือ | Claude ทำได้ไหม |
|---|---|---|
| เขียน prompt / storyboard / บท | — | ✅ |
| สร้างภาพนิ่ง | Midjourney, Gemini, Firefly | ❌ |
| ภาพนิ่ง → วิดีโอ | Runway, Kling, Veo, Sora | ❌ |
| ตัดต่อ + ซับ | CapCut | ❌ |
| ตัดสินว่าสวยไหม จังหวะได้ไหม | คน | ❌ |
