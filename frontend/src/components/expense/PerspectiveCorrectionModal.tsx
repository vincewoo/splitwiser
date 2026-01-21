import React, { useState, useRef, useEffect, useCallback } from 'react';

interface Point {
  x: number;
  y: number;
}

interface PerspectiveCorrectionModalProps {
  imageUrl: string;
  onApply: (correctedDataUrl: string, correctedFile: File) => void;
  onCancel: () => void;
}

/**
 * Modal for manually selecting 4 corners of a receipt to correct perspective.
 * Uses a canvas-based approach with bilinear interpolation for the transform.
 */
const PerspectiveCorrectionModal: React.FC<PerspectiveCorrectionModalProps> = ({
  imageUrl,
  onApply,
  onCancel
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [corners, setCorners] = useState<Point[]>([]);
  const [selectedCorner, setSelectedCorner] = useState<number | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [scale, setScale] = useState(1);
  const [isProcessing, setIsProcessing] = useState(false);

  // Load image
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      setImageLoaded(true);

      // Initialize corners to image corners (default - no correction)
      const padding = 20;
      setCorners([
        { x: padding, y: padding },                      // Top-left
        { x: img.width - padding, y: padding },          // Top-right
        { x: img.width - padding, y: img.height - padding }, // Bottom-right
        { x: padding, y: img.height - padding }          // Bottom-left
      ]);
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // Draw image and corners on canvas
  useEffect(() => {
    if (!canvasRef.current || !imageRef.current || !imageLoaded) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = imageRef.current;

    // Calculate scale to fit in viewport
    const maxWidth = Math.min(window.innerWidth - 64, 800);
    const maxHeight = window.innerHeight - 250;
    const scaleX = maxWidth / img.width;
    const scaleY = maxHeight / img.height;
    const newScale = Math.min(scaleX, scaleY, 1);
    setScale(newScale);

    canvas.width = img.width * newScale;
    canvas.height = img.height * newScale;

    // Draw image
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Draw overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw selection polygon (clear area)
    if (corners.length === 4) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(corners[0].x * newScale, corners[0].y * newScale);
      for (let i = 1; i < 4; i++) {
        ctx.lineTo(corners[i].x * newScale, corners[i].y * newScale);
      }
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.restore();

      // Draw polygon outline
      ctx.strokeStyle = '#14b8a6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(corners[0].x * newScale, corners[0].y * newScale);
      for (let i = 1; i < 4; i++) {
        ctx.lineTo(corners[i].x * newScale, corners[i].y * newScale);
      }
      ctx.closePath();
      ctx.stroke();

      // Draw corner handles
      const cornerLabels = ['TL', 'TR', 'BR', 'BL'];
      corners.forEach((corner, idx) => {
        const x = corner.x * newScale;
        const y = corner.y * newScale;

        // Handle circle
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.fillStyle = selectedCorner === idx ? '#0d9488' : '#14b8a6';
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Label
        ctx.fillStyle = 'white';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(cornerLabels[idx], x, y);
      });
    }
  }, [corners, selectedCorner, imageLoaded, scale]);

  // Handle mouse/touch events
  const getEventPos = useCallback((e: React.MouseEvent | React.TouchEvent): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    let clientX: number, clientY: number;

    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      x: (clientX - rect.left) / scale,
      y: (clientY - rect.top) / scale
    };
  }, [scale]);

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    const pos = getEventPos(e);

    // Check if clicking on a corner
    const cornerRadius = 15 / scale;
    const clickedCorner = corners.findIndex(corner =>
      Math.sqrt(Math.pow(corner.x - pos.x, 2) + Math.pow(corner.y - pos.y, 2)) < cornerRadius
    );

    if (clickedCorner !== -1) {
      setSelectedCorner(clickedCorner);
    }
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (selectedCorner === null || !imageRef.current) return;

    const pos = getEventPos(e);

    // Clamp to image bounds
    const clampedX = Math.max(0, Math.min(imageRef.current.width, pos.x));
    const clampedY = Math.max(0, Math.min(imageRef.current.height, pos.y));

    setCorners(prev => {
      const newCorners = [...prev];
      newCorners[selectedCorner] = { x: clampedX, y: clampedY };
      return newCorners;
    });
  };

  const handlePointerUp = () => {
    setSelectedCorner(null);
  };

  // Apply perspective correction
  const handleApply = async () => {
    if (!imageRef.current || corners.length !== 4) return;

    setIsProcessing(true);

    try {
      const img = imageRef.current;

      // Calculate output dimensions (use bounding box of selection)
      const minX = Math.min(...corners.map(c => c.x));
      const maxX = Math.max(...corners.map(c => c.x));
      const minY = Math.min(...corners.map(c => c.y));
      const maxY = Math.max(...corners.map(c => c.y));

      const outputWidth = Math.round(maxX - minX);
      const outputHeight = Math.round(maxY - minY);

      // Create output canvas
      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = outputWidth;
      outputCanvas.height = outputHeight;
      const outputCtx = outputCanvas.getContext('2d');
      if (!outputCtx) throw new Error('Failed to get output canvas context');

      // Source canvas with original image
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = img.width;
      srcCanvas.height = img.height;
      const srcCtx = srcCanvas.getContext('2d');
      if (!srcCtx) throw new Error('Failed to get source canvas context');
      srcCtx.drawImage(img, 0, 0);
      const srcData = srcCtx.getImageData(0, 0, img.width, img.height);

      // Output image data
      const outputData = outputCtx.createImageData(outputWidth, outputHeight);

      // Perform perspective transform using inverse mapping
      // Map each output pixel back to source coordinates
      for (let y = 0; y < outputHeight; y++) {
        for (let x = 0; x < outputWidth; x++) {
          // Normalized coordinates in output (0-1)
          const u = x / outputWidth;
          const v = y / outputHeight;

          // Bilinear interpolation of corner positions
          // Source position = interpolation of 4 corners based on (u, v)
          const srcX =
            corners[0].x * (1 - u) * (1 - v) +
            corners[1].x * u * (1 - v) +
            corners[2].x * u * v +
            corners[3].x * (1 - u) * v;

          const srcY =
            corners[0].y * (1 - u) * (1 - v) +
            corners[1].y * u * (1 - v) +
            corners[2].y * u * v +
            corners[3].y * (1 - u) * v;

          // Sample source pixel (nearest neighbor for speed)
          const sx = Math.round(srcX);
          const sy = Math.round(srcY);

          if (sx >= 0 && sx < img.width && sy >= 0 && sy < img.height) {
            const srcIdx = (sy * img.width + sx) * 4;
            const dstIdx = (y * outputWidth + x) * 4;

            outputData.data[dstIdx] = srcData.data[srcIdx];
            outputData.data[dstIdx + 1] = srcData.data[srcIdx + 1];
            outputData.data[dstIdx + 2] = srcData.data[srcIdx + 2];
            outputData.data[dstIdx + 3] = srcData.data[srcIdx + 3];
          }
        }
      }

      outputCtx.putImageData(outputData, 0, 0);

      // Convert to file
      const dataUrl = outputCanvas.toDataURL('image/jpeg', 0.92);
      const arr = dataUrl.split(',');
      const mimeMatch = arr[0].match(/:(.*?);/);
      const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      const file = new File([u8arr], 'corrected.jpg', { type: mime });

      onApply(dataUrl, file);
    } catch (error) {
      console.error('Perspective correction failed:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-[90vw] max-h-[90vh] overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Adjust Perspective
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Drag the corner handles to align with the receipt edges
          </p>
        </div>

        <div className="p-4 overflow-auto" style={{ maxHeight: 'calc(90vh - 150px)' }}>
          <canvas
            ref={canvasRef}
            onMouseDown={handlePointerDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onMouseLeave={handlePointerUp}
            onTouchStart={handlePointerDown}
            onTouchMove={handlePointerMove}
            onTouchEnd={handlePointerUp}
            className="cursor-move touch-none mx-auto block rounded"
            style={{ maxWidth: '100%' }}
          />
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={isProcessing}
            className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={isProcessing || corners.length !== 4}
            className="px-4 py-2 bg-teal-500 text-white rounded hover:bg-teal-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isProcessing ? (
              <>
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                Processing...
              </>
            ) : (
              'Apply Correction'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PerspectiveCorrectionModal;
