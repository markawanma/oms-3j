"use client";

// PickIdeaDialog — หยิบสัญญาณเป็นไอเดีย (content_signal_pick): ชื่อ · ชนิด · ช่องทาง (เฉพาะที่เข้าคู่กับชนิด) · กลุ่มลูกค้า
// ไอเดียที่ได้ไปรอที่หน้า "คัดไอเดีย" พร้อมที่มา · ชื่อเริ่มต้น = สรุปของสัญญาณ (แก้ได้) · DB ตัดสินด่านทั้งหมด

import { useId, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useRunAction } from "@/components/domain/marketing/workflow/useRunAction";
import { pickSignal } from "@/lib/actions/content-signals";
import { CHANNEL_LABEL, CUSTOMER_GROUPS, CUSTOMER_GROUP_LABEL, KIND_CHANNELS, PIECE_KINDS, PIECE_KIND_LABEL } from "@/lib/marketing/piece-labels";
import type { PieceKind } from "@/lib/marketing/piece-labels";
import type { SignalRow } from "@/lib/marketing/signal-types";

const FIELD =
  "min-h-11 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-base text-zinc-900 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600";

export function PickIdeaDialog({ signal, onClose }: { signal: SignalRow; onClose: () => void }) {
  const uid = useId();
  const { run, busy, error } = useRunAction();
  const [title, setTitle] = useState(signal.summary.slice(0, 200));
  const [kind, setKind] = useState<PieceKind | "">("");
  const [channel, setChannel] = useState("");
  const [group, setGroup] = useState(signal.customerGroup ?? "");
  const [done, setDone] = useState(false);
  const channels = kind ? KIND_CHANNELS[kind] : [];
  const ready = title.trim().length > 0 && kind !== "" && channel !== "" && group !== "";

  async function submit() {
    if (!ready) return;
    const res = await run(() => pickSignal(signal.id, { title, pieceKind: kind, channel, customerGroup: group }), { success: "หยิบเป็นไอเดียแล้ว — ไปรอที่หน้าคัดไอเดีย" });
    if (res.ok) setDone(true);
  }

  return (
    <Modal open onClose={onClose} title="หยิบเป็นไอเดีย">
      {done ? (
        <div className="space-y-3">
          <p className="text-sm text-zinc-800">ไอเดียนี้ไปรอที่หน้าคัดไอเดียแล้ว พร้อมที่มาจากสัญญาณนี้</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={onClose}>
              ปิด
            </Button>
            <Link href="/marketing/triage" className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary-600 px-4 text-base font-medium text-white hover:bg-primary-700">
              ไปคัดไอเดีย
            </Link>
          </div>
        </div>
      ) : (
        <form
          noValidate
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div>
            <label htmlFor={`${uid}-t`} className="mb-1 block text-sm font-medium text-zinc-800">
              ชื่อไอเดีย
            </label>
            <input id={`${uid}-t`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={FIELD} />
          </div>
          <div>
            <label htmlFor={`${uid}-k`} className="mb-1 block text-sm font-medium text-zinc-800">
              ชนิดชิ้นงาน
            </label>
            <select
              id={`${uid}-k`}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as PieceKind | "");
                setChannel("");
              }}
              className={FIELD}
            >
              <option value="">เลือกชนิด…</option>
              {PIECE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {PIECE_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}-c`} className="mb-1 block text-sm font-medium text-zinc-800">
              ช่องทาง
            </label>
            <select id={`${uid}-c`} value={channel} onChange={(e) => setChannel(e.target.value)} disabled={!kind} className={FIELD}>
              <option value="">{kind ? "เลือกช่องทาง…" : "เลือกชนิดก่อน"}</option>
              {channels.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}-g`} className="mb-1 block text-sm font-medium text-zinc-800">
              กลุ่มลูกค้า
            </label>
            <select id={`${uid}-g`} value={group} onChange={(e) => setGroup(e.target.value)} className={FIELD}>
              <option value="">เลือกกลุ่ม…</option>
              {CUSTOMER_GROUPS.map((g) => (
                <option key={g} value={g}>
                  {CUSTOMER_GROUP_LABEL[g]}
                </option>
              ))}
            </select>
          </div>
          {error && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm font-medium text-red-800">
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              ยกเลิก
            </Button>
            <Button type="submit" loading={busy} disabled={!ready || busy}>
              หยิบเป็นไอเดีย
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
