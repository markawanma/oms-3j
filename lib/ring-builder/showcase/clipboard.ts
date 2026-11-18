// lib/ring-builder/showcase/clipboard.ts — คัดลอกข้อความลงคลิปบอร์ด (client · ไม่ throw)
// คัดลอกแนวเดียวกับ copyText ของ /ring-size แต่เขียนแยกไว้ที่นี่: boundary.test.ts ห้าม lib/ring-builder/** import lib/ring-size ยกเว้น calibration/size
// webview บางตัว (LINE/TikTok) ไม่มี navigator.clipboard → ลอง execCommand ผ่าน textarea ชั่วคราว · ไม่สำเร็จ = คืน false (UI แสดง textarea ให้กดค้างคัดลอกเอง)
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // ตกไปทางสำรอง
  }
  try {
    if (typeof document === "undefined") return false;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = typeof document.execCommand === "function" ? document.execCommand("copy") : false;
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
