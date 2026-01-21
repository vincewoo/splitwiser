# OCR Receipt Scanning (Two-Phase Interactive System)

Receipt scanning uses Google Cloud Vision API with an advanced two-phase interactive workflow.

## Architecture

```
backend/ocr/
├── service.py   # Google Cloud Vision client (singleton)
├── parser.py    # Receipt text parsing & item extraction (V1)
├── parser_v2.py # Enhanced spatial layout parser
└── regions.py   # Smart region detection and filtering (Two-Phase OCR)

backend/routers/
└── ocr.py       # OCR endpoints (region detection, extraction)

frontend/src/
├── ReceiptScanner.tsx                    # Main scanner component
├── components/expense/
│   ├── BoundingBoxEditor.tsx             # Interactive region editor
│   ├── ItemPreviewEditor.tsx             # Item review interface
│   └── ReceiptCanvas.tsx                 # Canvas rendering engine
├── hooks/
│   └── useBoundingBoxes.ts               # Bounding box state management
└── utils/
    └── imageCompression.ts               # Client-side compression
```

## Two-Phase OCR System

**Phase 1: Interactive Region Definition**
- Automatic detection of text regions using Vision API paragraph boundaries
- Interactive canvas for adjusting bounding boxes
- Drag to move, resize from corners, double-click to add new boxes
- Click to delete regions
- Pinch-to-zoom with proper centering (mobile touch support)
- Numbered labels for clear identification
- Visual feedback during interaction

**Phase 2: Item Review & Editing**
- Split-view interface showing receipt regions and extracted items
- Inline editing of descriptions and prices
- Tax/tip marking per item
- Bidirectional highlighting (click item → highlights box on receipt)
- Items sorted by Y-coordinate (top-to-bottom on receipt)
- Cropped region preview above each item
- Individual edit buttons (no global edit mode)

## Backend Implementation

**API Endpoints:**
- `POST /ocr/detect-regions` - Upload receipt, get detected text regions with bounding boxes
- `POST /ocr/extract-regions` - Extract text from specific regions (coordinates provided by user)

**Smart Region Detection ([backend/ocr/regions.py](../backend/ocr/regions.py)):**
- Uses Vision API paragraph boundaries for line-level detection (not individual words)
- Intelligent filtering removes headers, footers, noise
- Confidence scoring for extracted items
- Enhanced price matching (handles prices with/without dollar signs)
- Initial suggestions with smart defaults

**Response Caching:**
- In-memory caching of Vision API responses (5-minute TTL)
- Single OCR call per receipt minimizes API usage
- Cache key based on image hash
- Reduces costs and improves performance

**File Validation:**
- 10MB maximum file size
- JPEG, PNG, WebP formats supported
- Comprehensive error handling

## Frontend Features

**Client-Side Image Compression ([frontend/src/utils/imageCompression.ts](../frontend/src/utils/imageCompression.ts)):**
- Automatically compresses images before upload
- Maximum dimension: 1920px
- Target size: ~1MB
- Preserves image quality while reducing bandwidth

**Interactive Canvas Editor ([frontend/src/components/expense/BoundingBoxEditor.tsx](../frontend/src/components/expense/BoundingBoxEditor.tsx)):**
- Full touch support (mobile-friendly)
- Pinch-to-zoom with proper pivot point calculations
- Drag gestures for panning
- Mouse support for desktop
- Visual feedback for selected regions
- Coordinate system transformations (OCR ↔ display)

**Item Preview Editor ([frontend/src/components/expense/ItemPreviewEditor.tsx](../frontend/src/components/expense/ItemPreviewEditor.tsx)):**
- Per-item split methods (Equal, Exact, Percentage, Shares)
- Dynamic split detail inputs based on split type
- Visual region preview for each item
- Save/cancel/delete for individual items
- Validation for split totals

## Per-Item Split Methods

**Flexible Splitting:**
Each item in an itemized expense can have its own split method:
- **Equal** - Divide item equally among assignees (default)
- **Exact** - Specify exact dollar amounts per person
- **Percentage** - Split by percentages (must total 100%)
- **Shares** - Split by share ratio (e.g., 2:1)

**Example:**
```
Item: "2 Corona $10.00"
Assignees: Alice, Bob
Split Method: SHARES
Split Details: Alice=2, Bob=1
Result: Alice=$6.67, Bob=$3.33
```

**Backend Validation:**
- EXACT: Validates amounts match item price
- PERCENT: Ensures percentages add to 100%
- SHARES: Validates positive share values
- Comprehensive error messages

## Setup

1. Create Google Cloud project and enable Cloud Vision API
2. Create service account with "Cloud Vision API User" role
3. Download JSON credentials file
4. Set environment variable:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/credentials.json"
   ```

## Free Tier

- 1,000 pages/month free
- Requires GCP account with billing enabled (won't charge within free tier)
- Caching reduces API calls significantly

## Enhanced Receipt Scanner (OCR V2)

### Parser V2 ([backend/ocr/parser_v2.py](../backend/ocr/parser_v2.py))

**Improvements:**
- Spatial layout analysis using bounding boxes
- Better multi-line item handling
- Filters false matches (phone numbers, dates, metadata)
- More accurate price matching
- Reduced false positives

**Algorithm:**
1. Extract text with bounding box coordinates from Google Cloud Vision
2. Group text blocks by vertical position (line grouping)
3. Match item descriptions with prices on same line
4. Filter out common false matches:
   - Phone numbers (pattern: XXX-XXX-XXXX)
   - Dates (pattern: MM/DD/YYYY)
   - Total/subtotal lines
   - Receipt metadata
5. Return structured items with prices

**Testing:**
- `backend/ocr/test_parser_comparison.py` - Comparison between V1 and V2 parsers
- Test cases for complex receipts with multi-line items

### Offline Warning

Receipt scanning unavailable offline:
- Warning message displayed when offline
- Scanner disabled in offline mode
- Requires Google Cloud Vision API (network required)
