from paddleocr import PaddleOCR
from typing import List, Tuple, Optional, Union
import numpy as np
from PIL import Image


class OCRService:
    """
    Singleton service for PaddleOCR text extraction.
    Initializes PaddleOCR once and reuses it for all requests.
    """

    def __init__(self):
        """Initialize PaddleOCR with optimal settings for receipt scanning."""
        self.ocr = PaddleOCR(
            use_angle_cls=True,  # Auto-rotate text for better accuracy
            lang='en'            # English language
        )

    def extract_text(self, image: Union[Image.Image, np.ndarray]) -> List[List[Tuple]]:
        """
        Extract text with bounding boxes from image.

        Args:
            image: PIL Image or numpy array (RGB)

        Returns:
            List of OCR results. Each result contains:
            - Bounding box coordinates [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
            - Tuple of (text, confidence)

        Example return format:
        [
            [
                [[[10, 10], [100, 10], [100, 30], [10, 30]], ("Burger", 0.95)],
                [[[110, 10], [160, 10], [160, 30], [110, 30]], ("$12.99", 0.98)]
            ]
        ]
        """
        # Convert PIL Image to numpy array if needed
        if isinstance(image, Image.Image):
            image_array = np.array(image)
        else:
            image_array = image

        # PaddleOCR v3.3.2 returns a generator, convert to list
        result_gen = self.ocr.ocr(image_array)

        # Consume the generator and get the first result (single image)
        result_list = list(result_gen)

        # Return the first result (dict) if available
        return result_list[0] if result_list else None


# Singleton instance - initialized once, reused for all requests
ocr_service = OCRService()
