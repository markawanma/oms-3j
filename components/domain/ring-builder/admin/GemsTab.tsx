"use client";

// แท็บ "พลอย (ราคาขาย)" — AdminGems · ทรงพลอย (แถบ) + ตารางพลอย (ราคาตามทรง×ขนาด · coverage) · แก้ไขใน StoneDialog
// 🔴 นี่คือ "ราคาขาย" ที่ลูกค้าเห็น — คนละตารางกับต้นทุนพลอยงานผลิต (/oem/gems) · ไม่คำนวณเงินที่นี่ แสดงเลขที่ server คืนเท่านั้น
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Gem } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { saveRingShape, setRingActive } from "@/lib/actions/ring-builder";
import type { AdminCatalog, AdminShape, AdminStone } from "@/lib/ring-builder/admin-types";
import { COVERAGE_REASON_LABEL, fmtThb, ringErrorText } from "@/lib/ring-builder/admin-ui";
import { CZ_WHITE } from "@/lib/ring-builder/config";
import { ConfirmDialog, ErrorLine, Field, RB_FIELD, ShapeGlyph, Swatch } from "./ui";
import { StoneDialog } from "./StoneDialog";

type Dlg = { t: "stone"; id: string | "new" } | { t: "shape"; shape: AdminShape | "new" } | { t: "shape-toggle"; shape: AdminShape } | null;

export function GemsTab({ catalog, onChanged }: { catalog: AdminCatalog; onChanged: () => Promise<void> }) {
  const [dlg, setDlg] = useState<Dlg>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "on" | "off">("all");
  const { push } = useToast();

  const stones = useMemo(() => {
    const t = q.trim().toLowerCase();
    return catalog.stones.filter((s) => (status === "all" || (status === "on") === s.isActive) && (t === "" || s.nameTh.toLowerCase().includes(t) || s.shortName.toLowerCase().includes(t)));
  }, [catalog.stones, q, status]);

  async function toggleShape(shape: AdminShape): Promise<string | null> {
    const res = await setRingActive({ kind: "shape", id: shape.id, active: !shape.isActive });
    if (!res.ok) return ringErrorText(res);
    push(shape.isActive ? `ปิดทรง "${shape.nameTh}" แล้ว` : `เปิดทรง "${shape.nameTh}" แล้ว`);
    await onChanged();
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-zinc-900">พลอยสำหรับออกแบบแหวน (ราคาขาย)</h2>
          <p className="mt-0.5 text-sm text-zinc-700">ราคาที่ลูกค้าเห็นบนหน้าออกแบบแหวน · แยกจากต้นทุนพลอยงานผลิต (/oem/gems)</p>
        </div>
        <Button type="button" onClick={() => setDlg({ t: "stone", id: "new" })}>
          ＋ เพิ่มพลอย
        </Button>
      </div>

      <section aria-label="ทรงพลอย" className="rounded-lg border border-zinc-200 bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1 basis-64">
            <div className="text-sm font-bold text-zinc-900">ทรงพลอย</div>
            <div className="text-xs text-zinc-600">กรอกขนาดเป็น กว้าง × ยาว (มม.) ทุกทรง · รูปร่างที่ระบบวาดได้มี กลม / ไข่</div>
          </div>
          <ul className="flex flex-wrap items-center gap-2">
            {catalog.shapes.map((s) => (
              <li key={s.id} className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm ${s.isActive ? "border-zinc-200 bg-zinc-50" : "border-dashed border-zinc-300 bg-white text-zinc-500"}`}>
                <ShapeGlyph kind={s.renderKind} />
                <span className="font-semibold">{s.nameTh}</span>
                <span className="text-xs text-zinc-600">{s.isActive ? `ใช้ใน ${s.usedByActiveDesigns} แบบ` : "ปิดอยู่"}</span>
                <button type="button" className="min-h-11 px-1 text-xs font-semibold text-primary-700 underline-offset-2 hover:underline" aria-label={`แก้ชื่อทรง ${s.nameTh}`} onClick={() => setDlg({ t: "shape", shape: s })}>
                  แก้ชื่อ
                </button>
                <button type="button" className="min-h-11 px-1 text-xs font-semibold text-zinc-700 underline-offset-2 hover:underline" aria-label={`${s.isActive ? "ปิด" : "เปิด"}ทรง ${s.nameTh}`} onClick={() => setDlg({ t: "shape-toggle", shape: s })}>
                  {s.isActive ? "ปิด" : "เปิด"}
                </button>
              </li>
            ))}
            <li>
              <Button type="button" variant="secondary" size="sm" onClick={() => setDlg({ t: "shape", shape: "new" })}>
                ＋ เพิ่มทรง
              </Button>
            </li>
          </ul>
        </div>
      </section>

      {catalog.stones.length === 0 ? (
        <EmptyState icon={Gem} title="ยังไม่มีพลอย" description={`ลูกค้าจะเลือกได้แค่ ${CZ_WHITE.name} · กด "เพิ่มพลอย" เพื่อเริ่มตั้งราคาขาย`} action={<Button type="button" onClick={() => setDlg({ t: "stone", id: "new" })}>＋ เพิ่มพลอย</Button>} />
      ) : (
        <section aria-label="รายการพลอย" className="rounded-lg border border-zinc-200 bg-white">
          <div className="flex flex-wrap gap-2 border-b border-zinc-200 p-3">
            <label className="sr-only" htmlFor="rb-gq">ค้นหาพลอย</label>
            <input id="rb-gq" className={`${RB_FIELD} min-w-44 flex-1`} placeholder="ค้นหาชื่อพลอย" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="sr-only" htmlFor="rb-gs">กรองสถานะ</label>
            <select id="rb-gs" className={`${RB_FIELD} w-auto`} value={status} onChange={(e) => setStatus(e.target.value as "all" | "on" | "off")}>
              <option value="all">ทุกสถานะ</option>
              <option value="on">เปิดขาย</option>
              <option value="off">ปิด</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs font-semibold text-zinc-600">
                  <th className="px-3 py-2.5">ลำดับ</th>
                  <th className="px-3 py-2.5">พลอย</th>
                  <th className="px-3 py-2.5">ราคาต่อเม็ดตามทรงและขนาด</th>
                  <th className="px-3 py-2.5">ขายได้ในแบบ</th>
                  <th className="px-3 py-2.5">สถานะ</th>
                  <th className="px-3 py-2.5"><span className="sr-only">จัดการ</span></th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-zinc-100">
                  <td className="px-3 py-3">0</td>
                  <td className="px-3 py-3">
                    <Swatch hex={CZ_WHITE.colorHex} />
                    <strong>{CZ_WHITE.name}</strong> <Badge>ค่าเริ่มต้น</Badge>
                  </td>
                  <td className="px-3 py-3 text-zinc-600">รวมในตัวเรือน</td>
                  <td className="px-3 py-3 text-zinc-600">ทุกแบบ</td>
                  <td className="px-3 py-3"><Badge tone="green">เปิดขาย</Badge></td>
                  <td />
                </tr>
                {stones.map((s) => (
                  <StoneRow key={s.id} s={s} onEdit={() => setDlg({ t: "stone", id: s.id })} />
                ))}
                {stones.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-sm text-zinc-600">ไม่พบพลอยตามที่กรอง</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {dlg?.t === "stone" && <StoneDialog catalog={catalog} stoneId={dlg.id} onChanged={onChanged} onClose={() => setDlg(null)} onSwitch={(id) => setDlg({ t: "stone", id })} />}
      {dlg?.t === "shape" && <ShapeDialog shape={dlg.shape} onChanged={onChanged} onClose={() => setDlg(null)} />}
      {dlg?.t === "shape-toggle" && (
        <ConfirmDialog
          open
          danger={dlg.shape.isActive}
          title={dlg.shape.isActive ? `ปิดทรง "${dlg.shape.nameTh}"` : `เปิดทรง "${dlg.shape.nameTh}"`}
          confirmLabel={dlg.shape.isActive ? "ปิดทรง" : "เปิดทรง"}
          onClose={() => setDlg(null)}
          onConfirm={() => toggleShape(dlg.shape)}
        >
          {dlg.shape.isActive ? (
            <p>
              ทรงนี้<strong>ใช้ใน {dlg.shape.usedByActiveDesigns} แบบ</strong>ที่เปิดอยู่ — ปิดแล้วแบบเหล่านั้นจะถูกซ่อนจากลูกค้า และราคาพลอยของทรงนี้จะไม่ขึ้นให้เลือก · รหัสที่ออกไปแล้วยังตรวจได้
            </p>
          ) : (
            <p>เปิดทรงนี้อีกครั้ง — แบบและราคาที่ผูกกับทรงนี้จะกลับมาแสดงตามสถานะเดิมของแต่ละรายการ</p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}

function StoneRow({ s, onEdit }: { s: AdminStone; onEdit: () => void }) {
  const active = s.offers.filter((o) => o.isActive);
  const cov = s.coverage;
  const short = s.isActive && cov.sellableDesigns < cov.visibleDesigns;
  return (
    <tr className={`border-b border-zinc-100 align-top ${short ? "bg-amber-50/40" : ""}`}>
      <td className="px-3 py-3">{s.stoneNo}</td>
      <td className="px-3 py-3">
        <Swatch hex={s.colorHex} />
        <strong>{s.nameTh}</strong>
      </td>
      <td className="px-3 py-3">
        {active.length === 0 ? (
          <span className="text-zinc-600">ยังไม่มีราคา</span>
        ) : (
          <ul className="space-y-0.5">
            {active.map((o) => (
              <li key={o.id}>
                {o.shapeName} {o.stoneLabel} {o.priceThb === null ? <span className="text-amber-800">ยังไม่ตั้งราคา</span> : <strong>{fmtThb(o.priceThb)}</strong>}
              </li>
            ))}
          </ul>
        )}
      </td>
      <td className="px-3 py-3">
        {s.isActive ? (
          <>
            <Badge tone={short ? "amber" : "green"}>
              {cov.sellableDesigns}/{cov.visibleDesigns} แบบ
            </Badge>
            {cov.missing.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-zinc-700">
                {cov.missing.map((m) => (
                  <li key={`${m.designNo}-${m.reason}`}>
                    ขาด {m.stoneCount} เม็ด {m.designName} ({m.shapeName} {m.stoneLabel}) · {COVERAGE_REASON_LABEL[m.reason]}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <span className="text-zinc-600">— (ปิดอยู่)</span>
        )}
      </td>
      <td className="px-3 py-3">{s.isActive ? <Badge tone="green">เปิดขาย</Badge> : <Badge>ปิด</Badge>}</td>
      <td className="px-3 py-3">
        <Button type="button" variant="secondary" size="sm" onClick={onEdit} aria-label={`แก้ไข ${s.nameTh}`}>
          แก้ไข
        </Button>
      </td>
    </tr>
  );
}

function ShapeDialog({ shape, onChanged, onClose }: { shape: AdminShape | "new"; onChanged: () => Promise<void>; onClose: () => void }) {
  const isNew = shape === "new";
  const [name, setName] = useState(isNew ? "" : shape.nameTh);
  const [kind, setKind] = useState<"round" | "oval">(isNew ? "round" : shape.renderKind);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { push } = useToast();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim() === "") return setErr("กรอกชื่อทรง");
    setBusy(true);
    setErr(null);
    const res = await saveRingShape({ id: isNew ? null : shape.id, name: name.trim(), renderKind: isNew ? kind : null });
    setBusy(false);
    if (!res.ok) return setErr(ringErrorText(res)); // ค่าที่กรอกอยู่คงเดิม
    push(isNew ? "เพิ่มทรงแล้ว" : "บันทึกชื่อทรงแล้ว");
    await onChanged();
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={isNew ? "เพิ่มทรงพลอย" : `แก้ชื่อทรง · ${shape.nameTh}`}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <Field label="ชื่อทรง (ลูกค้าเห็น)" hint="เพิ่มชื่อทรงได้เอง แต่รูปร่างที่ระบบวาดได้มีแค่ กลม / ไข่">
          {(p) => <input {...p} className={RB_FIELD} value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="รูปร่างที่ใช้วาด" hint={isNew ? "เลือกแล้วแก้ไม่ได้ภายหลัง (ถ้าต้องการรูปร่างอื่นให้สร้างทรงใหม่)" : "รูปร่างของทรงแก้ไม่ได้"}>
          {(p) => (
            <select {...p} className={RB_FIELD} value={kind} disabled={!isNew} onChange={(e) => setKind(e.target.value as "round" | "oval")}>
              <option value="round">กลม</option>
              <option value="oval">ไข่</option>
            </select>
          )}
        </Field>
        <ErrorLine message={err} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>ยกเลิก</Button>
          <Button type="submit" loading={busy}>บันทึก</Button>
        </div>
      </form>
    </Modal>
  );
}
