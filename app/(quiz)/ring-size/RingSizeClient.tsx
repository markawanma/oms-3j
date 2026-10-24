"use client";

// app/(quiz)/ring-size/RingSizeClient.tsx — state machine ของเครื่องมือวัดไซส์แหวน
//
// ลำดับจอ/ปลายทางย้อน/ตัวนับขั้น = lib/ring-size/flow.ts (pure + มีเทสต์) · ไฟล์นี้ต่อสายกับ history + storage + จอ
//
// 🔴 กฎที่ต้องไม่หลุด:
//   - Hydration: state เริ่มต้น deterministic (R0 · ไม่มีค่า) · localStorage/window/screen อ่านเฉพาะใน useEffect/handler
//     (ก่อนอ่านเสร็จ loaded=false → R0 แสดงโครงเปล่าไม่มีการ์ดเงื่อนไข)
//   - ทุกจอ = 1 history entry (pushState) · Back ของเครื่องย้อนทีละจอ ไม่ปิดหน้า · ค่าที่วัดแล้วไม่หายเมื่อย้อน
//     (ค่าเก็บเป็น มม./ppm ใน state ของ component นี้ — จอลูกอ่านค่าเริ่มจากที่นี่)
//   - localStorage ทุกจุด try/catch (lib/ring-size/calibration.ts) · ค่าเสีย = ทิ้ง · เขียนไม่ได้ = ทำงานต่อโดยไม่จำ
//   - ไม่ import "use server" / lib/actions · ไม่มีโค้ดกล้อง · ไม่มี network (ไม่มี API/DB)
//   - G5: ค่าเทียบเก่าไม่ตรงเครื่อง/การซูมตอนนี้ → ไม่ใช้เงียบๆ → พาไปจอเทียบของ ref เดิม (ข้าม R1Pick) พร้อมแถบแจ้ง
//   - tracking ปิด (TRACK_ENABLED=false) — ไม่มี sink ในโค้ดชุดนี้
import { useCallback, useEffect, useRef, useState } from "react";
import { CALIBRATION, type Method, type RefKind } from "@/lib/ring-size/config";
import {
  CALIBRATION_VERSION,
  currentFingerprint,
  isStaleCalibration,
  isTypicalPxPerMm,
  readCalibration,
  readLastResult,
  startPpmFromDpr,
  writeCalibration,
  writeLastResult,
  type Calibration,
  type LastResult,
} from "@/lib/ring-size/calibration";
import {
  MEASURE_SCREENS,
  backDestination,
  calibrationScreenFor,
  isScreenId,
  remeasureDestination,
  resolveScreen,
  startDestination,
  stepCounter,
  type ScreenId,
} from "@/lib/ring-size/flow";
import { circToRec, diameterToCirc, isPlausibleCirc, roundTenth } from "@/lib/ring-size/size";
import { G3Sheet } from "./_components/G3Sheet";
import { Calibrate } from "./_screens/Calibrate";
import { G4 } from "./_screens/G4";
import { R0 } from "./_screens/R0";
import { R1 } from "./_screens/R1";
import { R1Pick } from "./_screens/R1Pick";
import { R3 } from "./_screens/R3";
import { R4A } from "./_screens/R4A";
import { R4B } from "./_screens/R4B";
import { R5A } from "./_screens/R5A";
import { R5B } from "./_screens/R5B";
import { R6 } from "./_screens/R6";

interface ResultState {
  /** เส้นรอบวงที่ปัด 0.1 แล้ว */
  circ: number;
  method: Method;
  ref: RefKind;
  measuredAt: number;
}

/** ระยะที่ถือว่า "กำลังย้อน" สูงสุด (ms) ถ้า popstate ไม่มา */
const BACK_PENDING_MS = 800;

interface HistState {
  rs: ScreenId;
  i: number;
}

/**
 * state ของ history entry ใหม่ = state เดิม + { rs, i }  (QA-3: ห้ามเขียนทับทั้งก้อน)
 *
 * Next App Router ใส่ { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE } ใน history.state ทุก entry (next@15.5 app-router.js)
 * และ onPopState จะสั่ง window.location.reload() ทันทีถ้า event.state มีค่าแต่ไม่มี __NA
 * Router ครอบ pushState/replaceState ให้คัดลอก __NA ให้เองก็จริง แต่ React รัน effect "ลูกก่อนแม่" — effect ตอน mount ของหน้านี้
 * จึงเรียก replaceState ตัวจริงของเบราว์เซอร์ก่อน patch ติดตั้ง → ทับ __NA ทิ้ง → ปุ่ม Back ทุกจอ = reload (ค่าที่วัดหาย)
 * วิธีที่ถูก: ใช้ window.history.pushState/replaceState (ตัว Next patch ไว้ — เป็นแนวทางที่เอกสาร Next ระบุสำหรับ
 * "Native History API" ซิงก์กับ usePathname/useSearchParams) แต่ส่ง state ที่ "คงของเดิมไว้" ไม่ว่า patch จะติดตั้งแล้วหรือยัง
 * (state ที่มี __NA ถูกส่งผ่านตรงๆ ไม่ถูกแก้ซ้ำ — ดู app-router.js)
 * ทางอื่นที่ไม่เลือก: router.push/replace (ยิง RSC request + render ใหม่ทุกจอ ทั้งที่จอพวกนี้เป็น state ฝั่ง client ล้วน) · hash (#R3) (ไม่ผ่านระบบ history ของ Next และแชร์ลิงก์เข้าจอกลางทางได้ซึ่งไม่มีข้อมูลรองรับ)
 */
function nextHistoryState(rs: ScreenId, i: number): Record<string, unknown> {
  const cur = window.history.state as unknown;
  const base = cur && typeof cur === "object" && !Array.isArray(cur) ? (cur as Record<string, unknown>) : {};
  return { ...base, rs, i } satisfies Record<string, unknown>;
}

function readHistState(): HistState | null {
  try {
    const s = window.history.state as { rs?: unknown; i?: unknown } | null;
    if (s && isScreenId(s.rs) && typeof s.i === "number" && Number.isInteger(s.i) && s.i >= 0) return { rs: s.rs, i: s.i };
  } catch {
    // ไม่มี history API ที่ใช้ได้ — ทำงานต่อโดยไม่มี entry
  }
  return null;
}

/** method ของจอ (ใช้ตอน popstate) — จอวัด/สอนบอกเอง · R6/G4 ตามผลที่ค้างอยู่ · จออื่น = ไม่เปลี่ยน */
function methodForScreen(rs: ScreenId, result: ResultState | null, invalid: { method: Method } | null): Method | null {
  switch (rs) {
    case "R4A":
    case "R5A":
      return "A";
    case "R4B":
    case "R5B":
      return "B";
    case "R6":
      return result ? result.method : null;
    case "G4":
      return invalid ? invalid.method : null;
    default:
      return null;
  }
}

export function RingSizeClient() {
  // ───── state เริ่มต้น deterministic (ตรงกับ SSR) ─────
  const [screen, setScreen] = useState<ScreenId>("R0");
  const [loaded, setLoaded] = useState(false);
  const [calib, setCalib] = useState<Calibration | null>(null);
  const [stale, setStale] = useState(false);
  const [lastResult, setLastResult] = useState<LastResult | null>(null);
  const [method, setMethod] = useState<Method | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [g5, setG5] = useState(false);
  const [missingCalib, setMissingCalib] = useState(false);
  const [drafts, setDrafts] = useState<{ card: number | null; coin: number | null }>({ card: null, coin: null });
  const [measure, setMeasure] = useState<{ A: number | null; B: number | null }>({ A: null, B: null });
  const [result, setResult] = useState<ResultState | null>(null);
  const [resultFromHome, setResultFromHome] = useState(false);
  const [invalid, setInvalid] = useState<{ circ: number; method: Method; diameterMm: number | null } | null>(null);
  const [g3, setG3] = useState<{ kind: RefKind; ppm: number } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<ScreenId[]>(["R0"]);
  const idxRef = useRef(0);
  const firstRender = useRef(true);
  // QA-2: ปุ่มย้อนบนจอเรียก history.back() (async — popstate มาทีหลัง) · กดรัวก่อน popstate = back() ซ้ำ = ออกนอกหน้า
  // จึงมี flag "กำลังย้อน" จน popstate มาถึง (หรือครบ BACK_PENDING_MS กันค้างถ้า popstate ไม่มา)
  const backPendingRef = useRef(false);
  const backTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // popstate handler ถูกผูกครั้งเดียวตอน mount — อ่านผลวัดล่าสุดผ่าน ref (ไม่ใช่ closure เก่า)
  const resultRef = useRef<ResultState | null>(null);
  resultRef.current = result;
  const invalidRef = useRef<{ circ: number; method: Method; diameterMm: number | null } | null>(null);
  invalidRef.current = invalid;

  // ───── history: ทุกจอ = 1 entry ─────
  const navigate = useCallback((next: ScreenId, opts?: { replace?: boolean; keepNotice?: boolean }) => {
    setG3(null);
    if (!opts?.keepNotice) setMissingCalib(false);
    try {
      if (opts?.replace) {
        stackRef.current[idxRef.current] = next;
        window.history.replaceState(nextHistoryState(next, idxRef.current), "");
      } else {
        stackRef.current = stackRef.current.slice(0, idxRef.current + 1);
        stackRef.current.push(next);
        idxRef.current += 1;
        window.history.pushState(nextHistoryState(next, idxRef.current), "");
      }
    } catch {
      // history ใช้ไม่ได้ — จอยังเปลี่ยนได้ (เสียแค่ปุ่ม Back ของเครื่อง)
    }
    setScreen(next);
  }, []);

  /** ปุ่มย้อนบนจอ: ถ้า entry ก่อนหน้าคือปลายทางที่ต้องไป → history.back() (ไม่สะสม entry) · ไม่ใช่ → ไปปลายทางด้วย push */
  const goBack = useCallback(
    (dest: ScreenId) => {
      if (backPendingRef.current) return; // กำลังย้อนอยู่ — กดซ้ำไม่นับ
      const i = idxRef.current;
      if (dest === stackRef.current[i]) return; // ปลายทางคือจอนี้เอง (กดรัวหลัง navigate) — ไม่ push entry ซ้ำ
      if (i > 0 && stackRef.current[i - 1] === dest) {
        try {
          backPendingRef.current = true;
          if (backTimerRef.current) clearTimeout(backTimerRef.current);
          backTimerRef.current = setTimeout(() => {
            backPendingRef.current = false;
          }, BACK_PENDING_MS);
          window.history.back();
          return;
        } catch {
          backPendingRef.current = false;
          // ตกไป navigate ปกติ
        }
      }
      navigate(dest);
    },
    [navigate]
  );

  // ───── mount: อ่าน storage (ใน effect เท่านั้น) + ผูก history + ล็อก scroll ของ document ─────
  useEffect(() => {
    const c = readCalibration();
    setCalib(c);
    setStale(c ? isStaleCalibration(c, currentFingerprint()) : false); // คำนวณพร้อม calib ในรอบเดียว (กันการ์ด "เทียบไว้แล้ว" กะพริบ)
    setLastResult(readLastResult());
    setLoaded(true);

    // entry แรกของหน้านี้ = R0 (รีโหลดแล้ว history.state ค้างจอเก่า — ค่าที่วัดไม่อยู่แล้ว จึงเริ่ม R0 ใหม่)
    try {
      const prev = readHistState();
      const i = prev ? prev.i : 0;
      stackRef.current = [];
      stackRef.current[i] = "R0";
      idxRef.current = i;
      window.history.replaceState(nextHistoryState("R0", i), "");
    } catch {
      // ไม่มี history API
    }

    const onPop = (e: PopStateEvent) => {
      const s = e.state as { rs?: unknown; i?: unknown } | null;
      const rs: ScreenId = s && isScreenId(s.rs) ? s.rs : "R0";
      const i = s && typeof s.i === "number" && Number.isInteger(s.i) && s.i >= 0 ? s.i : 0;
      backPendingRef.current = false;
      if (backTimerRef.current) {
        clearTimeout(backTimerRef.current);
        backTimerRef.current = null;
      }
      idxRef.current = i;
      stackRef.current[i] = rs;
      setG3(null);
      // method เป็นฟังก์ชันของจอที่ย้อนไปถึง: R6 → ลองวิธีอื่น → Back ต้องได้ method ของผลนั้นคืน (ไม่ค้างเป็นวิธีอื่น)
      const m = methodForScreen(rs, resultRef.current, invalidRef.current);
      if (m) setMethod(m);
      setScreen(rs);
    };
    window.addEventListener("popstate", onPop);

    // layout ใช้ wrapper fixed ที่เลื่อนเอง — กัน document เลื่อนซ้อนสองชั้นข้างหลัง
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    html.style.overflow = "hidden";

    return () => {
      window.removeEventListener("popstate", onPop);
      html.style.overflow = prevOverflow;
      if (backTimerRef.current) clearTimeout(backTimerRef.current);
    };
  }, []);

  // ───── G5: ค่าเทียบไม่ตรงเครื่อง/การซูมตอนนี้ (DPR เปลี่ยนกลางทาง) ─────
  useEffect(() => {
    if (!calib) return;
    // ตรวจเฉพาะเมื่อหน้าต่างเปลี่ยน (ซูม/aA/หมุน) — ค่าเริ่มต้นคำนวณตอน mount และตอนบันทึกค่าใหม่ (finishCalibration) แล้ว
    const check = () => setStale(isStaleCalibration(calib, currentFingerprint()));
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [calib]);

  // ───── ด่านกันเข้าจอโดยไม่มีของที่ต้องใช้ ─────
  const staleBlocked = !!calib && stale && (MEASURE_SCREENS as readonly string[]).includes(screen);
  const guard = resolveScreen(screen, { hasCalibration: !!calib, hasResult: !!result, hasInvalid: !!invalid });
  const shown: ScreenId = staleBlocked && calib ? calibrationScreenFor(calib.ref) : guard.screen;

  useEffect(() => {
    if (shown === screen) return;
    if (staleBlocked) {
      setG5(true);
      navigate(shown, { replace: true });
    } else {
      navigate(shown, { replace: true, keepNotice: true });
      if (guard.missingCalibration) setMissingCalib(true);
    }
  }, [shown, screen, staleBlocked, guard.missingCalibration, navigate]);

  // เปลี่ยนจอ: โฟกัสไปที่เนื้อหา + เลื่อนกลับบนสุด (ไม่ทำตอน render ครั้งแรก)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const root = rootRef.current;
    if (!root) return;
    root.focus({ preventScroll: true });
    const scroller = root.parentElement;
    if (scroller && typeof scroller.scrollTo === "function") scroller.scrollTo(0, 0);
  }, [shown]);

  const counter = stepCounter(shown, skipped);
  const backCtx = { ref: calib?.ref ?? null, method, calibratedThisFlow: !skipped, resultFromHome };
  const back = (from: ScreenId) => goBack(backDestination(from, backCtx));

  // ───── การกระทำ ─────
  const start = () => {
    const d = startDestination({ calibration: calib, stale });
    setSkipped(d.skipped);
    setG5(d.g5);
    navigate(d.screen);
  };

  const redoCalibration = () => {
    setSkipped(false);
    setG5(false);
    navigate("R1Pick");
  };

  const pickRef = (ref: RefKind) => {
    setSkipped(false);
    setG5(false);
    navigate(ref === "coin" ? "R2Coin" : "R1");
  };

  const switchKind = (from: RefKind) => {
    setG5(false);
    navigate(from === "coin" ? "R1" : "R2Coin");
  };

  const finishCalibration = (kind: RefKind, ppm: number) => {
    const fp = currentFingerprint();
    const c: Calibration = { pxPerMm: ppm, ref: kind, ...fp, savedAt: Date.now(), version: CALIBRATION_VERSION };
    writeCalibration(c); // เขียนไม่ได้ = ทำงานต่อโดยไม่จำ (ไม่แจ้งผู้ใช้)
    setCalib(c);
    setStale(false);
    setG5(false);
    setSkipped(false);
    navigate("R3");
  };

  const confirmCalibration = (kind: RefKind, ppm: number) => {
    // G3: ค่านอกช่วงปกติ → ถามก่อน · "ยังไม่บันทึก" จนกว่าผู้ใช้ตัดสิน
    if (!isTypicalPxPerMm(ppm)) {
      setG3({ kind, ppm });
      return;
    }
    finishCalibration(kind, ppm);
  };

  const pickMethod = (m: Method) => {
    setMethod(m);
    navigate(m === "A" ? "R4A" : "R4B");
  };

  const finishMeasure = (m: Method, rawCirc: number, diameterMm: number | null = null) => {
    const rec = circToRec(rawCirc, m);
    if (!rec || !isPlausibleCirc(rawCirc) || !calib) {
      setInvalid({ circ: roundTenth(Number.isFinite(rawCirc) ? rawCirc : 0), method: m, diameterMm });
      navigate("G4");
      return;
    }
    const now = Date.now();
    const r: ResultState = { circ: rec.circ, method: m, ref: calib.ref, measuredAt: now };
    setInvalid(null);
    setResult(r);
    setResultFromHome(false);
    const saved: LastResult = { circ: r.circ, method: m, ref: r.ref, savedAt: now, version: 1 };
    writeLastResult(saved); // จำไม่ได้ก็ยังใช้ในเซสชันนี้ได้
    setLastResult(saved);
    navigate("R6");
  };

  const viewLastResult = () => {
    if (!lastResult) return;
    setMethod(lastResult.method);
    setResult({ circ: lastResult.circ, method: lastResult.method, ref: lastResult.ref, measuredAt: lastResult.savedAt });
    setResultFromHome(true);
    navigate("R6");
  };

  // ───── แสดงจอ ─────
  const kind: RefKind = shown === "R2Coin" ? "coin" : "card";
  const draftPpm = drafts[kind];
  // QA-1: G5 ต้องนับตั้งแต่รอบ render ที่เด้งมาจอเทียบ (staleBlocked) ไม่ใช่รอรอบหลัง effect ตั้ง g5 —
  // ไม่งั้น Calibrate mount ด้วย "ปรับแล้ว" จาก draft เดิม ปุ่มยืนยันกดได้ทันทีด้วย ppm ที่ยังไม่ตรวจซ้ำ
  const g5Active = (g5 || staleBlocked) && !!calib && calib.ref === kind;
  const calibInitialPpm =
    g5Active && calib
      ? startPpmFromDpr(calib, currentFingerprint().dpr)
      : draftPpm ?? CALIBRATION.PPM_START;

  let body: React.ReactNode;
  switch (shown) {
    case "R0":
      body = (
        <R0
          loaded={loaded}
          lastResultSize={lastResult ? (circToRec(lastResult.circ, lastResult.method)?.rec ?? null) : null}
          calibrated={!!calib && !stale}
          onStart={start}
          onViewLastResult={viewLastResult}
          onRedoCalibration={redoCalibration}
        />
      );
      break;
    case "R1Pick":
      body = <R1Pick step={counter} onBack={() => back("R1Pick")} onPick={pickRef} missingCalibration={missingCalib} />;
      break;
    case "R1":
      body = <R1 step={counter} onBack={() => back("R1")} onNext={() => navigate("R2")} onUseCoin={() => navigate("R2Coin")} />;
      break;
    case "R2":
    case "R2Coin":
      body = (
        <Calibrate
          key={shown}
          kind={kind}
          step={counter}
          initialPpm={calibInitialPpm}
          initiallyTouched={draftPpm !== null && !g5Active}
          g5={g5Active}
          onBack={() => back(shown)}
          onDraft={(ppm) => setDrafts((d) => ({ ...d, [kind]: ppm }))}
          onConfirm={(ppm) => confirmCalibration(kind, ppm)}
          onSwitchKind={() => switchKind(kind)}
        />
      );
      break;
    case "R3":
      body = <R3 step={counter} onBack={() => back("R3")} onPick={pickMethod} onRedo={redoCalibration} />;
      break;
    case "R4A":
      body = (
        <R4A
          step={counter}
          onBack={() => back("R4A")}
          onNext={() => navigate("R5A")}
          onSwitchB={() => {
            setMethod("B");
            navigate("R4B");
          }}
        />
      );
      break;
    case "R4B":
      body = (
        <R4B
          step={counter}
          onBack={() => back("R4B")}
          onNext={() => navigate("R5B")}
          onSwitchA={() => {
            setMethod("A");
            navigate("R4A");
          }}
        />
      );
      break;
    case "R5A":
      body = calib ? (
        <R5A
          key="R5A"
          step={counter}
          ppm={calib.pxPerMm}
          initialMm={measure.A}
          onBack={() => back("R5A")}
          onChange={(mm) => setMeasure((m) => ({ ...m, A: mm }))}
          onConfirm={(mm) => finishMeasure("A", diameterToCirc(mm), mm)}
          onHowTo={() => goBack("R4A")}
        />
      ) : null;
      break;
    case "R5B":
      body = calib ? (
        <R5B
          key="R5B"
          step={counter}
          ppm={calib.pxPerMm}
          initialMm={measure.B}
          onBack={() => back("R5B")}
          onChange={(mm) => setMeasure((m) => ({ ...m, B: mm }))}
          onConfirm={(mm) => finishMeasure("B", mm)}
          onUseRing={() => {
            setMethod("A");
            navigate("R4A");
          }}
        />
      ) : null;
      break;
    case "R6": {
      const size = result ? circToRec(result.circ, result.method) : null;
      body =
        result && size ? (
          <R6
            step={counter}
            size={size}
            method={result.method}
            refKind={result.ref}
            measuredAt={result.measuredAt}
            onBack={() => back("R6")}
            onRemeasure={() => navigate("R3")}
            onOtherMethod={() => {
              const other: Method = result.method === "A" ? "B" : "A";
              setMethod(other);
              navigate(other === "A" ? "R4A" : "R4B");
            }}
          />
        ) : null;
      break;
    }
    case "G4":
      body = invalid ? (
        <G4
          step={counter}
          circ={invalid.circ}
          diameterMm={invalid.diameterMm}
          method={invalid.method}
          onBack={() => back("G4")}
          onRemeasure={() => goBack(remeasureDestination(invalid.method))}
          onRecalibrate={redoCalibration}
        />
      ) : null;
      break;
  }

  return (
    <div ref={rootRef} tabIndex={-1} className="mx-auto flex min-h-full w-full max-w-[480px] flex-col outline-none">
      {body}
      {g3 ? <G3Sheet kind={g3.kind} onRetry={() => setG3(null)} onAccept={() => finishCalibration(g3.kind, g3.ppm)} /> : null}
    </div>
  );
}
