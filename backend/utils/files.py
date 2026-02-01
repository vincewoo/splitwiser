from fastapi import UploadFile, HTTPException

async def read_upload_file_securely(file: UploadFile, max_size_bytes: int) -> bytes:
    """
    Securely read an UploadFile with a size limit to prevent memory exhaustion DoS.

    Args:
        file: The uploaded file to read.
        max_size_bytes: The maximum allowed size in bytes.

    Returns:
        The file content as bytes.

    Raises:
        HTTPException: If the file size exceeds max_size_bytes.
    """
    size = 0
    content = bytearray()
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
