"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Radio } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { LiveSessionListItem } from "./LiveSessionListItem";
import { startLiveSession, closeLiveSession } from "@/lib/actions/live";
import type { LiveSession } from "@/lib/types";

export function LivePageClient({
  initialOpenSession,
  initialSessions,
}: {
  initialOpenSession: LiveSession | null;
  initialSessions: LiveSession[];
}) {
  const [openSession, setOpenSession] = useState<LiveSession | null>(initialOpenSession);
  const [sessions, setSessions] = useState<LiveSession[]>(initialSessions);
  const [title, setTitle] = useState("");
  const [starting, setStarting] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();

  async function handleStart(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setStarting(true);
    const result = await startLiveSession({ title: title.trim() || undefined });
    setStarting(false);

    if (!result.ok) {
      setError(result.error);
      toast.push(result.error, "error");
      return;
    }

    toast.push("เริ่มไลฟ์แล้ว", "success");
    router.push(`/live/${result.data.id}`);
  }

  async function handleClose() {
    if (!openSession) return;
    setClosing(true);
    const result = await closeLiveSession(openSession.id);
    setClosing(false);

    if (!result.ok) {
      toast.push(result.error, "error");
      return;
    }

    toast.push("ปิดไลฟ์แล้ว", "success");
    setSessions((prev) =>
      prev.map((s) => (s.id === openSession.id ? { ...s, status: "closed", endedAt: new Date().toISOString() } : s))
    );
    setOpenSession(null);
    router.push(`/live/${openSession.id}/summary`);
  }

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}

      {openSession ? (
        <div className="flex flex-col gap-3 rounded-lg border border-green-200 bg-green-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Radio className="h-5 w-5 shrink-0 text-green-600" aria-hidden="true" />
            <div>
              <p className="font-medium text-green-900">กำลังไลฟ์อยู่: {openSession.title || "ไม่มีชื่อ"}</p>
              <p className="text-xs text-green-700">เริ่มตั้งแต่ {new Date(openSession.startedAt).toLocaleTimeString("th-TH")}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" onClick={() => router.push(`/live/${openSession.id}`)}>
              ไปหน้าจดออเดอร์
            </Button>
            <Button variant="danger" size="sm" loading={closing} onClick={handleClose}>
              ปิดไลฟ์
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleStart} className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
          <div>
            <label htmlFor="live-title" className="block text-sm font-medium text-zinc-700">
              ชื่อไลฟ์ (ไม่บังคับ)
            </label>
            <input
              id="live-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="เช่น ไลฟ์เย็นวันศุกร์"
              className="mt-1 min-h-11 w-full rounded-md border border-zinc-300 px-3 text-base"
            />
          </div>
          <Button type="submit" variant="primary" loading={starting} className="w-full">
            เริ่มไลฟ์
          </Button>
        </form>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-zinc-700">ไลฟ์ล่าสุด</h2>
        {sessions.length === 0 ? (
          <EmptyState icon={Radio} title="ยังไม่เคยเริ่มไลฟ์" description="กดปุ่ม 'เริ่มไลฟ์' ด้านบนเพื่อเริ่มจดออเดอร์" />
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => (
              <LiveSessionListItem key={s.id} session={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
