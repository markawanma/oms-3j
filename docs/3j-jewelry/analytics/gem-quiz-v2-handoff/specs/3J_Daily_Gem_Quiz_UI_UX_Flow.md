# 3J JEWELRY --- DAILY GEM QUIZ

## UI / UX Flow Specification for Designer

> **Project Goal:** สร้าง Quiz สั้น ๆ สำหรับช่วยลูกค้าเลือก "วันนี้ควรใส่พลอยอะไร"
> โดยนำข้อมูลวันเกิด + เป้าหมายของวันนี้ + ความรู้สึก + ความชอบพลอย +
> รูปแบบเครื่องประดับ มาประกอบกับระบบคำนวณด้านโหราศาสตร์/ความเชื่อ
> เพื่อสร้างคำแนะนำแบบ Personalized
>
> **Core Feeling:** Luxury / Minimal / Trustworthy / Personal / Easy to
> use
>
> **Important:** Quiz ต้องรู้สึกเหมือน "Personal Jewelry Experience"
> มากกว่าแบบสอบถามทั่วไป

------------------------------------------------------------------------

# 1. BRAND & VISUAL DIRECTION

### Brand

**3J JEWELRY**

### Main Color

-   Primary Burgundy / Deep Red: `#8F1015` หรือใกล้เคียงสี Logo
-   Dark Burgundy: `#650A0D`
-   White: `#FFFFFF`
-   Warm Ivory: `#FAF8F4`
-   Text: `#292929`
-   Secondary Text: `#777777`
-   Border: `#E5E1DC`

### Visual Style

-   Minimal Luxury
-   White space เยอะ
-   เส้นบาง
-   Border radius ประมาณ 12--18 px
-   Burgundy ใช้เฉพาะจุดสำคัญ เช่น CTA / Progress / Highlight
-   ไม่ใช้สีแดงเยอะจนดูเป็น E-commerce discount page
-   ภาพพลอยควรดูสะอาด มีแสงแบบ Jewelry Product Photography
-   ใช้ Serif สำหรับ Heading / Gem Name ที่ต้องการความ Luxury
-   ใช้ Sans-serif สำหรับคำอธิบายและ UI

### Logo

ใช้ Logo **3J + JEWELRY** ตามไฟล์ต้นฉบับเท่านั้น

**ห้าม** - เปลี่ยนสัดส่วน - เปลี่ยนรูปทรง - เปลี่ยน Typography - ใส่ Effect หนัก -
Stretch Logo

------------------------------------------------------------------------

# 2. OVERALL USER FLOW

``` text
START
  ↓
Landing / Intro
  ↓
Q1 — วันเกิด
  ↓
Q2 — วันนี้อยากเสริมเรื่องอะไร?
  ↓
Q3 — วันนี้รู้สึกอย่างไร?
  ↓
Q4 — ชอบพลอยอะไร?
  ↓
Q5 — วันนี้อยากใส่เครื่องประดับแบบไหน?
  ↓
CALCULATE
  ↓
Your Gem for Today
  ↓
Why This Gem?
  ↓
Gem Pairing
  ↓
Alternative Gems
  ↓
How to Wear
  ↓
Recommended Products
  ↓
Disclaimer
```

### จำนวนคำถาม

**5 Questions**

เป้าหมายคือให้ลูกค้าทำจบภายในประมาณ **30--60 วินาที**

------------------------------------------------------------------------

# 3. SCREEN 00 --- LANDING PAGE

## Purpose

ทำให้ลูกค้าเข้าใจทันทีว่า Quiz นี้ทำอะไร และอยากกดเริ่ม

### Content

**3J JEWELRY**

# DAILY GEM QUIZ

### วันนี้คุณควรใส่พลอยอะไร?

ค้นหาพลอยที่เหมาะกับคุณสำหรับวันนี้\
จากวันเกิด เป้าหมาย ความรู้สึก และสไตล์ที่คุณชอบ

### CTA

**เริ่มทำแบบทดสอบ →**

### Visual

-   Background: White / Warm Ivory
-   ใช้ภาพพลอย 2--3 เม็ดเป็น Hero Image
-   ไม่ต้องมีข้อมูลเยอะ
-   Logo อยู่ด้านบน
-   CTA Burgundy เต็มความกว้างบน Mobile

------------------------------------------------------------------------

# 4. GLOBAL QUIZ HEADER

ทุกหน้าของ Quiz ใช้ Header Pattern เดียวกัน

``` text
←                         01 / 05

          3J JEWELRY

━━━━━━━━━━━░░░░
```

### Elements

**Back** - ลูกศร ← - กดกลับไปคำถามก่อนหน้าได้

**Progress** - `01 / 05` - `02 / 05` - etc.

**Progress Bar** - Burgundy = Completed - Light Gray = Remaining

### Important

Progress ต้องเห็นชัด แต่ไม่ใหญ่จนแย่งความสนใจจากคำถาม

------------------------------------------------------------------------

# 5. QUESTION 01 --- BIRTH DAY

## Question

### คุณเกิดวันอะไร?

**เลือกวันเกิดของคุณ**

### Options

-   ☀️ อาทิตย์
-   🌙 จันทร์
-   🔥 อังคาร
-   🍃 พุธ
-   ✦ พฤหัสบดี
-   ♡ ศุกร์
-   ◌ เสาร์

### UI

แนะนำเป็น Vertical List Card

``` text
┌──────────────────────────┐
│ ☀  อาทิตย์            › │
└──────────────────────────┘

┌──────────────────────────┐
│ ☾  จันทร์              › │
└──────────────────────────┘
```

### Interaction

เมื่อเลือก: - Card เปลี่ยน Border เป็น Burgundy - Background เปลี่ยนเป็น Burgundy
แบบ Very Light - Icon / Text เปลี่ยน Burgundy - สามารถ Auto Next ได้ หรือมีปุ่ม
`ถัดไป`

### Data

เก็บค่า:

``` text
birth_day = sunday / monday / ...
```

------------------------------------------------------------------------

# 6. QUESTION 02 --- TODAY'S GOAL

## Question

### วันนี้คุณอยากเสริมเรื่องอะไรเป็นพิเศษ?

**เลือก 1 สิ่งที่คุณอยากโฟกัสที่สุดในวันนี้**

### Options

1.  ❤️ ความรัก & เสน่ห์
2.  💰 การเงิน & โชคลาภ
3.  📈 งาน & ความสำเร็จ
4.  ✦ ความมั่นใจ & พลังใจ
5.  🛡 การปกป้อง & ความสงบ
6.  ✧ โอกาสใหม่ & การเปลี่ยนแปลง

### UI

Grid 2 Columns

Card ประกอบด้วย:

``` text
[ ICON ]

ความรัก
& เสน่ห์
```

### Interaction

เลือกได้ **1 ตัวเลือก**

### Data

``` text
daily_goal =
love
wealth
career
confidence
protection
opportunity
```

------------------------------------------------------------------------

# 7. QUESTION 03 --- TODAY'S FEELING

## Question

### วันนี้คุณรู้สึกอย่างไร?

**เลือกสิ่งที่ใกล้เคียงกับคุณที่สุด**

### Options

1.  🍃 อยากสงบ / สมดุล
2.  ✦ อยากมีพลัง / มั่นใจ
3.  ♡ อยากเปิดรับความรัก
4.  ✧ อยากดึงดูดโอกาส
5.  🔥 อยากลุย / เอาชนะความท้าทาย
6.  ☾ อยากปกป้องตัวเอง / ลดพลังลบ

### Purpose

คำถามนี้ทำให้ Recommendation เป็น "Today-based" มากขึ้น
ไม่ใช่คำนวณจากวันเกิดอย่างเดียว

### Data

``` text
today_feeling =
calm
power
love
opportunity
challenge
protection
```

------------------------------------------------------------------------

# 8. QUESTION 04 --- FAVORITE GEMSTONES

## Question

### คุณชอบพลอยโทนสีไหน?

**เลือกได้สูงสุด 3 ตัว --- เลือกตามใจชอบ ไม่มีคำตอบที่ถูกหรือผิด**

### IMPORTANT UX

สามารถเลือกได้ **สูงสุด 3 พลอย**

เมื่อเลือกครบ 3: - ตัวเลือกอื่นยังแสดงอยู่ - แต่ไม่สามารถเลือกเพิ่มได้ -
สามารถกดยกเลิกตัวที่เลือก แล้วเลือกตัวใหม่ได้

### Recommended Gem Options

ควรมีประมาณ **15--18 ตัวเลือก**

#### Red / Pink

-   ทับทิม
-   โกเมน
-   Rhodolite Garnet
-   Morganite

#### Purple

-   Amethyst
-   Kunzite
-   Iolite

#### Blue

-   Sapphire
-   Iolite
-   Blue Topaz
-   Kyanite

#### Green

-   Emerald
-   Peridot
-   Tourmaline

#### Yellow / Gold

-   Citrine
-   Yellow Sapphire

#### White / Clear

-   White Topaz
-   Moonstone
-   Diamond / CZ (ถ้าต้องการใช้เป็น category)

#### Black

-   Black Spinel
-   Onyx

#### Special

-   Opal
-   Labradorite

### UI

ใช้ Gem Card ที่มี: - ภาพพลอย - Color Dot - ชื่อพลอย - สี / Mood สั้น ๆ

ตัวอย่าง:

``` text
┌─────────────────────┐
│     [ GEM IMAGE ]   │
│                     │
│ ● Amethyst          │
│   ม่วง              │
└─────────────────────┘
```

### Selected State

``` text
┌─────────────────────┐
│  ✓ [ GEM IMAGE ]    │
│                     │
│ ● Amethyst          │
└─────────────────────┘
```

Border = Burgundy

### Data

``` text
favorite_gems = [
  gem_01,
  gem_02,
  gem_03
]
```

------------------------------------------------------------------------

# 9. QUESTION 05 --- JEWELRY TYPE

## Question

### วันนี้คุณอยากใส่แบบไหน?

**เลือกประเภทเครื่องประดับที่คุณชอบ**

### Options

-   💍 แหวน
-   ✨ ต่างหู
-   📿 สร้อย / จี้
-   ◇ กำไล
-   ✦ ยังไม่แน่ใจ --- แนะนำให้ฉัน

### Purpose

คำถามนี้มีประโยชน์ 2 ส่วน:

1.  ใช้ Personalize คำแนะนำ
2.  ใช้เชื่อมต่อไปยัง Product Recommendation ของ 3J Jewelry

### Data

``` text
jewelry_type =
ring
earring
necklace
bracelet
unknown
```

------------------------------------------------------------------------

# 10. CALCULATING SCREEN

หลัง Q5 ให้มีช่วง Loading สั้น ๆ

## Text

### กำลังค้นหาพลอยที่เหมาะกับคุณ...

วิเคราะห์จาก

-   วันเกิด
-   พลังที่คุณต้องการวันนี้
-   ความรู้สึกของคุณ
-   พลอยที่คุณชอบ
-   สไตล์เครื่องประดับของคุณ

### Animation

ใช้: - Gemstone sparkle - เส้นวงกลมบาง ๆ - Logo 3J - Subtle loading
animation

**ไม่ควรเกิน 1--2 วินาที**

------------------------------------------------------------------------

# 11. RESULT --- YOUR GEM FOR TODAY

นี่คือ **Hero Screen ของระบบ**

## Header

### YOUR GEM

### FOR TODAY

**พลอยประจำวันของคุณ**

### Main Gem

``` text
[ LARGE GEM IMAGE ]

GARNET
โกเมน
```

### Key Message

**พลังใจ · ความมั่นใจ · ความรัก · ความสำเร็จ**

### Explanation

วันนี้คุณต้องการพลังด้าน **งาน & ความสำเร็จ**\
และเลือกโทนสี **แดง / ชมพู**

จากข้อมูลของคุณ ระบบจึงแนะนำ **Garnet** เป็นพลอยหลักสำหรับวันนี้

### CTA

**ดูคำแนะนำของฉัน ↓**

------------------------------------------------------------------------

# 12. WHY THIS GEM?

## Title

### ทำไมถึงเหมาะกับคุณวันนี้?

แสดงข้อมูลที่ระบบใช้คำนวณแบบเข้าใจง่าย

``` text
วันเกิดของคุณ
☀️ วันอาทิตย์

เป้าหมายวันนี้
✦ งาน & ความสำเร็จ

พลังที่คุณต้องการ
🔥 อยากมีพลัง / มั่นใจ

สีที่คุณชอบ
● แดง / ชมพู

สไตล์ที่คุณเลือก
💍 แหวน
```

จากนั้นสรุป:

### Recommendation

**Garnet**

เหมาะกับโจทย์ของคุณวันนี้ เพราะให้ภาพลักษณ์และความหมายที่เชื่อมโยงกับพลัง ความมั่นใจ
และความมุ่งมั่น

------------------------------------------------------------------------

# 13. GEM PAIRING

## Title

### TRY THIS COMBINATION

แนะนำพลอยหลัก + พลอยคู่

ตัวอย่าง:

``` text
[GARNET]  +  [ROSE QUARTZ]

โกเมน        โรสควอตซ์
```

### Description

**เสริมพลัง + ความรัก**

หรือ

**ความมั่นใจ + ความนุ่มนวล**

### Purpose

ลูกค้าไม่ได้แค่รู้ว่า "ควรใส่อะไร" แต่รู้ต่อว่า:

> "ถ้าจะใส่ 2 พลอย ควรจับคู่กับอะไร?"

------------------------------------------------------------------------

# 14. ALTERNATIVE GEMS

## Title

### ทางเลือกอื่นสำหรับคุณ

ถ้าลูกค้าไม่ชอบพลอยหลัก ให้ระบบแนะนำอีก 2--3 ตัว

ตัวอย่าง:

### 01 --- Amethyst

เสริมสมาธิ · ความสงบ · สมดุล

### 02 --- Rhodolite Garnet

เสริมเสน่ห์ · ความสัมพันธ์ · ความมั่นใจ

### 03 --- Ruby

เสริมพลัง · ความสำเร็จ · ความมุ่งมั่น

### UI

ใช้ Horizontal / Vertical Product Card

แต่ละ Card มี: - Gem Image - Gem Name - Short benefit - Arrow `→`

------------------------------------------------------------------------

# 15. HOW TO WEAR

## Title

### วิธีการใส่เพื่อเสริมพลัง

คำแนะนำควรเป็นภาษาง่าย ๆ ไม่ควรเขียนเหมือนข้อกำหนดตายตัว

ตัวอย่าง:

### 💍 ใส่เป็นแหวน

เหมาะสำหรับวันที่ต้องการพกพลังของพลอยไว้กับตัวตลอดวัน

### ✦ ใส่คู่กับเงิน 925

ช่วยให้ภาพรวมของเครื่องประดับดูเรียบหรู และทำให้พลอยเป็นจุดเด่น

### ☾ Pair with Rose Quartz

เหมาะสำหรับวันที่ต้องการเน้นเรื่องความรักและเสน่ห์

> **หมายเหตุ:** คำแนะนำเหล่านี้เป็นแนวทางตามความเชื่อและสไตล์การสวมใส่

------------------------------------------------------------------------

# 16. PRODUCT RECOMMENDATION

หลังจาก Personal Recommendation ให้เชื่อมกับสินค้าของ 3J

## Title

### JEWELRY FOR YOUR TODAY

แนะนำสินค้า 2--4 ชิ้นที่ตรงกับ:

``` text
Recommended Gem
+
Jewelry Type
+
Customer Preference
```

ตัวอย่าง:

``` text
[ PRODUCT IMAGE ]

Garnet Ring
แหวนโกเมน

฿X,XXX

ดูรายละเอียด →
```

### Important

อย่าให้หน้าผลลัพธ์รู้สึกเหมือน "โดนขายของทันที"

ลำดับต้องเป็น:

``` text
Insight
↓
Gem Recommendation
↓
Why
↓
Pairing
↓
How to Wear
↓
Product
```

------------------------------------------------------------------------

# 17. FINAL DISCLAIMER

วางด้านล่างสุดของ Result Page

ใช้ Font เล็กประมาณ 11--12px

สี `#888888`

### Disclaimer

> **Disclaimer:**
> ผลลัพธ์นี้จัดทำขึ้นเพื่อความเชื่อส่วนบุคคลและใช้เป็นแนวทางในการเลือกเครื่องประดับเพื่อเสริมความมั่นใจเท่านั้น
> ไม่สามารถรับประกันผลลัพธ์หรือการเปลี่ยนแปลงที่เกิดขึ้นจริงได้

ไม่ควรใช้คำว่า: - รับประกัน - รักษา - ป้องกันโรค - เปลี่ยนดวงแน่นอน -
ทำให้รวยแน่นอน - ทำให้ความรักสมหวังแน่นอน

------------------------------------------------------------------------

# 18. RECOMMENDATION LOGIC --- สำหรับ Developer / System

ระบบควรใช้ **Weighted Recommendation** ไม่ใช่ Mapping แบบ 1:1

ตัวอย่าง:

``` text
Birth Day             30%
Today's Goal          30%
Today's Feeling       20%
Favorite Gem          10%
Jewelry Type          10%
```

จากนั้นคำนวณ Gem Score

ตัวอย่าง:

``` text
GARNET       92
AMETHYST     84
RUBY         78
ROSE QUARTZ  72
```

ระบบเลือก Gem ที่คะแนนสูงสุดเป็น:

``` text
TODAY'S GEM
```

และเลือกอันดับ 2--3 เป็น:

``` text
ALTERNATIVE GEMS
```

------------------------------------------------------------------------

# 19. IMPORTANT --- FAVORITE GEM SHOULD NOT OVERRIDE THE RESULT

ความชอบของลูกค้าไม่ควรเป็นตัวตัดสินทั้งหมด

ตัวอย่าง:

ลูกค้าชอบ:

``` text
Amethyst
```

แต่ Algorithm คำนวณว่า:

``` text
Garnet = 92
Amethyst = 84
```

ผลลัพธ์ควรเป็น:

### Today's Gem

**Garnet**

และเขียนว่า:

> "คุณชอบ Amethyst เป็นพิเศษ และวันนี้ Amethyst
> ก็เป็นหนึ่งในตัวเลือกที่เหมาะกับคุณเช่นกัน"

แบบนี้จะทำให้ Recommendation รู้สึกฉลาดกว่า
และไม่ทำให้ลูกค้ารู้สึกว่าคำตอบของตัวเองถูกละเลย

------------------------------------------------------------------------

# 20. RESPONSIVE DESIGN

## Mobile First

Target: - 390 × 844 - 375 × 812 - 430 × 932

### Desktop

ถ้าเปิดบน Desktop: - Quiz Card อยู่ตรงกลาง - Max width ประมาณ 500--600px -
Background รอบนอกเป็น Warm Ivory - Main Quiz Card เป็น White

### Gem Selection

Mobile: - 2 หรือ 3 Columns ตามขนาดหน้าจอ

Desktop: - 3--4 Columns

------------------------------------------------------------------------

# 21. MICRO INTERACTION

ควรมี Animation เล็ก ๆ เพื่อให้ระบบดู Premium

### Button

Hover: - Burgundy → Dark Burgundy - Transition 150--200ms

### Selection

เมื่อเลือก: - Border fade-in - Check icon - Scale ประมาณ 1.01

### Result

Gem Image: - Fade + slight scale - Sparkle แบบ subtle

### Page Transition

ใช้: - Fade - Slide up เล็กน้อย

**หลีกเลี่ยง Animation ที่เยอะหรือดูเหมือน Game**

------------------------------------------------------------------------

# 22. UX PRINCIPLES

### Rule 01

ลูกค้าต้องรู้ว่าตัวเองอยู่ Step ไหนเสมอ

### Rule 02

หนึ่งหน้ามีหนึ่งคำถามหลัก

### Rule 03

ไม่ใช้ข้อความยาวก่อนให้ลูกค้าเลือก

### Rule 04

ตัวเลือกต้องกดง่ายบน Mobile

### Rule 05

Result ต้องมี "เหตุผล" ไม่ใช่แค่ชื่อพลอย

### Rule 06

ต้องมี Alternative เพราะลูกค้าอาจไม่ชอบ Gem ที่ระบบเลือก

### Rule 07

Product Recommendation ต้องอยู่หลัง Insight

### Rule 08

Disclaimer ต้องเห็นได้ แต่ไม่รบกวน Experience

------------------------------------------------------------------------

# 23. COMPLETE FLOW --- QUICK REFERENCE

``` text
01
คุณเกิดวันอะไร?
↓
Birth Day

02
วันนี้คุณอยากเสริมเรื่องอะไร?
↓
Goal

03
วันนี้คุณรู้สึกอย่างไร?
↓
Feeling

04
คุณชอบพลอยโทนสีไหน?
↓
Favorite Gems — MAX 3

05
วันนี้คุณอยากใส่แบบไหน?
↓
Jewelry Type

LOADING
↓
Analyze

RESULT
↓
YOUR GEM FOR TODAY
↓
Why This Gem?
↓
Try This Combination
↓
Alternative Gems
↓
How to Wear
↓
Recommended 3J Jewelry
↓
Disclaimer
```

------------------------------------------------------------------------

# 24. DESIGNER HANDOFF --- สิ่งที่ต้องออกแบบ

Designer ควรส่งมอบอย่างน้อย:

### Core Screens

-   [ ] Landing
-   [ ] Q1 Birth Day
-   [ ] Q2 Goal
-   [ ] Q3 Feeling
-   [ ] Q4 Favorite Gems
-   [ ] Q5 Jewelry Type
-   [ ] Loading
-   [ ] Result Hero
-   [ ] Why This Gem
-   [ ] Gem Pairing
-   [ ] Alternative Gems
-   [ ] How to Wear
-   [ ] Product Recommendation
-   [ ] Disclaimer

### States

-   [ ] Default
-   [ ] Hover
-   [ ] Selected
-   [ ] Disabled
-   [ ] Maximum Selection Reached
-   [ ] Loading
-   [ ] Result

### Responsive

-   [ ] Mobile
-   [ ] Tablet
-   [ ] Desktop

------------------------------------------------------------------------

# 25. FINAL DESIGN DIRECTION

ภาพรวมต้องให้ความรู้สึกว่า:

> **"3J กำลังช่วยฉันเลือกเครื่องประดับสำหรับวันนี้"**

ไม่ใช่:

> "ฉันกำลังทำแบบสอบถามออนไลน์"

และไม่ควรให้ความรู้สึกเป็นเว็บไซต์สายมูแบบเข้มข้นเกินไป

ให้ Positioning อยู่ตรงกลางระหว่าง:

**Jewelry × Personalization × Astrology × Modern Luxury**

โดยมี **3J JEWELRY** เป็นแบรนด์หลัก และ Quiz เป็น Experience
ที่ทำให้ลูกค้ารู้สึกว่าเครื่องประดับชิ้นนั้น "ถูกเลือกมาให้ฉัน"
