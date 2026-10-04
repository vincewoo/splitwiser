import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReceiptScanner from '../ReceiptScanner';

// Mock the image compression module so we can assert whether compressImage is
// invoked. The real implementation throws 'File must be an image' for PDFs,
// which is exactly the regression this test guards against.
import { compressImage } from '../utils/imageCompression';
vi.mock('../utils/imageCompression', () => ({
    compressImage: vi.fn(async (file: File) => file),
}));

// Mock the SyncContext hook so we don't pull in the real syncManager / IndexedDB
// stack. The component only reads `isOnline`.
vi.mock('../contexts/SyncContext', () => ({
    useSync: () => ({ isOnline: true }),
}));

const mockCompressImage = vi.mocked(compressImage);

// A successful scan response with at least one item so handleScan reaches the
// success path (which transitions the component to the 'review' phase).
const scanResult = {
    items: [{ description: 'Coffee', price: 100, quantity: 1 }],
    tax: null as number | null,
    tip: null as number | null,
    total: 100,
    receipt_image_path: '/static/receipts/x.pdf',
};

function getFileInput(): HTMLInputElement {
    // The capture screen renders two file inputs: the library picker (which
    // accepts PDFs) and a camera-only one. These tests drive the library picker.
    const input = document.querySelector(
        'input[type="file"][accept*="application/pdf"]'
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    return input;
}

function selectFile(input: HTMLInputElement, file: File) {
    Object.defineProperty(input, 'files', {
        configurable: true,
        value: [file],
    });
    fireEvent.change(input);
}

describe('ReceiptScanner upload', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockCompressImage.mockClear();
        mockCompressImage.mockImplementation(async (file: File) => file);

        fetchMock = vi.fn(async () => ({
            ok: true,
            json: async () => scanResult,
        }));
        vi.stubGlobal('fetch', fetchMock);
        localStorage.setItem('token', 'test-token');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        localStorage.clear();
    });

    it('skips compression and POSTs the raw PDF to /ocr/scan-receipt', async () => {
        const onItemsDetected = vi.fn();
        render(<ReceiptScanner onItemsDetected={onItemsDetected} onClose={() => {}} />);

        const pdfFile = new File(['%PDF-1.4 fake'], 'receipt.pdf', {
            type: 'application/pdf',
        });
        selectFile(getFileInput(), pdfFile);

        fireEvent.click(screen.getByRole('button', { name: /read this receipt/i }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

        // The key regression assertion: PDFs must NOT be run through compressImage.
        expect(mockCompressImage).not.toHaveBeenCalled();

        // fetch was called against the ocr/scan-receipt endpoint.
        const [url, options] = fetchMock.mock.calls[0];
        expect(String(url)).toContain('ocr/scan-receipt');
        expect(options.method).toBe('POST');

        // The body is FormData containing the original (uncompressed) PDF file.
        const body = options.body as FormData;
        expect(body).toBeInstanceOf(FormData);
        const sentFile = body.get('file') as File;
        expect(sentFile).toBe(pdfFile);
        expect(sentFile.type).toBe('application/pdf');

        // Reached the success/review phase.
        await waitFor(() =>
            expect(screen.getByText(/Tap any line to fix it/i)).toBeInTheDocument()
        );
    });

    it('compresses image files before upload', async () => {
        const onItemsDetected = vi.fn();
        render(<ReceiptScanner onItemsDetected={onItemsDetected} onClose={() => {}} />);

        const pngFile = new File(['fake-png-bytes'], 'receipt.png', {
            type: 'image/png',
        });
        selectFile(getFileInput(), pngFile);

        fireEvent.click(screen.getByRole('button', { name: /read this receipt/i }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

        // Regression balance: images DO go through compression.
        expect(mockCompressImage).toHaveBeenCalledTimes(1);
        expect(mockCompressImage).toHaveBeenCalledWith(pngFile, 1920, 1);
    });
});

describe('ReceiptScanner tax and tip editing', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    // Reach the review phase with the given scan response.
    async function scanToReview(result: typeof scanResult) {
        fetchMock = vi.fn(async () => ({
            ok: true,
            json: async () => result,
        }));
        vi.stubGlobal('fetch', fetchMock);

        selectFile(getFileInput(), new File(['a'], 'receipt.png', { type: 'image/png' }));
        fireEvent.click(screen.getByRole('button', { name: /read this receipt/i }));
        await waitFor(() =>
            expect(screen.getByText(/Tap any line to fix it/i)).toBeInTheDocument()
        );
    }

    beforeEach(() => {
        mockCompressImage.mockClear();
        mockCompressImage.mockImplementation(async (file: File) => file);
        localStorage.setItem('token', 'test-token');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        localStorage.clear();
    });

    it('prefills the inputs with what the scan read', async () => {
        const onItemsDetected = vi.fn();
        render(<ReceiptScanner onItemsDetected={onItemsDetected} onClose={() => {}} />);
        await scanToReview({ ...scanResult, tax: 125, tip: 300 });

        expect(screen.getByLabelText('Tax')).toHaveValue(1.25);
        expect(screen.getByLabelText('Tip')).toHaveValue(3);
    });

    it('shows empty inputs when the scan read no tax or tip', async () => {
        const onItemsDetected = vi.fn();
        render(<ReceiptScanner onItemsDetected={onItemsDetected} onClose={() => {}} />);
        await scanToReview(scanResult);

        expect(screen.getByLabelText('Tax')).toHaveValue(null);
        expect(screen.getByLabelText('Tip')).toHaveValue(null);
    });

    it('hands edited tax and tip to onItemsDetected in cents', async () => {
        const onItemsDetected = vi.fn();
        render(<ReceiptScanner onItemsDetected={onItemsDetected} onClose={() => {}} />);
        await scanToReview(scanResult);

        fireEvent.change(screen.getByLabelText('Tax'), { target: { value: '0.50' } });
        fireEvent.change(screen.getByLabelText('Tip'), { target: { value: '1.00' } });
        fireEvent.click(screen.getByRole('button', { name: /who had what/i }));

        expect(onItemsDetected).toHaveBeenCalledTimes(1);
        const [, , , taxCents, tipCents] = onItemsDetected.mock.calls[0];
        expect(taxCents).toBe(50);
        expect(tipCents).toBe(100);
    });

    it('treats a cleared input as no tax on the receipt', async () => {
        const onItemsDetected = vi.fn();
        render(<ReceiptScanner onItemsDetected={onItemsDetected} onClose={() => {}} />);
        await scanToReview({ ...scanResult, tax: 125 });

        fireEvent.change(screen.getByLabelText('Tax'), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: /who had what/i }));

        const [, , , taxCents] = onItemsDetected.mock.calls[0];
        expect(taxCents).toBeNull();
    });

    it('treats a cleared input as no tip on the receipt', async () => {
        const onItemsDetected = vi.fn();
        render(<ReceiptScanner onItemsDetected={onItemsDetected} onClose={() => {}} />);
        await scanToReview({ ...scanResult, tip: 300 });

        fireEvent.change(screen.getByLabelText('Tip'), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: /who had what/i }));

        const [, , , , tipCents] = onItemsDetected.mock.calls[0];
        expect(tipCents).toBeNull();
    });

    it('clamps a typed negative to zero — min="0" does not stop the keyboard', async () => {
        const onItemsDetected = vi.fn();
        render(<ReceiptScanner onItemsDetected={onItemsDetected} onClose={() => {}} />);
        await scanToReview(scanResult);

        fireEvent.change(screen.getByLabelText('Tax'), { target: { value: '-5' } });
        fireEvent.click(screen.getByRole('button', { name: /who had what/i }));

        const [, , , taxCents] = onItemsDetected.mock.calls[0];
        expect(taxCents).toBe(0);
    });
});

describe('ReceiptScanner paste', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockCompressImage.mockClear();
        mockCompressImage.mockImplementation(async (file: File) => file);

        fetchMock = vi.fn(async () => ({
            ok: true,
            json: async () => scanResult,
        }));
        vi.stubGlobal('fetch', fetchMock);
        localStorage.setItem('token', 'test-token');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        localStorage.clear();
        // Remove any clipboard stub so it doesn't leak between tests.
        if ('clipboard' in navigator) {
            Reflect.deleteProperty(navigator, 'clipboard');
        }
    });

    // Minimal shape of the synthetic clipboardData payloads used in these tests.
    type PasteData = {
        items?: { type: string; getAsFile(): File | null }[];
        files?: File[];
    };

    // Minimal shape of the ClipboardItems returned by navigator.clipboard.read().
    type ClipboardReadItem = { types: string[]; getType(type: string): Promise<Blob> };
    type ClipboardRead = () => Promise<ClipboardReadItem[]>;

    // happy-dom lacks a real ClipboardEvent, so construct a plain Event and attach
    // a synthetic clipboardData payload.
    function firePaste(clipboardData: PasteData) {
        const ev = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(ev, 'clipboardData', { value: clipboardData });
        document.dispatchEvent(ev);
    }

    // Stub navigator.clipboard.read to resolve the given items.
    function stubClipboardRead(read: ClipboardRead | undefined) {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: read === undefined ? {} : { read },
        });
    }

    it('adopts a keyboard-pasted image and scans it', async () => {
        const onItemsDetected = vi.fn();
        render(<ReceiptScanner onItemsDetected={onItemsDetected} onClose={() => {}} />);

        const pngFile = new File(['fake-png-bytes'], 'pasted-receipt.png', {
            type: 'image/png',
        });
        firePaste({
            items: [
                {
                    type: 'image/png',
                    getAsFile: () => pngFile,
                },
            ],
            files: [pngFile],
        });

        // Preview shows the pasted filename.
        await waitFor(() =>
            expect(screen.getByText(/Selected: pasted-receipt\.png/i)).toBeInTheDocument()
        );

        fireEvent.click(screen.getByRole('button', { name: /read this receipt/i }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

        // Pasted images take the compression path (not the PDF path).
        expect(mockCompressImage).toHaveBeenCalledTimes(1);

        const [url] = fetchMock.mock.calls[0];
        expect(String(url)).toContain('ocr/scan-receipt');

        // Reached the review phase.
        await waitFor(() =>
            expect(screen.getByText(/Tap any line to fix it/i)).toBeInTheDocument()
        );
    });

    it('adopts an image via the "Paste from clipboard" button', async () => {
        const onItemsDetected = vi.fn();
        render(<ReceiptScanner onItemsDetected={onItemsDetected} onClose={() => {}} />);

        stubClipboardRead(
            vi.fn(async () => [
                {
                    types: ['image/png'],
                    getType: async () => new Blob(['x'], { type: 'image/png' }),
                },
            ])
        );

        fireEvent.click(screen.getByRole('button', { name: /paste from clipboard/i }));

        // The synthesized file name is shown, and the Scan button is enabled.
        await waitFor(() =>
            expect(screen.getByText(/Selected: pasted-receipt\.png/i)).toBeInTheDocument()
        );
        expect(screen.getByRole('button', { name: /read this receipt/i })).not.toBeDisabled();
    });

    it('shows an error when the clipboard has no image', async () => {
        const onItemsDetected = vi.fn();
        render(<ReceiptScanner onItemsDetected={onItemsDetected} onClose={() => {}} />);

        stubClipboardRead(vi.fn(async () => []));

        fireEvent.click(screen.getByRole('button', { name: /paste from clipboard/i }));

        await waitFor(() =>
            expect(screen.getByText(/No image found on the clipboard/i)).toBeInTheDocument()
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('shows an error when the clipboard API is unsupported', async () => {
        const onItemsDetected = vi.fn();
        render(<ReceiptScanner onItemsDetected={onItemsDetected} onClose={() => {}} />);

        // navigator.clipboard exists but has no read().
        stubClipboardRead(undefined);

        fireEvent.click(screen.getByRole('button', { name: /paste from clipboard/i }));

        await waitFor(() =>
            expect(screen.getByText(/isn't supported in this browser/i)).toBeInTheDocument()
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('ignores a keyboard paste while in the review phase', async () => {
        const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

        const onItemsDetected = vi.fn();
        render(<ReceiptScanner onItemsDetected={onItemsDetected} onClose={() => {}} />);

        // Adopt an image and scan it to reach the review phase.
        selectFile(getFileInput(), new File(['a'], 'first.png', { type: 'image/png' }));
        fireEvent.click(screen.getByRole('button', { name: /read this receipt/i }));
        await waitFor(() =>
            expect(screen.getByText(/Tap any line to fix it/i)).toBeInTheDocument()
        );

        // Any further object-URL creation now would mean a paste was adopted.
        createSpy.mockClear();

        // The paste listener is detached in the review phase, so this is a no-op.
        firePaste({
            items: [
                {
                    type: 'image/png',
                    getAsFile: () => new File(['b'], 'second.png', { type: 'image/png' }),
                },
            ],
        });

        // Still in review, and no new preview URL was created.
        expect(screen.getByText(/Tap any line to fix it/i)).toBeInTheDocument();
        expect(screen.getByText(/Coffee/i)).toBeInTheDocument();
        expect(createSpy).not.toHaveBeenCalled();
    });

    it('shows an error and does not fetch when clipboard.read() rejects', async () => {
        const onItemsDetected = vi.fn();
        render(<ReceiptScanner onItemsDetected={onItemsDetected} onClose={() => {}} />);

        stubClipboardRead(vi.fn(async () => { throw new Error('denied'); }));

        fireEvent.click(screen.getByRole('button', { name: /paste from clipboard/i }));

        await waitFor(() =>
            expect(screen.getByText(/Could not read the clipboard/i)).toBeInTheDocument()
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('treats a PDF pasted via clipboardData.files as a raw upload', async () => {
        const onItemsDetected = vi.fn();
        render(<ReceiptScanner onItemsDetected={onItemsDetected} onClose={() => {}} />);

        const pdfFile = new File(['%PDF-1.4 fake'], 'receipt.pdf', {
            type: 'application/pdf',
        });
        // No image item; the file falls back through clipboardData.files.
        firePaste({ files: [pdfFile] });

        await waitFor(() =>
            expect(screen.getByText(/Selected: receipt\.pdf/i)).toBeInTheDocument()
        );

        fireEvent.click(screen.getByRole('button', { name: /read this receipt/i }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

        // PDFs bypass compression and are sent as-is.
        expect(mockCompressImage).not.toHaveBeenCalled();
        const body = fetchMock.mock.calls[0][1].body as FormData;
        const sentFile = body.get('file') as File;
        expect(sentFile).toBe(pdfFile);
        expect(sentFile.type).toBe('application/pdf');

        await waitFor(() =>
            expect(screen.getByText(/Tap any line to fix it/i)).toBeInTheDocument()
        );
    });

    it('synthesizes pasted-receipt.png for a nameless screenshot blob', async () => {
        const onItemsDetected = vi.fn();
        render(<ReceiptScanner onItemsDetected={onItemsDetected} onClose={() => {}} />);

        firePaste({
            items: [
                {
                    type: 'image/png',
                    getAsFile: () => new File(['x'], '', { type: 'image/png' }),
                },
            ],
        });

        await waitFor(() =>
            expect(screen.getByText(/Selected: pasted-receipt\.png/i)).toBeInTheDocument()
        );
    });

    it('revokes the previous preview URL before creating a new one', async () => {
        const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
        const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

        const onItemsDetected = vi.fn();
        render(<ReceiptScanner onItemsDetected={onItemsDetected} onClose={() => {}} />);

        selectFile(getFileInput(), new File(['a'], 'first.png', { type: 'image/png' }));
        await waitFor(() =>
            expect(screen.getByText(/Selected: first\.png/i)).toBeInTheDocument()
        );

        selectFile(getFileInput(), new File(['b'], 'second.png', { type: 'image/png' }));
        await waitFor(() =>
            expect(screen.getByText(/Selected: second\.png/i)).toBeInTheDocument()
        );

        // The first URL was revoked and a fresh one created for the second image.
        expect(createSpy).toHaveBeenCalledTimes(2);
        expect(revokeSpy).toHaveBeenCalledWith('blob:mock');
    });

    it('does NOT revoke the preview URL on Retake (regression guard)', async () => {
        const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
        const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

        const onItemsDetected = vi.fn();
        render(<ReceiptScanner onItemsDetected={onItemsDetected} onClose={() => {}} />);

        selectFile(getFileInput(), new File(['a'], 'first.png', { type: 'image/png' }));
        fireEvent.click(screen.getByRole('button', { name: /read this receipt/i }));
        await waitFor(() =>
            expect(screen.getByText(/Tap any line to fix it/i)).toBeInTheDocument()
        );

        // Isolate the Re-scan action from any earlier revoke/create calls.
        revokeSpy.mockClear();
        createSpy.mockClear();

        fireEvent.click(screen.getByRole('button', { name: /retake/i }));

        // Back on the capture screen with the live preview intact.
        const preview = await screen.findByAltText('Receipt preview');
        expect(preview).toHaveAttribute('src', 'blob:mock');
        expect(revokeSpy).not.toHaveBeenCalled();
        expect(createSpy).not.toHaveBeenCalled();
    });

    it('revokes the current preview URL when cancelling (onClose path)', async () => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
        const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

        const onClose = vi.fn();
        render(<ReceiptScanner onItemsDetected={vi.fn()} onClose={onClose} />);

        selectFile(getFileInput(), new File(['a'], 'first.png', { type: 'image/png' }));
        await waitFor(() =>
            expect(screen.getByText(/Selected: first\.png/i)).toBeInTheDocument()
        );

        fireEvent.click(screen.getByRole('button', { name: /close/i }));

        expect(revokeSpy).toHaveBeenCalledWith('blob:mock');
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
