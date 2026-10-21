"use client";

// ShopQrCard — การ์ด QR ร้าน บน /jobs/workers (W1 · UX B.10.4) · เจ้าของ/แอดมินเท่านั้น (หน้าเดิมกันสิทธิ์แล้ว)
// สภาพ: ยังไม่เคยออก · ใช้งานอยู่ · ถูกเพิกถอน · อ่านสถานะล้ม (error) · กำลังออก/เพิกถอน (ปุ่ม loading) — ครบ 4 state
// 🔴 ค่าดิบของ QR ร้านอยู่ใน state ของคอมโพเนนต์นี้เท่านั้น (ไม่ลง storage/URL/log) · ปิดกล่อง = หาย · DB เก็บ hash — ดูซ้ำไม่ได้ ถ้าทำหายให้ออกใหม่
//   ออกใหม่ = QR เดิมใช้ไม่ได้ทันที (DB เพิกถอนในทรานแซกชันเดียวกัน — ออกไม่ผ่านไม่เพิกถอนของเก่า)
// พิมพ์: โปสเตอร์ A4 (ShopQrPoster) เป็นลูกตรงของ root ของ WorkersClient ที่ติด data-print-keep — ส่วนอื่นของหน้าถูกซ่อนตอนพิมพ์ด้วย print:[&>*:not([data-print-keep])]:hidden

import { useMemo, useState } from "react";
import { QrCode } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useOfficeRun } from "@/components/domain/jobs/useOfficeRun";
import { ShopQrPoster } from "@/components/domain/jobs/ShopQrPoster";
import { issueShopIntakeToken, revokeShopIntakeToken } from "@/lib/actions/job-workers";
import type { ShopIntakeStatus } from "@/lib/actions/job-workers";
import { thaiDateTime } from "@/lib/jobs/dates";
import { renderQrSvgClient, shopPageUrl } from "@/lib/jobs/qr-client";

export const MSG_ISSUE_FAIL = "ออก QR ไม่สำเร็จ — ลองอีกครั้ง";
export const MSG_REVOKE_FAIL = "เพิกถอนไม่สำเร็จ — ลองอีกครั้ง";
export const MSG_NOT_PRINTED = "ยังไม่ได้พิมพ์ — ปิดแล้วต้องออกใหม่ ปิดเลยไหม";

type Dlg = "reissue" | "revoke" | "issued" | null;

export function ShopQrCard({ status, statusError }: { status: ShopIntakeStatus | null; statusError: string | null }) {
  const { run, busy } = useOfficeRun();
  const [dlg, setDlg] = useState<Dlg>(null);
  const [issued, setIssued] = useState<{ token: string; issuedAt: string } | null>(null);
  const [printed, setPrinted] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const svg = useMemo(() => {
    if (!issued) return null;
    try {
      return renderQrSvgClient(shopPageUrl(window.location.origin, issued.token));
    } catch {
      return null;
    }
  }, [issued]);

  const active = status?.active === true;
  const revoked = status !== null && !status.active && status.issuedAt !== null;

  async function issue() {
    setErr(null);
    const r = await run(() => issueShopIntakeToken(), { success: "ออก QR ร้านแล้ว" });
    if (!r.ok) {
      setErr(MSG_ISSUE_FAIL);
      setDlg(null);
      return;
    }
    setIssued({ token: r.data.token, issuedAt: r.data.issuedAt });
    setPrinted(false);
    setDlg("issued");
  }

  async function revoke() {
    setErr(null);
    const r = await run(() => revokeShopIntakeToken(), { success: "เพิกถอน QR ร้านแล้ว" });
    if (!r.ok) {
      setErr(MSG_REVOKE_FAIL);
      setDlg(null);
      return;
    }
    setIssued(null);
    setDlg(null);
  }

  function closeIssued() {
    setIssued(null);
    setDlg(null);
  }

  return (
    <>
      <section aria-label="QR ร้าน" aria-busy={busy} className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="flex items-center gap-2 text-base font-bold text-zinc-900">
              <QrCode className="h-5 w-5" aria-hidden="true" />
              QR ร้าน — ให้ช่างเปิดงานใหม่จากมือถือ
            </h2>
            {statusError ? (
              <p role="alert" className="text-sm font-medium text-red-700">
                {statusError}
              </p>
            ) : active ? (
              <>
                <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-800">
                  <Badge tone="green">ใช้งานอยู่</Badge>
                  <span>ออกเมื่อ {thaiDateTime(status?.issuedAt)}</span>
                </p>
                <p className="text-sm text-zinc-700">ติดไว้ที่หน้าร้าน/โต๊ะผู้จัดการ · ช่างสแกน → เลือกชื่อ → ใส่ PIN → เปิดงาน</p>
              </>
            ) : revoked ? (
              <p className="text-sm text-zinc-800">
                <Badge tone="slate">ถูกเพิกถอน</Badge> <span className="ml-1">(ออกเมื่อ {thaiDateTime(status?.issuedAt)}) — ช่างเปิดงานจากมือถือไม่ได้</span>
              </p>
            ) : (
              <p className="text-sm text-zinc-800">ยังไม่มี QR ร้าน — ช่างยังเปิดงานจากมือถือไม่ได้</p>
            )}
            {!statusError && (
              <p className="text-xs text-zinc-600">
                ดู QR ซ้ำไม่ได้ (ระบบเก็บเฉพาะรหัสเข้ารหัส) — ถ้าทำหายให้ออกใหม่ · ถ้ามีคนพิมพ์ PIN ผิดครบ 7 ครั้งต่อวัน ทั้งร้านจะเข้าทาง QR นี้ไม่ได้จนกว่าจะออก QR ใหม่
              </p>
            )}
          </div>
          {!statusError && (
            <div className="flex flex-wrap gap-2">
              {active ? (
                <>
                  <Button type="button" variant="secondary" loading={busy} onClick={() => setDlg("reissue")}>
                    ออกใหม่ (เปลี่ยน QR)
                  </Button>
                  <Button type="button" variant="secondary" className="border-red-300 text-red-700 hover:bg-red-50" disabled={busy} onClick={() => setDlg("revoke")}>
                    เพิกถอน
                  </Button>
                </>
              ) : (
                <Button type="button" loading={busy} onClick={() => void issue()}>
                  ออก QR ร้าน
                </Button>
              )}
            </div>
          )}
        </div>
        {err && (
          <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-sm text-red-800">
            {err}
          </p>
        )}
      </section>

      {dlg === "reissue" && (
        <Modal open onClose={() => setDlg(null)} title="ออก QR ใหม่?">
          <div className="space-y-3">
            <p className="text-sm text-zinc-800">QR เดิมที่ติดอยู่จะใช้ไม่ได้ทันที — พร้อมพิมพ์และเปลี่ยนที่ติดแล้วใช่ไหม</p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" onClick={() => setDlg(null)} disabled={busy}>
                ยกเลิก
              </Button>
              <Button type="button" loading={busy} onClick={() => void issue()}>
                ออก QR ใหม่ แล้วพิมพ์
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {dlg === "revoke" && (
        <Modal open onClose={() => setDlg(null)} title="เพิกถอน QR ร้าน?">
          <div className="space-y-3">
            <p className="text-sm text-zinc-800">ช่างทุกคนจะเปิดงานจากมือถือไม่ได้ทันที จนกว่าจะออก QR ใหม่ · ใบงานและ QR ใบงานที่เปิดไปแล้วไม่ได้รับผลกระทบ</p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" onClick={() => setDlg(null)} disabled={busy}>
                ยกเลิก
              </Button>
              <Button type="button" variant="danger" loading={busy} onClick={() => void revoke()}>
                เพิกถอน
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {dlg === "issued" && issued && (
        <Modal open onClose={closeIssued} title="QR ร้านใหม่" confirmBeforeClose={() => printed || window.confirm(MSG_NOT_PRINTED)}>
          <div className="space-y-3">
            {svg ? (
              <div className="flex justify-center">
                {/* SVG สร้างในเบราว์เซอร์จากไลบรารี vendored (ดำบนขาว ไม่มีสคริปต์) จากลิงก์ของ QR ที่เพิ่งออก — ไม่ใช่ข้อมูลจากผู้ใช้ */}
                <div role="img" aria-label="QR ร้าน" className="h-60 w-60 rounded-md border border-zinc-300 bg-white p-1 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
              </div>
            ) : (
              <p role="alert" className="text-sm text-red-700">
                สร้างภาพ QR ไม่สำเร็จ — ปิดกล่องนี้แล้วออก QR ใหม่
              </p>
            )}
            <p role="note" className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm font-medium text-amber-950">
              ⚠ แสดงครั้งเดียว — ปิดกล่องนี้แล้วดูซ้ำไม่ได้ · ถ้าออกใหม่ QR เดิมที่ติดอยู่ใช้ไม่ได้ทันที · พิมพ์แล้วติดแทนของเดิมเลย
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                disabled={!svg}
                onClick={() => {
                  window.print();
                  setPrinted(true);
                }}
              >
                พิมพ์โปสเตอร์ QR
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (!printed && !window.confirm(MSG_NOT_PRINTED)) return;
                  closeIssued();
                }}
              >
                จดแล้ว ปิด
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {issued && svg && <ShopQrPoster svg={svg} />}
    </>
  );
}
