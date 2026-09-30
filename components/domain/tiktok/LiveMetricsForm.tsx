"use client";

// LiveMetricsForm — /tiktok/live-log's two independent forms (Tech Lead
// brief 30 ก.ย. 69): §1 คนดูพีคไลฟ์ (แสดงทุกครั้ง, ~10 วินาที/คืน) and §2
// เพื่อน LINE (ยุบใน <details>, กรอกแค่สัปดาห์ละครั้ง). Mobile-first เข้มมาก
// ตามบรีฟ — โทน/ความหนาแน่นของ input ลอกจาก ContentPostLinkForm.tsx
// (min-h-11 ทุก input/button, label เล็ก text-xs, card border+shadow-sm เบาๆ).
//
// 🔴 ทุกด่านจริง (ปฏิเสธติดลบ/อนาคต/เวลาสลับกัน) อยู่ที่ RPC ทั้งคู่
// (analytics.live_session_upsert 0121, analytics.channel_follower_upsert
// 0153) — validation ในไฟล์นี้เป็นแค่ UX (กันกดบันทึกทั้งที่ยังไม่กรอก) ไม่ใช่
// ด่านที่พึ่งพาได้ ตามกฎ "ห้าม validate เลขที่มีผลจริงที่ client".

import { useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  getLiveSessionForDate,
  upsertChannelFollowerCount,
  upsertLiveSession,
  type LiveSessionRow,
} from "@/lib/actions/live-metrics";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

// ไลฟ์ปกติ 20:00-23:00 (memory: live-selling-rhythm) — default ที่แก้ได้
// เพราะบางคืนไลฟ์ยาวเกินเที่ยงคืน (RPC เดิมรองรับ cross-midnight อยู่แล้ว).
const DEFAULT_START_TIME = "20:00";
const DEFAULT_END_TIME = "23:00";

/** timestamptz (UTC, ตามที่ DB เก็บ) -> "HH:MM" เวลาไทย สำหรับ input
 * type="time" — Bangkok ไม่มี DST เหมือน isoToBangkokInputValue ของ
 * ContentPostLinkForm.tsx (คนละ input type เลยแยกฟังก์ชัน ไม่ใช้ร่วมกัน). */
function isoToBangkokTime(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

const inputClass =
  "min-h-11 w-full rounded-md border border-zinc-300 px-3 text-sm focus:border-primary-500 focus:outline-none";
const labelClass = "mb-1 block text-xs font-medium text-zinc-600";
const existingNoticeClass = "rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-700";

export function LiveMetricsForm({
  todayTh,
  initialSession,
  initialFollowerCount,
}: {
  /** "YYYY-MM-DD" วันนี้ตามเขตเวลาไทย — คำนวณฝั่ง server (effectiveDateBangkok)
   * ไม่ใช่ client เพื่อไม่ให้ผูกกับนาฬิกา/เขตเวลาของเครื่องผู้ใช้ */
  todayTh: string;
  /** ค่าที่เคยกรอกของวันนี้ (ถ้ามี) — server component หน้า page.tsx fetch มา
   * ให้แล้วรอบแรกเพื่อไม่ต้อง round-trip ซ้ำตอน mount */
  initialSession: LiveSessionRow | null;
  initialFollowerCount: number | null;
}) {
  const toast = useToast();
  const router = useRouter();

  // ---- ส่วนที่ 1: คนดูพีคไลฟ์ --------------------------------------------
  const [liveDate, setLiveDate] = useState(todayTh);
  const [startTime, setStartTime] = useState(
    initialSession ? isoToBangkokTime(initialSession.startedAt) : DEFAULT_START_TIME
  );
  const [endTime, setEndTime] = useState(
    initialSession ? isoToBangkokTime(initialSession.endedAt) : DEFAULT_END_TIME
  );
  const [peakViewers, setPeakViewers] = useState(
    initialSession?.peakViewers != null ? String(initialSession.peakViewers) : ""
  );
  // เก็บ note เดิมไว้แบบไม่แสดงผล (ฟอร์มนี้ไม่มีช่องแก้หมายเหตุ) — ส่งกลับไป
  // พร้อม submit เสมอ กัน RPC (เป็น upsert เต็มแถว) เขียนทับ note เดิมเป็น
  // null เงียบๆ เวลาบันทึกซ้ำวันที่เคยมี note จากช่องทางอื่น (เช่น
  // Tech Lead เคยกรอกแทนผ่านแชท, source='owner_chat') — ตัดสินใจเพิ่มจาก
  // บรีฟ ดูคอมเมนต์ที่ lib/actions/live-metrics.ts's UpsertLiveSessionInput.note
  const [existingNote, setExistingNote] = useState<string | null>(initialSession?.note ?? null);
  const [hasExistingSession, setHasExistingSession] = useState(initialSession !== null);
  const [loadingDate, startLoadingDate] = useTransition();
  const [savingSession, startSavingSession] = useTransition();
  // วันที่ล่าสุดที่ pre-fill ไปแล้ว — กันยิง getLiveSessionForDate ซ้ำถ้าผู้ใช้
  // กดวันเดิม/blur ซ้ำโดยไม่ได้เปลี่ยนค่าจริง (แพทเทิร์นเดียวกับ
  // ContentPostLinkForm's lastInspectedUrlRef)
  const lastLoadedDateRef = useRef(todayTh);

  function handleDateChange(newDate: string) {
    setLiveDate(newDate);
    if (!newDate || newDate === lastLoadedDateRef.current) return;
    lastLoadedDateRef.current = newDate;
    startLoadingDate(async () => {
      let result: Awaited<ReturnType<typeof getLiveSessionForDate>>;
      try {
        result = await getLiveSessionForDate(newDate);
      } catch {
        // เน็ตหลุด/transport ล้ม — เหมือน ContentPostLinkForm's runInspect:
        // ห้ามพังทั้งหน้า ปล่อยให้ผู้ใช้กรอกเองต่อด้วยค่า default
        return;
      }
      if (result.ok && result.data) {
        setStartTime(isoToBangkokTime(result.data.startedAt));
        setEndTime(isoToBangkokTime(result.data.endedAt));
        setPeakViewers(result.data.peakViewers != null ? String(result.data.peakViewers) : "");
        setExistingNote(result.data.note);
        setHasExistingSession(true);
      } else {
        setStartTime(DEFAULT_START_TIME);
        setEndTime(DEFAULT_END_TIME);
        setPeakViewers("");
        setExistingNote(null);
        setHasExistingSession(false);
      }
    });
  }

  function handleSubmitSession(e: FormEvent) {
    e.preventDefault();
    const trimmedPeak = peakViewers.trim();
    const peak = Number(trimmedPeak);
    if (!trimmedPeak || Number.isNaN(peak)) {
      toast.push("กรุณากรอกจำนวนคนดูพีค", "error");
      return;
    }
    startSavingSession(async () => {
      const result = await upsertLiveSession({
        liveDate,
        startTime,
        endTime,
        peakViewers: peak,
        note: existingNote,
      });
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push("บันทึกคนดูพีคแล้ว");
      setHasExistingSession(true);
      router.refresh();
    });
  }

  // ---- ส่วนที่ 2: เพื่อน LINE (พับได้ ไม่บังคับกรอกทุกครั้ง) --------------
  const [followerCount, setFollowerCount] = useState(
    initialFollowerCount != null ? String(initialFollowerCount) : ""
  );
  const [hasExistingFollower, setHasExistingFollower] = useState(initialFollowerCount !== null);
  const [savingFollower, startSavingFollower] = useTransition();

  function handleSubmitFollower(e: FormEvent) {
    e.preventDefault();
    const trimmed = followerCount.trim();
    const count = Number(trimmed);
    if (!trimmed || Number.isNaN(count)) {
      toast.push("กรุณากรอกจำนวนเพื่อน LINE", "error");
      return;
    }
    startSavingFollower(async () => {
      const result = await upsertChannelFollowerCount({ asOfDate: todayTh, followerCount: count });
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push("บันทึกจำนวนเพื่อน LINE แล้ว");
      setHasExistingFollower(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* ---- ส่วนที่ 1 ---- */}
      <form
        onSubmit={handleSubmitSession}
        className="space-y-2.5 rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm"
      >
        <h2 className="text-sm font-bold text-zinc-900">คนดูพีคไลฟ์</h2>

        {hasExistingSession && !loadingDate && (
          <p className={existingNoticeClass}>
            วันนี้เคยกรอกไว้แล้ว — ค่าด้านล่างคือค่าที่เคยบันทึก แก้แล้วกดบันทึกจะทับของเดิม
          </p>
        )}

        <div>
          <label className={labelClass} htmlFor="lmf-date">
            วันที่ไลฟ์
          </label>
          <input
            id="lmf-date"
            type="date"
            value={liveDate}
            onChange={(e) => handleDateChange(e.target.value)}
            required
            className={inputClass}
          />
          {loadingDate && (
            <p className="mt-1 flex items-center gap-1 text-xs text-zinc-400">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              กำลังโหลดข้อมูลวันที่เลือก...
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <label className={labelClass} htmlFor="lmf-start">
              เวลาเริ่ม
            </label>
            <input
              id="lmf-start"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
              className={inputClass}
            />
          </div>
          <div className="flex-1">
            <label className={labelClass} htmlFor="lmf-end">
              เวลาเลิก
            </label>
            <input
              id="lmf-end"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              required
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="lmf-peak">
            คนดูพีค
          </label>
          <input
            id="lmf-peak"
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            value={peakViewers}
            onChange={(e) => setPeakViewers(e.target.value)}
            placeholder="เช่น 320"
            required
            className={inputClass}
          />
        </div>

        <Button type="submit" size="md" loading={savingSession} className="w-full">
          บันทึกคนดูพีค
        </Button>
      </form>

      {/* ---- ส่วนที่ 2 ---- */}
      <details className="rounded-lg border border-zinc-200 bg-white shadow-sm">
        <summary className="min-h-11 cursor-pointer select-none px-3.5 py-3 text-sm font-bold text-zinc-900">
          อัปเดตเพื่อน LINE รายสัปดาห์
        </summary>
        <form onSubmit={handleSubmitFollower} className="space-y-2.5 border-t border-zinc-200 p-3.5">
          {hasExistingFollower && (
            <p className={existingNoticeClass}>วันนี้เคยกรอกไว้แล้ว — บันทึกซ้ำจะทับค่าเดิม</p>
          )}
          <div>
            <label className={labelClass} htmlFor="lmf-follower">
              จำนวนเพื่อน LINE ปัจจุบัน
            </label>
            <input
              id="lmf-follower"
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              value={followerCount}
              onChange={(e) => setFollowerCount(e.target.value)}
              placeholder="เช่น 4200"
              required
              className={inputClass}
            />
          </div>
          <Button type="submit" size="md" loading={savingFollower} className="w-full">
            บันทึกจำนวนเพื่อน LINE
          </Button>
        </form>
      </details>
    </div>
  );
}
