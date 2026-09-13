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

/**
 * M2 fix (12 ก.ย. 69, security perf): extracts text for exactly ONE page —
 * used by getLabelPageSnippet (lib/actions/labels.ts), which only ever needs
 * ±80 characters around one page's zipcode. extractPageTexts() above walks
 * EVERY page of the document (unpdf's extractText with mergePages:false
 * still processes the whole thing); for a 300-page file (MAX_LABEL_PAGES)
 * that's ~300x more work than needed for a single "help me read this one
 * page" click, and repeated clicks across a review queue compound it.
 *
 * `pdf` (the PDFDocumentProxy from getDocumentProxy/openPdf) is the real
 * pdfjs-dist object underneath unpdf's thin wrapper — unpdf doesn't hide
 * pdfjs's native API, it just bundles/configures it for serverless — so
 * `.getPage()` is safe to call directly here rather than going through
 * unpdf's own (whole-document-only) extractText() helper.
 *
 * Joins text items the same way pdfjs's own text-layer rendering does
 * (respecting `hasEOL` for line breaks) — not byte-for-byte identical to
 * whatever internal joining unpdf's extractText() does for the SAME page,
 * but close enough that this is safe for a human-facing "does this word
 * roughly match" snippet. It is NOT used for anything that decides
 * match_status/province — that still goes exclusively through
 * extractPageTexts() inside parseLabelFile, unchanged.
 */
export async function extractSinglePageText(pdf: PdfDocument, pageNo: number): Promise<string> {
  if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > pdf.numPages) {
    throw new PdfExtractError(`extractSinglePageText: page ${pageNo} out of range (1-${pdf.numPages})`);
  }
  const page = await pdf.getPage(pageNo);
  const content = await page.getTextContent();
  let text = "";
  for (const item of content.items) {
    if ("str" in item) {
      text += item.str;
      if (item.hasEOL) text += "\n";
    }
  }
  return text;
}
