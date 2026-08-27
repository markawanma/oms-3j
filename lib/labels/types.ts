// lib/labels/types.ts — shared contract between the label-upload backend
// (lib/actions/labels.ts, lib/labels/*) and the UI (Luke/frontend-dev).
//
// ⚠️ This is the seam the frontend builds against — do NOT rename fields or
// change shapes here without checking with Tech Lead first (per brief).
//
// Plain module — no "use server" here (only lib/actions/labels.ts has that
// directive; a "use server" file may only export async functions, and these
// are types/consts, see lesson in supabase/migrations comment history /
// 0ae940d "แก้ build ล้ม — export const ในไฟล์ use server").

export type LabelParseSummary = {
  fileId: string;
  fileName: string;
  pageCount: number;
  applied: number; // เติมจังหวัดสำเร็จ
  skippedHasProvince: number; // ออเดอร์มีจังหวัดตรงกันอยู่แล้ว
  conflictCount: number; // ใบบอกจังหวัดอื่นที่ไม่ตรงของเดิม
  needsReview: number; // จับคู่ไม่ชี้ขาด รอคนเลือก
  orderNotFound: number; // tracking ไม่เจอออเดอร์
  undetectedFormat: number; // ไม่รู้ว่าใบเจ้าไหน
  parseFailedPages: number; // หน้าอ่านไม่ออก (เช่นไม่มี text layer)
  reviewRows: LabelReviewRow[];
};

export type LabelReviewRow = {
  pageId: string;
  pageNo: number;
  trackingNo: string | null;
  zipcode: string | null;
  status: "needs_review" | "conflict" | "order_not_found" | "undetected" | "parse_failed";
  candidates: { code: string; nameTh: string }[];
};

export type CreateLabelUploadResult = {
  fileId: string;
  uploadUrl: string | null; // null = ไฟล์นี้เคยอัปแล้ว (dedupe) ข้ามไป parse ได้เลย
  alreadyExists: boolean;
};

// รายการไฟล์ในประวัติ (getLabelFiles) — รูปทรงตรงกับ LabelFileRow ฝั่ง action
// (pageCount เป็น null ได้ก่อน parse เสร็จ)
export type LabelFileListItem = {
  id: string;
  fileName: string;
  pageCount: number | null;
  status: "uploaded" | "parsed" | "parse_failed" | "purged";
  uploadedAt: string;
};
