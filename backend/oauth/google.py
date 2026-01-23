"""Google OAuth 2.0 utilities for token verification and user info extraction."""

import os
from typing import Dict, Any
from google.oauth2 import id_token
from google.auth.transport import requests

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")


class GoogleOAuthError(Exception):
    """Custom exception for Google OAuth errors."""
    pass


def verify_google_token(token: str) -> Dict[str, Any]:
    """
    Verify Google ID token and extract user information.

    Args:
        token: The ID token from Google Sign-In

    Returns:
        Dictionary containing: google_id, email, email_verified, name, picture

    Raises:
        GoogleOAuthError: If token verification fails
    """
    if not GOOGLE_CLIENT_ID:
        raise GoogleOAuthError("GOOGLE_CLIENT_ID environment variable not set")

    try:
        idinfo = id_token.verify_oauth2_token(
            token,
            requests.Request(),
            GOOGLE_CLIENT_ID
        )

        # Verify the issuer
        if idinfo['iss'] not in ['accounts.google.com', 'https://accounts.google.com']:
            raise GoogleOAuthError("Invalid token issuer")

        # Verify the audience (client ID)
        if idinfo['aud'] != GOOGLE_CLIENT_ID:
            raise GoogleOAuthError("Invalid token audience")

        return {
            'google_id': idinfo['sub'],  # Unique Google user ID
            'email': idinfo.get('email'),
            'email_verified': idinfo.get('email_verified', False),
            'name': idinfo.get('name'),
            'picture': idinfo.get('picture'),
        }

    except ValueError as e:
        raise GoogleOAuthError(f"Token verification failed: {str(e)}")
