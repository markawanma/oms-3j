"use client";

// CreatePieceButton — "+ เพิ่มชิ้นงาน" (content_piece_create): ชื่อ · ชนิด · ช่องทาง · กลุ่มลูกค้า · วัน
// ช่องทางตัดตัวเลือกที่ไม่เข้าคู่กับชนิด (ไม่ใช่ให้เลือกแล้วฟ้อง) · เจ้าของ + มีวัน = "วางแผนแล้ว" (DB) · ค่าที่พิมพ์ค้างเมื่อ error

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { createPiece } from "@/lib/actions/content-calendar";
import {
  CHANNEL_LABEL,
  CUSTOMER_GROUPS,
  CUSTOMER_GROUP_LABEL,
  KIND_CHANNELS,
  PIECE_KINDS,
  PIECE_KIND_LABEL,
} from "@/lib/marketing/piece-labels";
import type { PieceKind } from "@/lib/marketing/piece-labels";

const INPUT =
  "min-h-11 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-base focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600";

function Form({ defaultDate, todayTh, onClose, onDirty }: { defaultDate: string; todayTh: string; onClose: () => void; onDirty: (d: boolean) => void }) {
  const router = useRouter();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<PieceKind | "">("");
  const [channel, setChannel] = useState("");
  const [group, setGroup] = useState("");
  const [date, setDate] = useState(defaultDate < todayTh ? todayTh : defaultDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const channels = kind ? KIND_CHANNELS[kind] : [];
  const ready = title.trim().length > 0 && title.length <= 200 && kind !== "" && channel !== "" && group !== "" && date !== "" && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await createPiece({ title, pieceKind: kind, channel, customerGroup: group, date });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDirty(false);
      toast.push("เพิ่มชิ้นงานแล้ว");
      onClose();
      router.refresh();
    } catch {
      setError("เพิ่มชิ้นงานไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) void submit();
      }}
      className="space-y-3"
    >
      <div className="space-y-1">
        <label htmlFor="new-title" className="block text-sm font-medium text-zinc-800">
          ชื่อชิ้นงาน
        </label>
        <input
          id="new-title"
          ref={titleRef}
          autoFocus
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            onDirty(true);
          }}
          maxLength={220}
          className={INPUT}
        />
        {title.length > 200 && <p className="text-xs font-medium text-red-700">ชื่อยาวเกิน 200 ตัวอักษร</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="new-kind" className="block text-sm font-medium text-zinc-800">
            ชนิดชิ้นงาน
          </label>
          <select
            id="new-kind"
            value={kind}
            onChange={(e) => {
              const k = e.target.value as PieceKind | "";
              setKind(k);
              setChannel(k && (KIND_CHANNELS[k] as readonly string[]).includes(channel) ? channel : "");
              onDirty(true);
            }}
            className={INPUT}
          >
            <option value="">เลือกชนิด</option>
            {PIECE_KINDS.map((k) => (
              <option key={k} value={k}>
                {PIECE_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="new-channel" className="block text-sm font-medium text-zinc-800">
            ช่องทาง
          </label>
          <select id="new-channel" value={channel} onChange={(e) => setChannel(e.target.value)} disabled={!kind} className={INPUT}>
            <option value="">{kind ? "เลือกช่องทาง" : "เลือกชนิดก่อน"}</option>
            {channels.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium text-zinc-800">กลุ่มลูกค้า (เลือกอย่างใดอย่างหนึ่ง)</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {CUSTOMER_GROUPS.map((g) => (
            <label
              key={g}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-zinc-300 bg-white px-2.5 has-[:checked]:border-primary-600 has-[:checked]:ring-1 has-[:checked]:ring-primary-600"
            >
              <input type="radio" name="new-group" checked={group === g} onChange={() => setGroup(g)} className="h-5 w-5 text-primary-600 focus:ring-primary-600" />
              <span className="text-sm font-medium">{CUSTOMER_GROUP_LABEL[g]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="space-y-1">
        <label htmlFor="new-date" className="block text-sm font-medium text-zinc-800">
          วันที่
        </label>
        <input id="new-date" type="date" min={todayTh} value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
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
        <Button type="submit" loading={busy} disabled={!ready}>
          เพิ่มชิ้นงาน
        </Button>
      </div>
      {!ready && !busy && <p className="text-xs text-zinc-600">กรอกให้ครบทุกช่องเพื่อเพิ่ม — ชิ้นจะอยู่สถานะ “วางแผนแล้ว” ในวันที่เลือก</p>}
    </form>
  );
}

export function CreatePieceButton({ defaultDate, todayTh }: { defaultDate: string; todayTh: string }) {
  const [open, setOpen] = useState(false);
  const dirty = useRef(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        เพิ่มชิ้นงาน
      </Button>
      {open && (
        <Modal
          open
          onClose={() => setOpen(false)}
          title="เพิ่มชิ้นงาน"
          confirmBeforeClose={() => !dirty.current || window.confirm("ทิ้งข้อมูลที่กรอกไว้?")}
        >
          <Form
            defaultDate={defaultDate}
            todayTh={todayTh}
            onClose={() => setOpen(false)}
            onDirty={(d) => {
              dirty.current = d;
            }}
          />
        </Modal>
      )}
    </>
  );
}
