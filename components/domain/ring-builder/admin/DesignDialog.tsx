"use client";

// แก้ไข/เพิ่มแบบแหวน — จำนวนเม็ด · ชื่อ · ทรง · กว้าง/ยาว (2 ช่อง) · ทิศเม็ดไข่ · ไซซ์ต่ำสุด–สูงสุด · ราคาตัวเรือน · รูปการ์ด · พรีวิว 2D
// ล็อกตั้งแต่ "เปิดขายครั้งแรก" (design.locked): จำนวนเม็ด/ทรง/ขนาดเม็ด/ทิศ แก้ไม่ได้ → ปุ่มทำสำเนา (ไม่มีตัวนับรหัส — ระบบไม่เก็บรหัส)
// ราคาตัวเรือน: ส่งเฉพาะเมื่อเปลี่ยนจากค่าปัจจุบัน · ไม่คำนวณเงินใน client
import { useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { clearRingCardImage, duplicateRingDesign, publishRingDesign, saveRingDesign, setRingActive, uploadRingCardImage } from "@/lib/actions/ring-builder";
import type { AdminCatalog, AdminDesign } from "@/lib/ring-builder/admin-types";
import { composeSize, fmtThb, HIDDEN_REASON_LABEL, parseWholeThb, ringErrorText } from "@/lib/ring-builder/admin-ui";
import { MAX_STONES, MIN_STONES } from "@/lib/ring-builder/config";
import { formatMm100, parseStoneSize } from "@/lib/ring-builder/mm";
import { MD_MAX_PX } from "@/lib/images/constants";
import { ConfirmDialog, ErrorLine, Field, Note, RB_FIELD, SizeFields } from "./ui";
import { RingDiagram } from "./RingDiagram";

const BODY_MAX = 1_000_000;
const COUNTS = Array.from({ length: MAX_STONES - MIN_STONES + 1 }, (_, i) => MIN_STONES + i);

export function DesignDialog({ catalog, designId, defaultCount, onChanged, onClose, onSwitch }: { catalog: AdminCatalog; designId: string | "new"; defaultCount: number | null; onChanged: () => Promise<void>; onClose: () => void; onSwitch: (id: string) => void }) {
  const design = designId === "new" ? null : catalog.designs.find((d) => d.id === designId) ?? null;
  return (
    <Modal open onClose={onClose} title={design ? `แก้ไข · ${design.stoneCount} เม็ด ${design.name}` : "เพิ่มแบบแหวน"} wide>
      <DesignForm key={design?.id ?? "new"} catalog={catalog} design={design} defaultCount={defaultCount} onChanged={onChanged} onClose={onClose} onSwitch={onSwitch} />
    </Modal>
  );
}

type Confirm = "price" | "publish" | "active" | null;

function DesignForm({ catalog, design, defaultCount, onChanged, onClose, onSwitch }: { catalog: AdminCatalog; design: AdminDesign | null; defaultCount: number | null; onChanged: () => Promise<void>; onClose: () => void; onSwitch: (id: string) => void }) {
  const { push } = useToast();
  const shapes = catalog.shapes.filter((s) => s.isActive || s.id === design?.shapeId);
  const initial = {
    name: design?.name ?? "",
    count: String(design?.stoneCount ?? defaultCount ?? 5),
    shapeId: design?.shapeId ?? shapes[0]?.id ?? "",
    w: design ? formatMm100(design.stoneMm100.major) : "",
    h: design ? formatMm100(design.stoneMm100.minor) : "",
    axis: design?.stoneAxis ?? "",
    sizeMin: String(design?.sizeMin ?? catalog.sizes.min),
    sizeMax: String(design?.sizeMax ?? catalog.sizes.max),
    price: design?.bodyPriceThb == null ? "" : String(design.bodyPriceThb),
  };
  const [f, setF] = useState(initial);
  const set = <K extends keyof typeof initial>(k: K, v: (typeof initial)[K]) => setF((p) => ({ ...p, [k]: v }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<Confirm>(null);

  const locked = design?.locked ?? false;
  const shape = shapes.find((s) => s.id === f.shapeId) ?? null;
  const round = shape?.renderKind === "round";
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const priceParsed = f.price.trim() === "" ? null : parseWholeThb(f.price, BODY_MAX);
  const priceChanged = priceParsed !== null && priceParsed !== (design?.bodyPriceThb ?? null);
  const size = parseStoneSize(f.w.trim() === "" ? "" : composeSize(f.w, round ? f.w : f.h));
  const countNum = /^\d$/.test(f.count) ? Number.parseInt(f.count, 10) : 0;

  function validate(): { ok: true; smin: number; smax: number } | { ok: false } {
    const e: Record<string, string> = {};
    if (f.name.trim() === "") e.name = "กรอกชื่อแบบ";
    if (countNum < MIN_STONES || countNum > MAX_STONES) e.count = `จำนวนเม็ดต้องเป็น ${MIN_STONES}-${MAX_STONES}`;
    if (!shape) e.shape = "เลือกทรงพลอย";
    if (!size.ok) e.size = size.reason === "range" ? "ขนาดต้องอยู่ระหว่าง 0.50-20.00 มม." : "กรอกกว้าง/ยาวเป็นตัวเลข (มม.)";
    const smin = /^\d{1,3}$/.test(f.sizeMin) ? Number.parseInt(f.sizeMin, 10) : NaN;
    const smax = /^\d{1,3}$/.test(f.sizeMax) ? Number.parseInt(f.sizeMax, 10) : NaN;
    if (Number.isNaN(smin) || Number.isNaN(smax) || smin < catalog.sizes.min || smax > catalog.sizes.max || smin > smax) e.sizes = `ช่วงไซซ์ต้องอยู่ใน ${catalog.sizes.min}-${catalog.sizes.max} และต่ำสุดไม่เกินสูงสุด`;
    if (f.price.trim() !== "" && priceParsed === null) e.price = "ราคาต้องเป็นจำนวนเต็มบาท";
    if (shape?.renderKind === "oval" && f.axis === "") e.axis = "ทรงไข่ต้องระบุทิศเม็ด";
    setFe(e);
    return Object.keys(e).length > 0 ? { ok: false } : { ok: true, smin, smax };
  }

  async function doSave() {
    const v = validate();
    if (!v.ok || !shape) return;
    setBusy(true);
    setErr(null);
    const res = await saveRingDesign({
      id: design?.id ?? null, name: f.name.trim(), stoneCount: countNum, shapeId: f.shapeId, size: composeSize(f.w, round ? f.w : f.h),
      stoneAxis: round ? null : (f.axis as "along_row" | "across_row"), sizeMin: v.smin, sizeMax: v.smax, sort: design?.sort ?? null,
      bodyPriceThb: priceChanged ? priceParsed : null,
    });
    setBusy(false);
    if (!res.ok) {
      await onChanged().catch(() => undefined); // กรณี "บันทึกแบบแล้วแต่ราคาไม่ติด" แบบถูกบันทึกจริง — รีโหลดให้เห็น · ค่าที่กรอกคงอยู่
      return setErr(ringErrorText(res));
    }
    push(res.data.created ? `เพิ่มแบบแล้ว (เป็นร่าง · แบบ #${res.data.designNo})` : "บันทึกแบบแล้ว");
    await onChanged();
    if (res.data.created) onSwitch(res.data.id);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!validate().ok) return;
    if (design?.published && priceChanged) setConfirm("price");
    else void doSave();
  }

  async function publish(): Promise<string | null> {
    if (!design) return null;
    const res = await publishRingDesign(design.id);
    if (!res.ok) return ringErrorText(res);
    push("เปิดขายแล้ว — จำนวนเม็ด/ทรง/ขนาดเม็ด/ทิศ ถูกล็อก");
    await onChanged();
    return null;
  }
  async function toggleActive(): Promise<string | null> {
    if (!design) return null;
    const res = await setRingActive({ kind: "design", id: design.id, active: !design.isActive });
    if (!res.ok) return ringErrorText(res);
    push(design.isActive ? "ปิดแบบนี้แล้ว" : "เปิดแบบนี้แล้ว");
    await onChanged();
    return null;
  }
  async function duplicate() {
    if (!design) return;
    setBusy(true);
    setErr(null);
    const res = await duplicateRingDesign(design.id);
    setBusy(false);
    if (!res.ok) return setErr(ringErrorText(res));
    push(`ทำสำเนาแล้ว — แบบ #${res.data.designNo} (ร่าง) แก้จำนวนเม็ด/ทรง/ขนาดได้`);
    await onChanged();
    onSwitch(res.data.id);
  }

  return (
    <div className="space-y-4">
      {design && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge>แบบ #{design.designNo}</Badge>
          {design.visible ? <Badge tone="green">เปิดขาย</Badge> : <Badge tone="amber">{design.hiddenReason ? HIDDEN_REASON_LABEL[design.hiddenReason] : "ไม่แสดงให้ลูกค้า"}</Badge>}
          {locked && <Badge tone="indigo">ล็อก · เคยเปิดขาย</Badge>}
          <span className="text-xs text-zinc-600">{design.statusChangedLabel}</span>
        </div>
      )}
      {locked && <Note>แบบนี้เคยเปิดขายแล้ว — จำนวนเม็ด ทรง ขนาดพลอย และทิศเม็ดแก้ไม่ได้ ถ้าต้องการเปลี่ยน ให้ "ทำสำเนาเป็นแบบใหม่"</Note>}

      <form onSubmit={submit} className="space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="จำนวนเม็ด" error={fe.count}>
            {(p) => (
              <select {...p} className={RB_FIELD} value={f.count} disabled={locked} onChange={(e) => set("count", e.target.value)}>
                {COUNTS.map((c) => <option key={c} value={c}>{c} เม็ด</option>)}
              </select>
            )}
          </Field>
          <Field label="ชื่อแบบ (ลูกค้าเห็น)" error={fe.name}>
            {(p) => <input {...p} className={RB_FIELD} value={f.name} maxLength={40} onChange={(e) => set("name", e.target.value)} />}
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="ทรงพลอย" error={fe.shape}>
            {(p) => (
              <select {...p} className={RB_FIELD} value={f.shapeId} disabled={locked} onChange={(e) => { const s = shapes.find((x) => x.id === e.target.value); setF((q) => ({ ...q, shapeId: e.target.value, axis: s?.renderKind === "round" ? "" : q.axis, h: s?.renderKind === "round" ? q.w : q.h })); }}>
                {shapes.map((s) => <option key={s.id} value={s.id}>{s.nameTh}{s.isActive ? "" : " (ปิดอยู่)"}</option>)}
              </select>
            )}
          </Field>
          {shape?.renderKind === "oval" && (
            <Field label="ทิศเม็ดไข่" error={fe.axis} hint="แกนยาวของเม็ดไปตามแนวแถว หรือขวางแนวแถว">
              {(p) => (
                <select {...p} className={RB_FIELD} value={f.axis} disabled={locked} onChange={(e) => set("axis", e.target.value)}>
                  <option value="">เลือกทิศ…</option>
                  <option value="along_row">ตามแนวแถว</option>
                  <option value="across_row">ขวางแนวแถว</option>
                </select>
              )}
            </Field>
          )}
        </div>
        <SizeFields w={f.w} h={f.h} round={!!round} disabled={locked} error={fe.size} onChange={(w, h) => setF((q) => ({ ...q, w, h }))} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="ไซซ์ต่ำสุด" error={fe.sizes} hint={`ช่วงร้าน ${catalog.sizes.min}-${catalog.sizes.max}`}>
            {(p) => <input {...p} inputMode="numeric" className={RB_FIELD} value={f.sizeMin} onChange={(e) => set("sizeMin", e.target.value)} />}
          </Field>
          <Field label="ไซซ์สูงสุด">
            {(p) => <input {...p} inputMode="numeric" className={RB_FIELD} value={f.sizeMax} onChange={(e) => set("sizeMax", e.target.value)} />}
          </Field>
          <Field label="ราคาตัวเรือน (บาท · ทุกไซซ์)" error={fe.price} hint={design?.bodyPriceThb != null ? `ปัจจุบัน ${fmtThb(design.bodyPriceThb)}` : "ต้องตั้งก่อนเปิดขาย"}>
            {(p) => <input {...p} inputMode="numeric" className={RB_FIELD} value={f.price} onChange={(e) => set("price", e.target.value)} />}
          </Field>
        </div>
        <Note tone="zinc">ลูกค้าเห็นเฉพาะพลอยที่มีราคาทรงและขนาดนี้ (ตั้งราคาที่แท็บ "พลอย") · CZ ขาวรวมในตัวเรือน</Note>

        <div>
          <div className="mb-1 text-sm font-semibold text-zinc-800">ตำแหน่งเม็ดสำหรับภาพ 2D (นับซ้ายไปขวา)</div>
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-2">
            <RingDiagram count={countNum} kind={round ? "round" : "oval"} axis={f.axis === "along_row" || f.axis === "across_row" ? f.axis : null} major={size.ok ? size.major : null} minor={size.ok ? size.minor : null} />
          </div>
        </div>

        <ErrorLine message={err} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {design && (
              <Button type="button" variant="secondary" onClick={duplicate} disabled={busy}>
                ทำสำเนาเป็นแบบใหม่
              </Button>
            )}
            {design && !design.published && (
              <Button type="button" variant="secondary" disabled={busy || dirty} title={dirty ? "บันทึกการแก้ไขก่อนเปิดขาย" : undefined} onClick={() => setConfirm("publish")}>
                เปิดขาย
              </Button>
            )}
            {design?.published && (
              <Button type="button" variant={design.isActive ? "danger" : "secondary"} disabled={busy} onClick={() => setConfirm("active")}>
                {design.isActive ? "ปิดแบบนี้" : "เปิดแบบนี้"}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>ปิดหน้าต่าง</Button>
            <Button type="submit" loading={busy}>{design ? "บันทึก" : "บันทึกเป็นร่าง"}</Button>
          </div>
        </div>
      </form>

      {design ? <CardImage design={design} onChanged={onChanged} /> : <Note tone="zinc">บันทึกแบบก่อน แล้วจึงอัปโหลดรูปบนการ์ดเลือกแบบได้ (ไม่บังคับ)</Note>}

      <ConfirmDialog open={confirm === "price"} title="แก้ราคาตัวเรือน" confirmLabel="ยืนยันบันทึก" onClose={() => setConfirm(null)} onConfirm={async () => { await doSave(); return null; }}>
        <p>แบบนี้เปิดขายแล้ว — ราคาตัวเรือนใหม่ {fmtThb(priceParsed)} มีผลกับการออกแบบหลังจากนี้ · รหัสสั่งทำที่ออกไปแล้วคงราคาเดิม</p>
      </ConfirmDialog>
      <ConfirmDialog open={confirm === "publish"} title="เปิดขายแบบนี้" confirmLabel="เปิดขาย" onClose={() => setConfirm(null)} onConfirm={publish}>
        <p>เปิดขายครั้งแรก — จะ<strong>ล็อกถาวร</strong> จำนวนเม็ด ทรง ขนาดพลอย และทิศเม็ด (แก้ภายหลังไม่ได้ ต้องทำสำเนาเป็นแบบใหม่) · ต้องมีราคาตัวเรือนและทรงที่เปิดอยู่</p>
      </ConfirmDialog>
      {design && (
        <ConfirmDialog open={confirm === "active"} danger={design.isActive} title={design.isActive ? "ปิดแบบนี้" : "เปิดแบบนี้"} confirmLabel={design.isActive ? "ปิดแบบ" : "เปิดแบบ"} onClose={() => setConfirm(null)} onConfirm={toggleActive}>
          {design.isActive ? (
            <p>ถ้าปิด: ลูกค้าที่มีงานค้างของแบบนี้จะเห็นว่าแบบปิดแล้วและต้องเลือกแบบใหม่ · รหัสเก่ายังตรวจได้ · ถ้าจำนวนเม็ดใดเหลือแบบเดียว ลูกค้ายังเห็นหน้าเลือกแบบ (การ์ดเดียว)</p>
          ) : (
            <p>เปิดแบบนี้อีกครั้ง — ลูกค้าจะเห็นเมื่อทรงเปิดอยู่และมีราคาตัวเรือน</p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}

function CardImage({ design, onChanged }: { design: AdminDesign; onChanged: () => Promise<void> }) {
  const { push } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const { resizeImageVariant } = await import("@/lib/images/client");
      const md = await resizeImageVariant(file, MD_MAX_PX);
      const fd = new FormData();
      fd.set("designId", design.id);
      fd.set("md", new File([md.blob], "card.jpg", { type: "image/jpeg" }));
      const res = await uploadRingCardImage(fd);
      if (!res.ok) setErr(ringErrorText(res));
      else {
        push("อัปโหลดรูปการ์ดแล้ว");
        await onChanged();
      }
    } catch {
      setErr("ย่อ/อัปโหลดรูปไม่สำเร็จ — ใช้ไฟล์ JPG หรือ PNG ที่เปิดดูได้ แล้วลองใหม่");
    } finally {
      setBusy(false);
    }
  }
  async function clear() {
    setBusy(true);
    setErr(null);
    const res = await clearRingCardImage(design.id);
    setBusy(false);
    if (!res.ok) return setErr(ringErrorText(res));
    push("ลบรูปการ์ดแล้ว");
    await onChanged();
  }

  return (
    <section aria-label="รูปบนการ์ดเลือกแบบ" className="space-y-2 border-t border-zinc-200 pt-3">
      <div className="text-sm font-semibold text-zinc-800">รูปบนการ์ดเลือกแบบ (ไม่บังคับ)</div>
      <div className="flex flex-wrap items-center gap-3">
        {design.cardImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={design.cardImageUrl} alt={`รูปการ์ด ${design.stoneCount} เม็ด ${design.name}`} className="h-20 w-20 rounded-md border border-zinc-200 object-cover" />
        ) : (
          <span className="text-sm text-zinc-600">ยังไม่มีรูป — การ์ดจะใช้แผนภาพ 2D</span>
        )}
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="เลือกไฟล์รูปการ์ด" onChange={onPick} />
        <Button type="button" variant="secondary" size="sm" loading={busy} onClick={() => input.current?.click()}>
          {design.cardImageUrl ? "เปลี่ยนรูป" : "อัปโหลดรูป"}
        </Button>
        {design.cardImageUrl && (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={clear}>
            ลบรูป
          </Button>
        )}
      </div>
      <ErrorLine message={err} />
    </section>
  );
}
