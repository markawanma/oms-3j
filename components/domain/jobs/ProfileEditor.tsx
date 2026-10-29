"use client";

// ProfileEditor — ตัวแก้ไขแบบการบันทึก 1 แบบ (0176): ชื่อ · หมายเหตุ · ตารางติ๊กขั้น · บังคับน้ำหนักสุทธิตอนปิดงาน · จัดการ (ค่าเริ่ม/สำเนา/ปิดใช้)
// ไม่ตัดสินกติกาเอง: ติ๊กขั้นไม่มีโลหะไม่ได้ (UI กัน + DB ปฏิเสธ) · ปิดแบบที่เป็นค่าเริ่ม = DB ปฏิเสธ (ปุ่มปิด + บอกเหตุผลเสมอ)
// ใช้ key={id|new:n} ที่ parent — เปลี่ยนแบบ = mount ใหม่ (state เริ่มจาก props ครั้งเดียว) · dirty ส่งขึ้น parent เพื่อกันทิ้งการแก้ไขเงียบ

import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Power } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ErrorLine, FIELD, Field } from "@/components/domain/jobs/JobDialogs";
import { CloseProfileDialog, SetDefaultDialog } from "@/components/domain/jobs/ProfileDialogs";
import { NO_FLAG, ProfileStageGrid } from "@/components/domain/jobs/ProfileStageGrid";
import type { GridFlag, GridFlags } from "@/components/domain/jobs/ProfileStageGrid";
import { useOfficeRun } from "@/components/domain/jobs/useOfficeRun";
import { saveProfile, setDefaultProfile, setProfileActive } from "@/lib/actions/job-profiles";
import { LABEL_ANGLE_MSG, LABEL_ANGLE_RE } from "@/lib/jobs/input";
import type { ProfileStageDef, RecordProfile } from "@/lib/jobs/profile";
import { goldUnguardedStages } from "@/lib/jobs/profile-summary";

export interface EditorSeed {
  name: string;
  note: string;
  requireFinalWeight: boolean;
  flags: GridFlags;
}

const NAME_MAX = 60;
const NOTE_MAX = 200;

/** flag เริ่มต้นจากแบบ — ขั้นที่ไม่มีโลหะไม่มี weigh/scrapWeight (กันค่าหลุดจากข้อมูลเก่า) */
function flagsFrom(profile: RecordProfile | null, defs: readonly ProfileStageDef[]): GridFlags {
  const out: GridFlags = {};
  for (const d of defs) out[d.code] = { ...NO_FLAG };
  for (const s of profile?.stages ?? []) {
    const d = defs.find((x) => x.code === s.stageCode);
    out[s.stageCode] = { weigh: !!d?.metalPresent && s.weigh, scrapQty: s.scrapQty, scrapWeight: !!d?.metalPresent && s.scrapWeight };
  }
  return out;
}

const sameFlags = (a: GridFlags, b: GridFlags, codes: readonly string[]): boolean =>
  codes.every((c) => {
    const x = a[c] ?? NO_FLAG;
    const y = b[c] ?? NO_FLAG;
    return x.weigh === y.weigh && x.scrapQty === y.scrapQty && x.scrapWeight === y.scrapWeight;
  });

interface Props {
  /** null = แบบใหม่ (ยังไม่บันทึก) */
  profile: RecordProfile | null;
  /** แบบใหม่จาก "สร้างจากแบบนี้" — ชื่อ/ค่าบนจอของแบบเดิมรวมที่ยังไม่บันทึก (ไม่ copy ค่าเริ่ม) */
  seed?: EditorSeed | null;
  defs: readonly ProfileStageDef[];
  onDirtyChange: (dirty: boolean) => void;
  /** บันทึกสำเร็จ — parent โหลดรายการใหม่แล้วชี้มาที่แบบนี้ */
  onSaved: (p: RecordProfile) => void;
  /** ค่าเริ่ม/ปิดใช้ เปลี่ยน — parent โหลดรายการใหม่ (ตัวแก้ไขคงเปิด) */
  onChanged: () => void;
  onClone: (seed: EditorSeed) => void;
  /** ปุ่ม [ยกเลิก] — parent ตัดสินเรื่อง dirty guard */
  onCancel: () => void;
}

export function ProfileEditor({ profile, seed, defs, onDirtyChange, onSaved, onChanged, onClone, onCancel }: Props) {
  const { run, busy, error, code, setError } = useOfficeRun();
  const base = useMemo(() => {
    if (seed) return seed;
    return { name: profile?.name ?? "", note: profile?.note ?? "", requireFinalWeight: profile?.requireFinalWeight ?? false, flags: flagsFrom(profile, defs) };
    // เริ่มจาก props ครั้งเดียวต่อ mount (parent ใช้ key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [name, setName] = useState(base.name);
  const [note, setNote] = useState(base.note);
  const [requireFinal, setRequireFinal] = useState(base.requireFinalWeight);
  const [flags, setFlags] = useState<GridFlags>(base.flags);
  const [dlg, setDlg] = useState<"general" | "gold" | "close" | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const codes = useMemo(() => defs.map((d) => d.code), [defs]);
  const baseline = useMemo(() => (profile && !seed ? base : { name: "", note: "", requireFinalWeight: false, flags: flagsFrom(null, defs) }), [profile, seed, base, defs]);
  const dirty = name.trim() !== baseline.name.trim() || note.trim() !== baseline.note.trim() || requireFinal !== baseline.requireFinalWeight || !sameFlags(flags, baseline.flags, codes);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  // สร้างจากแบบนี้: โฟกัสช่องชื่อ + เลือกข้อความ ให้พิมพ์ทับได้ทันที
  useEffect(() => {
    if (seed) {
      nameRef.current?.focus();
      nameRef.current?.select();
    }
  }, [seed]);

  const nameBad = LABEL_ANGLE_RE.test(name);
  const nameOk = name.trim().length >= 1 && name.trim().length <= NAME_MAX && !nameBad;
  const ready = nameOk && dirty && !busy;
  const nameDup = error !== null && code === "name_dup";

  const nameOf = (c: string) => defs.find((d) => d.code === c)?.nameTh ?? c;
  const unguardedNames = goldUnguardedStages(defs.filter((d) => d.isActive).map((d) => ({ code: d.code, metalPresent: d.metalPresent, goldWeighExempt: d.goldWeighExempt === true, weigh: flags[d.code]?.weigh === true }))).map(nameOf);

  const setFlag = (code: string, key: keyof GridFlag, v: boolean) => setFlags((p) => ({ ...p, [code]: { ...(p[code] ?? NO_FLAG), [key]: v } }));

  async function save() {
    if (!ready) return;
    const r = await run(
      () =>
        saveProfile({
          id: profile?.id ?? null,
          name,
          note,
          requireFinalWeight: requireFinal,
          stages: codes.map((c) => ({ stageCode: c, ...(flags[c] ?? NO_FLAG) })),
        }),
      { success: "บันทึกแบบแล้ว", refresh: false }
    );
    if (r.ok) onSaved(r.data);
    else if (r.code === "name_dup") nameRef.current?.focus();
  }

  async function clearGold() {
    if (!profile) return;
    const r = await run(() => setDefaultProfile(null, "gold"), { success: "ตั้งค่าเริ่มแล้ว", refresh: false });
    if (r.ok) onChanged();
  }
  async function reopen() {
    if (!profile) return;
    const r = await run(() => setProfileActive(profile.id, true), { success: "เปิดใช้งานแล้ว", refresh: false });
    if (r.ok) onChanged();
  }
  const isDefaultAny = profile ? profile.isDefault || profile.isDefaultGold : false;

  // dialog ต้องอยู่นอก <form> — Modal ไม่ใช้ portal: submit ของกล่องยืนยันจะ bubble ขึ้น form นี้แล้ว save การแก้ที่ค้างไปด้วย (review blocker)
  return (
    <>
    <form
      noValidate
      aria-label={profile ? `แก้แบบ ${profile.name}` : "สร้างแบบการบันทึกใหม่"}
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {profile && !profile.isActive && (
        <p role="status" className="rounded-md border border-zinc-300 bg-zinc-50 p-2.5 text-sm font-medium text-zinc-800">
          แบบนี้ปิดใช้งานอยู่ — เลือกตอนสร้างใบใหม่ไม่ได้
        </p>
      )}

      <Field id="pf-name" label={`ชื่อแบบ (จำเป็น · ไม่เกิน ${NAME_MAX} ตัวอักษร)`} hint={nameBad ? LABEL_ANGLE_MSG : undefined}>
        <input
          id="pf-name"
          ref={nameRef}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (nameDup) setError(null);
          }}
          maxLength={NAME_MAX}
          disabled={busy}
          aria-invalid={nameBad || nameDup ? true : undefined}
          aria-describedby={nameDup ? "pf-name-err" : undefined}
          className={FIELD}
        />
      </Field>
      {nameDup && (
        <p id="pf-name-err" role="alert" className="-mt-2 text-xs font-medium text-red-800">
          มีแบบชื่อนี้อยู่แล้ว
        </p>
      )}
      <Field id="pf-note" label="หมายเหตุ (ไม่บังคับ)">
        <input id="pf-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX} disabled={busy} className={FIELD} />
      </Field>

      <section aria-labelledby="pf-grid-h" className="space-y-2">
        <h3 id="pf-grid-h" className="text-sm font-semibold text-zinc-900">
          แต่ละขั้นให้ช่างทำอะไร
        </h3>
        <p className="text-xs text-zinc-700">ชั่งน้ำหนัก = ช่างต้องใส่น้ำหนักเข้า-ออก ไม่ใส่ รับ/ส่งต่อไม่ได้ · ชิ้นเสีย/เศษ = ช่องที่ช่างเห็นบนมือถือ (ไม่บังคับ ออฟฟิศกรอกแทนได้เสมอ)</p>
        <ProfileStageGrid idPrefix="pg" defs={defs} flags={flags} onChange={setFlag} disabled={busy} />
      </section>

      <section aria-labelledby="pf-close-h" className="space-y-1 rounded-md border border-zinc-200 p-3">
        <h3 id="pf-close-h" className="text-sm font-semibold text-zinc-900">
          ตอนปิดงาน
        </h3>
        <label htmlFor="pf-final" className="flex min-h-11 items-center gap-2 text-sm text-zinc-900">
          <input id="pf-final" type="checkbox" className="h-5 w-5 accent-primary-600" checked={requireFinal} onChange={(e) => setRequireFinal(e.target.checked)} disabled={busy} />
          บังคับใส่น้ำหนักสุทธิ (กรัม) ตอนกดปิดงาน
        </label>
        <p className="text-xs text-zinc-700">ใช้ได้แม้ไม่ชั่งระหว่างขั้น (ชั่งครั้งเดียว) · ใบทองที่มีขั้นชั่ง ระบบบังคับน้ำหนักสุทธิอยู่แล้วไม่ว่าจะติ๊กหรือไม่</p>
      </section>

      {profile && (
        <p role="note" className="rounded-md border border-sky-300 bg-sky-50 p-2.5 text-sm text-sky-900">
          แก้แบบนี้มีผลกับใบที่สร้างหลังจากนี้เท่านั้น
          {profile.jobsOpen > 0 ? ` · ใบที่สร้างไปแล้ว (เปิดอยู่ ${profile.jobsOpen} ใบ) ยังใช้กติกาตอนสร้างเหมือนเดิม` : ""} · ใบที่ยังไม่เริ่มเปลี่ยนแบบได้ที่หน้าใบงาน
        </p>
      )}

      {profile && (
        <section aria-labelledby="pf-manage-h" className="space-y-2 rounded-md border border-zinc-200 p-3">
          <h3 id="pf-manage-h" className="text-sm font-semibold text-zinc-900">
            จัดการแบบนี้
          </h3>
          {dirty && <p className="text-xs font-medium text-amber-900">บันทึกก่อนค่อยตั้งค่าเริ่มหรือปิด/เปิดใช้งาน</p>}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {profile.isActive && (
              <>
                <Button type="button" variant="secondary" onClick={() => setDlg("general")} disabled={busy || dirty || profile.isDefault}>
                  {profile.isDefault ? "เป็นค่าเริ่ม · งานทั่วไป อยู่แล้ว" : "ตั้งเป็นค่าเริ่ม · งานทั่วไป"}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setDlg("gold")} disabled={busy || dirty || profile.isDefaultGold}>
                  {profile.isDefaultGold ? "เป็นค่าเริ่ม · งานทอง อยู่แล้ว" : "ตั้งเป็นค่าเริ่ม · งานทอง"}
                </Button>
              </>
            )}
            {profile.isDefaultGold && (
              <Button type="button" variant="secondary" onClick={() => void clearGold()} disabled={busy || dirty}>
                เลิกเป็นค่าเริ่มงานทอง → ใช้ตามงานทั่วไป
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={() => onClone({ name: `${name.trim()} (สำเนา)`.slice(0, NAME_MAX), note, requireFinalWeight: requireFinal, flags })}
              disabled={busy}
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
              สร้างจากแบบนี้
            </Button>
            {profile.isActive ? (
              <Button type="button" variant="secondary" onClick={() => setDlg("close")} disabled={busy || dirty || isDefaultAny} aria-describedby={isDefaultAny ? "pf-close-why" : undefined}>
                <Power className="h-4 w-4" aria-hidden="true" />
                ปิดใช้งาน
              </Button>
            ) : (
              <Button type="button" variant="secondary" onClick={() => void reopen()} disabled={busy || dirty}>
                <Power className="h-4 w-4" aria-hidden="true" />
                เปิดใช้งานอีกครั้ง
              </Button>
            )}
          </div>
          {isDefaultAny && profile.isActive && (
            <p id="pf-close-why" className="text-xs font-medium text-zinc-800">
              ปิดไม่ได้ — เป็นค่าเริ่มอยู่ (ตั้งแบบอื่นก่อน)
            </p>
          )}
        </section>
      )}

      {!nameDup && <ErrorLine message={error} />}

      <div className="sticky bottom-0 -mx-1 flex flex-col-reverse gap-2 border-t border-zinc-200 bg-white p-2 sm:flex-row sm:justify-end lg:static lg:border-0 lg:p-0">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          ยกเลิก
        </Button>
        <Button type="submit" loading={busy} disabled={!ready}>
          บันทึก
        </Button>
      </div>

    </form>
    {profile && dlg === "general" && <SetDefaultDialog profile={profile} scope="general" unguardedNames={[]} onDone={() => { setDlg(null); onChanged(); }} onClose={() => setDlg(null)} />}
    {profile && dlg === "gold" && <SetDefaultDialog profile={profile} scope="gold" unguardedNames={unguardedNames} onDone={() => { setDlg(null); onChanged(); }} onClose={() => setDlg(null)} />}
    {profile && dlg === "close" && <CloseProfileDialog profile={profile} onDone={() => { setDlg(null); onChanged(); }} onClose={() => setDlg(null)} />}
    </>
  );
}
