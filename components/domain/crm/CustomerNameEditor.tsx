"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X } from "lucide-react";
import { crmEditCustomerName } from "@/lib/actions/crm";
import { Button } from "@/components/ui/Button";

/**
 * Inline edit for dim_customer.display_name (design §2.1 tail). Owner/admin
 * only — `canEdit` is decided server-side in page.tsx via getDevRole() and
 * passed down, so staff never even see the pencil icon; the server action
 * re-checks the same role itself regardless (defense in depth, per handoff).
 */
export function CustomerNameEditor({
  customerId,
  initialName,
  canEdit,
}: {
  customerId: string;
  initialName: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <div className="flex items-center gap-1.5">
        <h1 className="text-lg font-bold text-zinc-900">{initialName ?? "(ไม่มีชื่อ)"}</h1>
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              setValue(initialName ?? "");
              setError(null);
              setEditing(true);
            }}
            aria-label="แก้ไขชื่อลูกค้า"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    );
  }

  function handleSave() {
    startTransition(async () => {
      const result = await crmEditCustomerName(customerId, value);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor="customer-name-input">
          ชื่อลูกค้า
        </label>
        <input
          id="customer-name-input"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          className="min-h-10 flex-1 rounded-md border border-zinc-300 px-2.5 text-base font-bold text-zinc-900"
        />
        <Button size="sm" variant="primary" loading={pending} onClick={handleSave}>
          บันทึก
        </Button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          aria-label="ยกเลิก"
          disabled={pending}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
