// lib/labels/pdf.ts — PDF -> per-page text extraction. Plain module (no
// "use server") — only lib/actions/labels.ts (server) calls this in
// practice, but it stays import-safe from a plain test file too (unpdf runs
// fine under Node/Vitest, no Next-specific runtime needed).
//
// design §0: text layer via unpdf + parser-per-format — no OCR/LLM-vision in
// this phase. A PDF with no text layer (scanned image) must fail loudly per
// page (design "ความเสี่ยงใหญ่สุด" #2), never silently return empty pages
// that look "successfully parsed."
import { getDocumentProxy, extractText } from "unpdf";

const PDF_MAGIC = "%PDF-";

/** Magic-byte check — design §"เคสห้ามผ่าน" #7: reject non-PDF files before
 * ever handing bytes to the PDF parser (a renamed .jpg must not reach unpdf). */
export function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PDF_MAGIC.length) return false;
  const head = Buffer.from(bytes.subarray(0, PDF_MAGIC.length)).toString("latin1");
  return head === PDF_MAGIC;
}

export class PdfExtractError extends Error {}

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

/**
 * Opens the PDF and returns the parsed document (mainly so the caller can
 * check `.numPages` against MAX_LABEL_PAGES BEFORE paying for full text
 * extraction — design §"เคสห้ามผ่าน" #7: ">300 หน้า → reject ก่อน parse").
 * Throws PdfExtractError if the file can't be opened as a PDF at all
 * (corrupt/encrypted/zero pages).
 */
export async function openPdf(bytes: Uint8Array): Promise<PdfDocument> {
  let pdf: PdfDocument;
  try {
    pdf = await getDocumentProxy(bytes);
  } catch (err) {
    throw new PdfExtractError(
      `openPdf: unable to open PDF (corrupt or encrypted) — ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!pdf.numPages || pdf.numPages <= 0) {
    throw new PdfExtractError("openPdf: PDF has zero pages");
  }
  return pdf;
}

/**
 * Extracts per-page text (mergePages: false — each array entry is exactly
 * one page, required so stg_label_page can store 1 row per physical label).
 * A single unreadable *page* inside an otherwise valid PDF is NOT an error
 * here; it just comes back as an empty string for that page, and the caller
 * (lib/actions/labels.ts) classifies that page as match_status='parse_failed'
 * rather than failing the whole file.
 */
export async function extractPageTexts(pdf: PdfDocument): Promise<string[]> {
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}
