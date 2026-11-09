"use client";

// แก้ไข/เพิ่มพลอย (ราคาขาย) — ชื่อ · ชื่อสั้น · สี · ลำดับ + ราคาต่อเม็ดตามทรง×ขนาด (ขนาด 2 ช่อง) + ปิด/เปิด
// ราคา: ส่งเลขเต็มบาทที่ผู้ใช้กรอกให้ action ตรงๆ (ไม่คำนวณ) · แก้ราคา/ปิด = ต้องยืนยันก่อน · ค่าที่กรอกไม่หายเมื่อ error
import { useState } from "react";
import type { FormEvent } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { saveRingOffer, saveRingStone, setRingActive, setRingOfferPrice } from "@/lib/actions/ring-builder";
import type { AdminCatalog, AdminOffer, AdminStone } from "@/lib/ring-builder/admin-types";
import { composeSize, fmtThb, parseWholeThb, ringErrorText } from "@/lib/ring-builder/admin-ui";
import { formatMm100, parseStoneSize } from "@/lib/ring-builder/mm";
import { ConfirmDialog, ErrorLine, Field, Note, RB_FIELD, SizeFields } from "./ui";

const PRICE_MAX = 100000;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function StoneDialog({ catalog, stoneId, onChanged, onClose, onSwitch }: { catalog: AdminCatalog; stoneId: string | "new"; onChanged: () => Promise<void>; onClose: () => void; onSwitch: (id: string) => void }) {
  const stone = stoneId === "new" ? null : catalog.stones.find((s) => s.id === stoneId) ?? null;
  return (
    <Modal open onClose={onClose} title={stone ? `แก้ไข · ${stone.nameTh}` : "เพิ่มพลอย"} wide>
      <StoneForm key={stone?.id ?? "new"} catalog={catalog} stone={stone} onChanged={onChanged} onClose={onClose} onSwitch={onSwitch} />
    </Modal>
  );
}

function StoneForm({ catalog, stone, onChanged, onClose, onSwitch }: { catalog: AdminCatalog; stone: AdminStone | null; onChanged: () => Promise<void>; onClose: () => void; onSwitch: (id: string) => void }) {
  const { push } = useToast();
  const [name, setName] = useState(stone?.nameTh ?? "");
  const [shortName, setShortName] = useState(stone?.shortName ?? "");
  const [color, setColor] = useState(stone?.colorHex ?? "#888888");
  const [sort, setSort] = useState(stone ? String(stone.sort) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<{ name?: string; short?: string; color?: string; sort?: string }>({});
  const [confirmActive, setConfirmActive] = useState(false);
  // S9: เคยมีแถวราคา = ชื่อ/สีแก้ไม่ได้ (DB: stone_locked) — ปิดช่องก่อนกดบันทึกแทนปล่อยให้ error ทีหลัง
  const nameLocked = stone?.nameLocked ?? false;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const fe: typeof fieldErr = {};
    if (name.trim() === "") fe.name = "กรอกชื่อพลอย (ชื่อจริงตามชนิดวัสดุ)";
    const sn = [...shortName.trim()].length;
    if (sn < 1 || sn > 6) fe.short = "ชื่อสั้นต้องยาว 1-6 ตัวอักษร";
    if (!HEX_RE.test(color)) fe.color = "สีต้องเป็นรหัส #RRGGBB";
    if (sort.trim() !== "" && !/^-?\d{1,6}$/.test(sort.trim())) fe.sort = "ลำดับต้องเป็นจำนวนเต็ม";
    setFieldErr(fe);
    setErr(null);
    if (Object.keys(fe).length > 0) return;
    setBusy(true);
    try {
      const res = await saveRingStone({ id: stone?.id ?? null, name: name.trim(), shortName: shortName.trim(), colorHex: color, sort: sort.trim() === "" ? null : Number.parseInt(sort.trim(), 10) });
      if (!res.ok) return setErr(ringErrorText(res)); // ไม่ล้างฟอร์ม
      push(res.data.created ? "เพิ่มพลอยแล้ว — ตั้งราคาตามทรง/ขนาดต่อได้เลย" : "บันทึกพลอยแล้ว");
      await onChanged();
      if (res.data.created) onSwitch(res.data.id); // เปิดต่อเป็นโหมดแก้ไข เพื่อเพิ่มราคา
    } catch {
      setErr("บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง"); // S7: busy ไม่ค้าง
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(): Promise<string | null> {
    if (!stone) return null;
    const res = await setRingActive({ kind: "stone", id: stone.id, active: !stone.isActive });
    if (!res.ok) return ringErrorText(res);
    push(stone.isActive ? "ปิดพลอยแล้ว" : "เปิดพลอยแล้ว");
    await onChanged();
    return null;
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-3" noValidate>
        {nameLocked && <Note>พลอยนี้เคยมีราคาขายแล้ว — แก้ชื่อ/สีไม่ได้ (รหัสสั่งทำที่ออกไปแล้วอ้างชื่อและสีนี้) ถ้าต้องการเปลี่ยน ให้เพิ่มพลอยใหม่แทน · แก้ชื่อสั้นและลำดับได้</Note>}
        <Field label="ชื่อพลอย (ลูกค้าเห็น)" error={fieldErr.name} hint="ใช้ชื่อพลอยจริงตามชนิดวัสดุ">
          {(p) => <input {...p} className={RB_FIELD} value={name} maxLength={40} disabled={nameLocked} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="ชื่อสั้น (บนแถบตำแหน่ง · ไม่เกิน 6 ตัวอักษร)" error={fieldErr.short}>
            {(p) => <input {...p} className={RB_FIELD} value={shortName} onChange={(e) => setShortName(e.target.value)} />}
          </Field>
          <Field label="ลำดับที่แสดง" error={fieldErr.sort} hint="เว้นว่าง = ให้ระบบกำหนด">
            {(p) => <input {...p} inputMode="numeric" className={RB_FIELD} value={sort} onChange={(e) => setSort(e.target.value)} />}
          </Field>
        </div>
        <Field label="สีที่ใช้แสดงในภาพแหวน" error={fieldErr.color}>
          {(p) => (
            <div className="flex items-center gap-2">
              <input aria-label="เลือกสี" type="color" className="h-11 w-14 rounded-md border border-zinc-300 bg-white p-1" value={HEX_RE.test(color) ? color : "#888888"} disabled={nameLocked} onChange={(e) => setColor(e.target.value)} />
              <input {...p} className={`${RB_FIELD} max-w-36`} value={color} maxLength={7} disabled={nameLocked} onChange={(e) => setColor(e.target.value)} />
            </div>
          )}
        </Field>
        <ErrorLine message={err} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          {stone ? (
            <Button type="button" variant={stone.isActive ? "danger" : "secondary"} onClick={() => setConfirmActive(true)}>
              {stone.isActive ? "ปิดพลอยนี้" : "เปิดพลอยนี้"}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>ปิดหน้าต่าง</Button>
            <Button type="submit" loading={busy}>บันทึก</Button>
          </div>
        </div>
      </form>

      {stone ? (
        <OffersSection catalog={catalog} stone={stone} onChanged={onChanged} />
      ) : (
        <Note tone="zinc">บันทึกพลอยก่อน แล้วจึงตั้งราคาต่อเม็ดตามทรงและขนาดได้ · ทรง + ขนาดต้องตรงกับแบบแหวน พลอยจึงจะขึ้นให้ลูกค้าเลือก</Note>
      )}

      {stone && (
        <ConfirmDialog
          open={confirmActive}
          danger={stone.isActive}
          title={stone.isActive ? `ปิดพลอย "${stone.nameTh}"` : `เปิดพลอย "${stone.nameTh}"`}
          confirmLabel={stone.isActive ? "ปิดพลอย" : "เปิดพลอย"}
          onClose={() => setConfirmActive(false)}
          onConfirm={toggleActive}
        >
          {stone.isActive ? (
            <p>ถ้าปิด: ลูกค้าที่กำลังออกแบบต้องเลือกพลอยใหม่ · รหัสที่ออกไปแล้วยังตรวจได้ (ขึ้นป้ายว่าพลอยปิดแล้ว)</p>
          ) : (
            <p>เปิดพลอยนี้อีกครั้ง — จะขึ้นให้ลูกค้าเลือกในแบบที่มีราคาทรง/ขนาดตรงกัน</p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}

function OffersSection({ catalog, stone, onChanged }: { catalog: AdminCatalog; stone: AdminStone; onChanged: () => Promise<void> }) {
  return (
    <section aria-label="ราคาต่อเม็ดตามทรงและขนาด" className="space-y-3 border-t border-zinc-200 pt-4">
      <h3 className="text-sm font-bold text-zinc-900">ราคาต่อเม็ดตามทรงและขนาด</h3>
      <Note>แก้ราคา = มีผลกับการออกแบบหลังจากนี้ · รหัสสั่งทำที่ออกไปแล้วยังคงราคาเดิม (ตรวจย้อนได้ที่แท็บ "ตรวจรหัสสั่งทำ")</Note>
      {stone.offers.length === 0 ? (
        <p className="text-sm text-zinc-600">ยังไม่มีราคา — เพิ่มทรง/ขนาดด้านล่าง</p>
      ) : (
        <ul className="space-y-2">
          {stone.offers.map((o) => (
            <OfferRow key={`${o.id}:${o.priceThb}:${o.isActive}`} offer={o} onChanged={onChanged} />
          ))}
        </ul>
      )}
      <NewOfferRow catalog={catalog} stone={stone} onChanged={onChanged} />
    </section>
  );
}

function OfferRow({ offer, onChanged }: { offer: AdminOffer; onChanged: () => Promise<void> }) {
  const { push } = useToast();
  const [price, setPrice] = useState(offer.priceThb === null ? "" : String(offer.priceThb));
  const [confirm, setConfirm] = useState<"price" | "close" | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const parsed = parseWholeThb(price, PRICE_MAX);
  const dirty = parsed !== null && parsed !== offer.priceThb;

  async function savePrice() {
    if (parsed === null) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await setRingOfferPrice({ offerId: offer.id, priceThb: parsed });
      setConfirm(null);
      if (!res.ok) return setErr(ringErrorText(res));
      push(res.data.unchanged ? "ราคาเท่าเดิม ไม่มีการเปลี่ยน" : "บันทึกราคาแล้ว");
      await onChanged();
    } catch {
      setConfirm(null);
      setErr("บันทึกราคาไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  }
  /** เปิด offer ที่ปิดอยู่ (ไม่ต้องยืนยัน) — action โยนแล้วต้องไม่ปล่อยเป็น unhandled rejection */
  async function reopen() {
    setBusy(true);
    try {
      const e = await toggle();
      if (e) setErr(e);
    } catch {
      setErr("ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  }
  async function toggle(): Promise<string | null> {
    const res = await setRingActive({ kind: "offer", id: offer.id, active: !offer.isActive });
    if (!res.ok) return ringErrorText(res);
    push(offer.isActive ? "ปิดราคาทรง/ขนาดนี้แล้ว" : "เปิดราคาทรง/ขนาดนี้แล้ว");
    await onChanged();
    return null;
  }

  return (
    <li className={`rounded-md border p-2.5 ${offer.isActive ? "border-zinc-200" : "border-dashed border-zinc-300 bg-zinc-50"}`}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-32 flex-1">
          <div className="text-sm font-semibold text-zinc-900">
            {offer.shapeName} {offer.stoneLabel} มม. {!offer.isActive && <Badge>ปิด</Badge>}
          </div>
          <div className="text-xs text-zinc-600">ปัจจุบัน {offer.priceThb === null ? "ยังไม่ตั้งราคา" : fmtThb(offer.priceThb)} / เม็ด</div>
        </div>
        <Field label="ราคา (บาท/เม็ด)" className="w-36" error={price !== "" && parsed === null ? "จำนวนเต็ม 1-100,000" : null}>
          {(p) => <input {...p} inputMode="numeric" className={RB_FIELD} value={price} onChange={(e) => setPrice(e.target.value)} />}
        </Field>
        <Button type="button" variant="secondary" size="sm" disabled={!dirty || busy} onClick={() => setConfirm("price")}>
          บันทึกราคา
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => (offer.isActive ? setConfirm("close") : void reopen())}>
          {offer.isActive ? "ปิด" : "เปิด"}
        </Button>
      </div>
      {confirm === "price" && parsed !== null && (
        <div role="group" aria-label="ยืนยันแก้ราคา" className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-amber-50 p-2 text-sm text-amber-900">
          <span>
            ยืนยันตั้งราคา {fmtThb(parsed)}/เม็ด{offer.priceThb !== null ? ` (เดิม ${fmtThb(offer.priceThb)})` : ""} — มีผลกับการออกแบบหลังจากนี้ รหัสเก่าคงราคาเดิม
          </span>
          <Button type="button" size="sm" loading={busy} onClick={savePrice}>ยืนยัน</Button>
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setConfirm(null)}>ยกเลิก</Button>
        </div>
      )}
      <ErrorLine message={err} />
      <ConfirmDialog open={confirm === "close"} danger title="ปิดราคาทรง/ขนาดนี้" confirmLabel="ปิด" onClose={() => setConfirm(null)} onConfirm={toggle}>
        <p>
          พลอยนี้จะหายจากแบบที่ใช้ {offer.shapeName} {offer.stoneLabel} — ลูกค้าที่กำลังออกแบบต้องเลือกพลอยใหม่ · รหัสที่ออกไปแล้วยังตรวจได้
        </p>
      </ConfirmDialog>
    </li>
  );
}

function NewOfferRow({ catalog, stone, onChanged }: { catalog: AdminCatalog; stone: AdminStone; onChanged: () => Promise<void> }) {
  const { push } = useToast();
  const shapes = catalog.shapes.filter((s) => s.isActive);
  const [shapeId, setShapeId] = useState(shapes[0]?.id ?? "");
  const [w, setW] = useState("");
  const [h, setH] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const shape = shapes.find((s) => s.id === shapeId) ?? null;
  const round = shape?.renderKind === "round";
  const size = parseStoneSize(w.trim() === "" ? "" : composeSize(w, round ? w : h));
  const sizeErr = w.trim() === "" && h.trim() === "" ? null : !size.ok ? (size.reason === "range" ? "ขนาดต้องอยู่ระหว่าง 0.50-20.00 มม." : "ขนาดไม่ถูกต้อง") : null;
  // ซ้ำ = ทรง + ขนาด (major/minor เป็นจำนวนเต็ม mm100) เดียวกับ offer ที่เปิดอยู่ของพลอยนี้
  const dup = size.ok && stone.offers.find((o) => o.isActive && o.shapeId === shapeId && o.stoneMm100.major === size.major && o.stoneMm100.minor === size.minor);
  const priceParsed = parseWholeThb(price, PRICE_MAX);
  const canAdd = !!shape && size.ok && !dup && priceParsed !== null && !busy;

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!canAdd || priceParsed === null) return;
    setBusy(true);
    setErr(null);
    try {
      const o = await saveRingOffer({ stoneId: stone.id, shapeId, size: composeSize(w, round ? w : h) });
      if (!o.ok) return setErr(ringErrorText(o));
      const p = await setRingOfferPrice({ offerId: o.data.offerId, priceThb: priceParsed });
      if (!p.ok) {
        // S2: บันทึกสำเร็จบางส่วน — เพิ่มทรง/ขนาดแล้วแต่ราคาไม่ติด → ข้อความบอกส่วนที่สำเร็จเสมอ (ไม่ให้ข้อความของ code ทับ) · รายการแสดงเป็น "ยังไม่ตั้งราคา" ให้ตั้งต่อ
        await onChanged().catch(() => undefined);
        return setErr(`เพิ่มทรง/ขนาดแล้ว แต่ตั้งราคาไม่สำเร็จ: ${ringErrorText(p)} — ตั้งราคาในรายการด้านบน`);
      }
      push(o.data.reactivated ? "เปิดราคาเดิมกลับมาและตั้งราคาแล้ว" : "เพิ่มราคาทรง/ขนาดแล้ว");
      setW("");
      setH("");
      setPrice("");
      await onChanged();
    } catch {
      setErr("ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  if (shapes.length === 0) return <Note>ยังไม่มีทรงที่เปิดอยู่ — เพิ่มหรือเปิดทรงพลอยก่อนจึงตั้งราคาได้</Note>;
  return (
    <form onSubmit={add} className="space-y-2 rounded-md border border-dashed border-zinc-300 p-3" aria-label="เพิ่มทรงและขนาด" noValidate>
      <div className="text-sm font-semibold text-zinc-800">＋ เพิ่มทรง/ขนาด</div>
      <div className="grid gap-2 sm:grid-cols-[10rem_1fr_9rem]">
        <Field label="ทรง">
          {(p) => (
            <select {...p} className={RB_FIELD} value={shapeId} onChange={(e) => setShapeId(e.target.value)}>
              {shapes.map((s) => (
                <option key={s.id} value={s.id}>{s.nameTh}</option>
              ))}
            </select>
          )}
        </Field>
        <SizeFields w={w} h={h} round={round} onChange={(a, b) => { setW(a); setH(b); }} error={sizeErr} />
        <Field label="ราคา (บาท/เม็ด)" error={price !== "" && priceParsed === null ? "จำนวนเต็ม 1-100,000" : null}>
          {(p) => <input {...p} inputMode="numeric" className={RB_FIELD} value={price} onChange={(e) => setPrice(e.target.value)} />}
        </Field>
      </div>
      {dup && (
        <p role="alert" className="text-xs font-medium text-red-700">
          ⚠ {shape?.nameTh} {formatMm100(dup.stoneMm100.major)}×{formatMm100(dup.stoneMm100.minor)} ซ้ำกับรายการที่มีอยู่ — แก้ราคาในรายการด้านบน หรือเปลี่ยนขนาด
        </p>
      )}
      <p className="text-xs text-zinc-600">ทรง + ขนาดต้องตรงกับแบบแหวน พลอยจึงจะขึ้นให้ลูกค้าเลือก</p>
      <ErrorLine message={err} />
      <Button type="submit" variant="secondary" size="sm" loading={busy} disabled={!canAdd}>
        เพิ่มทรง/ขนาด
      </Button>
    </form>
  );
}
