# vendored: uqr 0.1.3 (MIT) — ตัวสร้าง QR (SVG) ฝั่ง server ของระบบใบงาน J1

- แหล่ง: npm `uqr@0.1.3` · tarball integrity `sha512-0rjE8iEJe4YmT9TOhwsZtqCMRLc5DXZUI2UEYUUg63ikBkqqE5EYWaI0etFe/5KUcmcYwLih2RND1kq+hrUJXA==`
- ไฟล์: `index.mjs` + `index.d.mts` คัดลอก **ไม่แก้แม้ตัวอักษรเดียว** จาก `package/dist/` ของ tarball · `LICENSE` ตามต้นฉบับ
- ไม่มี runtime dependency · ไม่มี network / fs / eval / process (ตรวจด้วย grep ใน lib/jobs/qr.test.ts)
- ทำไม vendor แทน `npm install`: worktree นี้ใช้ node_modules แบบ junction ชี้ dir หลัก — ติดตั้งจะเขียนลง node_modules ของ dir หลัก (ห้ามแตะ)
  → ตอน merge ให้ Tech Lead เลือก: คง vendor (ตรวจง่ายที่สุด — 739 บรรทัดอ่านได้) หรือเปลี่ยนเป็น `npm i uqr@0.1.3 --save-exact` แล้วลบโฟลเดอร์นี้
- ตรวจ supply chain: `npm pack uqr@0.1.3` แล้ว diff กับไฟล์ที่นี่ต้องว่าง · ผู้ดูแล: unjs (Anthony Fu)
