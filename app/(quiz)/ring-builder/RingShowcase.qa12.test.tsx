// @vitest-environment jsdom
// QA D1.2 (R2-D2): SSR/loading state has no bypass2 photo on photoless designs · reload keeps stones · CZ small only on bypass2
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { DESIGNS, getShowcaseDesign } from "@/lib/ring-builder/showcase/designs";
import { EMPTY_SHOWCASE_PARAMS, parseTableParam, readShowcaseParams, type IntentionTable } from "@/lib/ring-builder/showcase/quiz-link";
import { SHOWCASE_PHOTOS } from "./_assets";
import { RingShowcaseClient } from "./RingShowcaseClient";

afterEach(cleanup);
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null as never);
  window.history.replaceState(null, "", "/ring-builder");
  Element.prototype.scrollIntoView = vi.fn();
});

const TABLE = parseTableParam("gac.acp.cpb.bgc.pab.gpa") as IntentionTable;
const bypassSrcs = SHOWCASE_PHOTOS.bypass2.map((p) => p.src);

describe("Case 5: photoless designs never render a bypass2 <img> - first paint (checking/loading) included", () => {
  for (const d of DESIGNS.filter((x) => x.id !== "bypass2")) {
    it(`SSR first paint r=${d.id}: no <img>, no bypass2 src`, () => {
      const html = renderToString(<RingShowcaseClient params={readShowcaseParams({ r: d.id })} />);
      expect(html).not.toMatch(/<img/i);
      for (const src of bypassSrcs) expect(html).not.toContain(src);
    });
  }
  it("SSR first paint r=bypass2 does contain bypass2 photo (sanity: detector works)", () => {
    const html = renderToString(<RingShowcaseClient params={readShowcaseParams({})} />);
    expect(bypassSrcs.some((s) => html.includes(s))).toBe(true);
  });
  it("hostile r on SSR = bypass2 page, no throw", () => {
    expect(() => renderToString(<RingShowcaseClient params={readShowcaseParams({ r: ["x", "y"] })} />)).not.toThrow();
  });
});

describe("Case 6: CZ small 2 stones only on bypass2 (summary DOM)", () => {
  for (const d of DESIGNS) {
    it(`${d.id}`, () => {
      render(<RingShowcaseClient params={{ ...EMPTY_SHOWCASE_PARAMS, ring: d.id }} />);
      const body = document.body.textContent ?? "";
      expect(/CZ เล็ก\s*2\s*เม็ด/.test(body) || /CZ เล็ก2 เม็ด/.test(body)).toBe(d.id === "bypass2");
      expect(body.includes("CZ คือคิวบิกเซอร์โคเนีย")).toBe(d.id === "bypass2");
      expect(body).not.toContain("เพชร");
    });
  }
});

describe("Case 2: size 52 survives bypass detour; reload keeps stones and design", () => {
  it("trinity size 52 -> bypass2 (not sent, notice) -> back to trinity (52 restored)", async () => {
    const u = userEvent.setup();
    render(<RingShowcaseClient params={{ ...EMPTY_SHOWCASE_PARAMS, ring: "trinity" }} />);
    await u.click(screen.getByRole("radio", { name: "เบอร์ 52" }));
    const lineMsg = () => {
      const href = screen.getByRole("link", { name: /ส่งให้แอดมินทาง LINE/ }).getAttribute("href") ?? "";
      return decodeURIComponent(href.slice(href.indexOf("/?") + 2));
    };
    expect(lineMsg()).toContain("เบอร์ 52");
    await u.click(screen.getByRole("radio", { name: getShowcaseDesign("bypass2").name }));
    expect(lineMsg()).not.toContain("52");
    expect(lineMsg()).toContain("รอแอดมินช่วยเช็ก");
    expect(document.body.textContent).toMatch(/ไซซ์ 52 ใช้กับแบบนี้ไม่ได้/);
    await u.click(screen.getByRole("radio", { name: getShowcaseDesign("trinity").name }));
    expect(lineMsg()).toContain("เบอร์ 52");
  });
  it("URL after choosing a design + reload (parse back) keeps ring and own stones", async () => {
    const u = userEvent.setup();
    const { unmount } = render(<RingShowcaseClient params={{ ...EMPTY_SHOWCASE_PARAMS, table: TABLE, intention: "love", answered: "love" }} />);
    await u.click(screen.getByRole("radio", { name: getShowcaseDesign("channel4").name }));
    const url = new URL(window.location.href);
    expect(url.searchParams.get("r")).toBe("channel4");
    expect(url.searchParams.get("t")).toBe("gac.acp.cpb.bgc.pab.gpa");
    unmount();
    const q: Record<string, string> = {};
    url.searchParams.forEach((v, k) => (q[k] = v));
    const params = readShowcaseParams(q);
    expect(params.ring).toBe("channel4");
    expect(params.intention).toBe("love");
    expect(params.answered).toBe("love");
    render(<RingShowcaseClient params={params} />);
    expect(screen.getByRole("radio", { name: getShowcaseDesign("channel4").name })).toHaveAttribute("aria-checked", "true");
  });
});
