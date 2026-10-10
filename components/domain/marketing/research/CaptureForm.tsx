"use client";

// CaptureForm — "แปะลิงก์ที่เจอ" (เป้า ≤ 2 นาทีจากเจอคลิปถึงบันทึก) · reference_clip
// 🔴 ไม่เรียก oEmbed/ไม่ดึงหน้า/ไม่เปิดลิงก์ — ประโยคตรวจใต้ช่องลิงก์ = parse จากสตริงที่พิมพ์เองเท่านั้น · ซ้ำตัดสินที่ DB หลังกดบันทึก
// ช่องบังคับ: ลิงก์ + ประโยคเปิดของคลิป · สรุปค่าเริ่มต้น = ประโยคเปิด (อยู่ใน "แก้สรุป") · ป้าย mass ไม่คำนวณระหว่างพิมพ์ (DB คำนวณ แสดงในรายการ)
// มือถือ: ช่องเรียงตามแอป TikTok · PC: กลางจอ ≤ 560px (ใส่โดยหน้า)

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { captureSignal } from "@/lib/actions/content-signal-capture";
import type { CaptureField, CaptureSignalInput } from "@/lib/actions/content-signal-capture";
import { CUSTOMER_GROUPS, CUSTOMER_GROUP_LABEL, HOOK_TYPES, HOOK_TYPE_LABEL } from "@/lib/marketing/piece-labels";
import { cleanSignalUrl, describeLink } from "@/lib/marketing/signal-input";
import { GENERIC_ACTION_ERROR } from "@/components/domain/marketing/workflow/useRunAction";

const FIELD =
  "min-h-11 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-base text-zinc-900 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600";

const EMPTY: CaptureSignalInput = { url: "", hookText: "", hookType: "", summary: "", source: "owner", account: "", followers: "", views: "", likes: "", comments: "", saves: "", shares: "", approx: false, postedOn: "", customerGroup: "", whyItWorks: "" };

const METRICS: { key: "followers" | "views" | "likes" | "comments" | "saves" | "shares"; label: string }[] = [
  { key: "followers", label: "ผู้ติดตามของบัญชี" },
  { key: "views", label: "ยอดวิว" },
  { key: "likes", label: "ไลก์" },
  { key: "comments", label: "คอมเมนต์" },
  { key: "saves", label: "บันทึก" },
  { key: "shares", label: "แชร์" },
];

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-zinc-800">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-zinc-700">{hint}</p>}
      {error && (
        <p id={`${id}-err`} role="alert" className="text-sm font-medium text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}

export function CaptureForm() {
  const uid = useId();
  const [v, setV] = useState<CaptureSignalInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ field?: CaptureField; message: string; duplicateId?: string | null } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const set = <K extends keyof CaptureSignalInput>(k: K, val: CaptureSignalInput[K]) => setV((s) => ({ ...s, [k]: val }));
  const hint = useMemo(() => {
    if (!v.url.trim()) return null;
    const c = cleanSignalUrl(v.url);
    if (!c.ok) return { ok: false as const, text: c.error };
    const h = describeLink(c.url);
    return { ok: true as const, text: [h.platformLabel, h.account].filter(Boolean).join(" · ") + " · ตรวจว่าเคยแปะไหมตอนกดบันทึก" };
  }, [v.url]);
  const errFor = (f: CaptureField) => (err?.field === f ? err.message : null);
  const id = (n: string) => `${uid}-${n}`;

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const res = await captureSignal(v);
      if (!res.ok) {
        setErr({ field: res.field, message: res.error, duplicateId: res.duplicateId });
        return;
      }
      setSavedId(res.data.id);
      setV(EMPTY);
    } catch {
      setErr({ field: "form", message: GENERIC_ACTION_ERROR });
    } finally {
      setBusy(false);
    }
  }

  if (savedId) {
    return (
      <div role="status" className="space-y-3 rounded-lg border border-green-200 bg-green-50 p-4">
        <p className="flex items-center gap-2 text-base font-semibold text-green-900">
          <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          บันทึกลิงก์แล้ว
        </p>
        <p className="text-sm text-green-900">ระบบจะคำนวณ mass ให้ — ดูผลในรายการสัญญาณ</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => setSavedId(null)}>
            แปะอีกอัน
          </Button>
          <Link href={`/marketing/research?id=${savedId}`} className="inline-flex min-h-11 items-center rounded-md border border-zinc-300 bg-white px-4 text-base font-medium text-zinc-800 hover:bg-zinc-50">
            ดูในรายการ
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field id={id("url")} label="ลิงก์คลิปที่เจอ" error={errFor("url")} hint={hint?.ok === false ? undefined : (hint?.text ?? "วางลิงก์จากแอป — ระบบไม่เปิดลิงก์นี้")}>
        <input id={id("url")} type="url" inputMode="url" value={v.url} onChange={(e) => set("url", e.target.value)} maxLength={500} aria-invalid={!!errFor("url")} aria-describedby={errFor("url") ? `${id("url")}-err` : undefined} className={FIELD} placeholder="https://" />
        {hint?.ok === false && !errFor("url") && <p className="text-sm text-amber-900">{hint.text}</p>}
      </Field>
      {err?.duplicateId && (
        <p className="text-sm">
          <Link href={`/marketing/research?id=${err.duplicateId}`} className="inline-flex min-h-11 items-center font-semibold text-primary-700 underline">
            ไปดูรายการเดิม
          </Link>
        </p>
      )}

      <Field id={id("hook")} label="ประโยคเปิดของคลิป (ที่เห็น/ได้ยินในไม่กี่วินาทีแรก)" error={errFor("hook")}>
        <textarea id={id("hook")} value={v.hookText} onChange={(e) => set("hookText", e.target.value)} maxLength={500} rows={3} aria-invalid={!!errFor("hook")} className={`${FIELD} py-2`} />
      </Field>
      <Field id={id("htype")} label="ประเภท hook (ไม่บังคับ)">
        <select id={id("htype")} value={v.hookType} onChange={(e) => set("hookType", e.target.value)} className={FIELD}>
          <option value="">ยังไม่ระบุ</option>
          {HOOK_TYPES.map((t) => (
            <option key={t} value={t}>
              {HOOK_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </Field>

      <fieldset className="space-y-1">
        <legend className="text-sm font-medium text-zinc-800">ใครเห็น</legend>
        <div className="flex flex-wrap gap-2">
          {[["owner", "ฉัน"], ["host", "คนไลฟ์"], ["craftsman", "ช่าง"]].map(([val, label]) => (
            <label key={val} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm has-[:checked]:border-primary-600 has-[:checked]:bg-primary-50">
              <input type="radio" name={id("source")} value={val} checked={v.source === val} onChange={() => set("source", val)} className="h-5 w-5 accent-primary-600" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <details className="rounded-lg border border-zinc-200 bg-white p-3">
        <summary className="min-h-11 cursor-pointer text-sm font-semibold text-zinc-900">ตัวเลขที่เห็นบนจอ (ไม่บังคับ)</summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-zinc-700">ใส่เฉพาะที่เห็นจริง — ไม่เห็นให้เว้นว่าง (ห้ามใส่ 0) · พิมพ์ย่อได้ เช่น 16K, 1.2M · ระบบจะคำนวณ mass ให้หลังบันทึก</p>
          <div className="grid grid-cols-2 gap-3">
            {METRICS.map((m) => (
              <Field key={m.key} id={id(m.key)} label={m.label} error={errFor(m.key)}>
                <input id={id(m.key)} type="text" inputMode="text" autoComplete="off" value={v[m.key] ?? ""} onChange={(e) => set(m.key, e.target.value)} maxLength={20} aria-invalid={!!errFor(m.key)} className={FIELD} />
              </Field>
            ))}
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm text-zinc-900">
            <input type="checkbox" checked={!!v.approx} onChange={(e) => set("approx", e.target.checked)} className="h-5 w-5 accent-primary-600" />
            ตัวเลขเป็นค่าประมาณ (ตั้งให้เองถ้าพิมพ์ย่อ)
          </label>
        </div>
      </details>

      <details className="rounded-lg border border-zinc-200 bg-white p-3">
        <summary className="min-h-11 cursor-pointer text-sm font-semibold text-zinc-900">รายละเอียดเพิ่ม / แก้สรุป (ไม่บังคับ)</summary>
        <div className="mt-3 space-y-3">
          <Field id={id("summary")} label="สรุป 1 บรรทัด (ว่าง = ใช้ประโยคเปิด)" error={errFor("summary")}>
            <input id={id("summary")} type="text" value={v.summary} onChange={(e) => set("summary", e.target.value)} maxLength={300} className={FIELD} />
          </Field>
          <Field id={id("posted")} label="วันที่โพสต์คลิป" hint="ถ้าโพสต์ไม่เกิน 3 วัน ตัวเลขยังไม่สุก — ระบบจะติดป้ายให้" error={errFor("postedOn")}>
            <input id={id("posted")} type="date" value={v.postedOn} onChange={(e) => set("postedOn", e.target.value)} className={FIELD} />
          </Field>
          <Field id={id("account")} label="ชื่อบัญชี (ว่าง = ใช้ที่อ่านจากลิงก์)" error={errFor("account")}>
            <input id={id("account")} type="text" value={v.account} onChange={(e) => set("account", e.target.value)} maxLength={100} className={FIELD} />
          </Field>
          <Field id={id("group")} label="กลุ่มลูกค้าที่เกี่ยว">
            <select id={id("group")} value={v.customerGroup} onChange={(e) => set("customerGroup", e.target.value)} className={FIELD}>
              <option value="">ยังไม่ระบุ</option>
              {CUSTOMER_GROUPS.map((g) => (
                <option key={g} value={g}>
                  {CUSTOMER_GROUP_LABEL[g]}
                </option>
              ))}
            </select>
          </Field>
          <Field id={id("why")} label="คิดว่าทำไมคลิปนี้ได้ผล">
            <textarea id={id("why")} value={v.whyItWorks} onChange={(e) => set("whyItWorks", e.target.value)} maxLength={500} rows={2} className={`${FIELD} py-2`} />
          </Field>
        </div>
      </details>

      {err && (!err.field || err.field === "form") && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm font-medium text-red-800">
          {err.message}
        </p>
      )}
      <Button type="submit" loading={busy} disabled={busy} className="w-full sm:w-auto">
        บันทึกลิงก์
      </Button>
    </form>
  );
}
