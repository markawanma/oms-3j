import { Check, X } from "lucide-react";
import { STATUS_LABEL_TH, type OrderStatus } from "@/lib/types";

const HAPPY_PATH: OrderStatus[] = ["new", "confirmed", "to_ship", "shipped", "completed"];

/** Stepper timeline. Renders a terminal "ยกเลิก"/"ของไม่พอ" state distinctly instead of forcing it onto the happy-path steps. */
export function StatusTimeline({ status }: { status: OrderStatus }) {
  if (status === "cancelled" || status === "oversold_hold") {
    return (
      <section aria-label="สถานะออเดอร์" className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="flex items-center gap-2 text-red-700">
          <X className="h-5 w-5" aria-hidden="true" />
          <span className="font-medium">{STATUS_LABEL_TH[status]}</span>
        </div>
      </section>
    );
  }

  const currentIndex = HAPPY_PATH.indexOf(status);

  return (
    <section aria-label="สถานะออเดอร์" className="rounded-lg border border-zinc-200 bg-white p-4">
      <ol className="flex items-center justify-between">
        {HAPPY_PATH.map((step, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          return (
            <li key={step} className="flex flex-1 flex-col items-center text-center">
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                  done
                    ? "bg-green-600 text-white"
                    : active
                      ? "bg-primary-600 text-white"
                      : "bg-zinc-200 text-zinc-500"
                }`}
                aria-current={active ? "step" : undefined}
              >
                {done ? <Check className="h-4 w-4" aria-hidden="true" /> : i + 1}
              </span>
              <span className={`mt-1 text-xs ${active ? "font-semibold text-zinc-900" : "text-zinc-500"}`}>
                {STATUS_LABEL_TH[step]}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
