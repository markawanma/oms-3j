// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { CollapsibleSection } from "./CollapsibleSection";

// vitest.config.ts does NOT set `test.globals: true` (matches the rest of
// this repo's test suites, which import everything explicitly from
// "vitest") — @testing-library/react's auto-cleanup-after-each only
// self-registers when it detects a global `afterEach`, so without globals
// enabled it never fires on its own. Without this, each `render()` call
// below would leave its previous test's DOM mounted, and queries like
// `getByRole` would start throwing "found multiple elements" once more than
// one test in this file has rendered a section with the same title.
afterEach(cleanup);

/**
 * CollapsibleSection is the accordion primitive behind /tiktok/upload's 3
 * sections (design doc: docs/3j-jewelry/analytics/upload-page-layout-design.md
 * §6.1/§7/§8). Its one load-bearing behavior is that folding a section must
 * NEVER unmount its children — LabelReviewQueueRow/ProvinceFixRow keep
 * per-row form state (province/reason/note) in local useState, and losing
 * that silently on fold/unfold would reproduce exactly the bug the design
 * doc calls out in §2 ("state หายเงียบๆ"). Everything here tests that this
 * is actually true, not just that the component "looks right".
 */

// A child with its own useState, standing in for LabelReviewQueueRow's form
// state — the thing we need to prove survives being folded away and back.
function StatefulChild() {
  const [value, setValue] = useState("");
  return (
    <input
      aria-label="stateful-child-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}

function Harness({ initialOpen = true }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <CollapsibleSection id="test" title="ทดสอบ" open={open} onToggle={() => setOpen((o) => !o)}>
      <StatefulChild />
    </CollapsibleSection>
  );
}

describe("CollapsibleSection", () => {
  describe("hidden attribute does not unmount children", () => {
    it("preserves child useState across a single fold/unfold cycle", async () => {
      const user = userEvent.setup();
      render(<Harness initialOpen={true} />);

      const input = screen.getByLabelText("stateful-child-input");
      await user.type(input, "จังหวัดเชียงใหม่");
      expect(input).toHaveValue("จังหวัดเชียงใหม่");

      const header = screen.getByRole("button", { name: "ทดสอบ" });
      await user.click(header); // fold
      await user.click(header); // unfold

      // Re-query: if the child had been unmounted/remounted, this would be a
      // *new* DOM node with its useState reset to "" regardless of whether we
      // re-query or reuse the old reference — testing-library would still
      // find it via the same label.
      expect(screen.getByLabelText("stateful-child-input")).toHaveValue("จังหวัดเชียงใหม่");
    });

    it("preserves child useState across many fold/unfold cycles", async () => {
      const user = userEvent.setup();
      render(<Harness initialOpen={true} />);

      const input = screen.getByLabelText("stateful-child-input");
      await user.type(input, "RT-2608-016");

      const header = screen.getByRole("button", { name: "ทดสอบ" });
      for (let i = 0; i < 10; i += 1) {
        await user.click(header);
      }

      expect(screen.getByLabelText("stateful-child-input")).toHaveValue("RT-2608-016");
    });

    it("uses the native hidden attribute, not conditional rendering", () => {
      const { container } = render(
        <CollapsibleSection id="test" title="ทดสอบ" open={false} onToggle={() => {}}>
          <StatefulChild />
        </CollapsibleSection>
      );

      // The content region must still be present in the DOM even while
      // folded — conditional rendering ({open && children}) would make this
      // query return null.
      const content = container.querySelector("#test-content");
      expect(content).not.toBeNull();
      expect(content).toHaveAttribute("hidden");
      // The child is still mounted inside it.
      expect(screen.getByLabelText("stateful-child-input")).toBeInTheDocument();
    });
  });

  describe("aria-expanded", () => {
    it("is false when folded and true when open", () => {
      const { rerender } = render(
        <CollapsibleSection id="test" title="ทดสอบ" open={false} onToggle={() => {}}>
          <p>content</p>
        </CollapsibleSection>
      );
      expect(screen.getByRole("button", { name: "ทดสอบ" })).toHaveAttribute("aria-expanded", "false");

      rerender(
        <CollapsibleSection id="test" title="ทดสอบ" open={true} onToggle={() => {}}>
          <p>content</p>
        </CollapsibleSection>
      );
      expect(screen.getByRole("button", { name: "ทดสอบ" })).toHaveAttribute("aria-expanded", "true");
    });

    it("flips after a real click via onToggle wired to controlled state (Harness)", async () => {
      const user = userEvent.setup();
      render(<Harness initialOpen={false} />);

      const header = screen.getByRole("button", { name: "ทดสอบ" });
      expect(header).toHaveAttribute("aria-expanded", "false");

      await user.click(header);
      expect(header).toHaveAttribute("aria-expanded", "true");

      await user.click(header);
      expect(header).toHaveAttribute("aria-expanded", "false");
    });
  });

  describe("aria-controls", () => {
    it("points at the real content element's id", () => {
      render(
        <CollapsibleSection id="review" title="ตรวจ/แก้ไข" open={true} onToggle={() => {}}>
          <p>content</p>
        </CollapsibleSection>
      );

      const header = screen.getByRole("button", { name: "ตรวจ/แก้ไข" });
      const controlsId = header.getAttribute("aria-controls");
      expect(controlsId).toBe("review-content");

      const content = document.getElementById(controlsId as string);
      expect(content).not.toBeNull();
      expect(content).toHaveAttribute("role", "region");
      expect(content).toHaveAttribute("aria-labelledby", header.id);
    });

    it("keeps id/aria-controls unique per section id, not hardcoded", () => {
      render(
        <>
          <CollapsibleSection id="upload" title="อัปโหลด" open={true} onToggle={() => {}}>
            <p>a</p>
          </CollapsibleSection>
          <CollapsibleSection id="history" title="ประวัติไฟล์" open={false} onToggle={() => {}}>
            <p>b</p>
          </CollapsibleSection>
        </>
      );

      expect(screen.getByRole("button", { name: "อัปโหลด" })).toHaveAttribute("aria-controls", "upload-content");
      expect(screen.getByRole("button", { name: "ประวัติไฟล์" })).toHaveAttribute("aria-controls", "history-content");
      expect(document.getElementById("upload-content")).not.toBeNull();
      expect(document.getElementById("history-content")).not.toBeNull();
    });
  });

  describe("badge states", () => {
    it("renders 'ไม่รู้จำนวน' loading state (not a visible 0) when count is undefined", () => {
      render(
        <CollapsibleSection
          id="review"
          title="ตรวจ/แก้ไข"
          open={false}
          onToggle={() => {}}
          badge={{ count: undefined }}
        >
          <p>content</p>
        </CollapsibleSection>
      );

      // Loading state renders a status indicator, never a visible "0" text.
      expect(screen.getByRole("status", { name: "กำลังโหลดจำนวนที่ค้าง" })).toBeInTheDocument();
      expect(screen.queryByText("0")).not.toBeInTheDocument();
    });

    it("renders an error indicator (not '0') when count is null", () => {
      render(
        <CollapsibleSection
          id="review"
          title="ตรวจ/แก้ไข"
          open={false}
          onToggle={() => {}}
          badge={{ count: null }}
        >
          <p>content</p>
        </CollapsibleSection>
      );

      expect(screen.getByLabelText("โหลดจำนวนที่ค้างไม่สำเร็จ")).toBeInTheDocument();
      expect(screen.queryByText("0")).not.toBeInTheDocument();
    });

    it("renders no badge at all when count is 0", () => {
      render(
        <CollapsibleSection
          id="review"
          title="ตรวจ/แก้ไข"
          open={false}
          onToggle={() => {}}
          badge={{ count: 0 }}
        >
          <p>content</p>
        </CollapsibleSection>
      );

      expect(screen.queryByText("0")).not.toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("renders the real number when count is > 0, with an accessible label", () => {
      render(
        <CollapsibleSection
          id="review"
          title="ตรวจ/แก้ไข"
          open={false}
          onToggle={() => {}}
          badge={{ count: 114 }}
        >
          <p>content</p>
        </CollapsibleSection>
      );

      expect(screen.getByText("114")).toBeInTheDocument();
      expect(screen.getByText("ค้าง 114 รายการ")).toBeInTheDocument();
    });

    it("renders no badge markup when the badge prop is omitted entirely", () => {
      render(
        <CollapsibleSection id="history" title="ประวัติไฟล์" open={false} onToggle={() => {}}>
          <p>content</p>
        </CollapsibleSection>
      );

      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.queryByText(/รายการ/)).not.toBeInTheDocument();
    });
  });

  describe("toggle", () => {
    it("fires onToggle when the header is clicked", async () => {
      const user = userEvent.setup();
      const onToggle = vi.fn();
      render(
        <CollapsibleSection id="test" title="ทดสอบ" open={false} onToggle={onToggle}>
          <p>content</p>
        </CollapsibleSection>
      );

      await user.click(screen.getByRole("button", { name: "ทดสอบ" }));
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it("fires onToggle via keyboard (Enter/Space) on the native button", async () => {
      const user = userEvent.setup();
      const onToggle = vi.fn();
      render(
        <CollapsibleSection id="test" title="ทดสอบ" open={false} onToggle={onToggle}>
          <p>content</p>
        </CollapsibleSection>
      );

      const header = screen.getByRole("button", { name: "ทดสอบ" });
      header.focus();
      await user.keyboard("{Enter}");
      expect(onToggle).toHaveBeenCalledTimes(1);

      await user.keyboard(" ");
      expect(onToggle).toHaveBeenCalledTimes(2);
    });

    it("actually opens and closes end-to-end when wired to real state (Harness)", async () => {
      const user = userEvent.setup();
      render(<Harness initialOpen={false} />);

      const content = document.getElementById("test-content");
      expect(content).toHaveAttribute("hidden");

      await user.click(screen.getByRole("button", { name: "ทดสอบ" }));
      expect(content).not.toHaveAttribute("hidden");

      await user.click(screen.getByRole("button", { name: "ทดสอบ" }));
      expect(content).toHaveAttribute("hidden");
    });
  });
});
