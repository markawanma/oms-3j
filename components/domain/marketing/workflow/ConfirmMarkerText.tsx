// ConfirmMarkerText — แสดงข้อความที่มี marker [ต้องยืนยัน: …] แบบไฮไลต์ (พื้นอำพัน + กรอบ + ไอคอน "!" — ไม่พึ่งสีอย่างเดียว)
// ไม่ใช้ dangerouslySetInnerHTML (F12) — แยกช่วงข้อความด้วย splitConfirmMarkers แล้ว render เป็น React element ล้วน
// ตัวบล็อกอนุมัติจริงคือ DB (can_approve) — ที่นี่แสดงผลอย่างเดียว

import { AlertCircle } from "lucide-react";
import { splitConfirmMarkers } from "@/lib/marketing/confirm-marker";

export function ConfirmMarkerText({ text, className = "" }: { text: string | null | undefined; className?: string }) {
  const segments = splitConfirmMarkers(text);
  if (segments.length === 0) return null;
  return (
    <span className={`whitespace-pre-wrap break-words ${className}`}>
      {segments.map((s, i) => {
        if (s.kind === "confirm") {
          return (
            <mark
              key={i}
              className="mx-0.5 inline rounded-sm bg-amber-100 px-1 text-amber-900 ring-1 ring-amber-500 [box-decoration-break:clone]"
            >
              <AlertCircle className="mr-0.5 inline h-3.5 w-3.5 align-text-bottom" aria-hidden="true" />
              <span className="sr-only">ต้องยืนยัน: </span>
              {s.text}
            </mark>
          );
        }
        if (s.kind === "verify") {
          return (
            <mark key={i} className="mx-0.5 inline rounded-sm bg-zinc-100 px-1 text-zinc-800 ring-1 ring-zinc-400 ring-inset [box-decoration-break:clone]">
              {s.text}
            </mark>
          );
        }
        return <span key={i}>{s.text}</span>;
      })}
    </span>
  );
}
