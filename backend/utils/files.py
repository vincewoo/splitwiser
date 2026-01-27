from fastapi import UploadFile, HTTPException

async def read_upload_file_securely(file: UploadFile, max_size: int) -> bytes:
    """
    Read an UploadFile securely, preventing memory exhaustion from large files.

    Args:
        file: The UploadFile to read
        max_size: Maximum allowed size in bytes

    Returns:
        The file content as bytes

    Raises:
        HTTPException(413): If file size exceeds max_size
    """
    content = bytearray()
    size = 0
    chunk_size = 1024 * 1024  # 1MB chunks

    while True:
        chunk = await file.read(chunk_size)
        if not chunk:
            break
        size += len(chunk)
        if size > max_size:
            raise HTTPException(
                status_code=413,
                detail=f"File size exceeds maximum allowed size of {max_size / (1024 * 1024):.2f}MB"
            )
        content.extend(chunk)

    return bytes(content)
