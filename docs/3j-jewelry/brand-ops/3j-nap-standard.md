# 3J Jewelry — NAP มาตรฐาน + Checklist (Local SEO)

> NAP = Name / Address / Phone · ต้องเขียน**เหมือนกันเป๊ะทุกที่** (Google เจอข้อมูลขัดกัน = อันดับตก + ลูกค้าสับสน)

## 📇 NAP มาตรฐาน (copy บล็อกนี้ไปวางทุกแพลตฟอร์ม)

```
3J Jewelry
112, 203 ถนนเอกชัย (ระหว่างซอย 25/1 และ 27) แขวงบางขุนเทียน เขตจอมทอง กรุงเทพฯ 10150
โทร: 02 893 2350
LINE: @3jsilver
เว็บหลัก: 3jthailand.com  ·  เว็บรอง: 3jsilver.com
เวลาทำการ: 09:00–20:00 น. (ทุกวัน)
Google Map: https://maps.app.goo.gl/BPwDXR7jmwg71aZB9
```

## ✅ Checklist — ทำให้ตรงกัน 7 จุด

| # | ที่ | ต้องแก้ให้เป็น |
|---|---|---|
| 1 | **Google Business Profile** | ชื่อ "3J Jewelry" · หมวดหลัก **"ร้านเครื่องประดับ"** + รอง "ผู้ผลิตเครื่องประดับ" · เว็บ 3jthailand.com · เวลา 09:00–20:00 · เพิ่มรูปสินค้า/หน้าร้าน · ใส่ LINE ในคำอธิบาย |
| 2 | **3jthailand.com** (หลัก) | NAP ใน footer + ฝัง Google Map + ปุ่ม LINE + เบอร์ (ใช้ snippet ด้านล่าง) |
| 3 | **3jsilver.com** (รอง) | footer NAP เหมือนกัน + ลิงก์ไปเว็บหลัก + Map + LINE |
| 4 | **LINE OA @3jsilver** | ชื่อแสดง "3J Jewelry" + ที่อยู่/เบอร์/เวลา ในข้อมูลบัญชี |
| 5 | **TikTok @3jjewelry** | bio: ชื่อ + link (3jthailand.com / LINE) |
| 6 | **Shopee** | ชื่อร้าน/ข้อมูลตรงกัน + ลิงก์ |
| 7 | **Facebook** (ถ้ามี) | NAP ตรงกัน |

## 🔗 เชื่อมกัน (cross-link)
- **2 เว็บ** → footer ใส่ Google Map + LINE + เบอร์ + ลิงก์หากัน
- **Google Profile** → เว็บหลัก 3jthailand.com · ใส่ LINE + 3jsilver ในคำอธิบาย
- **TikTok / Shopee bio** → ลิงก์ไป 3jthailand.com + LINE @3jsilver

---

## 🧩 Footer NAP block (HTML) — วางในทั้ง 2 เว็บได้เลย

โทน 3J (แดง #A2191D / เทา / ขาว) · inline style ใช้ได้ทุกเว็บไม่ต้องแก้ CSS:

```html
<!-- 3J Jewelry — Footer NAP block -->
<div style="font-family:'Helvetica Neue',Arial,sans-serif;background:#F0F0F0;color:#343434;padding:28px 20px;border-top:3px solid #A2191D;">
  <div style="max-width:1000px;margin:0 auto;display:flex;flex-wrap:wrap;gap:24px;justify-content:space-between;align-items:flex-start;">
    <div style="min-width:240px;">
      <div style="font-size:20px;font-weight:700;color:#343434;">3<span style="color:#A2191D;">J</span> Jewelry</div>
      <p style="margin:10px 0 0;line-height:1.6;font-size:14px;color:#4A4A4A;">
        112, 203 ถนนเอกชัย (ระหว่างซอย 25/1 และ 27)<br>
        แขวงบางขุนเทียน เขตจอมทอง กรุงเทพฯ 10150
      </p>
    </div>
    <div style="min-width:210px;font-size:14px;line-height:2;color:#4A4A4A;">
      <div>โทร: <a href="tel:028932350" style="color:#A2191D;text-decoration:none;font-weight:600;">02 893 2350</a></div>
      <div>LINE: <a href="https://line.me/R/ti/p/@3jsilver" style="color:#A2191D;text-decoration:none;font-weight:600;">@3jsilver</a></div>
      <div>เวลาทำการ: 09:00–20:00 น.</div>
      <div style="margin-top:6px;">
        <a href="https://3jthailand.com" style="color:#343434;text-decoration:none;">3jthailand.com</a> ·
        <a href="https://3jsilver.com" style="color:#343434;text-decoration:none;">3jsilver.com</a>
      </div>
    </div>
    <div style="min-width:160px;">
      <a href="https://maps.app.goo.gl/BPwDXR7jmwg71aZB9" target="_blank" rel="noopener"
         style="display:inline-block;background:#A2191D;color:#ffffff;font-weight:700;font-size:14px;text-decoration:none;padding:11px 22px;border-radius:8px;">
        ดูแผนที่ / เส้นทาง
      </a>
    </div>
  </div>
</div>
```

### อยากให้แผนที่โผล่ในหน้าเว็บเลย (ฝัง iframe)
1. เปิด Google Maps ร้าน → กด **แชร์ (Share)** → แท็บ **"ฝังแผนที่ (Embed a map)"**
2. Copy โค้ด `<iframe ...>` → วางแทนปุ่ม "ดูแผนที่" ด้านบน (หรือเพิ่มใต้ footer)
