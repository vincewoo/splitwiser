"""Currency-related utilities: exchange rates, formatting, and conversion."""

from typing import Optional
import requests


# Exchange rates for currency conversion (fallback if API fails)
EXCHANGE_RATES = {
    "USD": 1.0,
    "EUR": 0.92,
    "GBP": 0.79,
    "JPY": 149.5,
    "CAD": 1.38,
    "CNY": 7.2,
    "HKD": 7.8
}

# Currency symbols for formatting
CURRENCY_SYMBOLS = {
    "USD": "$",
    "EUR": "€",
    "GBP": "£",
    "JPY": "¥",
    "CAD": "CA$",
    "CNY": "¥",
    "HKD": "HK$"
}


def format_currency(amount_cents: int, currency: str) -> str:
    """
    Format an amount in cents as a currency string with symbol.

    Args:
        amount_cents: Amount in cents (e.g., 1234 for $12.34)
        currency: Currency code (e.g., "USD", "EUR")

    Returns:
        Formatted string with symbol (e.g., "$12.34", "€12.34")
    """
    symbol = CURRENCY_SYMBOLS.get(currency, currency)
    amount = amount_cents / 100

    # For currencies like JPY that don't use decimal places
    if currency == "JPY":
        return f"{symbol}{amount:.0f}"

    # Handle negative amounts
    if amount < 0:
        return f"-{symbol}{abs(amount):.2f}"
    else:
        return f"{symbol}{amount:.2f}"


def fetch_historical_exchange_rate(date: str, from_currency: str, to_currency: str = "USD") -> Optional[float]:
    """
    Fetch historical exchange rate from Frankfurter API (free, no key required).
    Returns the rate to convert from from_currency to to_currency on the given date.

    Args:
        date: ISO format date string (YYYY-MM-DD)
        from_currency: Source currency code (e.g., "EUR")
        to_currency: Target currency code (default: "USD")

    Returns:
        Exchange rate as float, or None if fetch fails
    """
    # If converting to same currency, rate is 1.0
    if from_currency == to_currency:
        return 1.0

    try:
        # Frankfurter API endpoint for historical rates
        # https://www.frankfurter.app/docs/
        url = f"https://api.frankfurter.app/{date}"
        params = {
            "from": from_currency,
            "to": to_currency
        }

        response = requests.get(url, params=params, timeout=5)
        response.raise_for_status()

        data = response.json()

        # Check if the API returned successfully
        if "rates" in data and to_currency in data["rates"]:
            return float(data["rates"][to_currency])

        # If API fails, return None to use fallback
        return None

    except Exception as e:
        print(f"Error fetching exchange rate for {date} ({from_currency} to {to_currency}): {e}")
        return None


def get_exchange_rate_for_expense(date: str, currency: str) -> float:
    """
    Get exchange rate from currency to USD for a given date.
    First tries to fetch from API, falls back to static rates if API fails.

    Args:
        date: ISO format date string (YYYY-MM-DD)
        currency: Currency code (e.g., "EUR")

    Returns:
        Exchange rate from currency to USD
    """
    # If already USD, rate is 1.0
    if currency == "USD":
        return 1.0

    # Try to fetch historical rate from API
    rate = fetch_historical_exchange_rate(date, currency, "USD")

    # If API fails, use fallback static rates
    if rate is None:
        if currency in EXCHANGE_RATES:
            rate = EXCHANGE_RATES[currency]
            print(f"Using fallback rate for {currency}: {rate}")
        else:
            # Default to 1.0 if currency not found
            rate = 1.0
            print(f"Unknown currency {currency}, using rate 1.0")

    return rate


def convert_to_usd(amount: float, currency: str) -> float:
    """Convert an amount from the given currency to USD using static rates."""
    if currency not in EXCHANGE_RATES:
        return amount
    return amount / EXCHANGE_RATES[currency]


def convert_currency(amount: float, from_currency: str, to_currency: str) -> float:
    """
    Convert an amount from one currency to another using static rates.
    Converts through USD as an intermediary.

    Args:
        amount: Amount in source currency
        from_currency: Source currency code (e.g., "EUR")
        to_currency: Target currency code (e.g., "GBP")

    Returns:
        Amount in target currency
    """
    if from_currency == to_currency:
        return amount

    # Convert to USD first, then to target currency
    amount_in_usd = convert_to_usd(amount, from_currency)

    if to_currency not in EXCHANGE_RATES:
        return amount_in_usd

    return amount_in_usd * EXCHANGE_RATES[to_currency]


def get_current_exchange_rates() -> dict:
    """
    Get current exchange rates from Frankfurter API (free, no key required).
    Falls back to static rates if API is unavailable.
    All rates are relative to USD (base currency).
    """
    try:
        # Fetch latest rates from Frankfurter API with USD as base
        url = "https://api.frankfurter.app/latest"
        params = {
            "from": "USD",
            "to": "EUR,GBP,JPY,CAD,CNY,HKD"
        }

        response = requests.get(url, params=params, timeout=5)
        response.raise_for_status()

        data = response.json()

        if "rates" in data:
            # Add USD explicitly since it's the base
            rates = {"USD": 1.0}
            rates.update(data["rates"])
            return rates

        # If API response is invalid, use fallback
        print("API response invalid, using fallback rates")
        return EXCHANGE_RATES

    except Exception as e:
        print(f"Error fetching exchange rates: {e}")
        # Return static fallback rates
        return EXCHANGE_RATES
