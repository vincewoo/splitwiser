from google.cloud import vision
from google.api_core import exceptions as google_exceptions
import google.auth.exceptions
import logging

logger = logging.getLogger(__name__)

class OCRService:
    """
    Singleton service for Google Cloud Vision OCR text extraction.
    Initializes Vision client once and reuses it for all requests.
    """

    def __init__(self):
        """Initialize Google Cloud Vision client."""
        try:
            self.client = vision.ImageAnnotatorClient()
        except google.auth.exceptions.DefaultCredentialsError:
            logger.warning("Google Cloud Credentials not found. OCR service will not work.")
            self.client = None
        except Exception as e:
            logger.warning(f"Failed to initialize OCR service: {e}")
            self.client = None

    def extract_text(self, image_bytes: bytes):
        """
        Extract text from image using Google Cloud Vision.

        Args:
            image_bytes: Raw image bytes (JPEG, PNG, WebP)

        Returns:
            AnnotateImageResponse with text_annotations list.
            First annotation contains full text, subsequent ones are individual words.

        Raises:
            Exception: If Vision API returns an error or client is not initialized
        """
        if not self.client:
            raise Exception("OCR service is not available (missing credentials)")

        image = vision.Image(content=image_bytes)
        response = self.client.text_detection(image=image)

        if response.error.message:
            raise Exception(f"Vision API error: {response.error.message}")

        return response


# Singleton instance - initialized once, reused for all requests
ocr_service = OCRService()
