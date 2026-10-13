import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { compressImage, calculateNewDimensions } from '../imageCompression';

const MOCK_URL = 'blob:mock';
const MAX_BYTES = 1 * 1024 * 1024;

function blobOfSize(size: number): Blob {
  return new Blob([new Uint8Array(size)], { type: 'image/jpeg' });
}

// happy-dom has no real image decoding, so the module's `new Image()` is
// replaced by this stand-in. It records every construction so a test can prove
// the image is decoded exactly once.
let createdImages: HTMLImageElement[] = [];
let imageWidth = 4000;
let imageHeight = 3000;

class MockImage {
  width: number;
  height: number;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    this.width = imageWidth;
    this.height = imageHeight;
    createdImages.push(this as unknown as HTMLImageElement);
  }

  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

let drawImage: ReturnType<typeof vi.fn>;
let toBlobQualities: (number | undefined)[] = [];
let toBlobSize = 1000;
let toBlobReturnsNull = false;

beforeEach(() => {
  createdImages = [];
  imageWidth = 4000;
  imageHeight = 3000;
  toBlobQualities = [];
  toBlobSize = 1000;
  toBlobReturnsNull = false;

  vi.stubGlobal('Image', MockImage);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue(MOCK_URL);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

  drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);

  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    (callback, _type, quality) => {
      toBlobQualities.push(quality);
      callback(toBlobReturnsNull ? null : blobOfSize(toBlobSize));
    }
  );

  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('compressImage', () => {
  it('rejects a non-image file before loading anything', async () => {
    const file = new File(['plain'], 'notes.txt', { type: 'text/plain' });

    await expect(compressImage(file)).rejects.toThrow('File must be an image');
    expect(createdImages).toHaveLength(0);
  });

  it('decodes a 4000x3000 png once and returns receipt.jpg at 1920x1440', async () => {
    const file = new File(['png-bytes'], 'receipt.png', { type: 'image/png' });

    const result = await compressImage(file);

    expect(createdImages).toHaveLength(1);
    expect(drawImage).toHaveBeenCalledWith(createdImages[0], 0, 0, 1920, 1440);
    expect(result.name).toBe('receipt.jpg');
    expect(result.type).toBe('image/jpeg');
  });

  it('re-encodes at quality 0.1 when every attempt is over the limit', async () => {
    toBlobSize = 2 * MAX_BYTES;

    const file = new File(['png-bytes'], 'receipt.png', { type: 'image/png' });
    await compressImage(file);

    const lastCall = toBlobQualities.at(-1);
    expect(lastCall).toBe(0.1);
  });

  it('rejects with "Failed to encode image" when toBlob yields null', async () => {
    toBlobReturnsNull = true;

    const file = new File(['png-bytes'], 'receipt.png', { type: 'image/png' });

    await expect(compressImage(file)).rejects.toThrow('Failed to encode image');
  });
});

describe('calculateNewDimensions', () => {
  it('leaves a size within the limit unchanged', () => {
    expect(calculateNewDimensions(800, 600, 1920)).toEqual({
      width: 800,
      height: 600,
    });
  });

  it('scales a landscape size on its long side', () => {
    expect(calculateNewDimensions(4000, 3000, 1920)).toEqual({
      width: 1920,
      height: 1440,
    });
  });

  it('scales a portrait size on its long side', () => {
    expect(calculateNewDimensions(3000, 4000, 1920)).toEqual({
      width: 1440,
      height: 1920,
    });
  });
});
