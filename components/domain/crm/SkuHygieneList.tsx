"use client";

// SkuHygieneList — renders LineImportPreview.dirtySkus (lib/actions/import-line-items.ts,
// backed by lib/import/sku-hygiene.ts's analyzeSku/cleanSku). Purpose: the
// owner cannot SEE stray Thai vowel/tone marks or invisible Unicode
// characters glued onto SKU cell text exported from Shipnity (e.g. a
// tone mark U+0E4C sitting in front of an otherwise-normal `NC20-A1`) — his
// own words: "ผมมองไม่เห็นว่ามันสะอาดไหม". This component makes every such
// character visible as a `⟦U+XXXX⟧` placeholder chip, and gives a "copy the
// RAW string" affordance the owner cannot type by hand, so he can paste it
// into Shipnity's own search box to find the row that needs fixing.
//
// Purely advisory (matches LineImportWarningsList's contract) — nothing here
// blocks "ยืนยันนำเข้า"; see OrderImportClient.tsx's LineSinglePreviewCard.
//
// Styling deliberately mirrors LineImportWarningsList.tsx (border/bg/heading/
// text/chip tone blocks, COLLAPSE_THRESHOLD show-more pattern) rather than
// inventing new visual language, per design brief.

import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronUp, ClipboardCopy, Copy } from "lucide-react";
import { findingSeverity, type SkuCharIssue, type SkuHygieneFinding } from "@/lib/import/sku-hygiene";
import { formatCount } from "@/lib/tiktok/format";
import { useToast } from "@/components/ui/Toast";

const COLLAPSE_THRESHOLD = 8;

// ============================================================================
// Clipboard — must copy the RAW string (with the invisible characters),
// never a display placeholder. Needs a fallback because navigator.clipboard
// requires a secure context (localhost/Vercel are fine, but this can run
// behind older browsers or odd preview setups — see design brief).
// ============================================================================

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard && typeof window !== "undefined" && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the textarea fallback below
    }
  }
  if (typeof document === "undefined") return false;
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    // Off-screen but still focusable/selectable — execCommand("copy") needs
    // a real selection, it won't work on a display:none element.
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

// ============================================================================
// Raw SKU display — the whole point of this file. Walks the string by CODE
// POINT (never UTF-16 index — analyzeSku's `position` is 1-based code-point
// order, see sku-hygiene.ts's contract comment) and swaps every flagged
// character for a visible `⟦U+XXXX⟧` chip. Everything else renders as plain
// text so the owner can still read the SKU around the problem.
// ============================================================================

function RawSkuDisplay({ rawSku, issues }: { rawSku: string; issues: SkuCharIssue[] }) {
  const chars = Array.from(rawSku);
  const issueByPosition = new Map(issues.map((issue) => [issue.position, issue]));

  return (
    <span className="break-all font-mono text-[0.8rem] leading-relaxed">
      {chars.map((ch, idx) => {
        const position = idx + 1;
        const issue = issueByPosition.get(position);
        if (!issue) return <span key={position}>{ch}</span>;
        const severity = findingSeverity([issue]);
        const tone = severity === "amber" ? "bg-amber-200 text-amber-900" : "bg-zinc-300 text-zinc-800";
        return (
          <span
            key={position}
            className={`mx-px inline-block rounded px-1 font-bold ${tone}`}
            title={`ตำแหน่งที่ ${position} · ${issue.charName} (${issue.codepoint})`}
            aria-label={`อักขระซ่อน: ${issue.charName} ${issue.codepoint} ที่ตำแหน่งที่ ${position}`}
          >
            {`⟦${issue.codepoint}⟧`}
          </span>
        );
      })}
    </span>
  );
}

// ============================================================================
// Tone classes — same border/bg/heading/text/chip shape as LineImportWarningsList's
// TONE_CLASSES, restricted to the two severities this list uses.
// ============================================================================

const TONE_CLASSES: Record<"amber" | "zinc", { border: string; bg: string; heading: string; text: string; chip: string }> = {
  amber: {
    border: "border-amber-200",
    bg: "bg-amber-50",
    heading: "text-amber-900",
    text: "text-amber-800",
    chip: "bg-amber-100 text-amber-800",
  },
  zinc: {
    border: "border-zinc-200",
    bg: "bg-zinc-50",
    heading: "text-zinc-800",
    text: "text-zinc-600",
    chip: "bg-zinc-200 text-zinc-700",
  },
};

const GROUP_TITLE: Record<"amber" | "zinc", string> = {
  amber: "ต้องแก้ที่ Shipnity",
  zinc: "ระบบล้างให้อัตโนมัติแล้ว",
};

const GROUP_SUBTEXT: Record<"amber" | "zinc", string> = {
  amber: "มองไม่เห็นด้วยตาเปล่า — คัดลอก SKU ดิบไปวางในช่องค้นหาของ Shipnity เพื่อหาแถวที่ต้องแก้",
  // Deliberately does NOT promise "ไม่กระทบข้อมูล": the import normalizer trims
  // these at the edges (harmless) but turns one sitting INSIDE a code into an
  // ordinary space, which then fails to match the catalog. Saying "no impact"
  // outright would talk the owner out of fixing the one case that does bite.
  zinc: "ช่องว่างหัว-ท้ายระบบตัดให้ตอนนำเข้าอยู่แล้ว — แต่ถ้าอยู่กลางรหัสจะกลายเป็นช่องว่างธรรมดาและจับคู่สินค้าไม่ได้ ควรแก้ที่ไฟล์ต้นทาง",
};

function FindingRow({ finding }: { finding: SkuHygieneFinding }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const ok = await copyTextToClipboard(finding.rawSku);
    if (ok) {
      setCopied(true);
      toast.push("คัดลอกแล้ว");
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.push("คัดลอกไม่สำเร็จ ลองใหม่อีกครั้ง", "error");
    }
  }

  return (
    <li className="rounded-md border border-white bg-white/70 p-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <RawSkuDisplay rawSku={finding.rawSku} issues={finding.issues} />
          <p className="mt-1 text-[0.7rem] text-zinc-500">
            ควรเป็น{" "}
            <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-zinc-700">
              {finding.cleanedSku || "(ว่างเปล่าหลังล้าง)"}
            </code>{" "}
            ·{" "}
            {finding.cleanedExistsInCatalog ? (
              <span className="font-semibold text-green-700">มีใน catalog แล้ว</span>
            ) : (
              <span className="text-zinc-500">ยังไม่มีใน catalog</span>
            )}
          </p>
          <ul className="mt-1.5 space-y-0.5 text-[0.7rem] text-zinc-500">
            {finding.issues.map((issue, idx) => (
              <li key={idx}>
                ตำแหน่งที่ {issue.position} · {issue.charName} ({issue.codepoint})
              </li>
            ))}
          </ul>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="rounded-full bg-white px-2 py-0.5 text-[0.68rem] font-semibold tabular-nums text-zinc-600 shadow-sm">
            {formatCount(finding.rowCount)} แถว
          </span>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="flex min-h-9 items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 text-[0.72rem] font-semibold text-zinc-700 hover:bg-zinc-50"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-green-600" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {copied ? "คัดลอกแล้ว" : "คัดลอก SKU ดิบ"}
          </button>
        </div>
      </div>
    </li>
  );
}

function SeverityGroup({ severity, findings }: { severity: "amber" | "zinc"; findings: SkuHygieneFinding[] }) {
  const [expanded, setExpanded] = useState(false);
  if (findings.length === 0) return null;

  const tone = TONE_CLASSES[severity];
  const visible = expanded ? findings : findings.slice(0, COLLAPSE_THRESHOLD);
  const hiddenCount = findings.length - visible.length;

  return (
    <div className={`rounded-lg border ${tone.border} ${tone.bg} p-3.5`}>
      <div className="flex items-center justify-between gap-2">
        <h4 className={`flex items-center gap-1.5 text-sm font-bold ${tone.heading}`}>
          {severity === "amber" && <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />}
          {GROUP_TITLE[severity]}
        </h4>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${tone.chip}`}>
          {formatCount(findings.length)} รูปแบบ
        </span>
      </div>
      <p className={`mt-1 text-xs font-semibold ${tone.text}`}>{GROUP_SUBTEXT[severity]}</p>

      <ul className="mt-2 space-y-1.5">
        {visible.map((finding) => (
          <FindingRow key={finding.rawSku} finding={finding} />
        ))}
      </ul>

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={`mt-2 flex min-h-9 items-center gap-1 text-xs font-semibold underline underline-offset-2 ${tone.heading}`}
        >
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          ดูเพิ่มอีก {formatCount(hiddenCount)} รูปแบบ
        </button>
      )}
      {expanded && findings.length > COLLAPSE_THRESHOLD && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className={`mt-2 flex min-h-9 items-center gap-1 text-xs font-semibold underline underline-offset-2 ${tone.heading}`}
        >
          <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
          ย่อกลับ
        </button>
      )}
    </div>
  );
}

export function SkuHygieneList({
  findings,
  totalCount,
}: {
  findings: SkuHygieneFinding[];
  /** True total from the DB — may be larger than findings.length when the
   * batch has more distinct dirty raw-text findings than DIRTY_SKU_LIMIT
   * (200). See lib/actions/import-line-items.ts's dirtySkuTotalCount doc. */
  totalCount: number;
}) {
  const toast = useToast();
  if (findings.length === 0) return null;

  const amber = findings.filter((f) => f.severity === "amber");
  const zinc = findings.filter((f) => f.severity === "zinc");

  async function handleCopyAll() {
    const text = findings.map((f) => `${f.rawSku}\t${f.cleanedSku}`).join("\n");
    const ok = await copyTextToClipboard(text);
    toast.push(
      ok ? `คัดลอกแล้ว ${formatCount(findings.length)} รายการ` : "คัดลอกไม่สำเร็จ ลองใหม่อีกครั้ง",
      ok ? "success" : "error"
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-zinc-800">SKU ที่มีอักขระซ่อนอยู่ ({formatCount(findings.length)} รูปแบบ)</h3>
        <button
          type="button"
          onClick={() => void handleCopyAll()}
          className="flex min-h-9 items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
        >
          <ClipboardCopy className="h-3.5 w-3.5" aria-hidden="true" />
          คัดลอกทั้งหมด
        </button>
      </div>

      {totalCount > findings.length && (
        <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-600">
          แสดง {formatCount(findings.length)} จากทั้งหมด {formatCount(totalCount)} รูปแบบ — มีมากเกินกว่าจะแสดงทั้งหมดในหน้านี้
        </p>
      )}

      <SeverityGroup severity="amber" findings={amber} />
      <SeverityGroup severity="zinc" findings={zinc} />
    </div>
  );
}
