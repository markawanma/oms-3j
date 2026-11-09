"use client";

// แท็บ "ตรวจรหัสสั่งทำ" — AdminVerify + AdminVerifyStates · วางข้อความทั้งก้อน → checkRingCode → 8 สถานะ (+ "กำลังตรวจ" ฝั่ง client)
// 🔴 "ระบบตรวจไม่ได้" (unavailable) แยกจาก "รหัสผิด" ชัด: คนละป้าย คนละสี และมีข้อความ "อย่าบอกลูกค้าว่ารหัสผิด"
// ตัวเลขเงินทุกตัว (ตอนสร้าง · ปัจจุบัน · ต่าง · ข้อความแจ้งราคาใหม่) มาจาก server — หน้านี้ไม่คำนวณ
import { useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { checkRingCode } from "@/lib/actions/ring-builder";
import type { CodeCheckResult, CodeCheckView } from "@/lib/ring-builder/admin-types";
import { fmtDiffThb, fmtThb, ringErrorText } from "@/lib/ring-builder/admin-ui";
import { RB_FIELD } from "./ui";

type State =
  | { k: "idle" }
  | { k: "loading" }
  | { k: "result"; r: CodeCheckResult }
  | { k: "unavailable"; detail: string | null };

export function VerifyTab() {
  const [text, setText] = useState("");
  const [st, setSt] = useState<State>({ k: "idle" });
  const seq = useRef(0);

  async function run(value: string) {
    const my = ++seq.current;
    setSt({ k: "loading" });
    try {
      const res = await checkRingCode(value);
      if (my !== seq.current) return; // ผลเก่ามาช้า — ทิ้ง
      if (!res.ok) setSt({ k: "unavailable", detail: ringErrorText(res) });
      else setSt({ k: "result", r: res.data });
    } catch {
      if (my !== seq.current) return;
      setSt({ k: "unavailable", detail: null });
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (st.k === "loading") return;
    if (text.trim() === "") return setSt({ k: "idle" });
    void run(text);
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-zinc-900">ตรวจรหัสสั่งทำ</h2>
        <p className="mt-0.5 text-sm text-zinc-700">วางรหัส หรือวางข้อความทั้งก้อนจากแชทได้เลย ระบบดึงรหัสเอง (ไม่สนตัวพิมพ์/ช่องว่าง) · หน้านี้ไม่เก็บประวัติการตรวจ</p>
      </div>
      <form onSubmit={submit} aria-label="วางรหัส" className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3">
        <label htmlFor="rb-vc" className="text-sm font-semibold text-zinc-800">รหัส หรือข้อความจากลูกค้า</label>
        <textarea id="rb-vc" rows={4} maxLength={4000} className={`${RB_FIELD} py-2`} value={text} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" loading={st.k === "loading"} disabled={text.trim() === ""}>
          ตรวจ
        </Button>
      </form>
      <div aria-live="polite">
        <Result st={st} onRetry={() => void run(text)} />
      </div>
    </div>
  );
}

function StatusCard({ badge, tone, title, children, action }: { badge: string; tone: BadgeTone; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-4">
      <Badge tone={tone}>{badge}</Badge>
      <h3 className="text-base font-bold text-zinc-900">{title}</h3>
      {children && <div className="text-sm text-zinc-700">{children}</div>}
      {action}
    </div>
  );
}

function Result({ st, onRetry }: { st: State; onRetry: () => void }) {
  if (st.k === "idle") {
    return (
      <StatusCard badge="ยังว่าง" tone="slate" title="ยังไม่ได้วางรหัส">
        วางรหัส หรือข้อความจากแชทในกล่องด้านบน แล้วกด "ตรวจ" · หน้านี้ไม่เก็บประวัติการตรวจ
      </StatusCard>
    );
  }
  if (st.k === "loading") {
    return (
      <StatusCard badge="กำลังตรวจ" tone="blue" title="กำลังตรวจรหัส…">
        ปุ่ม "ตรวจ" ปิดชั่วคราวระหว่างรอ กันกดซ้ำ
      </StatusCard>
    );
  }
  if (st.k === "unavailable") return <Unavailable detail={st.detail} onRetry={onRetry} />;

  const { status, view } = st.r;
  switch (status) {
    case "empty":
      return (
        <StatusCard badge="ยังว่าง" tone="slate" title="ยังไม่ได้วางรหัส">
          วางรหัส หรือข้อความจากแชทในกล่องด้านบน แล้วกด "ตรวจ"
        </StatusCard>
      );
    case "not_found":
      return (
        <StatusCard badge="ไม่พบรหัส" tone="slate" title="ไม่พบรหัสในข้อความที่วาง">
          ข้อความที่วางอาจไม่ครบ ลองวางใหม่ทั้งก้อน หรือพิมพ์รหัสจากรูป
          <p className="mt-1 text-xs text-zinc-600">ยังไม่ใช่ "รหัสผิด" — ขอให้ตรวจว่าวางครบ</p>
        </StatusCard>
      );
    case "bad_format":
      return (
        <StatusCard badge="รูปแบบผิด" tone="orange" title="รหัสไม่ผ่านการตรวจเลขท้าย">
          อาจพิมพ์ผิดหรือถูกแก้ ลองเทียบกับรหัสในรูปที่ลูกค้าส่ง
          <p className="mt-1 text-xs text-zinc-600">ถ้ายังไม่ผ่าน: ขอให้ลูกค้าส่งรูปหรือรหัสใหม่</p>
        </StatusCard>
      );
    case "not_issued":
      return (
        <StatusCard badge="ไม่ได้ออกโดยระบบ" tone="red" title="ระบบไม่ได้ออกรหัสนี้">
          รูปแบบถูกต้อง แต่ระบบไม่เคยออกรหัสนี้ (ลายเซ็นไม่ตรง)
          <p className="mt-1 text-xs font-semibold text-red-800">ห้ามรับออเดอร์จากรหัสนี้ · ให้ลูกค้าออกแบบใหม่</p>
        </StatusCard>
      );
    case "unavailable":
      return <Unavailable detail={null} onRetry={onRetry} />;
    case "design_closed":
    case "changed":
    case "ok":
      return view ? <Detail status={status} view={view} /> : <Unavailable detail="ระบบไม่ส่งรายละเอียดกลับมา" onRetry={onRetry} />;
    default:
      return <Unavailable detail={null} onRetry={onRetry} />;
  }
}

function Unavailable({ detail, onRetry }: { detail: string | null; onRetry: () => void }) {
  return (
    <StatusCard badge="ระบบตรวจไม่ได้" tone="amber" title="ตรวจไม่ได้ในตอนนี้ (ปัญหาฝั่งระบบ)" action={<Button type="button" variant="secondary" size="sm" onClick={onRetry}>ตรวจอีกครั้ง</Button>}>
      <strong>ไม่ได้แปลว่ารหัสผิด</strong> — อย่าบอกลูกค้าว่ารหัสผิด ลองตรวจใหม่อีกครั้งในอีกสักครู่
      {detail && <p className="mt-1 text-xs text-zinc-600">{detail}</p>}
    </StatusCard>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function Detail({ status, view }: { status: "ok" | "changed" | "design_closed"; view: CodeCheckView }) {
  const { push } = useToast();
  const sizeText =
    view.sizeStatus === "admin_check" || view.size === null ? "ลูกค้าให้แอดมินช่วยเช็กไซซ์" : `เบอร์ ${view.size}`;

  async function copy(text: string, ok: string) {
    if (await copyText(text)) push(ok);
    else push("คัดลอกไม่สำเร็จ — เลือกข้อความแล้วคัดลอกเอง", "error");
  }

  return (
    <section aria-label="ผลตรวจ" className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        {status === "ok" && <Badge tone="green">ระบบออกรหัสนี้จริง</Badge>}
        {status === "changed" && (
          <>
            <Badge tone="green">ระบบออกรหัสนี้จริง</Badge>
            <Badge tone="amber">{view.diffTotalThb !== null && view.diffTotalThb !== 0 ? `ราคาเปลี่ยนจากตอนสร้าง ${fmtDiffThb(view.diffTotalThb)}` : "ราคา/พลอยเปลี่ยนจากตอนสร้าง"}</Badge>
          </>
        )}
        {status === "design_closed" && <Badge tone="orange">เวอร์ชันเก่า / แบบปิดแล้ว</Badge>}
        <span className="font-mono text-sm font-semibold text-zinc-900">{view.code}</span>
      </div>

      {status === "design_closed" && (
        <p className="text-sm text-zinc-800">
          รหัสถูกต้อง แต่แบบนี้ปิดไปแล้ว{view.designClosedLabel ? ` (${view.designClosedLabel})` : ""} — แสดงรายละเอียดตามที่บันทึกไว้ตอนออกรหัส · แอดมินตัดสินว่าจะรับทำหรือเสนอแบบอื่น
        </p>
      )}
      {status === "changed" && <p className="text-sm text-zinc-800">รหัสถูกต้อง แต่ราคาหรือพลอยเปลี่ยนจากตอนสร้าง — ไม่บล็อก แอดมินตัดสินว่าจะใช้ราคาไหน แล้วแจ้งลูกค้าในแชท</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="space-y-1.5 text-sm">
          <div className="text-xs font-semibold text-zinc-600">แบบ · ไซซ์ · เวลาที่ออกรหัส</div>
          <div className="font-semibold text-zinc-900">{view.stoneCount} เม็ด · {view.designName}</div>
          <div className="text-zinc-700">พลอย {view.shapeName} {view.stoneLabel} มม.</div>
          <div className="text-zinc-700">{sizeText}</div>
          {view.sizeStatus === "out_of_range" && (
            <p role="alert" className="text-xs font-semibold text-red-700">⚠ ไซซ์นี้อยู่นอกช่วงที่แบบนี้ทำ ({view.sizeMin}–{view.sizeMax}) — ทักลูกค้าก่อนรับทำ</p>
          )}
          <div className="text-zinc-700">ราคาตอนสร้าง: {view.pricedAtLabel} <span className="text-xs text-zinc-600">({view.ageDays} วันก่อน)</span></div>
          <div className="pt-1 text-xs font-semibold text-zinc-600">พลอยทีละตำแหน่ง (นับซ้ายไปขวา)</div>
          <ol className="space-y-1">
            {view.lines.map((l) => (
              <li key={l.pos} className="flex items-center gap-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-zinc-100 text-xs font-bold">{l.pos}</span>
                <span>{l.name}</span>
                {l.closedNow && <Badge tone="red">ปิดแล้ว</Badge>}
              </li>
            ))}
          </ol>
          {view.closedStones.length > 0 && <p className="text-xs text-red-700">พลอยที่ปิดไปแล้ว: {view.closedStones.map((s) => s.name).join(" · ")}</p>}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs font-semibold text-zinc-600">
                <th className="px-2 py-2">รายการ</th>
                <th className="px-2 py-2 text-right">ตอนสร้าง</th>
                <th className="px-2 py-2 text-right">ปัจจุบัน</th>
                <th className="px-2 py-2 text-right">ต่าง</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r, i) => (
                <tr key={`${r.label}-${i}`} className="border-b border-zinc-100">
                  <td className="px-2 py-2">{r.label}{r.count !== null ? ` × ${r.count}` : ""}</td>
                  <td className="px-2 py-2 text-right">{r.included ? "รวมในตัวเรือน" : fmtThb(r.creationThb)}</td>
                  <td className="px-2 py-2 text-right">{r.included ? "รวมในตัวเรือน" : fmtThb(r.currentThb)}</td>
                  <td className="px-2 py-2 text-right">{r.included ? "—" : fmtDiffThb(r.diffThb)}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td className="px-2 py-2">รวม</td>
                <td className="px-2 py-2 text-right">{fmtThb(view.creationTotalThb)}</td>
                <td className="px-2 py-2 text-right">{fmtThb(view.currentTotalThb)}</td>
                <td className="px-2 py-2 text-right">{fmtDiffThb(view.diffTotalThb)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {!view.historyMatchesSignedTotal && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm font-medium text-red-800">
          ยอดที่เซ็นในรหัส ({fmtThb(view.signedTotalThb)}) ไม่ตรงกับยอดที่คิดย้อนจากประวัติราคา — ผิดปกติ ให้ดูประวัติราคาและอย่ารับทำจนกว่าจะตรวจ
        </p>
      )}

      <div role="note" className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900">
        รหัสยืนยันว่า <strong>ระบบออกให้ และแบบ/พลอย/ไซซ์/ราคา ณ ตอนนั้นคือเท่านี้</strong> — ไม่ได้ยืนยันว่ารูปหรือข้อความที่ลูกค้าส่งไม่ถูกแก้ ต้องเทียบตำแหน่งพลอยกับรูปในแชทด้วยตาเสมอ
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => void copy(view.summaryText, "คัดลอกสรุปแล้ว")}>
          คัดลอกสรุปไปใบงาน
        </Button>
        {status !== "ok" && (
          <Button type="button" variant="secondary" onClick={() => void copy(view.priceNoticeText, "คัดลอกข้อความแจ้งราคาใหม่แล้ว")}>
            คัดลอกข้อความแจ้งราคาใหม่
          </Button>
        )}
      </div>
    </section>
  );
}
