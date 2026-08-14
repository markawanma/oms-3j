// lib/catalog/csv.ts — minimal RFC-4180-ish CSV parser for the product bulk
// import (docs/3j-jewelry/analytics/product-import-template.csv). Plain module
// (no "use server"/"use client") so it runs in the browser and is unit-testable.
// Handles: quoted fields with embedded commas/newlines, "" escaped quotes,
// CRLF or LF, a leading UTF-8 BOM, and blank lines. Unknown header columns are
// ignored; header matching is case-insensitive + trimmed.

import { PRODUCT_IMPORT_COLUMNS, type ProductImportRow } from "@/lib/catalog/types";

/** Tokenise CSV text into records of raw string fields. */
function parseRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let sawAny = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    sawAny = true;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\r") {
      // ignore; \n handles the line break
    } else if (ch === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += ch;
    }
  }

  // flush the final pending field/record (file not ending in newline)
  if (sawAny) {
    record.push(field);
    const isTrailingEmpty = record.length === 1 && record[0] === "";
    if (!isTrailingEmpty) records.push(record);
  }
  return records;
}

export interface ParsedCsv {
  rows: ProductImportRow[];
  /** raw header cells as they appeared (for showing the user what was read). */
  headers: string[];
  /** headers that were not recognised (ignored during import). */
  unknownHeaders: string[];
}

/** Parse product-import CSV text into row objects keyed by canonical column
 * name. Only known columns are kept; values are raw strings (the DB RPC does
 * the numeric/enum validation). */
export function parseProductCsv(text: string): ParsedCsv {
  // strip UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const records = parseRecords(text);
  if (records.length === 0) return { rows: [], headers: [], unknownHeaders: [] };

  const headers = records[0].map((h) => h.trim());
  const known = new Set<string>(PRODUCT_IMPORT_COLUMNS as readonly string[]);
  const headerKeys = headers.map((h) => h.toLowerCase());
  const unknownHeaders = headers.filter((h) => h !== "" && !known.has(h.toLowerCase()));

  const rows: ProductImportRow[] = [];
  for (let i = 1; i < records.length; i++) {
    const rec = records[i];
    if (rec.every((c) => c.trim() === "")) continue; // skip blank lines
    const obj: ProductImportRow = {};
    for (let c = 0; c < rec.length; c++) {
      const key = headerKeys[c];
      if (key && known.has(key)) obj[key] = rec[c];
    }
    rows.push(obj);
  }

  return { rows, headers, unknownHeaders };
}
