import { describe, expect, it } from "vitest";
import { safeHttpUrl } from "./safe-url";

describe("safeHttpUrl", () => {
  it("http/https ผ่าน", () => {
    expect(safeHttpUrl("https://example.org/a?b=1")).toBe("https://example.org/a?b=1");
    expect(safeHttpUrl(" http://example.org ")).toBe("http://example.org/");
  });
  it("javascript:/data:/vbscript:/file: ไม่ผ่าน", () => {
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>", "vbscript:x", "file:///etc/passwd", "ftp://x.org"]) {
      expect(safeHttpUrl(bad), bad).toBeNull();
    }
  });
  it("มีช่องว่าง/อักขระควบคุม/user:pass@/ว่าง/ยาวเกิน/ไม่ใช่สตริง ไม่ผ่าน", () => {
    for (const bad of ["https://a b.com", "https://x.org/\u0000", "https://user:pw@x.org", "", "   ", "https://x.org/" + "a".repeat(2100), null, undefined]) {
      expect(safeHttpUrl(bad as string)).toBeNull();
    }
  });
});
