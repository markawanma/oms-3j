"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Sparkles } from "lucide-react";
import { getCopilotRecommendations } from "@/lib/tiktok/mock-actions";
import type { CopilotRecommendation } from "@/lib/tiktok/types";
import { loadCopilotDecisions, saveCopilotDecision } from "@/lib/tiktok/copilot-storage";
import type { CopilotDecisionsMap } from "@/lib/tiktok/copilot-storage";
import { CopilotOverviewCard } from "./CopilotOverviewCard";
import { CopilotCard } from "./CopilotCard";
import { CopilotSection } from "./CopilotSection";
import { CopilotCardSkeleton } from "./CopilotCardSkeleton";
import { DismissReasonSheet } from "./DismissReasonSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { useToast } from "@/components/ui/Toast";

export function CopilotPageClient() {
  const toast = useToast();
  const [recs, setRecs] = useState<CopilotRecommendation[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<CopilotDecisionsMap>({});
  const [dismissTargetId, setDismissTargetId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await getCopilotRecommendations();
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRecs(result.data);
  }, []);

  useEffect(() => {
    load();
    setDecisions(loadCopilotDecisions());
  }, [load]);

  // Fixture's baseline "pending" set, overridden by whatever this browser
  // has decided (design §5: approve/dismiss lives in localStorage only).
  const merged = useMemo<CopilotRecommendation[]>(() => {
    if (!recs) return [];
    return recs.map((r) => {
      const d = decisions[r.id];
      if (!d) return r;
      return { ...r, status: d.status, decidedAt: d.decidedAt };
    });
  }, [recs, decisions]);

  const pending = merged.filter((r) => r.status === "pending");
  const approved = merged.filter((r) => r.status === "approved");
  const dismissed = merged.filter((r) => r.status === "dismissed");
  const dismissTarget = merged.find((r) => r.id === dismissTargetId) ?? null;

  const handleApprove = useCallback(
    (id: string) => {
      saveCopilotDecision(id, { status: "approved", decidedAt: new Date().toISOString(), dismissReason: null });
      setDecisions(loadCopilotDecisions());
      toast.push("บันทึกการอนุมัติแล้ว");
    },
    [toast]
  );

  const handleDismissClick = useCallback((id: string) => {
    setDismissTargetId(id);
  }, []);

  const handleDismissSubmit = useCallback(
    (reason: string | null) => {
      if (!dismissTargetId) return;
      saveCopilotDecision(dismissTargetId, { status: "dismissed", decidedAt: new Date().toISOString(), dismissReason: reason });
      setDecisions(loadCopilotDecisions());
      setDismissTargetId(null);
      toast.push("ปัดทิ้งคำแนะนำแล้ว");
    },
    [dismissTargetId, toast]
  );

  if (loading && !recs) {
    return (
      <div className="space-y-4">
        <CopilotOverviewCard />
        <CopilotCardSkeleton />
      </div>
    );
  }

  if (error && !recs) {
    return <ErrorState message={error} onRetry={load} />;
  }

  return (
    <div className="space-y-4">
      <CopilotOverviewCard />

      <div role="note" className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
        <p className="text-sm leading-relaxed text-amber-900">
          <span className="font-bold">ข้อควรระวัง:</span> ต้นทุนกรอกครบ <span className="font-bold tabular-nums">62%</span> —
          คำแนะนำอิง <span className="font-bold">ยอดขาย/AOV/ช่องทาง</span> ไม่ใช้กำไรตัดสินงบ
        </p>
      </div>

      {error && (
        // Design §5: "การ์ดที่เคยอนุมัติ/ปัดทิ้งไว้ก่อนหน้ายังต้องเห็นได้ —
        // แยก state ต่อ section ไม่ error รวมทั้งหน้า" — a retry failure here
        // never blanks the cards already rendered from `recs`.
        <p className="text-xs text-red-600">โหลดคำแนะนำใหม่ล้มเหลว: {error} — แสดงข้อมูลล่าสุดที่มี</p>
      )}

      {merged.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="ยังไม่มีคำแนะนำตอนนี้"
          description="ระบบจะวิเคราะห์ใหม่พรุ่งนี้ หรือเมื่อมีข้อมูลมากพอ"
        />
      ) : (
        <>
          <CopilotSection title="รอพิจารณา" count={pending.length}>
            {pending.length === 0 ? (
              <p className="py-4 text-center text-sm text-zinc-400">ตัดสินใจครบทุกใบแล้ว</p>
            ) : (
              pending.map((r) => <CopilotCard key={r.id} rec={r} onApprove={handleApprove} onDismiss={handleDismissClick} />)
            )}
          </CopilotSection>

          <CopilotSection title="อนุมัติแล้ว" count={approved.length} collapsible defaultOpen={false}>
            {approved.map((r) => (
              <CopilotCard key={r.id} rec={r} onApprove={handleApprove} onDismiss={handleDismissClick} />
            ))}
          </CopilotSection>

          <CopilotSection title="ปัดทิ้งแล้ว" count={dismissed.length} collapsible defaultOpen={false}>
            {dismissed.map((r) => (
              <CopilotCard key={r.id} rec={r} onApprove={handleApprove} onDismiss={handleDismissClick} />
            ))}
          </CopilotSection>
        </>
      )}

      <p className="border-t border-zinc-200 pt-3 text-xs leading-relaxed text-zinc-400">
        <span className="font-medium text-zinc-500">Ad Copilot</span> — คำแนะนำอ้างข้อมูลจริง H1 (MOCK, รอ analytics DB + LLM
        engine) · human-in-loop ทุกการ์ด · อนุมัติ/ปัดทิ้งบันทึกในเบราว์เซอร์นี้เท่านั้น (localStorage, ไม่แตะ DB)
      </p>

      <DismissReasonSheet
        open={!!dismissTarget}
        title={dismissTarget?.title ?? ""}
        onClose={() => setDismissTargetId(null)}
        onSubmit={handleDismissSubmit}
      />
    </div>
  );
}
