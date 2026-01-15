from google.cloud import vision
from google.api_core import exceptions as google_exceptions
from google.api_core import retry
import google.auth.exceptions
import logging
import os
import base64
import tempfile

logger = logging.getLogger(__name__)

# Handle GOOGLE_CREDENTIALS_BASE64 for Fly.io deployments
def _setup_google_credentials():
    """Decode base64 credentials and set up GOOGLE_APPLICATION_CREDENTIALS."""
    base64_creds = os.environ.get("GOOGLE_CREDENTIALS_BASE64")
    if base64_creds and not os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        try:
            # Decode the base64 credentials
            creds_json = base64.b64decode(base64_creds).decode("utf-8")
            # Write to a temp file that persists for the process lifetime
            creds_file = tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False)
            creds_file.write(creds_json)
            creds_file.close()
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = creds_file.name
            logger.info("Google Cloud credentials loaded from GOOGLE_CREDENTIALS_BASE64")
        except Exception as e:
            logger.warning(f"Failed to decode GOOGLE_CREDENTIALS_BASE64: {e}")

_setup_google_credentials()

# Configure retry for Vision API calls
# Retry on ServiceUnavailable (503) and DeadlineExceeded (504)
# Start with 0.5s delay, double it each time, up to 10s delay.
# Total deadline is 30s.
ocr_retry = retry.Retry(
    predicate=retry.if_exception_type(
        google_exceptions.ServiceUnavailable,
        google_exceptions.DeadlineExceeded,
    ),
    initial=0.5,
    maximum=10.0,
    multiplier=2.0,
    deadline=30.0,
)

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
        response = self.client.text_detection(image=image, retry=ocr_retry)

        if response.error.message:
            raise Exception(f"Vision API error: {response.error.message}")

        return response

    def detect_document_text(self, image_bytes: bytes):
        """
        Detect document text with detailed bounding boxes using Google Cloud Vision.

        Args:
            image_bytes: Raw image bytes (JPEG, PNG, WebP)

        Returns:
            AnnotateImageResponse with full_text_annotation and text_annotations.
            Includes detailed bounding box information for each detected text region.

        Raises:
            Exception: If Vision API returns an error
        """
        image = vision.Image(content=image_bytes)
        response = self.client.document_text_detection(image=image, retry=ocr_retry)

        if response.error.message:
            raise Exception(f"Vision API error: {response.error.message}")

        return response


# Singleton instance - initialized once, reused for all requests
ocr_service = OCRService()
