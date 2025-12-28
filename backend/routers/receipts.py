"""Receipts router: OCR receipt scanning endpoint."""

from typing import Annotated
import os
import shutil
import uuid
from fastapi import APIRouter, Depends, HTTPException, File, UploadFile
from sqlalchemy.orm import Session

import models
from database import get_db
from dependencies import get_current_user
from ocr.service import ocr_service
from ocr.parser import parse_receipt_items
from ocr.parser_v2 import parse_receipt_items_v2, get_raw_text


# Receipt directory path
DATA_DIR = os.getenv("DATA_DIR", "data")
RECEIPT_DIR = os.path.join(DATA_DIR, "receipts")


router = APIRouter(tags=["receipts"])


@router.post("/ocr/scan-receipt")
async def scan_receipt(
    file: UploadFile = File(...),
    current_user: Annotated[models.User, Depends(get_current_user)] = None
):
    """
    OCR endpoint for receipt scanning using Google Cloud Vision.
    Accepts image upload, returns extracted items with prices AND saves the image locally.

    Args:
        file: Uploaded image file (JPEG, PNG, WebP)
        current_user: Authenticated user (from JWT token)

    Returns:
        JSON with items, total, raw OCR text, and receipt_image_path
    """
    # Validate file type
    if file.content_type not in ["image/jpeg", "image/png", "image/webp"]:
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Only JPEG, PNG, and WebP images are supported."
        )

    try:
        # Ensure receipts directory exists
        os.makedirs(RECEIPT_DIR, exist_ok=True)

        # Generate unique filename
        file_ext = file.filename.split('.')[-1] if '.' in file.filename else "jpg"
        filename = f"{uuid.uuid4()}.{file_ext}"
        file_path = os.path.join(RECEIPT_DIR, filename)

        # Save file locally
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Reset file cursor for reading
        file.file.seek(0)

        # Read image file for OCR
        image_content = await file.read()
        print(f"Starting receipt scan... Image size: {len(image_content)} bytes")
        
        # OCR processing
        print("Calling Vision API...")
        vision_response = ocr_service.extract_text(image_content)
        print("Vision API response received")
        
        # Log response stats
        if vision_response.text_annotations:
            print(f"Number of text annotations: {len(vision_response.text_annotations)}")
            full_text = vision_response.text_annotations[0].description
            print(f"Raw text length: {len(full_text)}")
            print(f"First 100 chars of raw text: {full_text[:100]}...")
            raw_text = full_text
        else:
            print("No text annotations found in response")
            raw_text = ""

        # Parse items using new spatial layout parser (V2)
        items = parse_receipt_items_v2(vision_response)
        print(f"[V2 Parser] Parsed items count: {len(items)}")
        for item in items:
            print(f" - Found item: {item}")

        # For comparison, also run old parser
        items_old = parse_receipt_items(vision_response)
        print(f"[Old Parser] Parsed items count: {len(items_old)}")
        if len(items_old) != len(items):
            print(f"⚠️  Parser difference: V2 found {len(items)} items vs Old found {len(items_old)} items")
        
        # Calculate total
        total = sum(item['price'] for item in items)
        print(f"Calculated total from items: {total}")

        return {
            "items": items,
            "total": total,
            "raw_text": raw_text,
            "receipt_image_path": f"/static/receipts/{filename}"
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"OCR processing error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"OCR processing failed: {str(e)}"
        )
