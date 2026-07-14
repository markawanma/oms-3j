import { Phone, User, MapPin } from "lucide-react";

export function BuyerInfoCard({
  buyerName,
  buyerPhone,
  shippingAddress,
}: {
  buyerName: string | null;
  buyerPhone: string | null;
  shippingAddress: Record<string, unknown> | null;
}) {
  const addressText = shippingAddress
    ? Object.values(shippingAddress).filter(Boolean).join(" ")
    : null;

  return (
    <section aria-labelledby="buyer-info-heading" className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 id="buyer-info-heading" className="text-sm font-semibold text-slate-500">
        ข้อมูลผู้ซื้อ
      </h2>
      <div className="mt-3 space-y-2 text-sm text-slate-700">
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <span>{buyerName ?? "ไม่ระบุชื่อ"}</span>
        </div>
        <div className="flex items-center gap-2">
          <Phone className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <span>{buyerPhone ?? "ไม่ระบุเบอร์โทร"}</span>
        </div>
        {addressText && (
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            <span>{addressText}</span>
          </div>
        )}
      </div>
    </section>
  );
}
