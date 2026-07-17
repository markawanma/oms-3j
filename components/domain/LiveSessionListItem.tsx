import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { formatBangkokTime } from "@/lib/format";
import type { LiveSession } from "@/lib/types";

export function LiveSessionListItem({ session }: { session: LiveSession }) {
  const isOpen = session.status === "open";
  return (
    <Link
      href={`/live/${session.id}`}
      className="block rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-primary-300 focus-visible:border-primary-600"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-slate-900">{session.title || "ไลฟ์ไม่มีชื่อ"}</span>
        <Badge tone={isOpen ? "green" : "slate"}>{isOpen ? "กำลังไลฟ์" : "ปิดแล้ว"}</Badge>
      </div>
      <div className="mt-1 text-xs text-slate-400">
        เริ่ม {formatBangkokTime(session.startedAt)}
        {session.endedAt && ` · จบ ${formatBangkokTime(session.endedAt)}`}
      </div>
    </Link>
  );
}
