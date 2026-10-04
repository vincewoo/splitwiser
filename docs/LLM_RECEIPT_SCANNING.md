# LLM-Based Receipt Scanning

## Status: Implemented

All steps complete. Branch: `julo/llm-receipt-scanning`

## Overview

Replaced the multi-phase OCR system (Google Cloud Vision + bounding box editing) with a single-pass LLM vision approach. The user uploads a receipt image or PDF, the backend sends it to a configurable LLM provider, and gets back structured item data. The user reviews items in a simple list, then confirms.

## Architecture

### Flow

```
User uploads image or PDF
    → Frontend sends file to POST /ocr/scan-receipt
    → Backend detects file type by magic bytes (%PDF- → PDF, else image)
    → PDFs are rasterized to one PNG per page with PyMuPDF (~144 DPI)
    → Backend saves the original upload, then delegates to the configured LLM provider (OpenAI or Gemini)
    → All page images are sent in a single LLM call (one PDF = one receipt)
    → LLM returns JSON: { items, tax_cents, tip_cents, total_cents }
    → Backend validates response, returns items
    → Frontend shows editable item list with tax/tip/total summary
    → User reviews/edits, confirms → items + tax + tip + total flow into expense form
    → Expense form shows validation warning if items+tax+tip ≠ receipt total
```

### Multi-Provider Support

Switchable via `LLM_PROVIDER` env var:

| Provider | Env Var | Model |
|----------|---------|-------|
| `openai` (default) | `OPENAI_API_KEY` | GPT-4o with structured outputs |
| `gemini` | `GEMINI_API_KEY` | Gemini 2.0 Flash with JSON schema |

```
backend/ocr/
  llm_service.py              # Shared prompt, schema, dispatch, validation
  providers/
    openai_provider.py         # OpenAI GPT-4o implementation
    gemini_provider.py         # Google Gemini implementation
```

Adding a new provider: create `providers/new_provider.py` with a `parse_receipt(pages: list[tuple[bytes, str]]) -> dict` function, add an `elif` in `llm_service.py`. `pages` is a list of `(image_bytes, mime_type)` tuples — one entry for an image upload, one per page for a PDF — and the provider must send them all in a single multi-image LLM call.

### LLM Contract (Structured Output Schema)

```json
{
  "items": [
    { "description": "Margherita Pizza", "price_cents": 1499, "quantity": 1 }
  ],
  "tax_cents": 120,
  "tip_cents": 0,
  "total_cents": 1619
}
```

System prompt rules:
- Extract only purchased items (not subtotals, totals, payment lines)
- Apply discounts to the item above them (report after-discount prices)
- Prices in cents as integers
- Items should sum to the receipt's post-discount subtotal
- Tax, tip, total extracted separately for validation

### Backend

**Endpoint: `POST /ocr/scan-receipt`** (rate-limited, auth required)
- Input: multipart upload of an image (JPEG/PNG/WebP) or a PDF, max 10 MB
- Detects the file type by magic bytes (`%PDF-` → PDF, otherwise image)
- Images: validates with PIL (format detected from content, not the filename)
- PDFs: rasterizes each page to a PNG with PyMuPDF (`import fitz`) at a target ~144 DPI (`PDF_RENDER_ZOOM=2.0`), with a per-page clamp so the longest rendered side never exceeds `MAX_RENDER_PX` (3000 px) to bound memory; the whole document is treated as a single receipt
- Saves the original upload (the `.pdf` or image) to `data/receipts/<uuid>.<ext>`, served via `/static/receipts`
- Calls the LLM provider with the full list of page images in one call
- Returns: `{ items, tax, tip, total, receipt_image_path }`

**Files:**
- `backend/ocr/llm_service.py` — Shared prompt, schema, provider dispatch, response validation; `parse_receipt(pages: list[tuple[bytes, str]]) -> dict`
- `backend/ocr/providers/openai_provider.py` — OpenAI GPT-4o with structured outputs (single multi-image message)
- `backend/ocr/providers/gemini_provider.py` — Gemini with JSON schema (uses `nullable: true` instead of union types; single multi-image message)
- `backend/routers/ocr.py` — Single endpoint, magic-byte detection, PDF rasterization, delegates to `llm_service.parse_receipt()`
- `backend/schemas.py` — `ReceiptScanItem`, `ReceiptScanResponse`

### Frontend

**ReceiptScanner** (`frontend/src/ReceiptScanner.tsx`):
- Two phases: upload → review
- Upload: file picker (accepts images and PDFs); images get an inline preview and are compressed before upload, PDFs show a file-name placeholder and are uploaded as-is
- Review: editable item list (tap to edit inline), inline tax and tip inputs (always visible, prefilled from the scan; clearing one means "not on the receipt", and negative input is clamped to zero), total, collapsible receipt image
- Passes items + tax + tip + total to `AddExpenseModal` via `onItemsDetected` callback

**AddExpenseModal** (`frontend/src/AddExpenseModal.tsx`):
- `handleScannedItems` receives items, tax, tip, and total from scanner
- Sets itemized items, tax amount, tip amount, and total directly from receipt
- Uses receipt's `total_cents` as expense amount (avoids rounding errors from recomputing)
- Shows validation warning if items + tax + tip ≠ receipt total

### Removed Files

- `backend/ocr/parser.py`, `parser_v2.py`, `regions.py`, `service.py` — Old Google Vision OCR
- `backend/tests/test_ocr*.py` — Old OCR tests
- `frontend/src/components/expense/BoundingBoxEditor.tsx`
- `frontend/src/components/expense/ItemPreviewEditor.tsx` (+ example, README)
- `frontend/src/components/expense/ImageEditToolbar.tsx`
- `frontend/src/components/expense/ImageQualityIndicator.tsx`
- `frontend/src/components/expense/PerspectiveCorrectionModal.tsx`
- `frontend/src/hooks/useBoundingBoxes.ts`
- `frontend/src/utils/imagePreprocessing.ts`

## Deployment

Receipt scanning requires an LLM API key. Set via Fly.io secrets:

```bash
# OpenAI (default provider):
fly secrets set OPENAI_API_KEY=sk-your-key-here

# Or Gemini:
fly secrets set GEMINI_API_KEY=your-key-here LLM_PROVIDER=gemini
```

No code changes needed — the backend reads these from environment variables at runtime. Without a key set, the `/ocr/scan-receipt` endpoint will return an error when called.

## Known Limitations

- LLM accuracy: tax amounts can be off by a few cents, complex discount layouts may not always be parsed perfectly
- The review step exists for the user to catch and correct these — validation warning on the expense form flags mismatches
- Each scan costs one LLM API call (~$0.01-0.05 depending on image/page count and provider)
- PDFs are capped at 10 pages (`MAX_PDF_PAGES`); larger PDFs are rejected with HTTP 400
- Uploads (images and PDFs) are capped at 10 MB (shared limit); larger files are rejected
- Password-protected / encrypted PDFs are not supported (rejected with HTTP 400); unreadable or zero-page PDFs are likewise rejected with HTTP 400

## Dependencies / Licensing

- PDF rasterization uses **PyMuPDF** (`pymupdf`, imported as `fitz`), added to `backend/requirements.txt`.
- PyMuPDF is licensed under **AGPL-3.0 or a commercial license**. This is a copyleft license — review the licensing terms before distributing or deploying Splitwiser in a context where AGPL obligations are a concern, and obtain a commercial license if needed.
