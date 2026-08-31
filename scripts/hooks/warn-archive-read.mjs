// PostToolUse hook (matcher: Read) — เตือนอัตโนมัติเมื่อมีการอ่านไฟล์ใน docs/3j-jewelry/_archive/
// เหตุผล: ไฟล์ใน _archive ถูกแทนที่/มีข้อมูลผิด — เคยพาแผนพังมาแล้ว (positioning-2pillar → สมมติฐาน OEM ผิด)
// กลไกนี้ปิด gap "agent หยิบไฟล์เก่าโดยไม่รู้ตัว" โดยไม่ต้องรอเจ้าของสังเกต
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  try {
    const input = JSON.parse(raw || "{}");
    const fp = String(input?.tool_input?.file_path || "");
    if (/[\\/]_archive[\\/]/.test(fp)) {
      const name = fp.split(/[\\/]/).pop();
      process.stdout.write(
        JSON.stringify({
          systemMessage: `⛔ อ่านไฟล์ archive: ${name} — ไฟล์นี้ถูกแทนที่แล้ว`,
          hookSpecificOutput: {
            hookEventName: "PostToolUse",
            additionalContext:
              `คำเตือนอัตโนมัติ: ${name} อยู่ใน docs/3j-jewelry/_archive/ = ถูกแทนที่/มีข้อมูลที่ผิดหรือขัดกฎแบรนด์ ` +
              `ห้ามใช้วางแผนหรืออ้างเป็นข้อเท็จจริง — เปิด docs/3j-jewelry/INDEX.md เพื่อหาไฟล์ที่แทนที่มัน ` +
              `(อ่านเพื่อดูประวัติได้อย่างเดียว)`,
          },
        })
      );
    }
  } catch {
    // hook ห้ามล้มงานหลัก — เงียบเสมอเมื่อ parse ไม่ได้
  }
  process.exit(0);
});
