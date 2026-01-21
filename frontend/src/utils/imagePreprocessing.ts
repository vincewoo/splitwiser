/**
 * Image preprocessing utilities for improving OCR recognition
 * Provides rotation, brightness/contrast adjustment, auto-enhance, and more
 */

/**
 * Load an image from a File or data URL
 */
export async function loadImage(source: File | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      if (typeof source !== 'string') {
        URL.revokeObjectURL(img.src);
      }
      resolve(img);
    };

    img.onerror = () => {
      if (typeof source !== 'string') {
        URL.revokeObjectURL(img.src);
      }
      reject(new Error('Failed to load image'));
    };

    if (typeof source === 'string') {
      img.src = source;
    } else {
      img.src = URL.createObjectURL(source);
    }
  });
}

/**
 * Convert canvas to File
 */
export function canvasToFile(canvas: HTMLCanvasElement, filename: string, quality: number = 0.92): File {
  const dataURL = canvas.toDataURL('image/jpeg', quality);
  const arr = dataURL.split(',');
  const mimeMatch = arr[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mime });
}

/**
 * Convert canvas to data URL
 */
export function canvasToDataURL(canvas: HTMLCanvasElement, quality: number = 0.92): string {
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Rotate image by specified degrees (90, 180, 270)
 */
export async function rotateImage(
  source: File | string,
  degrees: 90 | 180 | 270
): Promise<{ file: File; dataUrl: string }> {
  const img = await loadImage(source);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  // Set canvas dimensions based on rotation
  if (degrees === 90 || degrees === 270) {
    canvas.width = img.height;
    canvas.height = img.width;
  } else {
    canvas.width = img.width;
    canvas.height = img.height;
  }

  // Translate and rotate
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);

  const filename = typeof source === 'string' ? 'rotated.jpg' : source.name;
  const file = canvasToFile(canvas, filename);
  const dataUrl = canvasToDataURL(canvas);

  return { file, dataUrl };
}

/**
 * Adjust brightness and contrast of an image
 * @param brightness - Brightness adjustment (-100 to 100, 0 = no change)
 * @param contrast - Contrast adjustment (-100 to 100, 0 = no change)
 */
export async function adjustBrightnessContrast(
  source: File | string,
  brightness: number,
  contrast: number
): Promise<{ file: File; dataUrl: string }> {
  const img = await loadImage(source);

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  // Draw original image
  ctx.drawImage(img, 0, 0);

  // Get image data
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Calculate brightness and contrast factors
  const brightnessF = brightness / 100;
  const contrastF = (contrast + 100) / 100;
  const intercept = 128 * (1 - contrastF);

  // Apply adjustments
  for (let i = 0; i < data.length; i += 4) {
    // Red
    data[i] = Math.min(255, Math.max(0, (data[i] * contrastF + intercept) + (brightnessF * 255)));
    // Green
    data[i + 1] = Math.min(255, Math.max(0, (data[i + 1] * contrastF + intercept) + (brightnessF * 255)));
    // Blue
    data[i + 2] = Math.min(255, Math.max(0, (data[i + 2] * contrastF + intercept) + (brightnessF * 255)));
    // Alpha unchanged
  }

  ctx.putImageData(imageData, 0, 0);

  const filename = typeof source === 'string' ? 'adjusted.jpg' : source.name;
  const file = canvasToFile(canvas, filename);
  const dataUrl = canvasToDataURL(canvas);

  return { file, dataUrl };
}

/**
 * Apply sharpening filter to image
 * Uses unsharp mask technique
 */
export async function sharpenImage(
  source: File | string,
  amount: number = 50 // 0-100
): Promise<{ file: File; dataUrl: string }> {
  const img = await loadImage(source);

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const width = canvas.width;
  const height = canvas.height;

  // Create a copy for the original values
  const originalData = new Uint8ClampedArray(data);

  // Sharpening kernel (Laplacian-based)
  const kernel = [
    0, -1, 0,
    -1, 5, -1,
    0, -1, 0
  ];

  const factor = amount / 100;

  // Apply convolution (skip edge pixels)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      for (let c = 0; c < 3; c++) { // RGB channels only
        let sum = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = ((y + ky) * width + (x + kx)) * 4 + c;
            sum += originalData[idx] * kernel[(ky + 1) * 3 + (kx + 1)];
          }
        }
        const idx = (y * width + x) * 4 + c;
        // Blend original and sharpened
        const sharpened = originalData[idx] + (sum - originalData[idx]) * factor;
        data[idx] = Math.min(255, Math.max(0, sharpened));
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);

  const filename = typeof source === 'string' ? 'sharpened.jpg' : source.name;
  const file = canvasToFile(canvas, filename);
  const dataUrl = canvasToDataURL(canvas);

  return { file, dataUrl };
}

/**
 * Convert image to grayscale (can improve OCR for some receipts)
 */
export async function convertToGrayscale(
  source: File | string
): Promise<{ file: File; dataUrl: string }> {
  const img = await loadImage(source);

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    // Use luminosity method for better perception
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    data[i] = gray;     // Red
    data[i + 1] = gray; // Green
    data[i + 2] = gray; // Blue
  }

  ctx.putImageData(imageData, 0, 0);

  const filename = typeof source === 'string' ? 'grayscale.jpg' : source.name;
  const file = canvasToFile(canvas, filename);
  const dataUrl = canvasToDataURL(canvas);

  return { file, dataUrl };
}

/**
 * Auto-enhance image for better OCR
 * Combines contrast stretching, slight sharpening, and optional grayscale
 */
export async function autoEnhance(
  source: File | string,
  options: {
    grayscale?: boolean;
    aggressiveContrast?: boolean;
  } = {}
): Promise<{ file: File; dataUrl: string }> {
  const img = await loadImage(source);

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const width = canvas.width;
  const height = canvas.height;

  // Step 1: Analyze histogram to find min/max values
  let minVal = 255;
  let maxVal = 0;

  for (let i = 0; i < data.length; i += 4) {
    const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (gray < minVal) minVal = gray;
    if (gray > maxVal) maxVal = gray;
  }

  // Step 2: Contrast stretching (histogram stretching)
  const range = maxVal - minVal;
  const stretchFactor = range > 0 ? 255 / range : 1;

  // For aggressive contrast, use a smaller range
  const targetMin = options.aggressiveContrast ? 20 : 0;
  const targetMax = options.aggressiveContrast ? 235 : 255;
  const targetRange = targetMax - targetMin;

  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const normalized = (data[i + c] - minVal) * stretchFactor;
      data[i + c] = Math.min(255, Math.max(0, targetMin + (normalized / 255) * targetRange));
    }
  }

  // Step 3: Optional grayscale conversion
  if (options.grayscale) {
    for (let i = 0; i < data.length; i += 4) {
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  // Step 4: Apply mild sharpening
  const sharpenedData = ctx.getImageData(0, 0, width, height);
  const sharpData = sharpenedData.data;
  const origForSharp = new Uint8ClampedArray(sharpData);

  const kernel = [0, -0.5, 0, -0.5, 3, -0.5, 0, -0.5, 0];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = ((y + ky) * width + (x + kx)) * 4 + c;
            sum += origForSharp[idx] * kernel[(ky + 1) * 3 + (kx + 1)];
          }
        }
        const idx = (y * width + x) * 4 + c;
        sharpData[idx] = Math.min(255, Math.max(0, sum));
      }
    }
  }

  ctx.putImageData(sharpenedData, 0, 0);

  const filename = typeof source === 'string' ? 'enhanced.jpg' : source.name;
  const file = canvasToFile(canvas, filename);
  const dataUrl = canvasToDataURL(canvas);

  return { file, dataUrl };
}

/**
 * Analyze image quality and provide recommendations
 */
export async function analyzeImageQuality(
  source: File | string
): Promise<{
  score: number; // 0-100
  issues: string[];
  recommendations: string[];
}> {
  const img = await loadImage(source);

  const canvas = document.createElement('canvas');
  // Use smaller size for analysis
  const maxDim = 500;
  const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  const issues: string[] = [];
  const recommendations: string[] = [];
  let score = 100;

  // Analyze brightness
  let totalBrightness = 0;
  let darkPixels = 0;
  let brightPixels = 0;

  for (let i = 0; i < data.length; i += 4) {
    const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
    totalBrightness += brightness;
    if (brightness < 50) darkPixels++;
    if (brightness > 230) brightPixels++;
  }

  const pixelCount = data.length / 4;
  const avgBrightness = totalBrightness / pixelCount;
  const darkRatio = darkPixels / pixelCount;
  const brightRatio = brightPixels / pixelCount;

  // Check for underexposure
  if (avgBrightness < 80 || darkRatio > 0.4) {
    issues.push('Image appears too dark');
    recommendations.push('Try using Auto-Enhance or increase brightness');
    score -= 20;
  }

  // Check for overexposure
  if (avgBrightness > 200 || brightRatio > 0.3) {
    issues.push('Image appears overexposed');
    recommendations.push('Reduce brightness or retake photo with less light');
    score -= 20;
  }

  // Analyze contrast (standard deviation of brightness)
  let brightnessVariance = 0;
  for (let i = 0; i < data.length; i += 4) {
    const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
    brightnessVariance += Math.pow(brightness - avgBrightness, 2);
  }
  const stdDev = Math.sqrt(brightnessVariance / pixelCount);

  if (stdDev < 30) {
    issues.push('Low contrast detected');
    recommendations.push('Try Auto-Enhance to improve contrast');
    score -= 15;
  }

  // Analyze blur (using Laplacian variance approximation)
  let laplacianVariance = 0;
  const width = canvas.width;
  const height = canvas.height;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      const center = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;

      const neighbors = [
        (y - 1) * width + x,
        (y + 1) * width + x,
        y * width + (x - 1),
        y * width + (x + 1)
      ].map(i => (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3);

      const laplacian = 4 * center - neighbors.reduce((a, b) => a + b, 0);
      laplacianVariance += laplacian * laplacian;
    }
  }

  const blurScore = laplacianVariance / ((width - 2) * (height - 2));

  if (blurScore < 100) {
    issues.push('Image may be blurry');
    recommendations.push('Try Sharpen or retake photo with steady hands');
    score -= 25;
  }

  // Check resolution
  if (img.width < 800 || img.height < 600) {
    issues.push('Image resolution is low');
    recommendations.push('Use a higher resolution photo for better results');
    score -= 15;
  }

  // Ensure score is in valid range
  score = Math.max(0, Math.min(100, score));

  // Add positive note if quality is good
  if (issues.length === 0) {
    recommendations.push('Image quality looks good!');
  }

  return { score, issues, recommendations };
}

/**
 * Crop image to specified region
 */
export async function cropImage(
  source: File | string,
  x: number,
  y: number,
  width: number,
  height: number
): Promise<{ file: File; dataUrl: string }> {
  const img = await loadImage(source);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  ctx.drawImage(img, x, y, width, height, 0, 0, width, height);

  const filename = typeof source === 'string' ? 'cropped.jpg' : source.name;
  const file = canvasToFile(canvas, filename);
  const dataUrl = canvasToDataURL(canvas);

  return { file, dataUrl };
}

/**
 * Apply threshold to create high-contrast black and white image
 * Good for thermal receipt paper
 */
export async function applyThreshold(
  source: File | string,
  threshold: number = 128 // 0-255
): Promise<{ file: File; dataUrl: string }> {
  const img = await loadImage(source);

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const value = gray >= threshold ? 255 : 0;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }

  ctx.putImageData(imageData, 0, 0);

  const filename = typeof source === 'string' ? 'threshold.jpg' : source.name;
  const file = canvasToFile(canvas, filename);
  const dataUrl = canvasToDataURL(canvas);

  return { file, dataUrl };
}

export type PreprocessingOperation =
  | { type: 'rotate'; degrees: 90 | 180 | 270 }
  | { type: 'brightness-contrast'; brightness: number; contrast: number }
  | { type: 'sharpen'; amount: number }
  | { type: 'grayscale' }
  | { type: 'auto-enhance'; grayscale?: boolean; aggressiveContrast?: boolean }
  | { type: 'threshold'; threshold: number };
