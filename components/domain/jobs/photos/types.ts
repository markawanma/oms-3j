// รูปที่ชั้นแสดงผลล้วนรู้จัก — ทั้งออฟฟิศ (JobPhotoRow) และช่าง (WorkerPhoto) แปลงมาเป็นรูปนี้
// 🔴 ไม่มี path/ชื่อไฟล์/ผู้อัปโหลด/ชื่อลูกค้า — มีเฉพาะ signed URL (15 นาที) + สถานะที่ UI ต้องใช้
// โฟลเดอร์ components/domain/jobs/photos/ = ชั้นแสดงผลล้วน: ห้าม import "use server"/lib/actions/* (worker-boundary.test.ts ครอบคลุมโฟลเดอร์นี้)

export interface PhotoView {
  id: string;
  /** รูปย่อ (sm 480px) · null = เซ็นไม่สำเร็จ → แสดงสถานะ "โหลดรูปไม่ได้" */
  smUrl: string | null;
  /** รูปกลาง (md 1200px) · โหลดเมื่อเปิด viewer เท่านั้น */
  mdUrl: string | null;
  isPrimary: boolean;
  /** ป้าย "จากแคตตาล็อก" — ออฟฟิศเท่านั้น (ช่างไม่ส่ง) */
  fromCatalog?: boolean;
}

/** onRetryLoad: "error" = รูปเพิ่งโหลดล้ม (อัตโนมัติ — ผู้เรียก throttle เอง เพราะลิงก์หมดอายุ 15 นาที) · "tap" = ผู้ใช้แตะขอใหม่ */
export type RetryReason = "error" | "tap";
