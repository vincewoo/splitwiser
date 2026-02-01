"""File handling utilities with security features."""

from fastapi import UploadFile, HTTPException

async def read_upload_file_securely(file: UploadFile, max_size_bytes: int = 10 * 1024 * 1024) -> bytes:
    """
    Read an UploadFile securely, enforcing a maximum size limit.
    This prevents DoS attacks where a user uploads a huge file to exhaust memory.

    Args:
        file: The FastAPI UploadFile to read
        max_size_bytes: Maximum allowed size in bytes (default 10MB)

    Returns:
        The file content as bytes

    Raises:
        HTTPException(413): If file is too large
    """
    content = bytearray()
    size = 0
    chunk_size = 1024 * 1024  # 1MB chunks

    while True:
        chunk = await file.read(chunk_size)
        if not chunk:
            break

        size += len(chunk)
        if size > max_size_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"File size exceeds maximum allowed size of {max_size_bytes / (1024 * 1024):.2f}MB"
            )

        content.extend(chunk)

    return bytes(content)
