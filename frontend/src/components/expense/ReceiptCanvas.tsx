import React, { useRef, useEffect, useState, useCallback } from 'react';

export interface BoundingBox {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    label: number;
}

interface ReceiptCanvasProps {
    imageUrl: string;
    boxes: BoundingBox[];
    selectedBoxId: string | null;
    onBoxClick: (id: string) => void;
    onCanvasClick: (x: number, y: number) => void;
    width: number;
    height: number;
}

interface TouchState {
    startTime: number;
    startX: number;
    startY: number;
    touches: number;
}

const MOBILE_HANDLE_SIZE = 44;
const DESKTOP_HANDLE_SIZE = 8;
const LONG_PRESS_DURATION = 500;

const ReceiptCanvas: React.FC<ReceiptCanvasProps> = ({
    imageUrl,
    boxes,
    selectedBoxId,
    onBoxClick,
    onCanvasClick,
    width,
    height
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imageRef = useRef<HTMLImageElement | null>(null);
    const [hoveredBoxId, setHoveredBoxId] = useState<string | null>(null);
    const [isMobile, setIsMobile] = useState(false);
    const [touchState, setTouchState] = useState<TouchState | null>(null);
    const [longPressTimer, setLongPressTimer] = useState<number | null>(null);

    // Detect mobile device
    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.matchMedia('(max-width: 768px) or (hover: none)').matches);
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    const drawResizeHandles = useCallback((ctx: CanvasRenderingContext2D, box: BoundingBox) => {
        const handleSize = isMobile ? MOBILE_HANDLE_SIZE : DESKTOP_HANDLE_SIZE;
        const handles = [
            { x: box.x, y: box.y }, // nw
            { x: box.x + box.width / 2, y: box.y }, // n
            { x: box.x + box.width, y: box.y }, // ne
            { x: box.x + box.width, y: box.y + box.height / 2 }, // e
            { x: box.x + box.width, y: box.y + box.height }, // se
            { x: box.x + box.width / 2, y: box.y + box.height }, // s
            { x: box.x, y: box.y + box.height }, // sw
            { x: box.x, y: box.y + box.height / 2 }, // w
        ];

        handles.forEach(handle => {
            if (isMobile) {
                // Draw circular handles for mobile with better visibility
                ctx.beginPath();
                ctx.arc(handle.x, handle.y, handleSize / 2, 0, 2 * Math.PI);
                ctx.fillStyle = 'white';
                ctx.fill();
                ctx.strokeStyle = '#0d9488';
                ctx.lineWidth = 3;
                ctx.stroke();

                // Inner dot
                ctx.beginPath();
                ctx.arc(handle.x, handle.y, handleSize / 4, 0, 2 * Math.PI);
                ctx.fillStyle = '#0d9488';
                ctx.fill();
            } else {
                ctx.fillStyle = '#0d9488';
                ctx.fillRect(
                    handle.x - handleSize / 2,
                    handle.y - handleSize / 2,
                    handleSize,
                    handleSize
                );
            }
        });
    }, [isMobile]);

    const drawCanvas = useCallback((ctx: CanvasRenderingContext2D) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw image if loaded
        if (imageRef.current) {
            ctx.drawImage(imageRef.current, 0, 0, canvas.width, canvas.height);
        }

        // Draw boxes
        boxes.forEach(box => {
            const isSelected = box.id === selectedBoxId;
            const isHovered = box.id === hoveredBoxId;

            // Box styling with enhanced visibility on mobile
            ctx.strokeStyle = isSelected ? '#0d9488' : '#3b82f6';
            ctx.lineWidth = isSelected && isMobile ? 4 : isSelected ? 3 : 2;
            ctx.fillStyle = isHovered ? 'rgba(59, 130, 246, 0.2)' : 'rgba(59, 130, 246, 0.15)';

            // Draw filled box
            ctx.fillRect(box.x, box.y, box.width, box.height);

            // Draw border
            ctx.strokeRect(box.x, box.y, box.width, box.height);

            // Draw label with background circle (larger on mobile)
            const labelRadius = isMobile ? 20 : 16;
            const fontSize = isMobile ? 22 : 18;
            const labelX = box.x + box.width / 2;
            const labelY = box.y + box.height / 2;

            // Draw dark background circle
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.beginPath();
            ctx.arc(labelX, labelY, labelRadius, 0, 2 * Math.PI);
            ctx.fill();

            // Draw white text
            ctx.fillStyle = '#ffffff';
            ctx.font = `bold ${fontSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(box.label.toString(), labelX, labelY);

            // Draw resize handles for selected box
            if (isSelected) {
                drawResizeHandles(ctx, box);
            }
        });
    }, [boxes, selectedBoxId, hoveredBoxId, isMobile, drawResizeHandles]);

    // Load and draw image
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Load image
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = imageUrl;

        img.onload = () => {
            imageRef.current = img;
            drawCanvas(ctx);
        };

        img.onerror = () => {
            console.error('Failed to load receipt image');
        };
    }, [imageUrl, drawCanvas]);

    // Redraw when boxes, selection, hover state, or mobile state changes
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        drawCanvas(ctx);
    }, [drawCanvas]);

    const getBoxAtPoint = useCallback((x: number, y: number): BoundingBox | null => {
        // Check boxes in reverse order (top to bottom in stack)
        for (let i = boxes.length - 1; i >= 0; i--) {
            const box = boxes[i];
            if (
                x >= box.x &&
                x <= box.x + box.width &&
                y >= box.y &&
                y <= box.y + box.height
            ) {
                return box;
            }
        }
        return null;
    }, [boxes]);

    const getResizeHandle = useCallback((x: number, y: number, box: BoundingBox): string | null => {
        const handleSize = isMobile ? MOBILE_HANDLE_SIZE : DESKTOP_HANDLE_SIZE;
        const tolerance = handleSize / 2;

        const handles: Array<{ handle: string; hx: number; hy: number }> = [
            { handle: 'nw', hx: box.x, hy: box.y },
            { handle: 'n', hx: box.x + box.width / 2, hy: box.y },
            { handle: 'ne', hx: box.x + box.width, hy: box.y },
            { handle: 'e', hx: box.x + box.width, hy: box.y + box.height / 2 },
            { handle: 'se', hx: box.x + box.width, hy: box.y + box.height },
            { handle: 's', hx: box.x + box.width / 2, hy: box.y + box.height },
            { handle: 'sw', hx: box.x, hy: box.y + box.height },
            { handle: 'w', hx: box.x, hy: box.y + box.height / 2 },
        ];

        for (const { handle, hx, hy } of handles) {
            const distance = Math.sqrt(Math.pow(x - hx, 2) + Math.pow(y - hy, 2));
            if (distance <= tolerance) {
                return handle;
            }
        }

        return null;
    }, [isMobile]);

    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Check if clicking on selected box's resize handle
        if (selectedBoxId) {
            const selectedBox = boxes.find(b => b.id === selectedBoxId);
            if (selectedBox) {
                const handle = getResizeHandle(x, y, selectedBox);
                if (handle) {
                    // TODO: Implement resize functionality
                    return;
                }
            }
        }

        // Check if clicking on a box
        const clickedBox = getBoxAtPoint(x, y);
        if (clickedBox) {
            onBoxClick(clickedBox.id);
        } else {
            onCanvasClick(x, y);
        }
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Update cursor style based on hover
        if (selectedBoxId) {
            const selectedBox = boxes.find(b => b.id === selectedBoxId);
            if (selectedBox) {
                const handle = getResizeHandle(x, y, selectedBox);
                if (handle) {
                    canvas.style.cursor = getCursorForHandle(handle);
                    return;
                }
            }
        }

        const hoveredBox = getBoxAtPoint(x, y);
        canvas.style.cursor = hoveredBox ? 'pointer' : 'default';
        setHoveredBoxId(hoveredBox?.id || null);
    };

    const handleMouseUp = () => {
        // TODO: Complete resize operation
    };

    const handleMouseLeave = () => {
        setHoveredBoxId(null);
    };

    // Clear long press timer
    const clearLongPress = useCallback(() => {
        if (longPressTimer !== null) {
            window.clearTimeout(longPressTimer);
            setLongPressTimer(null);
        }
    }, [longPressTimer]);

    // Enhanced touch event handlers for mobile support
    const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        e.preventDefault();

        const rect = canvas.getBoundingClientRect();
        const touch = e.touches[0];
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;

        // Store touch state
        setTouchState({
            startTime: Date.now(),
            startX: x,
            startY: y,
            touches: e.touches.length
        });

        // Check if touching on selected box's resize handle
        if (selectedBoxId) {
            const selectedBox = boxes.find(b => b.id === selectedBoxId);
            if (selectedBox) {
                const handle = getResizeHandle(x, y, selectedBox);
                if (handle) {
                    // TODO: Implement resize functionality
                    return;
                }
            }
        }

        // Check if touching a box
        const touchedBox = getBoxAtPoint(x, y);
        if (touchedBox) {
            onBoxClick(touchedBox.id);

            // Start long press timer
            const timer = window.setTimeout(() => {
                // Vibrate if supported
                if (navigator.vibrate) {
                    navigator.vibrate(100);
                }
                // Could trigger delete or other action here
            }, LONG_PRESS_DURATION);
            setLongPressTimer(timer);
        } else {
            onCanvasClick(x, y);
        }
    }, [boxes, selectedBoxId, onBoxClick, onCanvasClick, getResizeHandle, getBoxAtPoint]);

    const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
        e.preventDefault();

        if (!touchState) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const touch = e.touches[0];
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;

        // Calculate movement
        const dx = x - touchState.startX;
        const dy = y - touchState.startY;
        const movement = Math.sqrt(dx * dx + dy * dy);

        // Cancel long press if moved more than 10px
        if (movement > 10) {
            clearLongPress();
        }
    }, [touchState, clearLongPress]);

    const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        clearLongPress();
        setTouchState(null);
    }, [clearLongPress]);

    const getCursorForHandle = (handle: string | null): string => {
        const cursors: Record<string, string> = {
            'nw': 'nw-resize',
            'n': 'n-resize',
            'ne': 'ne-resize',
            'e': 'e-resize',
            'se': 'se-resize',
            's': 's-resize',
            'sw': 'sw-resize',
            'w': 'w-resize',
        };
        return handle ? cursors[handle] : 'default';
    };

    return (
        <div className="relative">
            <canvas
                ref={canvasRef}
                width={width}
                height={height}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                className="border border-gray-300 dark:border-gray-600 rounded max-w-full"
                style={{ touchAction: 'none' }}
            />
        </div>
    );
};

export default ReceiptCanvas;
