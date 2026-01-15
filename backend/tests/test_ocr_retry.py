import pytest
from unittest.mock import MagicMock, patch
from google.api_core import exceptions, retry
from ocr.service import ocr_service

def test_detect_document_text_retry_logic():
    """
    Test that detect_document_text is called with retry logic.
    """
    # Simulate a ServiceUnavailable error
    error = exceptions.ServiceUnavailable("Service unavailable")

    # Mock the client
    with patch.object(ocr_service, 'client') as mock_client:
        mock_client.document_text_detection.side_effect = error

        # Call the service method
        with pytest.raises(exceptions.ServiceUnavailable):
            ocr_service.detect_document_text(b"fake_image_content")

        # Verify that the method was called
        assert mock_client.document_text_detection.called

        # Verify that the retry argument was passed
        args, kwargs = mock_client.document_text_detection.call_args
        assert 'retry' in kwargs
        assert isinstance(kwargs['retry'], retry.Retry)

        # Verify retry configuration
        retry_obj = kwargs['retry']
        # Check that ServiceUnavailable is retried
        assert retry_obj._predicate(exceptions.ServiceUnavailable("test"))
        # Check that DeadlineExceeded is retried
        assert retry_obj._predicate(exceptions.DeadlineExceeded("test"))
        # Check that other exceptions are NOT retried (e.g. NotFound)
        assert not retry_obj._predicate(exceptions.NotFound("test"))

def test_extract_text_retry_logic():
    """
    Test that extract_text is called with retry logic.
    """
    # Simulate a ServiceUnavailable error
    error = exceptions.ServiceUnavailable("Service unavailable")

    # Mock the client
    with patch.object(ocr_service, 'client') as mock_client:
        mock_client.text_detection.side_effect = error

        # Call the service method
        with pytest.raises(exceptions.ServiceUnavailable):
            ocr_service.extract_text(b"fake_image_content")

        # Verify that the method was called
        assert mock_client.text_detection.called

        # Verify that the retry argument was passed
        args, kwargs = mock_client.text_detection.call_args
        assert 'retry' in kwargs
        assert isinstance(kwargs['retry'], retry.Retry)
