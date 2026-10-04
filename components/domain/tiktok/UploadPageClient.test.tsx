// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useSearchParams } from "next/navigation";
import { ToastProvider } from "@/components/ui/Toast";
import { getLabelFiles, getPendingLabelReviews, resolveLabelPage } from "@/lib/actions/labels";
import type { CrmProvinceOption } from "@/lib/crm/order-override";
import { UploadPageClient } from "./UploadPageClient";

// Same reason as components/ui/CollapsibleSection.test.tsx: this repo's
// vitest.config.ts does NOT set test.globals, so @testing-library/react's
// auto-cleanup never self-registers — without this, each render() below
// would leave the previous test's DOM mounted and duplicate-element errors
// would follow.
afterEach(cleanup);

/**
 * UploadPageClient integration test — design doc §10 items 5/6
 * (docs/3j-jewelry/analytics/upload-page-layout-design.md), the items the
 * brief flags as "สำคัญสุด": a form filled in inside the "ตรวจ/แก้ไข" section
 * must never reset just because that section (or an unrelated sibling
 * section) was folded/unfolded. CollapsibleSection.test.tsx already proves
 * this at the primitive level with a throwaway stateful child — this file
 * proves the SAME claim one level up, using the real
 * LabelReviewQueueRow/ProvinceSelect form that the design doc's bug report
 * is actually about, wired through the real UploadPageClient tree.
 *
 * "@/lib/actions/labels" is a "use server" module — mocked wholesale so no
 * test here ever reaches a real DB/network call; UploadPageClient's own
 * upload/parse flow (drag-drop → sha256 → createLabelUpload/parseLabelFile)
 * is explicitly OUT of scope for the accordion redesign (design doc §6.4)
 * and isn't exercised here.
 */

vi.mock("next/navigation", () => ({
  // UploadPageClient reads `?open=` once via useSearchParams() (design doc
  // §6.2, deep-link support). Wrapped in vi.fn() (not a plain arrow) so the
  // one deep-link test below can override just its first call via
  // mockReturnValueOnce — every other test keeps this plain-empty default,
  // i.e. starts from the normal default accordion state.
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

vi.mock("@/lib/actions/labels", () => ({
  createLabelUpload: vi.fn(),
  parseLabelFile: vi.fn(),
  getLabelFiles: vi.fn(async () => ({ ok: true, data: [] })),
  // One interactive row, shaped like a real needs_review page with a tracking
  // number and a matched order — enough for LabelReviewQueueRow to render its
  // full form (province select / reason / note), which is the form this test
  // is actually about. candidates: [] on purpose so selectedProvince starts
  // at "" instead of auto-picking a single candidate (lib's own
  // row.candidates.length === 1 ? ... : "" rule) — keeps the "did selecting a
  // province survive fold/unfold" assertion unambiguous.
  getPendingLabelReviews: vi.fn(async () => ({
    ok: true,
    data: [
      {
        pageId: "page-1",
        pageNo: 1,
        trackingNo: "TH1234567890",
        zipcode: "50000",
        status: "needs_review",
        candidates: [],
        fileId: "file-1",
        fileName: "batch-a.pdf",
        orderSources: [
          {
            factOrderId: "order-1",
            sourceOrderNo: "SO-0001",
            trackingNo: "TH1234567890",
            provinceCode: "TH-10",
            provinceSource: "import",
            importFileName: "sales.xlsx",
            sourceRowNo: 5,
          },
        ],
      },
    ],
  })),
  findOrdersByTracking: vi.fn(async () => ({ ok: true, data: [] })),
  setOrderProvince: vi.fn(),
  revertOrderProvince: vi.fn(),
  resolveLabelPage: vi.fn(),
  ignoreLabelPage: vi.fn(),
  revertLabelPage: vi.fn(),
  getLabelPageViewUrl: vi.fn(),
  getLabelPageSnippet: vi.fn(),
}));

const PROVINCES: CrmProvinceOption[] = [
  { code: "TH-10", nameTh: "กรุงเทพมหานคร" },
  { code: "TH-50", nameTh: "เชียงใหม่" },
];

function renderPage() {
  return render(
    <ToastProvider>
      <UploadPageClient provinces={PROVINCES} canEdit={true} />
    </ToastProvider>
  );
}

function headerEl(id: "upload" | "review" | "history"): HTMLElement {
  const el = document.getElementById(`${id}-header`);
  if (!el) throw new Error(`#${id}-header not found`);
  return el;
}

function contentHidden(id: "upload" | "review" | "history"): boolean {
  return document.getElementById(`${id}-content`)?.hasAttribute("hidden") ?? true;
}

describe("UploadPageClient accordion — form state survives folding (design doc §10.5/§10.6)", () => {
  it("defaults to 'upload' open and 'review'/'history' folded (§10.1)", async () => {
    renderPage();
    // Wait for PendingReviewQueue's load() to settle (it fetches on mount
    // regardless of whether "review" is folded — see design doc §6/§2) so
    // later tests' assumptions about DOM being ready are validated here too.
    await screen.findByLabelText("หมายเหตุ — หน้า 1");

    expect(contentHidden("upload")).toBe(false);
    expect(contentHidden("review")).toBe(true);
    expect(contentHidden("history")).toBe(true);
  });

  it("keeps a filled-in note after folding and unfolding the SAME section (§10.5)", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(headerEl("review"));
    expect(contentHidden("review")).toBe(false);

    const note = await screen.findByLabelText("หมายเหตุ — หน้า 1");
    await user.type(note, "โทรยืนยันกับลูกค้าแล้ว");
    expect(note).toHaveValue("โทรยืนยันกับลูกค้าแล้ว");

    await user.click(headerEl("review")); // fold
    expect(contentHidden("review")).toBe(true);

    await user.click(headerEl("review")); // unfold
    expect(contentHidden("review")).toBe(false);

    // Re-query deliberately (not reusing the `note` reference) — if
    // CollapsibleSection had unmounted its children instead of using the
    // `hidden` attribute (exactly the bug design doc §2 exists to prevent),
    // this would be a brand-new <input> reset back to "".
    expect(screen.getByLabelText("หมายเหตุ — หน้า 1")).toHaveValue("โทรยืนยันกับลูกค้าแล้ว");
  });

  it("keeps province + note filled in 'review' after opening/closing 'history' in between, without ever touching 'review' itself (§10.6)", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(headerEl("review"));
    const provinceSelect = await screen.findByLabelText("เลือกจังหวัด — หน้า 1");
    const note = screen.getByLabelText("หมายเหตุ — หน้า 1");

    await user.selectOptions(provinceSelect, "TH-50");
    await user.type(note, "ลูกค้าย้ายบ้านใหม่");
    expect(provinceSelect).toHaveValue("TH-50");

    // Switch to a DIFFERENT, unrelated section and back — "review" itself is
    // never folded during this sequence.
    await user.click(headerEl("history"));
    expect(contentHidden("history")).toBe(false);
    await user.click(headerEl("history"));
    expect(contentHidden("history")).toBe(true);

    // "review" was open the entire time — confirm its form wasn't disturbed
    // by its sibling's mount/toggle at all.
    expect(contentHidden("review")).toBe(false);
    expect(screen.getByLabelText("เลือกจังหวัด — หน้า 1")).toHaveValue("TH-50");
    expect(screen.getByLabelText("หมายเหตุ — หน้า 1")).toHaveValue("ลูกค้าย้ายบ้านใหม่");
  });

  it("badge on 'review' header reflects the real pending count from getPendingLabelReviews, even while folded (§7)", async () => {
    renderPage();
    await screen.findByLabelText("หมายเหตุ — หน้า 1"); // wait for load() to settle
    expect(contentHidden("review")).toBe(true); // still folded — badge must not need it open
    expect(screen.getByText("ค้าง 1 รายการ")).toBeInTheDocument();
  });

  // Design doc §10 item 7: "กดยืนยันจังหวัดในแถวที่กรอกไว้ → แถวหายจากคิวตาม
  // ปกติ (onResolved) + badge ลดลงถูกต้อง". QA (4 ต.ค. 69) originally caught
  // this as a FINDING — handleResolved filtered local `rows` state (the
  // visible list shrank correctly) but never called onCountChange, so the
  // header badge went stale until the next full load(). code-reviewer
  // independently flagged the same bug. Fixed by deriving onCountChange
  // from `rows` itself via a useEffect (PendingReviewQueue.tsx) instead of
  // calling it ad hoc at each mutation site — load() and handleResolved
  // both just mutate `rows` now; the effect is the one place that tells the
  // parent. This test is the flipped version of that finding, asserting the
  // now-correct behavior.
  it("badge count updates after resolving a row — handleResolved keeps onCountChange in sync (§10 item 7)", async () => {
    vi.mocked(resolveLabelPage).mockResolvedValueOnce({ ok: true, data: { appliedOrders: 1 } });
    const user = userEvent.setup();
    renderPage();

    await user.click(headerEl("review"));
    await user.selectOptions(await screen.findByLabelText("เลือกจังหวัด — หน้า 1"), "TH-50");
    await user.selectOptions(screen.getByLabelText("เหตุผล — หน้า 1"), "customer_moved");

    expect(screen.getByText("ค้าง 1 รายการ")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ยืนยันจังหวัด" }));

    // The row is gone from the visible list ...
    await screen.findByText("ไม่มีหน้าค้างรอตรวจ");

    // ... and the header badge is told the count dropped to 0, which design
    // doc §7 ("Empty" row) says means no badge at all — not a "0" badge.
    expect(screen.queryByText(/ค้าง \d+ รายการ/)).not.toBeInTheDocument();
  });

  // Design doc §10 item 8 / §4.2 / §6.2: `?open=review` must open "review"
  // on mount AND scroll to it (unlike the parse-complete auto-expand in
  // item 2/3, which deliberately does NOT scroll). jsdom does not implement
  // `Element.scrollIntoView` at all (confirmed separately — calling it
  // throws "is not a function"), so it has to be stubbed here same as a
  // real browser test would stub it; this is a test-environment gap, not
  // something the app can rely on jsdom to catch on its own.
  it("deep-link ?open=review opens 'review' on mount and scrolls to it, without touching 'upload'/'history' (§10.8)", async () => {
    vi.mocked(useSearchParams).mockReturnValueOnce(new URLSearchParams("open=review") as ReturnType<typeof useSearchParams>);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    renderPage();
    await screen.findByLabelText("หมายเหตุ — หน้า 1");

    // Opened immediately on mount (the merge-without-closing-others rule —
    // "upload" stays open too, it's never told to close).
    expect(contentHidden("upload")).toBe(false);
    expect(contentHidden("review")).toBe(false);
    expect(contentHidden("history")).toBe(true);

    // The scroll is deliberately deferred ~150ms (design doc §6.2, mirrors
    // ContentEntryQueue.tsx's existing pattern) so the just-unhidden content
    // has a frame to lay out first — wait past that window with a real
    // timer before asserting the scroll actually fired.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  // Design doc §10 item 14: "ยืนยันว่า toggle accordion เปิด/ปิด ไม่ยิง
  // request ใหม่ ... ถ้าเห็น request ซ้ำแปลว่ามีจุดไหน conditional-unmount
  // หลุดมา ต้องตีกลับ". Both PendingReviewQueue and LabelFileHistory fetch
  // once on mount and are ALWAYS mounted (hidden, never unmounted) — folding
  // a section must not re-trigger either fetch.
  it("toggling sections open/closed never re-fetches getPendingLabelReviews or getLabelFiles (§10.14)", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText("หมายเหตุ — หน้า 1"); // initial load settles

    expect(vi.mocked(getPendingLabelReviews)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getLabelFiles)).toHaveBeenCalledTimes(1);

    // Fold/unfold every section a few times each, in a mixed order.
    await user.click(headerEl("review"));
    await user.click(headerEl("history"));
    await user.click(headerEl("review"));
    await user.click(headerEl("upload"));
    await user.click(headerEl("history"));
    await user.click(headerEl("upload"));

    expect(vi.mocked(getPendingLabelReviews)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getLabelFiles)).toHaveBeenCalledTimes(1);
  });
});
