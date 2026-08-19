"use client";

// TaskGateSection — "เงื่อนไขที่ต้องผ่าน" on /marketing/calendar/[stepId] (M4,
// design ux-content-calendar.md §3 item 4: "ของเดิม (ปุ่ม 'ผ่าน: ...')").
// Same passCampaignGate RPC + interaction as CampaignBoard.tsx's StepCard gate
// row, extracted into its own small client component because page.tsx is a
// server component (it can't hold the busy/toast state itself) and this
// piece of interactivity is scoped to one step, not the whole board.

import { useState, useTransition } from "react";
import { passCampaignGate } from "@/lib/actions/marketing";
import { GATE_LABEL } from "@/lib/marketing/campaign-types";
import type { CampaignGate } from "@/lib/marketing/campaign-types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

export function TaskGateSection({ stepId, gates }: { stepId: string; gates: CampaignGate[] }) {
  const toast = useToast();
  const [items, setItems] = useState(gates);
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const relevant = items.filter((g) => g.status !== "na");
  if (relevant.length === 0) return null;

  function handlePass(gateKind: string) {
    setBusyKind(gateKind);
    startTransition(async () => {
      const result = await passCampaignGate(stepId, gateKind);
      setBusyKind(null);
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      setItems((prev) => prev.map((g) => (g.gateKind === gateKind ? { ...g, status: "passed" as const } : g)));
      toast.push("ผ่านเงื่อนไขแล้ว");
    });
  }

  return (
    <section className="space-y-2 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-bold text-zinc-900">เงื่อนไขที่ต้องผ่าน</h2>
      <div className="flex flex-wrap items-center gap-1.5">
        {relevant.map((g) => {
          const passed = g.status === "passed";
          return passed ? (
            <Badge key={g.gateKind} tone="green">
              ✓ {GATE_LABEL[g.gateKind] ?? g.gateKind}
            </Badge>
          ) : (
            <Button
              key={g.gateKind}
              variant="secondary"
              size="sm"
              loading={busyKind === g.gateKind}
              onClick={() => handlePass(g.gateKind)}
            >
              ผ่าน: {GATE_LABEL[g.gateKind] ?? g.gateKind}
            </Button>
          );
        })}
      </div>
    </section>
  );
}
