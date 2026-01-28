from fastapi import UploadFile, HTTPException

async def read_upload_file_securely(file: UploadFile, max_size: int = 10 * 1024 * 1024) -> bytes:
    """
    Reads an UploadFile securely by enforcing a maximum size limit.
    Reads in chunks to prevent memory exhaustion DoS attacks.

    Args:
        file: The UploadFile to read.
        max_size: Maximum allowed size in bytes (default 10MB).

    Returns:
        The file content as bytes.

    Raises:
        HTTPException(413): If the file size exceeds max_size.
    """
    content = bytearray()
    chunk_size = 1024 * 1024  # 1MB chunks

    while True:
        chunk = await file.read(chunk_size)
        if not chunk:
            break
        content.extend(chunk)
        if len(content) > max_size:
            raise HTTPException(
                status_code=413,
                detail=f"File size exceeds maximum allowed size of {max_size / (1024 * 1024):.2f}MB"
            )

    return bytes(content)
