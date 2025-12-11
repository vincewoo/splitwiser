from PIL import Image
import cv2
import numpy as np


def preprocess_image(image: Image.Image) -> np.ndarray:
    """
    Preprocess receipt image for better OCR accuracy.

    Steps:
    1. Convert PIL Image to numpy array
    2. Convert to grayscale
    3. Apply denoising
    4. Apply adaptive thresholding for better contrast

    Args:
        image: PIL Image object

    Returns:
        Numpy array of preprocessed image (grayscale)
    """
    # Convert PIL to numpy array
    img = np.array(image)

    # Convert to grayscale if color image
    if len(img.shape) == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    else:
        gray = img

    # Denoise to reduce noise artifacts
    denoised = cv2.fastNlMeansDenoising(gray)

    # Adaptive thresholding for better contrast
    # This helps separate text from background, especially in poor lighting
    thresh = cv2.adaptiveThreshold(
        denoised,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        11,  # Block size (must be odd)
        2    # Constant subtracted from mean
    )

    return thresh


def resize_if_large(image: Image.Image, max_width: int = 1920) -> Image.Image:
    """
    Resize image if it's too large to improve processing speed.

    Args:
        image: PIL Image object
        max_width: Maximum width in pixels

    Returns:
        Resized PIL Image (or original if already small enough)
    """
    width, height = image.size

    if width > max_width:
        # Calculate new height maintaining aspect ratio
        ratio = max_width / width
        new_height = int(height * ratio)
        return image.resize((max_width, new_height), Image.Resampling.LANCZOS)

    return image
