// scripts/lib/silver-sheet-parse.mjs
//
// Pure parsing/cross-check logic for the silver-price Google Sheet, split out
// of capture-silver-price-sheet.mjs so it can be unit-tested (no network, no
// env, no top-level side effects — safe to import from a test file).
//
// Moved verbatim from the CSV-fetch version (2026-09-02, feat/sheets-api-auth)
// when auth switched to the Sheets API v4 service-account flow. The Sheets
// API's `spreadsheets.values.get` (default FORMATTED_VALUE render option)
// already returns `values: string[][]` — the exact same shape the old CSV
// state-machine parser used to produce — so parseSheet()'s input contract is
// unchanged and none of its logic (anchor-based column mapping, the 6
// mandatory cross-checks) needed to change. The old `parseCsv()` function
// was deleted as dead code: there is no more CSV text to parse.
//
// 🔴 Do not change the anchor-based column mapping or drop any of the 6
// cross-checks below without re-reading the brief for feat/sheets-api-auth —
// they exist specifically to catch silently-wrong column mapping (e.g.
// grabbing the "Partner 5.80%" block whose values coincidentally look valid).

/** Strict cell -> number: strips thousands separators, requires the WHOLE
 * (trimmed) cell to be numeric — no free-form regex extraction from mixed
 * text (that's how the old scraper avoided grabbing the wrong number out of
 * a label cell). Returns null for empty/non-numeric/<=0 cells. */
export function cellToNumber(cell) {
  if (cell === undefined || cell === null) return null;
  const trimmed = String(cell).trim().replace(/,/g, "");
  if (trimmed === "" || trimmed === "#N/A") return null;
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** First row index (top to bottom) whose cells jointly contain every string
 * in `mustInclude` — anchor by text, never by hardcoded row index. */
export function findAnchorRow(rows, mustInclude) {
  for (let i = 0; i < rows.length; i++) {
    const joined = rows[i].join("|");
    if (mustInclude.every((s) => joined.includes(s))) return i;
  }
  return -1;
}

/** Column index of a cell that, trimmed, equals `label` exactly — used once
 * we already know which row is the header, to disambiguate near-duplicate
 * labels (e.g. "ซื้อคืน kg" vs "ราคาซื้อคืน" both contain "ซื้อคืน"). */
export function findColumnExact(row, label) {
  return row.findIndex((c) => (c ?? "").trim() === label);
}

const EN_MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

/** "31-Aug-2026" -> "2026-08-31". Sheet uses AD (Christian) year directly —
 * unlike the website scraper's Thai-language date, no Buddhist-year offset
 * here. Returns null (never guesses) if the format doesn't match. */
export function parseSheetDate(text) {
  const m = String(text ?? "").trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const monthIdx = EN_MONTHS.indexOf(m[2].toLowerCase());
  const year = Number(m[3]);
  if (monthIdx < 0 || !Number.isFinite(day) || !Number.isFinite(year)) return null;
  return `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ============================================================================
// Main parse: anchor-based extraction + mandatory cross-checks.
// Returns { data, problems, warnings } — data is only meaningful when
// problems.length === 0 (caller must abort on any problem, per brief).
// ============================================================================
export function parseSheet(rows) {
  const problems = [];
  const warnings = [];
  const data = {};

  // ---- Top summary block: USD/kg, USD/THB, THB/kg, ต่อบาท, ค่าบล๊อค kg ----
  const topHeaderIdx = findAnchorRow(rows, ["USD/THB", "ต่อบาท", "THB/kg"]);
  if (topHeaderIdx === -1 || !rows[topHeaderIdx + 1]) {
    problems.push("หา header แถวสรุปบนสุด (USD/THB · ต่อบาท · THB/kg) ไม่เจอ — โครงสร้างชีตอาจเปลี่ยน");
  } else {
    const headerRow = rows[topHeaderIdx];
    const valueRow = rows[topHeaderIdx + 1];
    const topFields = [
      ["Priece USD/kg", "usd_per_kg"],
      ["USD/THB", "usd_thb"],
      ["THB/kg", "thb_per_kg"],
      ["ต่อบาท", "silver_value_per_baht"],
      ["ค่าบล๊อค kg", "block_fee_kg"],
    ];
    for (const [label, key] of topFields) {
      const colIdx = findColumnExact(headerRow, label);
      if (colIdx === -1) {
        problems.push(`หาคอลัมน์หัวตาราง "${label}" ไม่เจอในแถวสรุปบนสุด`);
        continue;
      }
      const v = cellToNumber(valueRow[colIdx]);
      if (v === null) {
        problems.push(`ค่า "${label}" ในแถวสรุปบนสุดอ่านไม่ได้/ไม่เป็นตัวเลขบวก (แถว ${topHeaderIdx + 2}, คอลัมน์ ${colIdx + 1})`);
        continue;
      }
      data[key] = v;
    }
  }

  // ---- Per-size block: 0.5/1/3/5/10 บาท ----
  const sizeHeaderIdx = findAnchorRow(rows, ["ราคาเนื้อเงิน", "ราคาค่าบล๊อค", "ซื้อคืน"]);
  const sizeSuffixes = [
    ["0.5", "0_5"],
    ["1", "1"],
    ["3", "3"],
    ["5", "5"],
    ["10", "10"],
  ];
  const silverContentBySize = {}; // internal — used only for cross-checks below
  let asOfDateRaw = null;

  if (sizeHeaderIdx === -1) {
    problems.push('หา header แถวตารางราคาต่อขนาด ("ราคาเนื้อเงิน"/"ราคาค่าบล๊อค"/"ซื้อคืน") ไม่เจอ');
  } else {
    const headerRow = rows[sizeHeaderIdx];
    const colSilver = findColumnExact(headerRow, "ราคาเนื้อเงิน");
    const colBlockFee = findColumnExact(headerRow, "ราคาค่าบล๊อค");
    const colMargin = findColumnExact(headerRow, "11%");
    const colTotal = findColumnExact(headerRow, "Total");
    const colShopee = findColumnExact(headerRow, "Shopee");
    const colBuy = findColumnExact(headerRow, "ราคาซื้อคืน");
    const requiredCols = { colSilver, colBlockFee, colMargin, colTotal, colShopee, colBuy };
    const missingCols = Object.entries(requiredCols)
      .filter(([, v]) => v === -1)
      .map(([k]) => k);
    if (missingCols.length > 0) {
      problems.push(`หาคอลัมน์ในตารางราคาต่อขนาดไม่ครบ: ${missingCols.join(", ")}`);
    } else {
      // as-of date sits right before "ราคาเนื้อเงิน" in the same header row
      // (real layout observed: col0=blank/weight-label-elsewhere, col1=date,
      // col2="ราคาเนื้อเงิน"). Best-effort only — used solely for the legacy
      // silver_price_daily upsert, never for silver_price_history.
      if (colSilver > 0) asOfDateRaw = headerRow[colSilver - 1];

      for (let i = 0; i < sizeSuffixes.length; i++) {
        const [label, suffix] = sizeSuffixes[i];
        const rowIdx = sizeHeaderIdx + 1 + i;
        const row = rows[rowIdx];
        const rowLabel = row?.[0]?.trim();
        if (!row || rowLabel !== label) {
          problems.push(
            `แถวขนาด ${label} บาท ไม่ตรงตามที่คาด (แถว ${rowIdx + 1} มี label="${rowLabel ?? "(ไม่มีแถว)"}") — mapping อาจเลื่อน`
          );
          continue;
        }
        const silverVal = cellToNumber(row[colSilver]);
        const blockFee = cellToNumber(row[colBlockFee]);
        const marginComp = cellToNumber(row[colMargin]);
        const sell = cellToNumber(row[colTotal]);
        const shopeeVal = cellToNumber(row[colShopee]);
        const buy = cellToNumber(row[colBuy]);

        if (silverVal === null || sell === null || buy === null) {
          problems.push(`ขนาด ${label} บาท: อ่านค่าหลัก (ราคาเนื้อเงิน/Total/ราคาซื้อคืน) ไม่ได้ครบ`);
          continue;
        }
        silverContentBySize[suffix] = { weight: Number(label), value: silverVal };
        data[`sell_${suffix}`] = sell;
        data[`buy_${suffix}`] = buy;
        data[`block_fee_${suffix}`] = blockFee;
        data[`margin_component_${suffix}`] = marginComp;
        data[`shopee_${suffix}`] = shopeeVal;
      }
    }
  }

  // ---- กิโลกรัม: ขายออก / ขายออก Vat / ซื้อเข้า ----
  const kiloSpecs = [
    { re: /ขายออก(?!.*Vat).*กิโล/i, key: "kilo_sell", label: "ขายออก 1 กิโล" },
    { re: /ขายออก.*Vat.*กิโล/i, key: "kilo_sell_vat", label: "ขายออก Vat 1 กิโล" },
    { re: /ซื้อเข้า.*กิโล/i, key: "kilo_buy", label: "ซื้อเข้า 1 กิโล" },
  ];
  for (const spec of kiloSpecs) {
    const rowIdx = rows.findIndex((r) => r.some((cell) => spec.re.test(cell ?? "")));
    if (rowIdx === -1) {
      problems.push(`หาแถว "${spec.label}" ไม่เจอ`);
      continue;
    }
    const row = rows[rowIdx];
    const labelIdx = row.findIndex((cell) => spec.re.test(cell ?? ""));
    let v = null;
    for (let c = labelIdx + 1; c < row.length; c++) {
      v = cellToNumber(row[c]);
      if (v !== null) break;
    }
    if (v === null) {
      problems.push(`แถว "${spec.label}" (แถว ${rowIdx + 1}) หาค่าตัวเลขไม่เจอ`);
      continue;
    }
    data[spec.key] = v;
  }

  // ---- sheet_time: best-effort, legacy-table field only, never blocks ----
  let sheetTime = null;
  outer: for (const r of rows) {
    for (const cell of r) {
      if (/^\d{1,2}:\d{2}$/.test((cell ?? "").trim())) {
        sheetTime = cell.trim();
        break outer;
      }
    }
  }

  const asOfDate = parseSheetDate(asOfDateRaw);
  if (asOfDateRaw && !asOfDate) {
    warnings.push(`แปลงวันที่ "${asOfDateRaw}" ไม่ได้ — จะข้าม upsert ตาราง silver_price_daily เดิม (silver_price_history ยังบันทึกได้ปกติ)`);
  }

  // ============================================================================
  // Mandatory cross-checks (per brief) — ANY failure aborts the whole run,
  // no partial/suspect insert.
  // ============================================================================
  if (problems.length === 0) {
    // 1) doubling: เนื้อเงิน 0.5 บาท × 2 = เนื้อเงิน 1 บาท
    const c05 = silverContentBySize["0_5"];
    const c1 = silverContentBySize["1"];
    if (c05 && c1) {
      const expected = c05.value * 2;
      if (Math.abs(expected - c1.value) / c1.value > 0.01) {
        problems.push(`Cross-check ล้ม: เนื้อเงิน 0.5 บาท×2 (${expected}) ไม่ตรงกับเนื้อเงิน 1 บาท (${c1.value})`);
      }
    }

    // 2) buy-back เป็นเส้นตรงกับน้ำหนัก: buy_X ≈ silverContent_X - 30*weight
    for (const [suffix, entry] of Object.entries(silverContentBySize)) {
      const buy = data[`buy_${suffix}`];
      if (buy === undefined) continue;
      const expectedBuy = entry.value - 30 * entry.weight;
      const tolerance = Math.max(1, Math.abs(expectedBuy) * 0.02);
      if (Math.abs(buy - expectedBuy) > tolerance) {
        problems.push(
          `Cross-check ล้ม: ขนาด ${entry.weight} บาท ราคาซื้อคืน ${buy} ห่างจากที่คาด ${expectedBuy.toFixed(2)} (เนื้อเงิน - 30×น้ำหนัก) เกิน tolerance — น่าจะอ่านผิดคอลัมน์/แถว`
        );
      }
    }

    // 3) silver_value_per_baht (แถวสรุปบนสุด) ต้องตรงกับเนื้อเงินขนาด 1 บาท
    if (data.silver_value_per_baht !== undefined && c1) {
      if (Math.abs(data.silver_value_per_baht - c1.value) / c1.value > 0.01) {
        problems.push(
          `Cross-check ล้ม: silver_value_per_baht (${data.silver_value_per_baht}) ไม่ตรงกับเนื้อเงินขนาด 1 บาท (${c1.value})`
        );
      }
    }

    // 4) sell >= buy ทุกขนาด + กิโล (ซ้ำกับ DB constraint แต่เช็คก่อน insert ให้ error ชัดเจนกว่า)
    for (const [, suffix] of sizeSuffixes) {
      const sell = data[`sell_${suffix}`];
      const buy = data[`buy_${suffix}`];
      if (sell !== undefined && buy !== undefined && sell < buy) {
        problems.push(`Cross-check ล้ม: ขนาด ${suffix} บาท ขายออก (${sell}) ถูกกว่าซื้อเข้า (${buy}) — น่าจะอ่านสลับคอลัมน์`);
      }
    }
    if (data.kilo_sell !== undefined && data.kilo_buy !== undefined && data.kilo_sell < data.kilo_buy) {
      problems.push(`Cross-check ล้ม: กิโลขายออก (${data.kilo_sell}) ถูกกว่าซื้อเข้า (${data.kilo_buy})`);
    }

    // 5) กิโลขาย VAT ≈ กิโลขาย × 1.07
    if (data.kilo_sell !== undefined && data.kilo_sell_vat !== undefined) {
      const expectedVat = data.kilo_sell * 1.07;
      if (Math.abs(data.kilo_sell_vat - expectedVat) / expectedVat > 0.01) {
        problems.push(
          `Cross-check ล้ม: กิโลขาย VAT (${data.kilo_sell_vat}) ไม่ตรงกับกิโลขาย×1.07 (${expectedVat.toFixed(2)})`
        );
      }
    }

    // 6) ราคาขายต้องเรียงเพิ่มตามขนาด (0.5 < 1 < 3 < 5 < 10)
    const sellSeries = sizeSuffixes.map(([, suffix]) => data[`sell_${suffix}`]);
    for (let i = 1; i < sellSeries.length; i++) {
      if (sellSeries[i - 1] !== undefined && sellSeries[i] !== undefined && sellSeries[i] <= sellSeries[i - 1]) {
        problems.push(`Cross-check ล้ม: ราคาขายไม่เรียงเพิ่มตามขนาด (${sizeSuffixes[i - 1][0]} บาท=${sellSeries[i - 1]}, ${sizeSuffixes[i][0]} บาท=${sellSeries[i]})`);
      }
    }
  }

  return { data, problems, warnings, asOfDate, asOfDateRaw, sheetTime };
}
