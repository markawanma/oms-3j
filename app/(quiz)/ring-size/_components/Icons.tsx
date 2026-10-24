// ไอคอน/ภาพสอนเล็กๆ ของ ring-size (inline SVG — ไม่พึ่งไฟล์ภายนอก/CDN เพื่อให้ใช้ได้ใน webview)
// ภาพสอนวาดวัตถุได้ (ไม่ใช่เวทีวัด — ห้ามนำไปวางในเวที)

type P = { size?: number; className?: string };

const base = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function BackIcon({ size = 22, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={2} className={className} aria-hidden="true">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export function ArrowRightIcon({ size = 20, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={2.2} className={className} aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 20, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={2.2} className={className} aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function LockIcon({ size = 14, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={2} className={className} aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function CameraOffIcon({ size = 24, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8} className={className} aria-hidden="true">
      <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="12.5" r="3.5" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

export function CardIcon({ size = 24, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8} className={className} aria-hidden="true">
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18M7 15h4" />
    </svg>
  );
}

export function RingSmallIcon({ size = 24, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.8} className={className} aria-hidden="true">
      <circle cx="12" cy="14" r="6" />
      <path d="M10 5h4l-2 3z" />
    </svg>
  );
}

export function LineChatIcon({ size = 24, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.9} className={className} aria-hidden="true">
      <path d="M12 4c5 0 9 3.1 9 7s-4 7-9 7c-.9 0-1.7-.1-2.5-.3L5 20l1-3.5C4.2 15.2 3 13.2 3 11c0-3.9 4-7 9-7z" />
    </svg>
  );
}

export function ShareIcon({ size = 20, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.9} className={className} aria-hidden="true">
      <path d="M12 15V4M7 9l5-5 5 5M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5" />
    </svg>
  );
}

export function GemIcon({ size = 20, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.9} className={className} aria-hidden="true">
      <path d="M7 4h10l4 5-9 11L3 9z" />
      <path d="M3 9h18M12 20L8 9l4-5 4 5z" />
    </svg>
  );
}

export function CheckIcon({ size = 18, className, strokeWidth = 2.6 }: P & { strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

export function CrossIcon({ size = 18, className, strokeWidth = 2.6 }: P & { strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function WarnIcon({ size = 36, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={1.9} className={className} aria-hidden="true">
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v5M12 18v.01" />
    </svg>
  );
}

export function PlusIcon({ size = 22, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={2.2} className={className} aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function MinusIcon({ size = 22, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={2.2} className={className} aria-hidden="true">
      <path d="M5 12h14" />
    </svg>
  );
}

export function UpDownIcon({ size = 18, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={2.4} className={className} aria-hidden="true">
      <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />
    </svg>
  );
}

// ───────────────────────── ภาพตกแต่ง / ภาพสอน ─────────────────────────

/** วงแหวนตกแต่งหน้าแรก (ซ่อนเมื่อจอเตี้ย) */
export function RingHero({ className }: { className?: string }) {
  return (
    <svg width="150" height="96" viewBox="0 0 150 96" fill="none" className={className} aria-hidden="true">
      <ellipse cx="75" cy="62" rx="52" ry="22" stroke="#C8A777" strokeWidth="1" />
      <ellipse cx="75" cy="56" rx="40" ry="16" stroke="#a2191d" strokeWidth="7" />
      <ellipse cx="75" cy="56" rx="40" ry="16" stroke="#7d1316" strokeWidth="1" opacity=".5" />
      <path d="M75 18l3 9 9 3-9 3-3 9-3-9-9-3 9-3z" fill="#a2191d" />
      <path d="M108 26l1.6 4.4 4.4 1.6-4.4 1.6-1.6 4.4-1.6-4.4-4.4-1.6 4.4-1.6z" fill="#C8A777" />
      <path d="M40 30l1.2 3.3 3.3 1.2-3.3 1.2-1.2 3.3-1.2-3.3-3.3-1.2 3.3-1.2z" fill="#C8A777" />
    </svg>
  );
}

/** ไอคอนตัวเลือกเหรียญ (R1Pick) — ภาพสอน ไม่ใช่เวทีวัด */
export function CoinPickArt({ size = 60 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 60 60" fill="none">
      <circle cx="30" cy="30" r="26" fill="#D9D9DE" stroke="#8E8E96" strokeWidth="1.5" />
      <circle cx="30" cy="30" r="16" fill="#D8B66A" stroke="#A88536" strokeWidth="1.2" />
    </svg>
  );
}

export function CardPickArt({ size = 60 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 60 60" fill="none">
      <rect x="4" y="13" width="52" height="34" rx="5" fill="#C8A777" />
      <rect x="10" y="20" width="10" height="8" rx="1.5" fill="#fff" opacity=".7" />
      <path d="M10 39h22" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" opacity=".7" />
    </svg>
  );
}

/** I1: วางบัตรทับจอ ปลายบัตรเลยขอบบนจอ เส้นแดงสองเส้นชิดขอบบัตร */
export function CardOnPhoneFigure({ label }: { label: string }) {
  return (
    <svg role="img" aria-label={label} width="100%" height="190" viewBox="0 0 300 190" fill="none">
      <rect x="95" y="28" width="110" height="160" rx="14" fill="#fff" stroke="#2B1E1E" strokeWidth="2" />
      <rect x="112" y="6" width="76" height="120" rx="6" fill="#C8A777" />
      <rect x="120" y="14" width="14" height="10" rx="2" fill="#fff" opacity=".7" />
      <path d="M120 100h40" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".7" />
      <path d="M109.5 40v140M190.5 40v140" stroke="#a2191d" strokeWidth="3" />
    </svg>
  );
}

/** I3: มองบนลงล่าง ลูกศรชี้ขอบด้านใน (ถูก) กับขอบด้านนอก (ผิด) */
export function RingEdgeFigure({ label, size = 170 }: { label: string; size?: number }) {
  return (
    <svg role="img" aria-label={label} width={(210 / 170) * size} height={size} viewBox="0 0 210 170" fill="none">
      <circle cx="80" cy="85" r="60" fill="#E9DCCB" />
      <circle cx="80" cy="85" r="60" stroke="#C8A777" strokeWidth="1.5" />
      <circle cx="80" cy="85" r="44" fill="#fff" stroke="#8C6E45" strokeWidth="1.5" />
      <circle cx="80" cy="85" r="44" fill="#a2191d" opacity=".14" />
      <path d="M80 85h44" stroke="#1F7A45" strokeWidth="2.5" />
      <path d="M118 80l6 5-6 5" stroke="#1F7A45" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M80 85L36 85" stroke="#1F7A45" strokeWidth="2.5" />
      <path d="M42 80l-6 5 6 5" stroke="#1F7A45" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M80 22v-12M140 85h12" stroke="#B42318" strokeWidth="2" strokeDasharray="3 3" />
      <circle cx="166" cy="40" r="15" fill="#1F7A45" />
      <path d="M159 40l5 5 9-10" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="166" cy="128" r="15" fill="#B42318" />
      <path d="M160 122l12 12M172 122l-12 12" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

/** I5: พันกระดาษรอบนิ้ว → ขีดรอยตรงที่ซ้อน → คลี่เป็นเส้นตรง */
export function PaperWrapFigure({ label }: { label: string }) {
  return (
    <svg role="img" aria-label={label} width="100%" height="150" viewBox="0 0 330 150" fill="none">
      {/* 1 พัน */}
      <rect x="28" y="20" width="34" height="110" rx="17" fill="#E9DCCB" stroke="#8C6E45" strokeWidth="1.5" />
      <rect x="22" y="60" width="46" height="22" rx="4" fill="#fff" stroke="#2B1E1E" strokeWidth="1.5" />
      <text x="45" y="14" textAnchor="middle" fontSize="13" fill="#5C4D49">1</text>
      {/* 2 ขีด */}
      <rect x="130" y="60" width="46" height="22" rx="4" fill="#fff" stroke="#2B1E1E" strokeWidth="1.5" />
      <path d="M160 56v30" stroke="#a2191d" strokeWidth="3" />
      <text x="153" y="14" textAnchor="middle" fontSize="13" fill="#5C4D49">2</text>
      {/* 3 คลี่ */}
      <rect x="236" y="22" width="22" height="110" rx="3" fill="#fff" stroke="#2B1E1E" strokeWidth="1.5" />
      <path d="M232 88h30" stroke="#a2191d" strokeWidth="3" />
      <text x="247" y="14" textAnchor="middle" fontSize="13" fill="#5C4D49">3</text>
      <path d="M78 71h40M186 71h40" stroke="#C8A777" strokeWidth="1.5" strokeDasharray="4 4" />
    </svg>
  );
}
