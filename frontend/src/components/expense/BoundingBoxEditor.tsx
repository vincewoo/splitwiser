import React, { useRef, useState, useEffect, useCallback } from 'react';

export interface BoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
    label?: string;
}

interface BoundingBoxEditorProps {
    imageUrl: string;
    initialRegions: BoundingBox[];
    onChange: (regions: BoundingBox[]) => void;
}

type DragMode = 'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br' | 'create' | 'none';

interface DragState {
    mode: DragMode;
    boxIndex: number;
    startX: number;
    startY: number;
    originalBox: BoundingBox;
    isCreating?: boolean;
}

interface TouchState {
    type: 'none' | 'single' | 'pinch' | 'pan';
    boxIndex: number | null;
    startDistance: number;
    startBox: BoundingBox | null;
    touches: { id: number; x: number; y: number }[];
    startTime: number;
    startScale?: number;
    // New fields for correct pinch-to-zoom
    startScreenDistance?: number;
    startScreenCenter?: { x: number; y: number };
    startPanOffset?: { x: number; y: number };
}

interface PanState {
    offsetX: number;
    offsetY: number;
    scale: number;
}

// Increased handle size for mobile (44x44px minimum touch target)
const HANDLE_SIZE = 20;
const MOBILE_HANDLE_SIZE = 44;
const BOX_COLOR = 'rgba(59, 130, 246, 0.3)'; // Blue with transparency
const BOX_BORDER_COLOR = 'rgba(59, 130, 246, 0.8)';
const SELECTED_BOX_COLOR = 'rgba(16, 185, 129, 0.3)'; // Teal with transparency
const SELECTED_BORDER_COLOR = 'rgba(16, 185, 129, 1)';
const LONG_PRESS_DURATION = 500; // 500ms for long press

const BoundingBoxEditor: React.FC<BoundingBoxEditorProps> = ({
    imageUrl,
    initialRegions,
    onChange
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);

    const [regions, setRegions] = useState<BoundingBox[]>(initialRegions);
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    const [dragState, setDragState] = useState<DragState | null>(null);
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
    const [touchState, setTouchState] = useState<TouchState>({
        type: 'none',
        boxIndex: null,
        startDistance: 0,
        startBox: null,
        touches: [],
        startTime: 0,
        startScale: 1
    });
    const [panState, setPanState] = useState<PanState>({
        offsetX: 0,
        offsetY: 0,
        scale: 1
    });
    const [isMobile, setIsMobile] = useState(false);
    const [showInstructions, setShowInstructions] = useState(true);
    const [longPressTimer, setLongPressTimer] = useState<number | null>(null);
    const [isLongPressing, setIsLongPressing] = useState(false);

    // Detect mobile device
    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.matchMedia('(max-width: 768px) or (hover: none)').matches);
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    // Update regions when initialRegions change
    useEffect(() => {
        setRegions(initialRegions);
    }, [initialRegions]);

    // Load image and set up canvas
    useEffect(() => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            imageRef.current = img;
            setImageDimensions({ width: img.width, height: img.height });
            setImageLoaded(true);
        };
        img.onerror = () => {
            console.error('Failed to load image:', imageUrl);
            alert('Failed to load receipt image');
        };
        img.src = imageUrl;
    }, [imageUrl]);

    // Draw canvas when regions or selection changes
    useEffect(() => {
        if (!imageLoaded || !canvasRef.current || !imageRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Apply pan and zoom transformations
        ctx.save();
        ctx.translate(panState.offsetX, panState.offsetY);
        ctx.scale(panState.scale, panState.scale);

        // Draw image
        ctx.drawImage(imageRef.current, 0, 0, canvas.width, canvas.height);

        // Draw all bounding boxes
        regions.forEach((box, idx) => {
            const isSelected = idx === selectedIndex;
            const boxColor = isSelected ? SELECTED_BOX_COLOR : BOX_COLOR;
            const borderColor = isSelected ? SELECTED_BORDER_COLOR : BOX_BORDER_COLOR;

            // Draw box with pulsing effect if long pressing
            if (isLongPressing && isSelected) {
                ctx.fillStyle = 'rgba(239, 68, 68, 0.4)'; // Red color for delete indication
            } else {
                ctx.fillStyle = boxColor;
            }
            ctx.fillRect(box.x, box.y, box.width, box.height);

            // Draw border with increased width for selected on mobile
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = isSelected && isMobile ? 4 : 2;
            ctx.strokeRect(box.x, box.y, box.width, box.height);

            // Draw label
            if (box.label) {
                const labelSize = isMobile ? 28 : 24;
                const labelPadding = isMobile ? 8 : 6;

                ctx.font = `bold ${labelSize}px sans-serif`;
                const textMetrics = ctx.measureText(box.label);
                const labelWidth = textMetrics.width + labelPadding * 2;
                const labelHeight = labelSize + labelPadding * 2;

                // Draw label background
                ctx.fillStyle = borderColor;
                ctx.fillRect(box.x, box.y - labelHeight, labelWidth, labelHeight);

                // Draw label text
                ctx.fillStyle = 'white';
                ctx.textBaseline = 'middle';
                ctx.fillText(box.label, box.x + labelPadding, box.y - labelHeight / 2);
            }

            // Draw resize handles if selected
            if (isSelected) {
                ctx.fillStyle = SELECTED_BORDER_COLOR;
                const handleSize = isMobile ? MOBILE_HANDLE_SIZE : HANDLE_SIZE;
                const handles = [
                    { x: box.x, y: box.y }, // top-left
                    { x: box.x + box.width, y: box.y }, // top-right
                    { x: box.x, y: box.y + box.height }, // bottom-left
                    { x: box.x + box.width, y: box.y + box.height }, // bottom-right
                ];
                handles.forEach(handle => {
                    // Draw outer circle for better visibility on mobile
                    if (isMobile) {
                        ctx.beginPath();
                        ctx.arc(handle.x, handle.y, handleSize / 2, 0, 2 * Math.PI);
                        ctx.fillStyle = 'white';
                        ctx.fill();
                        ctx.strokeStyle = SELECTED_BORDER_COLOR;
                        ctx.lineWidth = 3;
                        ctx.stroke();

                        // Draw inner circle
                        ctx.beginPath();
                        ctx.arc(handle.x, handle.y, handleSize / 4, 0, 2 * Math.PI);
                        ctx.fillStyle = SELECTED_BORDER_COLOR;
                        ctx.fill();
                    } else {
                        ctx.fillRect(
                            handle.x - handleSize / 2,
                            handle.y - handleSize / 2,
                            handleSize,
                            handleSize
                        );
                    }
                });
            }
        });

        ctx.restore();
    }, [regions, selectedIndex, imageLoaded, panState, isMobile, isLongPressing]);

    // Get raw canvas coordinates (accounting for CSS scaling but NOT pan/zoom)
    const getRawCanvasCoordinates = useCallback((clientX: number, clientY: number) => {
        if (!canvasRef.current) return { x: 0, y: 0 };
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();

        // Account for CSS scaling of the canvas
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    }, []);

    // Get canvas coordinates from event (accounting for CSS scaling, pan and zoom)
    const getCanvasCoordinates = useCallback((clientX: number, clientY: number) => {
        const raw = getRawCanvasCoordinates(clientX, clientY);

        // Reverse the pan and zoom transformations
        return {
            x: (raw.x - panState.offsetX) / panState.scale,
            y: (raw.y - panState.offsetY) / panState.scale
        };
    }, [panState, getRawCanvasCoordinates]);

    // Check if point is in resize handle
    const getResizeHandle = useCallback((x: number, y: number, box: BoundingBox): DragMode => {
        const handleSize = isMobile ? MOBILE_HANDLE_SIZE : HANDLE_SIZE;
        const handles = [
            { x: box.x, y: box.y, mode: 'resize-tl' as DragMode },
            { x: box.x + box.width, y: box.y, mode: 'resize-tr' as DragMode },
            { x: box.x, y: box.y + box.height, mode: 'resize-bl' as DragMode },
            { x: box.x + box.width, y: box.y + box.height, mode: 'resize-br' as DragMode },
        ];

        for (const handle of handles) {
            const distance = Math.sqrt(
                Math.pow(x - handle.x, 2) + Math.pow(y - handle.y, 2)
            );
            if (distance <= handleSize) {
                return handle.mode;
            }
        }
        return 'none';
    }, [isMobile]);

    // Calculate distance between two touch points
    const getTouchDistance = useCallback((touch1: { x: number; y: number }, touch2: { x: number; y: number }) => {
        return Math.sqrt(
            Math.pow(touch2.x - touch1.x, 2) + Math.pow(touch2.y - touch1.y, 2)
        );
    }, []);

    // Clear long press timer
    const clearLongPress = useCallback(() => {
        if (longPressTimer !== null) {
            window.clearTimeout(longPressTimer);
            setLongPressTimer(null);
        }
        setIsLongPressing(false);
    }, [longPressTimer]);

    // Check if point is in box
    const findBoxAtPoint = useCallback((x: number, y: number): number => {
        // Check in reverse order so top boxes are selected first
        for (let i = regions.length - 1; i >= 0; i--) {
            const box = regions[i];
            if (x >= box.x && x <= box.x + box.width &&
                y >= box.y && y <= box.y + box.height) {
                return i;
            }
        }
        return -1;
    }, [regions]);

    // Handle mouse down
    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const { x, y } = getCanvasCoordinates(e.clientX, e.clientY);

        // Check if clicking on a box
        const boxIndex = findBoxAtPoint(x, y);

        if (boxIndex !== -1) {
            // Clicking on a box - delete it immediately
            const newRegions = regions.filter((_, idx) => idx !== boxIndex);
            // Renumber labels and clear any stored metadata
            newRegions.forEach((box, idx) => {
                box.label = String(idx + 1);
                // Clear any normalized coordinates since the array has changed
                delete (box as any).normalized_x;
                delete (box as any).normalized_y;
                delete (box as any).normalized_width;
                delete (box as any).normalized_height;
            });
            setRegions(newRegions);
            setSelectedIndex(null);
            onChange(newRegions);
        } else {
            // Clicking on empty space - start creating a new box
            const newBox: BoundingBox = {
                x: x,
                y: y,
                width: 0,
                height: 0,
                label: String(regions.length + 1)
            };

            setDragState({
                mode: 'create',
                boxIndex: regions.length,
                startX: x,
                startY: y,
                originalBox: newBox,
                isCreating: true
            });
        }
    }, [regions, getCanvasCoordinates, findBoxAtPoint, onChange]);

    // Handle mouse move
    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!dragState) return;

        const { x, y } = getCanvasCoordinates(e.clientX, e.clientY);

        if (dragState.mode === 'create') {
            // Creating a new box
            const newBox: BoundingBox = {
                x: Math.min(dragState.startX, x),
                y: Math.min(dragState.startY, y),
                width: Math.abs(x - dragState.startX),
                height: Math.abs(y - dragState.startY),
                label: String(dragState.boxIndex + 1)
            };

            // Update the temporary box while dragging
            const newRegions = [...regions];
            // If this is the first move, add the box to the regions
            if (dragState.isCreating) {
                newRegions.push(newBox);
                setDragState({ ...dragState, isCreating: false });
            } else {
                // Update existing temporary box
                newRegions[dragState.boxIndex] = newBox;
            }

            setRegions(newRegions);
            onChange(newRegions);
        } else {
            const dx = x - dragState.startX;
            const dy = y - dragState.startY;

            const newRegions = [...regions];
            const box = { ...dragState.originalBox };

            if (dragState.mode === 'move') {
                box.x = Math.max(0, Math.min(imageDimensions.width - box.width, dragState.originalBox.x + dx));
                box.y = Math.max(0, Math.min(imageDimensions.height - box.height, dragState.originalBox.y + dy));
            } else if (dragState.mode.startsWith('resize-')) {
                // Handle resize
                const isLeft = dragState.mode.includes('l');
                const isTop = dragState.mode.includes('t');

                if (isLeft) {
                    const newX = Math.max(0, dragState.originalBox.x + dx);
                    const newWidth = dragState.originalBox.width - (newX - dragState.originalBox.x);
                    if (newWidth > 10) {
                        box.x = newX;
                        box.width = newWidth;
                    }
                } else {
                    box.width = Math.max(10, dragState.originalBox.width + dx);
                }

                if (isTop) {
                    const newY = Math.max(0, dragState.originalBox.y + dy);
                    const newHeight = dragState.originalBox.height - (newY - dragState.originalBox.y);
                    if (newHeight > 10) {
                        box.y = newY;
                        box.height = newHeight;
                    }
                } else {
                    box.height = Math.max(10, dragState.originalBox.height + dy);
                }
            }

            newRegions[dragState.boxIndex] = box;
            setRegions(newRegions);
            onChange(newRegions);
        }
    }, [dragState, regions, getCanvasCoordinates, imageDimensions, onChange]);

    // Handle mouse up
    const handleMouseUp = useCallback(() => {
        // If we were creating a box, remove it if it's too small
        if (dragState && dragState.mode === 'create') {
            const lastBox = regions[regions.length - 1];
            if (lastBox && (lastBox.width < 10 || lastBox.height < 10)) {
                // Remove the too-small box
                const newRegions = regions.slice(0, -1);
                setRegions(newRegions);
                onChange(newRegions);
            }
        }
        setDragState(null);
    }, [dragState, regions, onChange]);

    // Disabled double-click since we now use drag to create

    // Keyboard delete disabled - using click-to-delete instead

    // Enhanced touch event handlers
    const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
        e.preventDefault();

        const touches = Array.from(e.touches).map(t => {
            const coords = getCanvasCoordinates(t.clientX, t.clientY);
            return { id: t.identifier, x: coords.x, y: coords.y };
        });

        if (e.touches.length === 1) {
            // Single touch - start long press timer for delete
            const touch = touches[0];
            const boxIndex = findBoxAtPoint(touch.x, touch.y);

            if (boxIndex !== -1) {
                setSelectedIndex(boxIndex);

                // Start long press timer
                const timer = window.setTimeout(() => {
                    setIsLongPressing(true);
                    // Vibrate if supported
                    if (navigator.vibrate) {
                        navigator.vibrate(100);
                    }
                }, LONG_PRESS_DURATION);
                setLongPressTimer(timer);

                // Check for resize handle
                const resizeMode = getResizeHandle(touch.x, touch.y, regions[boxIndex]);
                if (resizeMode !== 'none') {
                    setDragState({
                        mode: resizeMode,
                        boxIndex,
                        startX: touch.x,
                        startY: touch.y,
                        originalBox: { ...regions[boxIndex] }
                    });
                    setTouchState({
                        type: 'single',
                        boxIndex,
                        startDistance: 0,
                        startBox: { ...regions[boxIndex] },
                        touches,
                        startTime: Date.now()
                    });
                } else {
                    // Start move
                    setDragState({
                        mode: 'move',
                        boxIndex,
                        startX: touch.x,
                        startY: touch.y,
                        originalBox: { ...regions[boxIndex] }
                    });
                    setTouchState({
                        type: 'single',
                        boxIndex,
                        startDistance: 0,
                        startBox: { ...regions[boxIndex] },
                        touches,
                        startTime: Date.now()
                    });
                }
            } else {
                // Touching on empty space - start creating a new box (same as mouse behavior)
                setSelectedIndex(null);
                const newBox: BoundingBox = {
                    x: touch.x,
                    y: touch.y,
                    width: 0,
                    height: 0,
                    label: String(regions.length + 1)
                };

                setDragState({
                    mode: 'create',
                    boxIndex: regions.length,
                    startX: touch.x,
                    startY: touch.y,
                    originalBox: newBox,
                    isCreating: true
                });
                setTouchState({
                    type: 'single',
                    boxIndex: null,
                    startDistance: 0,
                    startBox: null,
                    touches,
                    startTime: Date.now()
                });
            }
        } else if (e.touches.length === 2) {
            // Two-finger touch
            clearLongPress();

            const touch1 = touches[0];
            const touch2 = touches[1];
            const distance = getTouchDistance(touch1, touch2);

            // Check if both touches are on the selected box
            if (selectedIndex !== null && selectedIndex >= 0) {
                const box = regions[selectedIndex];
                const box1 = findBoxAtPoint(touch1.x, touch1.y);
                const box2 = findBoxAtPoint(touch2.x, touch2.y);

                if (box1 === selectedIndex && box2 === selectedIndex) {
                    // Pinch to resize
                    setTouchState({
                        type: 'pinch',
                        boxIndex: selectedIndex,
                        startDistance: distance,
                        startBox: { ...box },
                        touches,
                        startTime: Date.now()
                    });
                    return;
                }
            }

            // Otherwise, pan/zoom the image
            const rawTouch1 = getRawCanvasCoordinates(e.touches[0].clientX, e.touches[0].clientY);
            const rawTouch2 = getRawCanvasCoordinates(e.touches[1].clientX, e.touches[1].clientY);
            const startScreenDistance = getTouchDistance(rawTouch1, rawTouch2);
            const startScreenCenter = {
                x: (rawTouch1.x + rawTouch2.x) / 2,
                y: (rawTouch1.y + rawTouch2.y) / 2
            };

            setTouchState({
                type: 'pan',
                boxIndex: null,
                startDistance: distance,
                startBox: null,
                touches,
                startTime: Date.now(),
                startScale: panState.scale,
                startScreenDistance,
                startScreenCenter,
                startPanOffset: { x: panState.offsetX, y: panState.offsetY }
            });
        }
    }, [getCanvasCoordinates, findBoxAtPoint, getResizeHandle, regions, selectedIndex, getTouchDistance, clearLongPress, panState.scale, panState.offsetX, panState.offsetY, getRawCanvasCoordinates]);

    const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
        e.preventDefault();

        const touches = Array.from(e.touches).map(t => {
            const coords = getCanvasCoordinates(t.clientX, t.clientY);
            return { id: t.identifier, x: coords.x, y: coords.y };
        });

        // Clear long press if movement detected
        if (touchState.type === 'single' && touchState.touches.length > 0) {
            const dx = touches[0].x - touchState.touches[0].x;
            const dy = touches[0].y - touchState.touches[0].y;
            const movement = Math.sqrt(dx * dx + dy * dy);
            if (movement > 5) {
                clearLongPress();
            }
        }

        if (touchState.type === 'single' && dragState) {
            if (dragState.mode === 'create') {
                // Creating a new box via touch
                const newBox: BoundingBox = {
                    x: Math.min(dragState.startX, touches[0].x),
                    y: Math.min(dragState.startY, touches[0].y),
                    width: Math.abs(touches[0].x - dragState.startX),
                    height: Math.abs(touches[0].y - dragState.startY),
                    label: String(dragState.boxIndex + 1)
                };

                const newRegions = [...regions];
                if (dragState.isCreating) {
                    newRegions.push(newBox);
                    setDragState({ ...dragState, isCreating: false });
                } else {
                    newRegions[dragState.boxIndex] = newBox;
                }
                setRegions(newRegions);
                onChange(newRegions);
            } else {
                // Single touch move/resize
                const touch = touches[0];
                const dx = touch.x - dragState.startX;
                const dy = touch.y - dragState.startY;

                const newRegions = [...regions];
                const box = { ...dragState.originalBox };

                if (dragState.mode === 'move') {
                    box.x = Math.max(0, Math.min(imageDimensions.width - box.width, dragState.originalBox.x + dx));
                    box.y = Math.max(0, Math.min(imageDimensions.height - box.height, dragState.originalBox.y + dy));
                } else if (dragState.mode.startsWith('resize-')) {
                    const isLeft = dragState.mode.includes('l');
                    const isTop = dragState.mode.includes('t');

                    if (isLeft) {
                        const newX = Math.max(0, dragState.originalBox.x + dx);
                        const newWidth = dragState.originalBox.width - (newX - dragState.originalBox.x);
                        if (newWidth > 10) {
                            box.x = newX;
                            box.width = newWidth;
                        }
                    } else {
                        box.width = Math.max(10, dragState.originalBox.width + dx);
                    }

                    if (isTop) {
                        const newY = Math.max(0, dragState.originalBox.y + dy);
                        const newHeight = dragState.originalBox.height - (newY - dragState.originalBox.y);
                        if (newHeight > 10) {
                            box.y = newY;
                            box.height = newHeight;
                        }
                    } else {
                        box.height = Math.max(10, dragState.originalBox.height + dy);
                    }
                }

                newRegions[dragState.boxIndex] = box;
                setRegions(newRegions);
                onChange(newRegions);
            }
        } else if (touchState.type === 'pinch' && e.touches.length === 2 && touchState.startBox) {
            // Pinch to resize
            const touch1 = touches[0];
            const touch2 = touches[1];
            const currentDistance = getTouchDistance(touch1, touch2);
            const scale = currentDistance / touchState.startDistance;

            const newRegions = [...regions];
            const box = { ...touchState.startBox };

            // Scale from center
            const centerX = box.x + box.width / 2;
            const centerY = box.y + box.height / 2;

            box.width = Math.max(20, touchState.startBox.width * scale);
            box.height = Math.max(20, touchState.startBox.height * scale);
            box.x = centerX - box.width / 2;
            box.y = centerY - box.height / 2;

            // Keep within bounds
            box.x = Math.max(0, Math.min(imageDimensions.width - box.width, box.x));
            box.y = Math.max(0, Math.min(imageDimensions.height - box.height, box.y));

            newRegions[touchState.boxIndex!] = box;
            setRegions(newRegions);
            onChange(newRegions);
        } else if (touchState.type === 'pan' && e.touches.length === 2) {
            // Two-finger pan and zoom with zoom centering
            if (touchState.startScreenDistance && touchState.startScreenCenter && touchState.startPanOffset && touchState.startScale) {
                const rawTouch1 = getRawCanvasCoordinates(e.touches[0].clientX, e.touches[0].clientY);
                const rawTouch2 = getRawCanvasCoordinates(e.touches[1].clientX, e.touches[1].clientY);

                const currentScreenDistance = getTouchDistance(rawTouch1, rawTouch2);
                const currentScreenCenter = {
                    x: (rawTouch1.x + rawTouch2.x) / 2,
                    y: (rawTouch1.y + rawTouch2.y) / 2
                };

                // Calculate new scale
                const zoomScale = currentScreenDistance / touchState.startScreenDistance;
                const newScale = Math.max(0.5, Math.min(3, touchState.startScale * zoomScale));

                // Calculate new pan offset to keep the zoom centered around the pinch point
                // Formula: newOffset = currentCenter - (pointInImage * newScale)
                // pointInImage = (startCenter - startOffset) / startScale
                const pointInImageX = (touchState.startScreenCenter.x - touchState.startPanOffset.x) / touchState.startScale;
                const pointInImageY = (touchState.startScreenCenter.y - touchState.startPanOffset.y) / touchState.startScale;

                const newOffsetX = currentScreenCenter.x - (pointInImageX * newScale);
                const newOffsetY = currentScreenCenter.y - (pointInImageY * newScale);

                setPanState({
                    offsetX: newOffsetX,
                    offsetY: newOffsetY,
                    scale: newScale
                });

                // Update touch state touches (keep mostly for consistency, though we use raw coords here)
                setTouchState(prev => ({
                    ...prev,
                    touches
                }));
            }
        }
    }, [touchState, dragState, regions, getCanvasCoordinates, getTouchDistance, imageDimensions, onChange, panState, clearLongPress, getRawCanvasCoordinates]);

    const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
        e.preventDefault();

        // If we were creating a box, remove it if it's too small
        if (dragState && dragState.mode === 'create') {
            const lastBox = regions[regions.length - 1];
            if (lastBox && (lastBox.width < 10 || lastBox.height < 10)) {
                const newRegions = regions.slice(0, -1);
                setRegions(newRegions);
                onChange(newRegions);
            }
        }

        // Check if long press completed
        if (isLongPressing && selectedIndex !== null) {
            // Delete the box
            const newRegions = regions.filter((_, idx) => idx !== selectedIndex);
            // Renumber labels
            newRegions.forEach((box, idx) => {
                box.label = String(idx + 1);
            });
            setRegions(newRegions);
            setSelectedIndex(null);
            onChange(newRegions);

            // Vibrate for confirmation
            if (navigator.vibrate) {
                navigator.vibrate(200);
            }
        }

        clearLongPress();
        setDragState(null);

        if (e.touches.length === 0) {
            setTouchState({
                type: 'none',
                boxIndex: null,
                startDistance: 0,
                startBox: null,
                touches: [],
                startTime: 0
            });
        }
    }, [isLongPressing, selectedIndex, regions, onChange, clearLongPress]);

    return (
        <div ref={containerRef} className="relative w-full">
            {!imageLoaded && (
                <div className="flex items-center justify-center h-64 bg-gray-100 dark:bg-gray-700">
                    <p className="text-gray-500 dark:text-gray-400">Loading image...</p>
                </div>
            )}
            {imageLoaded && (
                <>
                    <canvas
                        ref={canvasRef}
                        width={imageDimensions.width}
                        height={imageDimensions.height}
                        className="w-full h-auto border border-gray-300 dark:border-gray-600 rounded cursor-crosshair touch-none"
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                        onTouchStart={handleTouchStart}
                        onTouchMove={handleTouchMove}
                        onTouchEnd={handleTouchEnd}
                    />

                    {/* Mobile instructions overlay */}
                    {isMobile && showInstructions && (
                        <div className="absolute top-2 left-2 right-2 bg-black bg-opacity-75 text-white text-xs p-3 rounded-lg">
                            <button
                                onClick={() => setShowInstructions(false)}
                                className="absolute top-1 right-1 text-white hover:text-gray-300 text-lg font-bold w-6 h-6 flex items-center justify-center"
                            >
                                ×
                            </button>
                            <p className="font-bold mb-1">Touch Controls:</p>
                            <p>• Tap blue box to delete</p>
                            <p>• Drag on empty space to create box</p>
                            <p>• Pinch box with 2 fingers to resize</p>
                            <p>• 2-finger drag to pan image</p>
                        </div>
                    )}

                    {/* Long press indicator */}
                    {isLongPressing && (
                        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-red-500 text-white px-4 py-2 rounded-full shadow-lg animate-pulse">
                            Release to delete
                        </div>
                    )}

                    {/* Mobile delete button as alternative */}
                    {isMobile && selectedIndex !== null && !isLongPressing && (
                        <button
                            onClick={() => {
                                const newRegions = regions.filter((_, idx) => idx !== selectedIndex);
                                newRegions.forEach((box, idx) => {
                                    box.label = String(idx + 1);
                                });
                                setRegions(newRegions);
                                setSelectedIndex(null);
                                onChange(newRegions);
                            }}
                            className="absolute bottom-4 right-4 bg-red-500 hover:bg-red-600 text-white w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-2xl font-bold"
                        >
                            🗑
                        </button>
                    )}

                    {/* Show instructions toggle for mobile */}
                    {isMobile && !showInstructions && (
                        <button
                            onClick={() => setShowInstructions(true)}
                            className="absolute top-2 right-2 bg-blue-500 hover:bg-blue-600 text-white w-8 h-8 rounded-full shadow-lg flex items-center justify-center text-lg font-bold"
                        >
                            ?
                        </button>
                    )}
                </>
            )}
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                {isMobile ? (
                    <>
                        <p>• Tap a blue box to delete it</p>
                        <p>• Drag on empty space to create new box</p>
                        <p>• Use 2 fingers to pinch resize or pan</p>
                    </>
                ) : (
                    <>
                        <p>• Click a blue box to delete it</p>
                        <p>• Drag on empty space to create new box</p>
                    </>
                )}
            </div>
        </div>
    );
};

export default BoundingBoxEditor;
