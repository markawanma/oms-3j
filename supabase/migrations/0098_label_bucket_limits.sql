-- 0098_label_bucket_limits.sql — security 2a High #1: ด่านชั้นนอกสุดของ bucket
-- เพดานขนาด + ชนิดไฟล์บังคับที่ตัว storage เอง ไม่ต้องพึ่งโค้ดแอปเลย
-- (0097 สร้าง bucket โดยไม่ตั้ง = ไม่จำกัดขนาด/ชนิด — PUT ผ่าน signed URL
-- ยัดไฟล์ 2GB ชนิดอะไรก็ได้)
update storage.buckets
   set file_size_limit    = 20971520,                  -- 20MB = MAX_LABEL_FILE_BYTES
       allowed_mime_types = array['application/pdf']
 where id = 'shipping-labels';
