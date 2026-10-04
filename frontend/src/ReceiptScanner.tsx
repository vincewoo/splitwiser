import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    ArrowRight,
    CameraRotate,
    CheckCircle,
    ClipboardText,
    FilePdf,
    ImageSquare,
    Sparkle,
    Trash,
    WarningCircle,
    X,
} from '@phosphor-icons/react';
import { getApiUrl } from './api';
import { useSync } from './contexts/SyncContext';
import { compressImage } from './utils/imageCompression';
import { Button } from './components/ui';
import { useStagedReveal } from './hooks/useStagedReveal';
import {
    reconcileReceipt,
    reconciliationWarning,
} from './utils/receiptReconciliation';

// Synthesize a filename for a clipboard blob that usually has none.
// e.g. image/png -> pasted-receipt.png (defaults to png).
function filenameForBlob(type: string): string {
    const ext = type.startsWith('image/') ? type.slice('image/'.length) : '';
    return `pasted-receipt.${ext || 'png'}`;
}

// Extract the first usable image (or PDF) File from a paste event's clipboard data.
function imageFileFromClipboardEvent(e: ClipboardEvent): File | null {
    const data = e.clipboardData;
    if (!data) return null;

    const items = data.items;
    if (items) {
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) {
                    return file.name
                        ? file
                        : new File([file], filenameForBlob(item.type), { type: item.type });
                }
            }
        }
    }

    // Fall back to a file copied from the OS file manager (may be a PDF).
    const fallback = data.files && data.files[0];
    if (fallback && (fallback.type.startsWith('image/') || fallback.type === 'application/pdf')) {
        return fallback;
    }

    return null;
}

// Extract the first image File from an async clipboard read (navigator.clipboard.read()).
async function imageFileFromAsyncClipboard(items: ClipboardItems): Promise<File | null> {
    for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (type) {
            const blob = await item.getType(type);
            return new File([blob], filenameForBlob(type), { type });
        }
    }
    return null;
}

interface ReceiptScannerProps {
    onItemsDetected: (items: { description: string; price: number }[], receiptPath?: string, validationWarning?: string | null, taxCents?: number | null, tipCents?: number | null, totalCents?: number | null) => void;
    onClose: () => void;
}

interface ScannedItem {
    description: string;
    price: number;       // cents
    quantity: number;
}

interface ScanResult {
    items: ScannedItem[];
    tax: number | null;   // cents
    tip: number | null;   // cents
    total: number | null;  // cents
    receipt_image_path: string;
}

/**
 * 'capture' picks the image, 'reading' covers the scan call and the staged
 * reveal of what came back, 'review' reconciles it against the printed total.
 */
type Phase = 'capture' | 'reading' | 'review';

const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const ReceiptScanner: React.FC<ReceiptScannerProps> = ({ onItemsDetected, onClose }) => {
    const { isOnline } = useSync();
    const [phase, setPhase] = useState<Phase>('capture');
    const [image, setImage] = useState<File | null>(null);
    const [imageUrl, setImageUrl] = useState<string>('');
    const [isPdf, setIsPdf] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>('');

    // Scan results
    const [items, setItems] = useState<ScannedItem[]>([]);
    const [tax, setTax] = useState<number | null>(null);
    const [tip, setTip] = useState<number | null>(null);
    const [total, setTotal] = useState<number | null>(null);
    const [receiptImagePath, setReceiptImagePath] = useState<string>('');

    // What the tax and tip inputs show. Kept as strings so a half-typed value
    // ("3." mid-edit) survives; `tax`/`tip` above stay the parsed cents that
    // reconciliation and the confirm payload read.
    const [taxInput, setTaxInput] = useState('');
    const [tipInput, setTipInput] = useState('');

    /**
     * What came back from the scan, held separately from `items` so the reveal
     * animates the response before the editable list takes over.
     */
    const [incoming, setIncoming] = useState<ScannedItem[] | null>(null);
    const { revealed, revealing } = useStagedReveal(incoming);

    // Editing state
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editDescription, setEditDescription] = useState('');
    const [editPrice, setEditPrice] = useState('');

    const fileInputRef = useRef<HTMLInputElement>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);
    // Tracks the current preview object URL for revocation without making loadFile
    // depend on imageUrl (which would re-subscribe the paste listener every render).
    const objectUrlRef = useRef<string>('');
    // Guards async continuations that can resolve after the modal unmounts
    // (the component is conditionally rendered).
    const mountedRef = useRef(true);
    // Mirrors `loading` so the captured paste closure can re-check it per event.
    const loadingRef = useRef(false);
    // Prevents overlapping clipboard.read() calls from a double-clicked button.
    const pastingRef = useRef(false);

    // Revoke and clear the current preview object URL. Centralized so every
    // genuine teardown site frees the blob (and Re-scan can deliberately skip it).
    const revokePreviewUrl = useCallback(() => {
        if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current);
            objectUrlRef.current = '';
        }
    }, []);

    // Shared "adopt this file" path for the picker, the camera and paste.
    const loadFile = useCallback((file: File) => {
        setImage(file);
        setError('');
        const pdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        setIsPdf(pdf);
        revokePreviewUrl();
        // A blob URL can't be rendered in an <img>, so only create one for images.
        const url = pdf ? '' : URL.createObjectURL(file);
        objectUrlRef.current = url;
        setImageUrl(url);
    }, [revokePreviewUrl]);

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            loadFile(e.target.files[0]);
        }
        // Allow re-picking the same file after a retake.
        e.target.value = '';
    };

    // Revoke the last preview object URL on unmount so closing the modal mid-flow
    // doesn't leak it, and flag the component as unmounted so async continuations
    // (clipboard.read) bail out instead of touching state.
    useEffect(() => () => {
        mountedRef.current = false;
        revokePreviewUrl();
    }, [revokePreviewUrl]);

    // Keyboard paste (Cmd/Ctrl+V): active only while capturing and idle, so
    // pasting while editing an item in review is never hijacked.
    useEffect(() => {
        if (phase !== 'capture' || loading) return;
        const onPaste = (e: ClipboardEvent) => {
            // A scan may have started between setLoading(true) and this effect
            // re-subscribing; don't let a stray paste swap the image mid-upload.
            if (loadingRef.current) return;
            const file = imageFileFromClipboardEvent(e);
            // No image on the clipboard -> let normal paste proceed.
            if (file) loadFile(file);
        };
        document.addEventListener('paste', onPaste);
        return () => document.removeEventListener('paste', onPaste);
    }, [phase, loading, loadFile]);

    // Hand over to review once the response has landed and finished revealing.
    useEffect(() => {
        if (phase !== 'reading' || loading || !incoming || revealing) return;
        setItems(incoming);
        setIncoming(null);
        setPhase('review');
    }, [phase, loading, incoming, revealing]);

    const handlePasteFromClipboard = async () => {
        if (!navigator.clipboard?.read) {
            setError("Pasting from the clipboard isn't supported in this browser.");
            return;
        }
        // Ignore a second click while the first read() is still in flight.
        if (pastingRef.current) return;
        pastingRef.current = true;
        try {
            const clipboardItems = await navigator.clipboard.read();
            // The modal may have closed while awaiting the (permissioned) read.
            if (!mountedRef.current) return;
            const file = await imageFileFromAsyncClipboard(clipboardItems);
            if (!mountedRef.current) return;
            if (!file) {
                setError('No image found on the clipboard.');
                return;
            }
            loadFile(file);
        } catch {
            if (!mountedRef.current) return;
            setError('Could not read the clipboard. Check clipboard permissions and try again.');
        } finally {
            pastingRef.current = false;
        }
    };

    const handleScan = async () => {
        if (!image) return;

        setLoading(true);
        loadingRef.current = true;
        setError('');
        setIncoming(null);
        setPhase('reading');

        try {
            // PDFs are sent as-is; compressImage only handles raster images.
            const uploadFile = isPdf ? image : await compressImage(image, 1920, 1);

            const formData = new FormData();
            formData.append('file', uploadFile);

            const token = localStorage.getItem('token');
            const response = await fetch(getApiUrl('ocr/scan-receipt'), {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData,
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.detail || 'Receipt scanning failed');
            }

            const data: ScanResult = await response.json();

            if (!data.items || data.items.length === 0) {
                throw new Error('No items detected on the receipt. Please try a clearer photo.');
            }

            setTax(data.tax);
            setTip(data.tip);
            setTaxInput(data.tax != null ? (data.tax / 100).toFixed(2) : '');
            setTipInput(data.tip != null ? (data.tip / 100).toFixed(2) : '');
            setTotal(data.total);
            setReceiptImagePath(data.receipt_image_path);
            // Reveal the response rather than dropping it in all at once.
            setIncoming(data.items);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to scan receipt');
            setPhase('capture');
        } finally {
            setLoading(false);
            loadingRef.current = false;
        }
    };

    const reconciliation = reconcileReceipt(items, tax, tip, total);

    const handleConfirm = () => {
        const finalItems = items.map(item => ({
            description: item.description,
            price: item.price,
        }));

        onItemsDetected(
            finalItems,
            receiptImagePath,
            reconciliationWarning(reconciliation, formatCents),
            tax,
            tip,
            total
        );
    };

    const handleCancel = () => {
        revokePreviewUrl();
        onClose();
    };

    // Retake returns to capture while keeping the selected image and its live
    // preview, so it must NOT revoke the object URL.
    const handleRetake = () => {
        setPhase('capture');
        setItems([]);
        setIncoming(null);
        setError('');
    };

    // Inline editing
    const startEditing = (index: number) => {
        setEditingIndex(index);
        setEditDescription(items[index].description);
        setEditPrice((items[index].price / 100).toFixed(2));
    };

    const saveEdit = () => {
        if (editingIndex === null) return;
        const priceCents = Math.round(parseFloat(editPrice || '0') * 100);
        setItems(prev => prev.map((item, i) =>
            i === editingIndex
                ? { ...item, description: editDescription || item.description, price: priceCents }
                : item
        ));
        setEditingIndex(null);
    };

    const cancelEdit = () => setEditingIndex(null);

    // '' means not on the receipt (null), anything else is whole cents.
    // Clamped at zero: min="0" stops the spinner but not a typed minus, and a
    // negative here would flow into reconciliation and the expense payload.
    const centsFromInput = (value: string): number | null => {
        if (value.trim() === '') return null;
        const parsed = parseFloat(value);
        return Number.isNaN(parsed) ? null : Math.max(0, Math.round(parsed * 100));
    };

    const handleTaxChange = (value: string) => {
        setTaxInput(value);
        setTax(centsFromInput(value));
    };

    const handleTipChange = (value: string) => {
        setTipInput(value);
        setTip(centsFromInput(value));
    };

    const deleteItem = (index: number) => {
        setItems(prev => prev.filter((_, i) => i !== index));
        if (editingIndex === index) setEditingIndex(null);
    };

    /** One-tap fix for a shortfall: book the difference as its own line. */
    const addDifferenceAsItem = () => {
        if (reconciliation.delta === null || reconciliation.delta <= 0) return;
        setItems(prev => [
            ...prev,
            {
                description: 'Unread line from receipt',
                price: reconciliation.delta as number,
                quantity: 1,
            },
        ]);
    };

    const revealedTotal = revealed.reduce((sum, item) => sum + item.price, 0);

    return (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-end sm:items-center justify-center font-sans">
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Scan a receipt"
                className="bg-sw-bg text-sw-text w-full sm:max-w-lg h-[92vh] sm:h-auto sm:max-h-[90vh] rounded-t-sw-sheet sm:rounded-sw-card-lg shadow-[0_-12px_40px_rgba(0,0,0,.45)] sm:shadow-[0_0_0_1px_var(--sw-line)] flex flex-col overflow-hidden"
            >

                {/* ---------------------------------------------------- capture */}
                {phase === 'capture' && (
                    <>
                        <div className="flex items-center gap-3 px-[18px] py-3.5 flex-none">
                            <button
                                type="button"
                                onClick={handleCancel}
                                aria-label="Close"
                                className="text-sw-muted hover:text-sw-text"
                            >
                                <X size={22} />
                            </button>
                            <div className="text-base font-medium">Scan a receipt</div>
                        </div>

                        <div className="flex-1 min-h-0 mx-3.5 rounded-[18px] overflow-hidden bg-sw-sunk flex items-center justify-center relative">
                            {imageUrl ? (
                                <img
                                    src={imageUrl}
                                    alt="Receipt preview"
                                    className="max-w-full max-h-full object-contain"
                                />
                            ) : isPdf && image ? (
                                <div className="flex flex-col items-center gap-2 text-sw-muted px-6 text-center">
                                    <FilePdf size={40} />
                                    <span className="text-sm break-all">{image.name}</span>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center gap-3 text-sw-dim px-8 text-center">
                                    <ImageSquare size={38} />
                                    <p className="text-[13px] text-sw-muted">
                                        Photograph the receipt, choose an image or PDF, or paste
                                        one from your clipboard.
                                    </p>
                                </div>
                            )}

                            {/* Framing guides, drawn over whatever is behind them. */}
                            {!image && (
                                <>
                                    <span className="absolute top-8 left-12 w-[22px] h-[22px] border-t-[3px] border-l-[3px] border-sw-accent rounded-tl-[5px]" />
                                    <span className="absolute top-8 right-12 w-[22px] h-[22px] border-t-[3px] border-r-[3px] border-sw-accent rounded-tr-[5px]" />
                                    <span className="absolute bottom-8 left-12 w-[22px] h-[22px] border-b-[3px] border-l-[3px] border-sw-accent rounded-bl-[5px]" />
                                    <span className="absolute bottom-8 right-12 w-[22px] h-[22px] border-b-[3px] border-r-[3px] border-sw-accent rounded-br-[5px]" />
                                </>
                            )}

                            {image && (
                                <div className="absolute top-3.5 left-0 right-0 flex justify-center">
                                    <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/70 text-white text-[12.5px]">
                                        <CheckCircle size={15} weight="fill" className="text-sw-pos" />
                                        Ready to read
                                    </span>
                                </div>
                            )}
                        </div>

                        <div className="px-[18px] pt-3.5 pb-2 flex-none">
                            {error && <p className="text-[12.5px] text-sw-neg mb-2">{error}</p>}
                            {!isOnline && (
                                <p className="text-[12.5px] text-sw-neg mb-2">
                                    Scanning needs an internet connection.
                                </p>
                            )}
                            {image && (
                                // Names the adopted file — the only confirmation a PDF
                                // gets, since it has no preview to show.
                                <p className="text-xs text-sw-muted mb-1 break-all">
                                    Selected: {image.name}
                                </p>
                            )}
                            <p className="text-xs text-sw-dim">
                                Long receipt? Photograph it in parts and add the lines from each.
                            </p>
                        </div>

                        {/* Library / shutter / paste — the three capture routes as peers. */}
                        <div className="px-7 pb-3.5 flex items-center justify-between flex-none">
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*,application/pdf"
                                onChange={handleImageChange}
                                className="sr-only"
                            />
                            <input
                                ref={cameraInputRef}
                                type="file"
                                accept="image/*"
                                capture="environment"
                                onChange={handleImageChange}
                                className="sr-only"
                            />

                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                aria-label="Choose an image or PDF from your library"
                                className="flex flex-col items-center gap-1 w-[58px] text-sw-muted hover:text-sw-text"
                            >
                                <ImageSquare size={25} />
                                <span className="text-[10.5px]">Library</span>
                            </button>

                            <button
                                type="button"
                                onClick={() =>
                                    image ? handleScan() : cameraInputRef.current?.click()
                                }
                                disabled={loading || (!!image && !isOnline)}
                                aria-label={image ? 'Read this receipt' : 'Take a photo'}
                                className="w-[70px] h-[70px] rounded-full shadow-[0_0_0_3px_var(--sw-accent)] flex items-center justify-center disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                            >
                                <span className="w-14 h-14 rounded-full bg-sw-accent flex items-center justify-center text-sw-on-accent text-[13px] font-medium">
                                    {image ? 'Read' : ''}
                                </span>
                            </button>

                            <button
                                type="button"
                                onClick={handlePasteFromClipboard}
                                disabled={loading}
                                aria-label="Paste from clipboard"
                                className="flex flex-col items-center gap-1 w-[58px] text-sw-muted hover:text-sw-text disabled:opacity-45"
                            >
                                <ClipboardText size={25} />
                                <span className="text-[10.5px]">Paste</span>
                            </button>
                        </div>
                    </>
                )}

                {/* ---------------------------------------------------- reading */}
                {phase === 'reading' && (
                    <>
                        <div className="flex items-center gap-3 px-[18px] py-4 flex-none">
                            <div className="text-[17px] font-medium">Reading your receipt</div>
                            <Button
                                variant="secondary"
                                onClick={handleRetake}
                                className="ml-auto min-h-[34px] text-sw-muted"
                            >
                                Cancel
                            </Button>
                        </div>

                        <div className="px-4 flex gap-3.5 items-start flex-1 min-h-0 overflow-auto">
                            <div className="relative w-[104px] flex-none rounded-lg overflow-hidden bg-sw-sunk">
                                {imageUrl ? (
                                    <img src={imageUrl} alt="" className="w-full object-cover" />
                                ) : (
                                    <div className="h-32 flex items-center justify-center text-sw-dim">
                                        <FilePdf size={26} />
                                    </div>
                                )}
                                {/* Scanning line, purely decorative. */}
                                <span
                                    className="absolute left-0 right-0 h-0.5 bg-sw-accent shadow-[0_0_14px_3px_rgba(145,132,217,.7)] animate-pulse"
                                    style={{ top: '45%' }}
                                    aria-hidden="true"
                                />
                            </div>

                            <div className="flex-1 min-w-0" aria-live="polite">
                                <div className="text-[12.5px] text-sw-muted mb-0.5">
                                    Found so far
                                </div>
                                <div className="sw-num text-[27px] font-medium mb-3">
                                    {revealed.length}{' '}
                                    {revealed.length === 1 ? 'item' : 'items'} ·{' '}
                                    {formatCents(revealedTotal)}
                                </div>

                                <div className="flex flex-col gap-[7px]">
                                    {revealed.map((item, index) => (
                                        <div
                                            key={index}
                                            className="flex items-center gap-2 text-[13px]"
                                        >
                                            <CheckCircle
                                                size={15}
                                                weight="fill"
                                                className="text-sw-pos flex-none"
                                            />
                                            <span className="truncate">{item.description}</span>
                                            <span className="sw-num ml-auto text-sw-muted flex-none">
                                                {formatCents(item.price)}
                                            </span>
                                        </div>
                                    ))}

                                    {(loading || revealing) && (
                                        <>
                                            <div className="flex items-center gap-[9px] pt-0.5">
                                                <span className="w-[15px] h-[15px] rounded-full border-2 border-sw-line border-t-sw-accent animate-spin" />
                                                <span className="h-[9px] flex-1 rounded bg-sw-surface" />
                                            </div>
                                            <div className="flex items-center gap-[9px]">
                                                <span className="w-[15px] h-[15px]" />
                                                <span className="h-[9px] w-[72%] rounded bg-sw-surface opacity-60" />
                                            </div>
                                            <div className="flex items-center gap-[9px]">
                                                <span className="w-[15px] h-[15px]" />
                                                <span className="h-[9px] w-[54%] rounded bg-sw-surface opacity-35" />
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="m-4 p-4 rounded-[14px] bg-sw-surface shadow-[0_0_0_1px_var(--sw-line)] flex-none">
                            <div className="flex items-center gap-2 mb-1">
                                <Sparkle size={16} className="text-sw-accent" />
                                <div className="text-[13.5px] font-medium">
                                    Usually about four seconds
                                </div>
                            </div>
                            <div className="text-[12.5px] text-sw-muted">
                                We read the whole receipt in one pass, then check the lines
                                against the printed total.
                            </div>
                        </div>
                    </>
                )}

                {/* ----------------------------------------------------- review */}
                {phase === 'review' && (
                    <>
                        <div className="flex items-center gap-3 px-[18px] py-3.5 flex-none">
                            <div className="text-[17px] font-medium">Does this look right?</div>
                            <Button
                                variant="ghost"
                                onClick={handleRetake}
                                icon={<CameraRotate size={15} />}
                                className="ml-auto text-[13px]"
                            >
                                Retake
                            </Button>
                        </div>

                        {/* Live reconciliation, stated before confirming rather than after. */}
                        {reconciliation.status !== 'balanced' &&
                            reconciliation.status !== 'unknown' &&
                            reconciliation.delta !== null && (
                                <div className="px-4 pb-3 flex-none">
                                    <div className="bg-sw-surface rounded-[14px] px-3.5 py-3 shadow-[0_0_0_1px_var(--sw-neg)]">
                                        <div className="flex items-center gap-2 mb-1">
                                            <WarningCircle
                                                size={17}
                                                weight="fill"
                                                className="text-sw-neg flex-none"
                                            />
                                            <div className="text-[13.5px] font-medium">
                                                We're {formatCents(Math.abs(reconciliation.delta))}{' '}
                                                {reconciliation.status === 'under' ? 'under' : 'over'}{' '}
                                                the receipt total
                                            </div>
                                        </div>
                                        <div className="text-[12.5px] text-sw-muted mb-2.5">
                                            Items, tax and tip come to{' '}
                                            {formatCents(reconciliation.computed)}, but the receipt
                                            says {formatCents(total ?? 0)}.{' '}
                                            {reconciliation.status === 'under'
                                                ? 'Probably a line we misread.'
                                                : 'Probably a line counted twice.'}
                                        </div>
                                        {reconciliation.status === 'under' && (
                                            <Button
                                                variant="primary"
                                                onClick={addDifferenceAsItem}
                                                className="min-h-[38px] text-[12.5px]"
                                            >
                                                Add {formatCents(reconciliation.delta)} as an item
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            )}

                        <div className="flex-1 min-h-0 overflow-auto px-4">
                            <div className="flex items-center gap-2 pt-0.5 pb-2">
                                <div className="text-[11px] uppercase tracking-[0.09em] text-sw-dim">
                                    {items.length} {items.length === 1 ? 'item' : 'items'}
                                </div>
                                <div className="ml-auto text-xs text-sw-dim">
                                    Tap any line to fix it
                                </div>
                            </div>

                            {items.map((item, index) =>
                                editingIndex === index ? (
                                    <div
                                        key={index}
                                        className="px-3 py-2.5 my-1.5 rounded-sw-card bg-sw-surface shadow-[0_0_0_1px_var(--sw-accent)]"
                                    >
                                        <input
                                            type="text"
                                            value={editDescription}
                                            onChange={e => setEditDescription(e.target.value)}
                                            aria-label="Item name"
                                            className="w-full mb-2 px-2.5 py-2 rounded-lg bg-sw-bg text-sw-text border border-sw-line focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                                            placeholder="Item name"
                                            autoFocus
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') saveEdit();
                                                if (e.key === 'Escape') cancelEdit();
                                            }}
                                        />
                                        <div className="flex items-center gap-2">
                                            <div className="flex items-center gap-1.5 flex-1 px-2.5 py-[7px] rounded-lg bg-sw-bg shadow-[0_0_0_1px_var(--sw-line)]">
                                                <span className="text-sw-dim text-[13px]">$</span>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    value={editPrice}
                                                    onChange={e => setEditPrice(e.target.value)}
                                                    aria-label="Price"
                                                    className="sw-num w-full bg-transparent text-sw-text text-sm focus:outline-none"
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') saveEdit();
                                                        if (e.key === 'Escape') cancelEdit();
                                                    }}
                                                />
                                            </div>
                                            <Button
                                                variant="ghost"
                                                onClick={() => deleteItem(index)}
                                                aria-label="Delete item"
                                                className="text-sw-neg hover:bg-[color-mix(in_srgb,var(--sw-neg)_12%,transparent)]"
                                            >
                                                <Trash size={14} />
                                            </Button>
                                            <Button
                                                variant="primary"
                                                onClick={saveEdit}
                                                className="min-h-9 text-[12.5px]"
                                            >
                                                Done
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <button
                                        key={index}
                                        type="button"
                                        onClick={() => startEditing(index)}
                                        className="w-full flex items-center gap-3 py-[11px] border-b border-sw-line text-left hover:bg-sw-surface focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                                    >
                                        <span className="flex-1 min-w-0 text-sm truncate">
                                            {item.quantity > 1 && (
                                                <span className="text-sw-dim mr-1">
                                                    {item.quantity}×
                                                </span>
                                            )}
                                            {item.description}
                                        </span>
                                        <span className="sw-num text-sm text-sw-muted flex-none">
                                            {formatCents(item.price)}
                                        </span>
                                    </button>
                                )
                            )}

                            {error && <p className="text-[12.5px] text-sw-neg py-2">{error}</p>}
                        </div>

                        <div className="px-4 pt-3 pb-3.5 bg-sw-sunk border-t border-sw-line flex-none">
                            <div className="flex justify-between text-[12.5px] text-sw-muted mb-0.5">
                                <span>Items</span>
                                <span className="sw-num">
                                    {formatCents(reconciliation.itemsSum)}
                                </span>
                            </div>
                            {/*
                              * Tax and tip are as editable as the lines above:
                              * the scan can misread them, and a tip is often
                              * added after the receipt prints — so the rows are
                              * always shown, even when the scan found nothing.
                              */}
                            <div className="flex justify-between items-center text-[12.5px] text-sw-muted mb-1">
                                <span>Tax</span>
                                <span className="flex items-center gap-1 px-2 py-[3px] rounded-lg bg-sw-bg shadow-[0_0_0_1px_var(--sw-line)]">
                                    <span className="text-sw-dim">$</span>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        inputMode="decimal"
                                        value={taxInput}
                                        onChange={e => handleTaxChange(e.target.value)}
                                        placeholder="0.00"
                                        aria-label="Tax"
                                        className="sw-num w-16 bg-transparent text-right text-sw-text focus:outline-none"
                                    />
                                </span>
                            </div>
                            <div className="flex justify-between items-center text-[12.5px] text-sw-muted mb-2">
                                <span>Tip</span>
                                <span className="flex items-center gap-1 px-2 py-[3px] rounded-lg bg-sw-bg shadow-[0_0_0_1px_var(--sw-line)]">
                                    <span className="text-sw-dim">$</span>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        inputMode="decimal"
                                        value={tipInput}
                                        onChange={e => handleTipChange(e.target.value)}
                                        placeholder="0.00"
                                        aria-label="Tip"
                                        className="sw-num w-16 bg-transparent text-right text-sw-text focus:outline-none"
                                    />
                                </span>
                            </div>
                            {total != null && (
                                <div className="flex justify-between text-[15px] font-medium mb-3">
                                    <span>Receipt total</span>
                                    <span className="sw-num">{formatCents(total)}</span>
                                </div>
                            )}
                            <Button
                                variant="primary"
                                block
                                onClick={handleConfirm}
                                disabled={items.length === 0}
                                className="min-h-[46px]"
                            >
                                Next — who had what
                                <ArrowRight size={16} />
                            </Button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default ReceiptScanner;
