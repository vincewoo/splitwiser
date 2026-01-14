import React, { useState } from 'react';
import { getApiUrl } from './api';
import AlertDialog from './components/AlertDialog';
import { useSync } from './contexts/SyncContext';
import BoundingBoxEditor from './components/expense/BoundingBoxEditor';
import type { BoundingBox as BoundingBoxEditorType } from './components/expense/BoundingBoxEditor';
import ItemPreviewEditor from './components/expense/ItemPreviewEditor';
import type { ItemWithRegion } from './components/expense/ItemPreviewEditor';
import { compressImage } from './utils/imageCompression';

interface ReceiptScannerProps {
    onItemsDetected: (items: { description: string, price: number }[], receiptPath?: string, validationWarning?: string | null) => void;
    onClose: () => void;
}

type Phase = 'upload' | 'define-regions' | 'review-items';

// Combined type that works for both components
interface RegionData {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    label?: string;
    // Store normalized coordinates from backend to avoid conversion issues
    normalized_x?: number;
    normalized_y?: number;
    normalized_width?: number;
    normalized_height?: number;
}

const ReceiptScanner: React.FC<ReceiptScannerProps> = ({ onItemsDetected, onClose }) => {
    const { isOnline } = useSync();
    const [phase, setPhase] = useState<Phase>('upload');
    const [image, setImage] = useState<File | null>(null);
    const [imageUrl, setImageUrl] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string>('');
    const [alertDialog, setAlertDialog] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        type: 'alert' | 'confirm' | 'success' | 'error';
    }>({ isOpen: false, title: '', message: '', type: 'alert' });

    // Phase 1: Region detection - unified format with id
    const [regions, setRegions] = useState<RegionData[]>([]);
    const [cacheKey, setCacheKey] = useState<string>('');
    const [ocrImageDimensions, setOcrImageDimensions] = useState<{ width: number, height: number } | null>(null);

    // Phase 2: Item extraction
    const [items, setItems] = useState<ItemWithRegion[]>([]);

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setImage(file);
            setError('');

            // Create object URL for preview
            const url = URL.createObjectURL(file);
            setImageUrl(url);
        }
    };

    const startRegionDetection = async () => {
        if (!image) return;

        setLoading(true);
        setProgress(0);
        setError('');

        try {
            // Compress image before upload
            setProgress(10);
            console.log('Compressing image...');
            const compressedImage = await compressImage(image, 1920, 1);
            console.log(`Image compressed: ${image.size} -> ${compressedImage.size} bytes`);

            setProgress(30);

            const formData = new FormData();
            formData.append('file', compressedImage);

            const token = localStorage.getItem('token');

            // Call detect-regions endpoint
            console.log('Calling /ocr/detect-regions...');
            const response = await fetch(getApiUrl('ocr/detect-regions'), {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });

            setProgress(90);

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Region detection failed');
            }

            const data = await response.json();
            console.log('Region detection response:', data);

            // Store the image dimensions that the backend used for OCR
            // This is crucial for correct coordinate transformation
            const ocrImageWidth = data.image_size.width;
            const ocrImageHeight = data.image_size.height;
            console.log(`OCR image dimensions: ${ocrImageWidth}x${ocrImageHeight}`);
            setOcrImageDimensions({ width: ocrImageWidth, height: ocrImageHeight });

            // Get actual dimensions of the displayed image
            const img = new Image();
            img.src = imageUrl;
            await new Promise((resolve) => { img.onload = resolve; });
            const displayWidth = img.naturalWidth;
            const displayHeight = img.naturalHeight;
            console.log(`Display image dimensions: ${displayWidth}x${displayHeight}`);

            // Convert normalized coordinates to pixel coordinates based on DISPLAYED image dimensions
            // We need to scale from OCR image space to display image space
            const scaleX = displayWidth / ocrImageWidth;
            const scaleY = displayHeight / ocrImageHeight;

            const pixelRegions = data.regions.map((region: any) => ({
                id: region.id,
                x: region.x * ocrImageWidth * scaleX,  // First to OCR pixels, then scale to display
                y: region.y * ocrImageHeight * scaleY,
                width: region.width * ocrImageWidth * scaleX,
                height: region.height * ocrImageHeight * scaleY,
                label: region.id,
                // Store original normalized coords for later
                normalized_x: region.x,
                normalized_y: region.y,
                normalized_width: region.width,
                normalized_height: region.height
            }));

            setRegions(pixelRegions);
            setCacheKey(data.cache_key);
            setProgress(100);

            // Move to phase 1
            setPhase('define-regions');

        } catch (error: any) {
            console.error('Region detection error:', error);
            setError(`Failed to detect regions: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const proceedToReview = async () => {
        if (!cacheKey || regions.length === 0) {
            setError('Please define at least one region');
            return;
        }

        setLoading(true);
        setProgress(0);
        setError('');

        try {
            // Get display image dimensions
            const img = new Image();
            img.src = imageUrl;
            await new Promise((resolve) => { img.onload = resolve; });
            const displayWidth = img.naturalWidth;
            const displayHeight = img.naturalHeight;

            // Convert regions back to normalized coordinates relative to OCR image
            const normalizedRegions = regions.map((region, idx) => {
                let result;
                // Check if we have the original normalized coordinates stored
                if ('normalized_x' in region && region.normalized_x !== undefined) {
                    // Use the original normalized coordinates from the backend
                    result = {
                        x: region.normalized_x,
                        y: region.normalized_y,
                        width: region.normalized_width,
                        height: region.normalized_height
                    };
                    console.log(`Region ${idx}: Using stored normalized coords`, result);
                } else if (ocrImageDimensions) {
                    // User created this box - convert from display pixels to OCR normalized
                    // First normalize to display image
                    const displayNormX = region.x / displayWidth;
                    const displayNormY = region.y / displayHeight;
                    const displayNormWidth = region.width / displayWidth;
                    const displayNormHeight = region.height / displayHeight;

                    // The OCR image and display image should have same aspect ratio
                    // So normalized coordinates should be the same
                    result = {
                        x: displayNormX,
                        y: displayNormY,
                        width: displayNormWidth,
                        height: displayNormHeight
                    };
                    console.log(`Region ${idx}: User-created, normalizing from display pixels`, result);
                } else {
                    // Fallback - shouldn't happen
                    result = {
                        x: region.x / displayWidth,
                        y: region.y / displayHeight,
                        width: region.width / displayWidth,
                        height: region.height / displayHeight
                    };
                    console.log(`Region ${idx}: Fallback normalization`, result);
                }
                return result;
            });

            setProgress(30);

            const token = localStorage.getItem('token');

            // Call extract-regions endpoint
            console.log('Calling /ocr/extract-regions...');
            const response = await fetch(getApiUrl('ocr/extract-regions'), {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    cache_key: cacheKey,
                    regions: normalizedRegions
                })
            });

            setProgress(90);

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Item extraction failed');
            }

            const data = await response.json();
            console.log('Item extraction response:', data);

            // Convert items to ItemWithRegion format
            const extractedItems: ItemWithRegion[] = data.items.map((item: any) => ({
                region_id: item.region_id,
                description: item.description,
                price: item.price,
                is_tax_tip: false,
                split_type: 'EQUAL'
            }));

            setItems(extractedItems);
            setProgress(100);

            // Move to phase 2
            setPhase('review-items');

        } catch (error: any) {
            console.error('Item extraction error:', error);
            setError(`Failed to extract items: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleRegionsChange = (updatedRegions: BoundingBoxEditorType[]) => {
        // Convert BoundingBoxEditor format to our unified format
        // BoundingBoxEditor may create new regions without id, so we need to ensure they have ids
        const regionsWithIds: RegionData[] = updatedRegions.map((region, index) => {
            // Find existing region to preserve metadata
            const existing = regions.find(r =>
                Math.abs(r.x - region.x) < 0.01 &&
                Math.abs(r.y - region.y) < 0.01 &&
                Math.abs(r.width - region.width) < 0.01 &&
                Math.abs(r.height - region.height) < 0.01
            );

            // If this is an existing region and it hasn't been modified, preserve normalized coords
            // But if the position/size changed significantly, clear the normalized coords
            if (existing && 'normalized_x' in existing) {
                const positionChanged = Math.abs(existing.x - region.x) > 1 ||
                    Math.abs(existing.y - region.y) > 1 ||
                    Math.abs(existing.width - region.width) > 1 ||
                    Math.abs(existing.height - region.height) > 1;

                if (positionChanged) {
                    // Position changed - clear normalized coords
                    return {
                        id: existing.id,
                        x: region.x,
                        y: region.y,
                        width: region.width,
                        height: region.height,
                        label: region.label || existing.label
                        // Don't include normalized coords - they're invalid now
                    };
                } else {
                    // Position unchanged - keep normalized coords
                    return {
                        ...existing,
                        x: region.x,
                        y: region.y,
                        width: region.width,
                        height: region.height,
                        label: region.label || existing.label
                    };
                }
            } else {
                // New region created by user - no normalized coords yet
                return {
                    id: region.label || String(index + 1),
                    x: region.x,
                    y: region.y,
                    width: region.width,
                    height: region.height,
                    label: region.label || String(index + 1)
                };
            }
        });
        setRegions(regionsWithIds);
    };

    const handleItemsChange = (updatedItems: ItemWithRegion[]) => {
        setItems(updatedItems);
    };

    const handleBack = () => {
        if (phase === 'review-items') {
            setPhase('define-regions');
        } else if (phase === 'define-regions') {
            setPhase('upload');
            setRegions([]);
            setCacheKey('');
        }
    };

    const handleConfirm = () => {
        // Convert items to the expected format
        const finalItems = items.map(item => ({
            description: item.description,
            price: item.price
        }));

        onItemsDetected(finalItems);
    };

    const handleCancel = () => {
        // Clean up object URL
        if (imageUrl) {
            URL.revokeObjectURL(imageUrl);
        }
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-gray-600 dark:bg-gray-900/75 bg-opacity-50 overflow-y-auto h-full w-full flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl dark:shadow-gray-900/50 w-full max-w-6xl max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold dark:text-gray-100">Scan Receipt</h2>

                    {/* Progress indicator */}
                    <div className="flex items-center gap-2 text-sm">
                        <div className={`flex items-center gap-1 ${phase === 'upload' ? 'text-teal-600 dark:text-teal-400 font-semibold' : 'text-gray-400 dark:text-gray-500'}`}>
                            <span className={`w-6 h-6 rounded-full flex items-center justify-center ${phase === 'upload' ? 'bg-teal-100 dark:bg-teal-900/30' : 'bg-gray-100 dark:bg-gray-700'}`}>
                                1
                            </span>
                            <span className="hidden sm:inline">Upload</span>
                        </div>
                        <span className="text-gray-300 dark:text-gray-600">→</span>
                        <div className={`flex items-center gap-1 ${phase === 'define-regions' ? 'text-teal-600 dark:text-teal-400 font-semibold' : 'text-gray-400 dark:text-gray-500'}`}>
                            <span className={`w-6 h-6 rounded-full flex items-center justify-center ${phase === 'define-regions' ? 'bg-teal-100 dark:bg-teal-900/30' : 'bg-gray-100 dark:bg-gray-700'}`}>
                                2
                            </span>
                            <span className="hidden sm:inline">Define Regions</span>
                        </div>
                        <span className="text-gray-300 dark:text-gray-600">→</span>
                        <div className={`flex items-center gap-1 ${phase === 'review-items' ? 'text-teal-600 dark:text-teal-400 font-semibold' : 'text-gray-400 dark:text-gray-500'}`}>
                            <span className={`w-6 h-6 rounded-full flex items-center justify-center ${phase === 'review-items' ? 'bg-teal-100 dark:bg-teal-900/30' : 'bg-gray-100 dark:bg-gray-700'}`}>
                                3
                            </span>
                            <span className="hidden sm:inline">Review Items</span>
                        </div>
                    </div>
                </div>

                {/* Error message */}
                {error && (
                    <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                        <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
                    </div>
                )}

                {/* Offline warning */}
                {!isOnline && (
                    <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                        <p className="text-sm text-yellow-700 dark:text-yellow-400">
                            Receipt scanning requires an internet connection and is not available offline.
                        </p>
                    </div>
                )}

                {/* Phase 1: Upload */}
                {phase === 'upload' && (
                    <div>
                        <div className="mb-4">
                            <label className="block w-full">
                                <span className="sr-only">Choose receipt</span>
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={handleImageChange}
                                    className="block w-full text-sm text-gray-500 dark:text-gray-400
                                        file:mr-4 file:py-2 file:px-4
                                        file:rounded-full file:border-0
                                        file:text-sm file:font-semibold
                                        file:bg-teal-50 file:text-teal-700
                                        hover:file:bg-teal-100
                                        dark:file:bg-teal-900/30 dark:file:text-teal-300
                                        cursor-pointer file:cursor-pointer"
                                />
                            </label>
                            {image && (
                                <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                                    Selected: {image.name}
                                </div>
                            )}
                        </div>

                        {/* Image preview */}
                        {imageUrl && (
                            <div className="mb-4">
                                <img
                                    src={imageUrl}
                                    alt="Receipt preview"
                                    className="max-w-full max-h-96 mx-auto rounded border border-gray-300 dark:border-gray-600"
                                />
                            </div>
                        )}

                        {loading && (
                            <div className="mb-4">
                                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                                    <div className="bg-teal-600 dark:bg-teal-500 h-2.5 rounded-full transition-all" style={{ width: `${progress}%` }}></div>
                                </div>
                                <p className="text-xs text-center mt-1 dark:text-gray-300">Processing... {progress}%</p>
                            </div>
                        )}

                        <div className="flex justify-end space-x-3">
                            <button
                                onClick={handleCancel}
                                className="px-4 py-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                                disabled={loading}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={startRegionDetection}
                                disabled={!image || loading || !isOnline}
                                aria-busy={loading}
                                className={`px-4 py-2 text-white rounded flex items-center justify-center ${!image || loading || !isOnline ? 'bg-gray-300 dark:bg-gray-600 cursor-not-allowed' : 'bg-teal-500 hover:bg-teal-600'}`}
                            >
                                {loading ? (
                                    <>
                                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Processing...
                                    </>
                                ) : (
                                    'Next: Detect Regions'
                                )}
                            </button>
                        </div>
                    </div>
                )}

                {/* Phase 2: Define Regions */}
                {phase === 'define-regions' && imageUrl && (
                    <div>
                        <BoundingBoxEditor
                            imageUrl={imageUrl}
                            initialRegions={regions}
                            onChange={handleRegionsChange}
                        />

                        {loading && (
                            <div className="my-4">
                                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                                    <div className="bg-teal-600 dark:bg-teal-500 h-2.5 rounded-full transition-all" style={{ width: `${progress}%` }}></div>
                                </div>
                                <p className="text-xs text-center mt-1 dark:text-gray-300">Extracting items... {progress}%</p>
                            </div>
                        )}

                        <div className="flex justify-end space-x-3 mt-4">
                            <button
                                onClick={handleBack}
                                className="px-4 py-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                                disabled={loading}
                            >
                                Back
                            </button>
                            <button
                                onClick={proceedToReview}
                                disabled={regions.length === 0 || loading}
                                aria-busy={loading}
                                className={`px-4 py-2 text-white rounded flex items-center justify-center ${regions.length === 0 || loading ? 'bg-gray-300 dark:bg-gray-600 cursor-not-allowed' : 'bg-teal-500 hover:bg-teal-600'}`}
                            >
                                {loading ? (
                                    <>
                                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Processing...
                                    </>
                                ) : (
                                    `Next: Extract Items (${regions.length})`
                                )}
                            </button>
                        </div>
                    </div>
                )}

                {/* Phase 3: Review Items */}
                {phase === 'review-items' && imageUrl && (
                    <div>
                        <ItemPreviewEditor
                            imageUrl={imageUrl}
                            regions={regions.map(r => ({
                                id: r.label || r.id,  // Use label as ID since items use 1-based numbering
                                x: r.x,
                                y: r.y,
                                width: r.width,
                                height: r.height
                            }))}
                            items={items}
                            onItemsChange={handleItemsChange}
                            currency="USD"
                        />

                        <div className="flex justify-end space-x-3 mt-6">
                            <button
                                onClick={handleBack}
                                className="px-4 py-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                            >
                                Back
                            </button>
                            <button
                                onClick={handleConfirm}
                                disabled={items.length === 0}
                                className={`px-4 py-2 text-white rounded ${items.length === 0 ? 'bg-gray-300 dark:bg-gray-600 cursor-not-allowed' : 'bg-teal-500 hover:bg-teal-600'}`}
                            >
                                Confirm Items ({items.length})
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <AlertDialog
                isOpen={alertDialog.isOpen}
                title={alertDialog.title}
                message={alertDialog.message}
                type={alertDialog.type}
                onClose={() => setAlertDialog({ isOpen: false, title: '', message: '', type: 'alert' })}
            />
        </div>
    );
};

export default ReceiptScanner;
