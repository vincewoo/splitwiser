# LLM-Based Receipt Scanning — Implementation Plan

## Overview

Replace the existing multi-phase OCR system (Google Cloud Vision + bounding box editing) with a single-pass LLM vision approach. The user uploads a receipt image, the backend sends it to an LLM (OpenAI GPT-4o), and gets back structured item data. The user then reviews the items in a simple list view before confirming.

## Why

The current system is complex: it requires Google Cloud Vision API, a bounding-box editor for the user to adjust detected regions, coordinate normalization, caching, and two separate API calls. An LLM with vision can do all of this in one shot — detect items, parse descriptions, extract prices, and identify tax/tip — with better accuracy and a much simpler UX.

## Architecture

### New Flow

```
User uploads image
    → Frontend sends image to POST /ocr/scan-receipt
    → Backend encodes image as base64, sends to OpenAI GPT-4o with structured output schema
    → LLM returns JSON: { items: [...], subtotal?, tax?, tip?, total? }
    → Backend validates response against schema, saves receipt image, returns items
    → Frontend shows item list preview alongside receipt image thumbnail
    → User reviews/edits items, then confirms → items flow into expense creation (unchanged)
```

### LLM Contract (Structured Output Schema)

OpenAI's structured outputs (response_format with json_schema) will enforce the contract:

```json
{
  "items": [
    {
      "description": "Margherita Pizza",
      "price_cents": 1499,
      "quantity": 1
    }
  ],
  "tax_cents": 120,
  "tip_cents": 0,
  "total_cents": 1619
}
```

Rules enforced via the system prompt:
- `price_cents`: integer, price in cents for the line total (qty × unit price)
- `quantity`: integer, >= 1
- `description`: the item name as shown on the receipt
- Tax/tip/total are optional metadata for validation
- Items must NOT include tax, tip, subtotal, total, discounts, or payment lines

### Backend Changes

**New/Modified files:**
- `backend/ocr/llm_service.py` — New. OpenAI API client for receipt parsing.
- `backend/routers/ocr.py` — Rewrite `POST /ocr/scan-receipt` to use LLM. Remove `detect-regions` and `extract-regions` endpoints.
- `backend/schemas.py` — Add new response schema for LLM scan results.
- `backend/requirements.txt` — Add `openai` package.

**Removed files (no longer needed):**
- `backend/ocr/parser.py` — V1 text parser
- `backend/ocr/parser_v2.py` — V2 spatial parser
- `backend/ocr/regions.py` — Region detection
- `backend/ocr/service.py` — Google Cloud Vision client

**Endpoint: `POST /ocr/scan-receipt`**
- Input: multipart file upload (unchanged)
- Processing: validate image → save to disk → base64 encode → call OpenAI → validate response
- Output:
  ```json
  {
    "items": [
      { "description": "Margherita Pizza", "price": 1499, "quantity": 1 }
    ],
    "tax": 120,
    "tip": 0,
    "total": 1619,
    "receipt_image_path": "/static/receipts/uuid.jpg"
  }
  ```
- Items use `price` in cents (matching existing convention)

**Environment variable:** `OPENAI_API_KEY`

### Frontend Changes

**Simplified ReceiptScanner component:**
- Remove phases: no more `define-regions` or `review-items` with bounding boxes
- Two states: `upload` and `review`
- Upload: file picker + image preview (keep existing upload UX)
- Review: side-by-side layout — receipt image on one side, item list on the other
- Item list shows description, quantity, price for each item, plus tax/tip/total summary
- User can edit description and price inline
- User can delete items or add manual items
- Confirm button sends items back via `onItemsDetected` (unchanged callback signature)

**Files to remove/simplify:**
- `frontend/src/components/expense/BoundingBoxEditor.tsx` — Remove
- `frontend/src/components/expense/ItemPreviewEditor.tsx` — Remove
- `frontend/src/hooks/useBoundingBoxes.ts` — Remove
- `frontend/src/components/expense/ImageEditToolbar.tsx` — Remove (image preprocessing no longer needed; LLM handles messy images)
- `frontend/src/components/expense/ImageQualityIndicator.tsx` — Remove
- `frontend/src/components/expense/PerspectiveCorrectionModal.tsx` — Remove
- `frontend/src/utils/imagePreprocessing.ts` — Remove

**Files unchanged:**
- `frontend/src/AddExpenseModal.tsx` — No changes needed; it already receives `{ description, price }[]`
- `frontend/src/hooks/useItemizedExpense.ts` — No changes needed

## Implementation Steps

1. **Backend: Create LLM service** (`backend/ocr/llm_service.py`)
   - OpenAI client initialization with API key from env
   - `parse_receipt(image_bytes: bytes) -> dict` function
   - System prompt with strict rules
   - Structured output schema enforcement
   - Error handling and retries

2. **Backend: Update schemas** (`backend/schemas.py`)
   - Add `ReceiptScanItem` and `ReceiptScanResponse` models
   - Remove old OCR schemas (RegionBoundingBox, ExtractRegionsRequest, ExtractedItem)

3. **Backend: Rewrite OCR router** (`backend/routers/ocr.py`)
   - Rewrite `scan-receipt` endpoint to use LLM service
   - Remove `detect-regions` and `extract-regions` endpoints
   - Remove OCRCache class
   - Keep file validation and image saving logic

4. **Backend: Update requirements** — Add `openai`

5. **Frontend: Rewrite ReceiptScanner** — Simple upload → review flow

6. **Frontend: Clean up** — Remove bounding box / image preprocessing components

7. **Update CLAUDE.md** — Document new architecture
