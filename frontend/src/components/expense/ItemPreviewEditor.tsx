import React, { useState, useRef, useEffect } from 'react';
import { formatMoney } from '../../utils/formatters';

export interface BoundingBox {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    confidence?: number; // 0-1 range from OCR
    text?: string;
}

export interface ItemSplitDetails {
    user_id: number;
    is_guest: boolean;
    amount?: number; // For EXACT split (in cents)
    percentage?: number; // For PERCENTAGE split (0-100)
    shares?: number; // For SHARES split
}

export interface ItemWithRegion {
    region_id: string;
    description: string;
    price: number; // in cents
    is_tax_tip: boolean;
    split_type: 'EQUAL' | 'EXACT' | 'PERCENTAGE' | 'SHARES'; // How to split this item
    split_details?: ItemSplitDetails[]; // Details for non-equal splits
    confidence?: number; // 0-1 range from OCR
}

interface ItemPreviewEditorProps {
    imageUrl: string;
    regions: BoundingBox[];
    items: ItemWithRegion[];
    onItemsChange: (items: ItemWithRegion[]) => void;
    currency?: string;
}

const ItemPreviewEditor: React.FC<ItemPreviewEditorProps> = ({
    imageUrl,
    regions,
    items,
    onItemsChange,
    currency = 'USD'
}) => {
    const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    const [tempEditValues, setTempEditValues] = useState<{ description: string; price: string } | null>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imageRef = useRef<HTMLImageElement | null>(null);
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
    const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
    const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
    const receiptContainerRef = useRef<HTMLDivElement>(null);
    const itemListRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const [regionImages, setRegionImages] = useState<Map<string, string>>(new Map());

    // Load image and extract region images
    useEffect(() => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            imageRef.current = img;
            setImageDimensions({ width: img.width, height: img.height });
            setImageLoaded(true);
            // Extraction will happen via the regions useEffect
        };
        img.onerror = () => {
            console.error('Failed to load receipt image');
        };
        img.src = imageUrl;
    }, [imageUrl]);

    // Extract cropped images for each region
    const extractRegionImages = (img: HTMLImageElement) => {
        const newRegionImages = new Map<string, string>();

        regions.forEach(region => {
            try {
                // Create a temporary canvas for cropping
                const tempCanvas = document.createElement('canvas');
                const ctx = tempCanvas.getContext('2d');
                if (!ctx) return;

                // Set canvas size to match the region
                tempCanvas.width = region.width;
                tempCanvas.height = region.height;

                // Draw the cropped region
                ctx.drawImage(
                    img,
                    region.x, region.y, region.width, region.height, // Source rect
                    0, 0, region.width, region.height // Dest rect
                );

                // Convert to data URL
                const dataUrl = tempCanvas.toDataURL('image/png');
                newRegionImages.set(region.id, dataUrl);
            } catch (error) {
                console.error(`Failed to extract region ${region.id}:`, error);
            }
        });

        setRegionImages(newRegionImages);
    };

    // Re-extract region images when regions change
    useEffect(() => {
        if (imageLoaded && imageRef.current) {
            extractRegionImages(imageRef.current);
        }
    }, [regions, imageLoaded]);

    // Helper: Get confidence color
    const getConfidenceColor = (confidence?: number): { border: string; bg: string; label: string } => {
        if (!confidence) confidence = 0.9; // Default high confidence

        if (confidence >= 0.9) {
            return {
                border: '#10b981', // green
                bg: 'rgba(16, 185, 129, 0.2)',
                label: 'High'
            };
        } else if (confidence >= 0.7) {
            return {
                border: '#f59e0b', // yellow/orange
                bg: 'rgba(245, 158, 11, 0.2)',
                label: 'Medium'
            };
        } else {
            return {
                border: '#ef4444', // red
                bg: 'rgba(239, 68, 68, 0.2)',
                label: 'Low'
            };
        }
    };

    // Sort items by Y coordinate of their corresponding region
    const sortedItems = [...items].sort((a, b) => {
        const regionA = regions.find(r => r.id === a.region_id);
        const regionB = regions.find(r => r.id === b.region_id);
        if (!regionA || !regionB) return 0;
        return regionA.y - regionB.y;
    });

    // Draw canvas with boxes
    useEffect(() => {
        if (!imageLoaded || !canvasRef.current || !imageRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw image
        ctx.drawImage(imageRef.current, 0, 0, canvas.width, canvas.height);

        // Draw bounding boxes
        regions.forEach(box => {
            const item = items.find(i => i.region_id === box.id);
            const isSelected = box.id === selectedRegionId;
            const isHovered = box.id === hoveredRegionId || box.id === hoveredItemId;
            const confidence = item?.confidence || box.confidence;
            const confidenceColor = getConfidenceColor(confidence);

            // Box styling with confidence colors
            if (isSelected) {
                ctx.strokeStyle = '#0d9488'; // teal
                ctx.lineWidth = 4;
                ctx.fillStyle = 'rgba(13, 148, 136, 0.3)';
            } else if (isHovered) {
                ctx.strokeStyle = '#3b82f6'; // blue
                ctx.lineWidth = 3;
                ctx.fillStyle = 'rgba(59, 130, 246, 0.25)';
            } else if (item) {
                ctx.strokeStyle = confidenceColor.border;
                ctx.lineWidth = 2;
                ctx.fillStyle = confidenceColor.bg;
            } else {
                ctx.strokeStyle = '#9ca3af'; // gray
                ctx.lineWidth = 1;
                ctx.fillStyle = 'rgba(156, 163, 175, 0.1)';
            }

            // Draw filled box
            ctx.fillRect(box.x, box.y, box.width, box.height);

            // Draw border
            ctx.strokeRect(box.x, box.y, box.width, box.height);

            // Draw label if item exists
            if (item) {
                const itemIndex = sortedItems.indexOf(item) + 1;
                const labelSize = 28;
                const labelX = box.x + 8;
                const labelY = box.y + 8;

                // Draw dark background with rounded corners
                ctx.fillStyle = isSelected ? '#0d9488' : 'rgba(0, 0, 0, 0.85)';

                // Use roundRect if available, otherwise use regular rect
                if (typeof ctx.roundRect === 'function') {
                    ctx.beginPath();
                    ctx.roundRect(labelX, labelY, labelSize, labelSize, 4);
                    ctx.fill();
                } else {
                    ctx.fillRect(labelX, labelY, labelSize, labelSize);
                }

                // Draw white text
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 18px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(itemIndex.toString(), labelX + labelSize / 2, labelY + labelSize / 2);
            }
        });
    }, [regions, items, sortedItems, selectedRegionId, hoveredRegionId, hoveredItemId, imageLoaded]);

    // Synchronized scrolling helper
    const scrollToItem = (regionId: string) => {
        const itemElement = itemRefs.current.get(regionId);
        if (itemElement && itemListRef.current) {
            itemElement.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
                inline: 'nearest'
            });
        }
    };

    const scrollToBox = (regionId: string) => {
        const box = regions.find(b => b.id === regionId);
        if (box && canvasRef.current && receiptContainerRef.current) {
            const canvas = canvasRef.current;
            const container = receiptContainerRef.current;

            // Calculate box center position
            const boxCenterY = box.y + box.height / 2;
            const containerHeight = container.clientHeight;
            const canvasHeight = canvas.height;

            // Calculate scroll position to center the box
            const scrollRatio = boxCenterY / canvasHeight;
            const targetScroll = (canvas.clientHeight * scrollRatio) - (containerHeight / 2);

            container.scrollTo({
                top: Math.max(0, targetScroll),
                behavior: 'smooth'
            });
        }
    };

    // Handle canvas click
    const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Find clicked box
        const clickedBox = regions.find(box =>
            x >= box.x && x <= box.x + box.width &&
            y >= box.y && y <= box.y + box.height
        );

        if (clickedBox) {
            setSelectedRegionId(clickedBox.id);
            // Scroll to corresponding item in list
            scrollToItem(clickedBox.id);
        } else {
            setSelectedRegionId(null);
        }
    };

    // Handle canvas hover
    const handleCanvasMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Find hovered box
        const hoveredBox = regions.find(box =>
            x >= box.x && x <= box.x + box.width &&
            y >= box.y && y <= box.y + box.height
        );

        setHoveredRegionId(hoveredBox?.id || null);
        canvas.style.cursor = hoveredBox ? 'pointer' : 'default';
    };

    // Handle item click in list
    const handleItemClick = (regionId: string) => {
        setSelectedRegionId(regionId);
        // Scroll to corresponding box on receipt
        scrollToBox(regionId);
    };

    // Handle item hover
    const handleItemHover = (regionId: string | null) => {
        setHoveredItemId(regionId);
    };

    // Start editing an item
    const handleEditStart = (regionId: string) => {
        const item = items.find(i => i.region_id === regionId);
        if (item) {
            setEditingItemId(regionId);
            setTempEditValues({
                description: item.description,
                price: (item.price / 100).toFixed(2)
            });
        }
    };

    // Save edited item
    const handleEditSave = () => {
        if (!editingItemId || !tempEditValues) return;

        const priceFloat = parseFloat(tempEditValues.price);
        if (isNaN(priceFloat)) return;

        const priceCents = Math.round(priceFloat * 100);
        const updatedItems = items.map(item =>
            item.region_id === editingItemId
                ? { ...item, description: tempEditValues.description, price: priceCents }
                : item
        );
        onItemsChange(updatedItems);
        setEditingItemId(null);
        setTempEditValues(null);
    };

    // Cancel editing
    const handleEditCancel = () => {
        setEditingItemId(null);
        setTempEditValues(null);
    };

    // Handle description change (for temp edit values)
    const handleDescriptionChange = (newDescription: string) => {
        if (tempEditValues) {
            setTempEditValues({ ...tempEditValues, description: newDescription });
        }
    };

    // Handle price change (for temp edit values)
    const handlePriceChange = (newPriceStr: string) => {
        if (tempEditValues) {
            setTempEditValues({ ...tempEditValues, price: newPriceStr });
        }
    };

    // Handle tax/tip checkbox
    const handleTaxTipToggle = (regionId: string) => {
        const updatedItems = items.map(item =>
            item.region_id === regionId
                ? { ...item, is_tax_tip: !item.is_tax_tip }
                : item
        );
        onItemsChange(updatedItems);
    };

    // Handle remove item
    const handleRemoveItem = (regionId: string) => {
        const updatedItems = items.filter(item => item.region_id !== regionId);
        onItemsChange(updatedItems);
        if (selectedRegionId === regionId) {
            setSelectedRegionId(null);
        }
    };

    // Calculate total
    const total = items.reduce((sum, item) => sum + item.price, 0);

    const [connectionPath, setConnectionPath] = useState('');

    useEffect(() => {
        if (!selectedRegionId && !hoveredItemId) {
            setConnectionPath('');
            return;
        }

        const targetId = (selectedRegionId || hoveredItemId) as string;
        const box = regions.find(b => b.id === targetId);
        const item = items.find(i => i.region_id === targetId);

        if (!box || !item || !canvasRef.current) {
            setConnectionPath('');
            return;
        }

        const canvas = canvasRef.current;
        const canvasRect = canvas.getBoundingClientRect();

        // Box center point (relative to canvas)
        const boxCenterX = box.x + box.width / 2;
        const boxCenterY = box.y + box.height / 2;

        // Convert to screen coordinates
        const scaleX = canvasRect.width / imageDimensions.width;
        const scaleY = canvasRect.height / imageDimensions.height;

        const startX = boxCenterX * scaleX;
        const startY = boxCenterY * scaleY;

        // Item position (relative to viewport) - approximate
        const itemElement = itemRefs.current.get(targetId);
        if (!itemElement) {
            setConnectionPath('');
            return;
        }

        const itemRect = itemElement.getBoundingClientRect();
        const endX = canvasRect.width + 24; // Gap between panels
        const endY = itemRect.top - canvasRect.top + itemRect.height / 2;

        // Create curved path
        const controlX1 = startX + (endX - startX) * 0.4;
        const controlX2 = startX + (endX - startX) * 0.6;

        setConnectionPath(`M ${startX} ${startY} C ${controlX1} ${startY}, ${controlX2} ${endY}, ${endX} ${endY}`);
    }, [selectedRegionId, hoveredItemId, regions, items, imageDimensions]);

    return (
        <div className="flex flex-col lg:flex-row gap-6">
            {/* Receipt Image */}
            <div className="lg:w-1/2">
                <div className="sticky top-4">
                    <h3 className="text-lg font-semibold mb-3 dark:text-gray-100">
                        Receipt Preview
                    </h3>
                    {!imageLoaded && (
                        <div className="flex items-center justify-center h-96 bg-gray-100 dark:bg-gray-700 rounded border border-gray-300 dark:border-gray-600">
                            <p className="text-gray-500 dark:text-gray-400">Loading receipt...</p>
                        </div>
                    )}
                    {imageLoaded && (
                        <div
                            ref={receiptContainerRef}
                            className="relative max-h-[600px] overflow-y-auto"
                        >
                            <div className="relative">
                                <canvas
                                    ref={canvasRef}
                                    width={imageDimensions.width}
                                    height={imageDimensions.height}
                                    onClick={handleCanvasClick}
                                    onMouseMove={handleCanvasMove}
                                    onMouseLeave={() => setHoveredRegionId(null)}
                                    className="w-full h-auto border border-gray-300 dark:border-gray-600 rounded cursor-pointer"
                                />

                                {/* SVG Overlay for connection lines */}
                                {(selectedRegionId || hoveredItemId) && (
                                    <svg
                                        className="absolute inset-0 pointer-events-none w-full h-full z-10"
                                        style={{ overflow: 'visible', zIndex: 10 }}
                                    >
                                        <defs>
                                            <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                                                <stop offset="0%" stopColor={selectedRegionId ? "#0d9488" : "#3b82f6"} stopOpacity="1" />
                                                <stop offset="100%" stopColor={selectedRegionId ? "#0d9488" : "#3b82f6"} stopOpacity="0.4" />
                                            </linearGradient>
                                        </defs>
                                        <path
                                            d={connectionPath}
                                            stroke="url(#lineGradient)"
                                            strokeWidth="3"
                                            fill="none"
                                            strokeDasharray="8 4"
                                            className="animate-pulse"
                                            style={{
                                                animation: 'dash 1.5s linear infinite',
                                                strokeDashoffset: 0
                                            }}
                                        />
                                    </svg>
                                )}
                            </div>
                            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                Click on boxes to highlight corresponding items
                            </p>

                            {/* Confidence legend */}
                            <div className="mt-3 flex items-center gap-4 text-xs">
                                <span className="text-gray-600 dark:text-gray-400 font-medium">Confidence:</span>
                                <div className="flex items-center gap-1">
                                    <div className="w-3 h-3 rounded-full bg-green-500"></div>
                                    <span className="text-gray-600 dark:text-gray-400">High (&gt;90%)</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                                    <span className="text-gray-600 dark:text-gray-400">Medium (70-90%)</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <div className="w-3 h-3 rounded-full bg-red-500"></div>
                                    <span className="text-gray-600 dark:text-gray-400">Low (&lt;70%)</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Items List */}
            <div className="lg:w-1/2">
                <div className="flex justify-between items-center mb-3">
                    <h3 className="text-lg font-semibold dark:text-gray-100">
                        Detected Items ({items.length})
                    </h3>
                </div>

                {items.length === 0 && (
                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                        <p>No items detected.</p>
                        <p className="text-sm mt-1">Draw boxes on the receipt to extract items.</p>
                    </div>
                )}

                <div ref={itemListRef} className="space-y-3 max-h-[600px] overflow-y-auto">
                    {sortedItems.map((item, idx) => {
                        const isSelected = item.region_id === selectedRegionId;
                        const isHovered = item.region_id === hoveredItemId;
                        const itemNumber = idx + 1;
                        const confidenceColor = getConfidenceColor(item.confidence);
                        const hasSelection = selectedRegionId !== null;

                        return (
                            <div
                                key={item.region_id}
                                ref={(el) => {
                                    if (el) itemRefs.current.set(item.region_id, el);
                                }}
                                onClick={() => handleItemClick(item.region_id)}
                                onMouseEnter={() => handleItemHover(item.region_id)}
                                onMouseLeave={() => handleItemHover(null)}
                                className={`p-4 rounded-lg border-2 cursor-pointer transition-all duration-300 ${
                                    isSelected
                                        ? 'border-teal-500 dark:border-teal-600 bg-teal-50 dark:bg-teal-900/20 shadow-lg scale-105 animate-pulse'
                                        : isHovered
                                        ? 'border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-md scale-102'
                                        : hasSelection
                                        ? 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 opacity-40 hover:opacity-60'
                                        : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-500 hover:shadow-md'
                                }`}
                                style={{
                                    borderLeftWidth: '4px',
                                    borderLeftColor: confidenceColor.border
                                }}
                            >
                                <div>
                                    {/* Region Image Preview - Now at the top */}
                                    <div className="mb-3">
                                        {regionImages.get(item.region_id) ? (
                                            <div className="relative overflow-hidden rounded-lg border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2">
                                                <img
                                                    src={regionImages.get(item.region_id)}
                                                    alt=""
                                                    className="w-full h-auto max-h-20 object-contain"
                                                    style={{
                                                        imageRendering: 'auto',
                                                        filter: isSelected ? 'contrast(1.1)' : isHovered ? 'brightness(1.05)' : 'brightness(0.98) contrast(1.05)'
                                                    }}
                                                />
                                            </div>
                                        ) : (
                                            <div className="w-full h-20 flex items-center justify-center rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800">
                                                <span className="text-xs text-gray-400 dark:text-gray-500">No image</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Item details below the image */}
                                    <div className="flex items-start gap-3">
                                        {/* Item Number Badge */}
                                        <div className={`flex-shrink-0 w-8 h-8 rounded flex items-center justify-center text-white font-bold transition-all ${
                                            isSelected ? 'bg-teal-500 shadow-md' : 'bg-gray-700 dark:bg-gray-600'
                                        }`}>
                                            {itemNumber}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            {/* Description */}
                                            {editingItemId === item.region_id ? (
                                                <input
                                                    type="text"
                                                    value={tempEditValues?.description || ''}
                                                    onChange={(e) => handleDescriptionChange(e.target.value)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="w-full px-2 py-1 mb-2 text-sm font-medium border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
                                                    placeholder="Item description"
                                                    autoFocus
                                                />
                                            ) : (
                                                <p className="font-medium text-gray-900 dark:text-gray-100 mb-1">
                                                    {item.description || '(No description)'}
                                                </p>
                                            )}

                                            <div className="flex items-center gap-3 flex-wrap">
                                                {/* Price */}
                                            {editingItemId === item.region_id ? (
                                                <div className="flex items-center gap-1">
                                                    <span className="text-sm text-gray-600 dark:text-gray-400">$</span>
                                                    <input
                                                        type="text"
                                                        value={tempEditValues?.price || ''}
                                                        onChange={(e) => handlePriceChange(e.target.value)}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="w-20 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
                                                    />
                                                </div>
                                            ) : (
                                                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                                    {formatMoney(item.price, currency)}
                                                </span>
                                            )}

                                            {/* Tax/Tip Checkbox */}
                                            {editingItemId === item.region_id && (
                                                <label
                                                    className="flex items-center gap-1.5 cursor-pointer"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={item.is_tax_tip}
                                                        onChange={() => handleTaxTipToggle(item.region_id)}
                                                        className="w-4 h-4 text-teal-600 border-gray-300 rounded focus:ring-teal-500"
                                                    />
                                                    <span className="text-xs text-gray-600 dark:text-gray-400">
                                                        Tax/Tip
                                                    </span>
                                                </label>
                                            )}

                                            {/* Confidence Badge */}
                                            {item.confidence !== undefined && (
                                                <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700">
                                                    <div
                                                        className="w-2 h-2 rounded-full"
                                                        style={{ backgroundColor: confidenceColor.border }}
                                                    ></div>
                                                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                                        {Math.round(item.confidence * 100)}%
                                                    </span>
                                                </div>
                                            )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex-shrink-0 flex items-center gap-2">
                                        {editingItemId === item.region_id ? (
                                            <>
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleEditSave();
                                                    }}
                                                    className="p-1.5 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-900/20 rounded"
                                                    title="Save changes"
                                                >
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                    </svg>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleEditCancel();
                                                    }}
                                                    className="p-1.5 text-gray-600 hover:text-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 rounded"
                                                    title="Cancel editing"
                                                >
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleRemoveItem(item.region_id);
                                                    }}
                                                    className="p-1.5 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                                                    title="Delete item"
                                                >
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                </button>
                                            </>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleEditStart(item.region_id);
                                                }}
                                                className="p-1.5 text-gray-600 hover:text-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 rounded"
                                                title="Edit item"
                                            >
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                </svg>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Total */}
                {items.length > 0 && (
                    <div className="mt-6 pt-4 border-t border-gray-300 dark:border-gray-600">
                        <div className="flex justify-between items-center">
                            <span className="text-lg font-semibold dark:text-gray-100">
                                Total
                            </span>
                            <span className="text-xl font-bold text-teal-600 dark:text-teal-400">
                                {formatMoney(total, currency)}
                            </span>
                        </div>
                        {items.some(i => i.is_tax_tip) && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                                Items marked as tax/tip will be distributed proportionally when splitting
                            </p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ItemPreviewEditor;
