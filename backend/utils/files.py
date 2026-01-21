"""File handling utilities for secure file processing."""

from fastapi import UploadFile, HTTPException

async def read_upload_file_securely(file: UploadFile, max_size_bytes: int) -> bytes:
    """
    Securely reads an uploaded file, ensuring it doesn't exceed the maximum size.
    Reads in chunks to prevent memory exhaustion DoS attacks.

    Args:
        file: The FastAPI UploadFile object
        max_size_bytes: Maximum allowed file size in bytes

    Returns:
        bytes: The content of the file

    Raises:
        HTTPException: If the file size exceeds the limit
    """
    # Check Content-Length header as a first line of defense (if available)
    # Note: This is client-controlled, so we verify by counting bytes
    # Starlette/FastAPI doesn't always expose raw headers in UploadFile easily,
    # but we can rely on reading behavior.

    content = bytearray()
    chunk_size = 1024 * 1024  # 1MB chunks

    # Read in chunks
    while True:
        chunk = await file.read(chunk_size)
        if not chunk:
            break

        content.extend(chunk)

        if len(content) > max_size_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"File size exceeds maximum allowed size of {max_size_bytes / (1024 * 1024):.2f}MB"
            )

    return bytes(content)
