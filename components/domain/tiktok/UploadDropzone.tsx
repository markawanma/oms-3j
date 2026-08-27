"use client";

import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";

/**
 * UploadDropzone — accessible per design §6: keyboard-focusable
 * (`role="button" tabIndex={0}`, Enter/Space opens the file picker, not
 * drag-only), drag state announced via `aria-live`. The hidden native
 * `<input type="file">` is what actually receives files whether dropped or
 * picked — drop just forwards the dropped files into the same handler.
 *
 * P1 is PDF-only (docs/3j-jewelry/analytics/design-label-upload.md §0 —
 * text-layer parsing, no OCR yet).
 */
export function UploadDropzone({ onFilesSelected }: { onFilesSelected: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [announce, setAnnounce] = useState("");

  const openPicker = () => inputRef.current?.click();

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="ลากไฟล์ใบปะหน้ามาวาง หรือกดเพื่อเลือกไฟล์"
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPicker();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
          setAnnounce("วางไฟล์เพื่ออัปโหลด");
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          setAnnounce("");
          // dataTransfer.files is a snapshot (not the live-cleared FileList
          // that <input> gives you), but convert to a plain array up front
          // anyway so both paths into onFilesSelected share the same type.
          const files = Array.from(e.dataTransfer.files);
          if (files.length > 0) onFilesSelected(files);
        }}
        className={`flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-5 py-8 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 ${
          dragging ? "border-primary-600 bg-primary-50" : "border-zinc-300 bg-white hover:border-primary-300"
        }`}
      >
        <UploadCloud className={`h-9 w-9 ${dragging ? "text-primary-600" : "text-primary-600"}`} aria-hidden="true" />
        <p className="text-sm font-bold text-zinc-900">ลากไฟล์ใบปะหน้ามาวางที่นี่</p>
        <p className="text-xs text-zinc-500">หรือกดเพื่อเลือกไฟล์ — อัปโหลดหลายไฟล์พร้อมกันได้</p>
        <p className="text-[0.7rem] text-zinc-400">รองรับ PDF เท่านั้น · สูงสุด 20MB ต่อไฟล์</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf"
        className="sr-only"
        onChange={(e) => {
          // ⚠️ ต้อง Array.from() ก่อน e.target.value = "" เสมอ — input.files
          // คืน live FileList ตัวเดิมทุกครั้ง การล้าง value จะล้าง FileList
          // ตัวนั้นทิ้งไปด้วย (pattern เดียวกับ OrderImportClient.tsx —
          // ถ้าอ่าน e.target.files ทีหลังจาก clear แล้วจะได้ length 0 เสมอ
          // แล้ว handler จะ return ออกเงียบๆ = เลือกไฟล์แล้วไม่มีอะไรเกิดขึ้น)
          const files = Array.from(e.target.files ?? []);
          e.target.value = ""; // ให้เลือกไฟล์ชื่อเดิมซ้ำได้
          if (files.length > 0) onFilesSelected(files);
        }}
      />
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  );
}
