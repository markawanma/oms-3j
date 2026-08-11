"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { crmEditPii } from "@/lib/actions/crm";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { CrmCustomerPii } from "@/lib/actions/crm";

/** address is a free-form jsonb blob (no fixed shape elsewhere in the
 * codebase, see crmEditPii's CrmEditPiiInput doc) — edited here as one plain
 * text field and stored/read back as `{ raw: "..." }`. */
function addressToText(address: unknown | null): string {
  if (!address) return "";
  if (typeof address === "object" && address !== null && "raw" in (address as Record<string, unknown>)) {
    const raw = (address as { raw?: unknown }).raw;
    return typeof raw === "string" ? raw : "";
  }
  return JSON.stringify(address);
}

/** Edit button + modal for pii_customer.phone_e164/full_name/address — owner/
 * admin only (design §2.7). `canEdit` decided server-side in page.tsx via
 * getDevRole(); the server action re-checks the same gate itself. */
export function PiiEditForm({ customerId, pii, canEdit }: { customerId: string; pii: CrmCustomerPii | null; canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(pii?.phoneE164 ?? "");
  const [fullName, setFullName] = useState(pii?.fullName ?? "");
  const [address, setAddress] = useState(addressToText(pii?.address ?? null));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canEdit) return null;

  function openModal() {
    setPhone(pii?.phoneE164 ?? "");
    setFullName(pii?.fullName ?? "");
    setAddress(addressToText(pii?.address ?? null));
    setError(null);
    setOpen(true);
  }

  function handleSave() {
    startTransition(async () => {
      const result = await crmEditPii(customerId, {
        phoneE164: phone,
        fullName,
        address: address.trim() ? { raw: address.trim() } : null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={openModal} className="ml-auto">
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        แก้ไข PII
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="แก้ไขข้อมูลส่วนบุคคล (PII)">
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">ชื่อเต็ม</span>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="min-h-11 rounded-md border border-slate-300 px-2.5 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">เบอร์โทร</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+66812345678"
              className="min-h-11 rounded-md border border-slate-300 px-2.5 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">ที่อยู่</span>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={3}
              className="rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-900"
            />
          </label>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button variant="secondary" className="flex-1" onClick={() => setOpen(false)} disabled={pending}>
              ยกเลิก
            </Button>
            <Button variant="primary" className="flex-1" loading={pending} onClick={handleSave}>
              บันทึก
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
