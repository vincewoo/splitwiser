"""Tests for the LLM receipt parsing service."""

from unittest.mock import patch

from ocr.llm_service import parse_receipt


class TestSanitizeItems:
    """Test the sanitization logic in parse_receipt (post-provider)."""

    def _make_provider_result(self, items):
        return {
            "items": items,
            "tax_cents": 100,
            "tip_cents": None,
            "total_cents": 500,
        }

    @patch("ocr.llm_service.os.getenv", return_value="openai")
    def test_valid_items_pass_through(self, _mock_env):
        items = [{"description": "Coffee", "price_cents": 350, "quantity": 1}]
        with patch("ocr.providers.openai_provider.parse_receipt", return_value=self._make_provider_result(items)):
            result = parse_receipt(b"fake", "image/jpeg")
        item = result["items"][0]
        assert item["description"] == "Coffee"
        assert item["price_cents"] == 350
        assert item["quantity"] == 1

    @patch("ocr.llm_service.os.getenv", return_value="openai")
    def test_negative_price_clamped_to_zero(self, _mock_env):
        items = [{"description": "Discount item", "price_cents": -100, "quantity": 1}]
        with patch("ocr.providers.openai_provider.parse_receipt", return_value=self._make_provider_result(items)):
            result = parse_receipt(b"fake", "image/jpeg")
        assert result["items"][0]["price_cents"] == 0

    @patch("ocr.llm_service.os.getenv", return_value="openai")
    def test_non_int_price_clamped_to_zero(self, _mock_env):
        items = [{"description": "Bad price", "price_cents": "abc", "quantity": 1}]
        with patch("ocr.providers.openai_provider.parse_receipt", return_value=self._make_provider_result(items)):
            result = parse_receipt(b"fake", "image/jpeg")
        assert result["items"][0]["price_cents"] == 0

    @patch("ocr.llm_service.os.getenv", return_value="openai")
    def test_missing_description_defaults_to_unknown(self, _mock_env):
        items = [{"description": "", "price_cents": 100, "quantity": 1}]
        with patch("ocr.providers.openai_provider.parse_receipt", return_value=self._make_provider_result(items)):
            result = parse_receipt(b"fake", "image/jpeg")
        assert result["items"][0]["description"] == "Unknown item"

    @patch("ocr.llm_service.os.getenv", return_value="openai")
    def test_none_description_defaults_to_unknown(self, _mock_env):
        items = [{"description": None, "price_cents": 100, "quantity": 1}]
        with patch("ocr.providers.openai_provider.parse_receipt", return_value=self._make_provider_result(items)):
            result = parse_receipt(b"fake", "image/jpeg")
        assert result["items"][0]["description"] == "Unknown item"

    @patch("ocr.llm_service.os.getenv", return_value="openai")
    def test_quantity_below_one_defaults_to_one(self, _mock_env):
        items = [{"description": "Widget", "price_cents": 200, "quantity": 0}]
        with patch("ocr.providers.openai_provider.parse_receipt", return_value=self._make_provider_result(items)):
            result = parse_receipt(b"fake", "image/jpeg")
        assert result["items"][0]["quantity"] == 1

    @patch("ocr.llm_service.os.getenv", return_value="openai")
    def test_non_int_quantity_defaults_to_one(self, _mock_env):
        items = [{"description": "Widget", "price_cents": 200, "quantity": "two"}]
        with patch("ocr.providers.openai_provider.parse_receipt", return_value=self._make_provider_result(items)):
            result = parse_receipt(b"fake", "image/jpeg")
        assert result["items"][0]["quantity"] == 1


class TestProviderDispatch:
    def test_unknown_provider_raises_runtime_error(self):
        with patch("ocr.llm_service.os.getenv", return_value="not_real"):
            try:
                parse_receipt(b"fake", "image/jpeg")
                assert False, "Should have raised RuntimeError"
            except RuntimeError as exc:
                assert "Unknown LLM_PROVIDER" in str(exc)

    @patch("ocr.llm_service.os.getenv", return_value="gemini")
    def test_gemini_provider_dispatched(self, _mock_env):
        mock_result = {
            "items": [{"description": "Tea", "price_cents": 250, "quantity": 1}],
            "tax_cents": None,
            "tip_cents": None,
            "total_cents": 250,
        }
        with patch("ocr.providers.gemini_provider.parse_receipt", return_value=mock_result):
            result = parse_receipt(b"fake", "image/jpeg")
        assert result["items"][0]["description"] == "Tea"
