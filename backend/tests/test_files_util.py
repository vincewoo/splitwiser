import pytest
from unittest.mock import MagicMock, AsyncMock
from fastapi import UploadFile, HTTPException
from utils.files import read_upload_file_securely

@pytest.mark.asyncio
async def test_read_securely_valid_size():
    mock_file = MagicMock(spec=UploadFile)
    # Simulate reading 5 bytes, then end of file
    mock_file.read = AsyncMock(side_effect=[b"12345", b""])

    content = await read_upload_file_securely(mock_file, max_size=10)
    assert content == b"12345"

@pytest.mark.asyncio
async def test_read_securely_exceeds_size():
    mock_file = MagicMock(spec=UploadFile)
    # Simulate reading 5 bytes, then 6 bytes (total 11 > 10)
    mock_file.read = AsyncMock(side_effect=[b"12345", b"678901"])

    with pytest.raises(HTTPException) as exc:
        await read_upload_file_securely(mock_file, max_size=10)

    assert exc.value.status_code == 413

@pytest.mark.asyncio
async def test_read_securely_stops_early():
    mock_file = MagicMock(spec=UploadFile)
    # Simulate a stream that would be very large if fully read
    # Chunk 1: 5 bytes (ok)
    # Chunk 2: 6 bytes (total 11 > 10, should fail here)
    # Chunk 3: 100 bytes (should NOT be read)
    mock_file.read = AsyncMock(side_effect=[b"12345", b"678901", b"x" * 100])

    with pytest.raises(HTTPException):
        await read_upload_file_securely(mock_file, max_size=10)

    # Verify read was called twice (for first 2 chunks), not 3 times
    assert mock_file.read.call_count == 2
