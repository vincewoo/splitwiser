/**
 * Image compression utility using Canvas API
 * Compresses images before upload to reduce file size and dimensions
 */

/**
 * Calculate new dimensions while preserving aspect ratio
 */
export function calculateNewDimensions(
  width: number,
  height: number,
  maxDimension: number
): { width: number; height: number } {
  if (width <= maxDimension && height <= maxDimension) {
    return { width, height };
  }

  const aspectRatio = width / height;

  if (width > height) {
    return {
      width: maxDimension,
      height: Math.round(maxDimension / aspectRatio),
    };
  } else {
    return {
      width: Math.round(maxDimension * aspectRatio),
      height: maxDimension,
    };
  }
}

/**
 * Load an image file into an HTMLImageElement, revoking the object URL once done.
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };

    img.src = objectUrl;
  });
}

/**
 * Encode a canvas as a JPEG blob at the given quality.
 */
function encodeJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to encode image'));
        }
      },
      'image/jpeg',
      quality
    );
  });
}

/**
 * Compress an image file
 * @param file - The image file to compress
 * @param maxDimension - Maximum width or height (default: 1920)
 * @param maxSizeMB - Target maximum file size in MB (default: 1)
 * @returns Compressed image as a File object
 */
export async function compressImage(
  file: File,
  maxDimension: number = 1920,
  maxSizeMB: number = 1
): Promise<File> {
  try {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      throw new Error('File must be an image');
    }

    // Load the image once: the same element is measured and then drawn.
    const img = await loadImage(file);

    // Calculate new dimensions
    const { width: newWidth, height: newHeight } = calculateNewDimensions(
      img.width,
      img.height,
      maxDimension
    );

    // Create canvas and draw resized image
    const canvas = document.createElement('canvas');
    canvas.width = newWidth;
    canvas.height = newHeight;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }

    ctx.drawImage(img, 0, 0, newWidth, newHeight);

    // Compress with quality adjustment to meet size target
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    let quality = 0.9;
    let blob: Blob;

    // Binary search for optimal quality
    let minQuality = 0.1;
    let maxQuality = 0.9;

    while (true) {
      blob = await encodeJpeg(canvas, quality);

      if (blob.size > maxSizeBytes && quality > minQuality) {
        // File too large, reduce quality
        maxQuality = quality;
        quality = (minQuality + quality) / 2;
      } else if (blob.size < maxSizeBytes * 0.8 && quality < maxQuality) {
        // File could be larger, increase quality
        minQuality = quality;
        quality = (quality + maxQuality) / 2;
      } else {
        // Size is acceptable
        break;
      }

      // Prevent infinite loop
      if (maxQuality - minQuality < 0.01) {
        break;
      }
    }

    // If still too large, use minimum quality
    if (blob.size > maxSizeBytes) {
      blob = await encodeJpeg(canvas, 0.1);
    }

    return new File([blob], file.name.replace(/\.[^/.]+$/, '.jpg'), {
      type: 'image/jpeg',
    });
  } catch (error) {
    console.error('Image compression failed:', error);
    throw error;
  }
}
