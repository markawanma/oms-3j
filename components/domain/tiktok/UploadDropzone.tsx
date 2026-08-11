"use client";

import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";

/**
 * UploadDropzone — accessible per design §6: keyboard-focusable
 * (`role="button" tabIndex={0}`, Enter/Space opens the file picker, not
 * drag-only), drag state announced via `aria-live`. The hidden native
 * `<input type="file">` is what actually receives files whether dropped or
 * picked — drop just forwards `dataTransfer.files` into the same handler.
 */
export function UploadDropzone({ onFilesSelected }: { onFilesSelected: (files: FileList) => void }) {
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
          if (e.dataTransfer.files.length > 0) onFilesSelected(e.dataTransfer.files);
        }}
        className={`flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-5 py-8 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 ${
          dragging ? "border-primary-600 bg-primary-50" : "border-slate-300 bg-white hover:border-primary-400"
        }`}
      >
        <UploadCloud className={`h-9 w-9 ${dragging ? "text-primary-600" : "text-primary-500"}`} aria-hidden="true" />
        <p className="text-sm font-bold text-slate-900">ลากไฟล์ใบปะหน้ามาวางที่นี่</p>
        <p className="text-xs text-slate-500">หรือกดเพื่อเลือกไฟล์ — อัปโหลดหลายไฟล์พร้อมกันได้</p>
        <p className="text-[0.7rem] text-slate-400">รองรับ PDF / JPG / PNG · สูงสุด 20MB ต่อไฟล์</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png"
        className="sr-only"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) onFilesSelected(e.target.files);
          e.target.value = ""; // allow re-selecting the same file name again
        }}
      />
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  );
}
