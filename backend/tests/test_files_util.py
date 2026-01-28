import pytest
import io
from fastapi import UploadFile, HTTPException
from utils.files import read_upload_file_securely

# Mock UploadFile
class MockUploadFile(UploadFile):
    def __init__(self, data: bytes):
        self.file = io.BytesIO(data)
        self.filename = "test.txt"

    async def read(self, size=-1):
        if size == -1:
            return self.file.read()
        return self.file.read(size)

@pytest.mark.asyncio
async def test_read_upload_file_securely_valid():
    content = b"x" * 1024
    file = MockUploadFile(content)

    result = await read_upload_file_securely(file, max_size=2048)
    assert result == content

@pytest.mark.asyncio
async def test_read_upload_file_securely_large_valid():
    # 1.5MB file (default chunk size is 1MB)
    size = int(1.5 * 1024 * 1024)
    content = b"x" * size
    file = MockUploadFile(content)

    result = await read_upload_file_securely(file, max_size=2 * 1024 * 1024)
    assert len(result) == size
    assert result == content

@pytest.mark.asyncio
async def test_read_upload_file_securely_limit_exceeded():
    # 2MB file
    size = 2 * 1024 * 1024
    content = b"x" * size
    file = MockUploadFile(content)

    # Max size 1MB
    with pytest.raises(HTTPException) as exc_info:
        await read_upload_file_securely(file, max_size=1 * 1024 * 1024)

    assert exc_info.value.status_code == 413
    assert "File size exceeds" in exc_info.value.detail
