import os
import sys
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
import bcrypt
import secrets
import hashlib

SECRET_KEY = os.environ.get("SECRET_KEY")
SPLITWISER_ENV = os.environ.get("SPLITWISER_ENV", "development")

if not SECRET_KEY:
    if SPLITWISER_ENV.lower() == "production":
        raise ValueError("FATAL: SECRET_KEY env var is not set. Cannot start in production mode.")

    print("WARNING: SECRET_KEY not set. Using insecure default for development only.", file=sys.stderr)
    SECRET_KEY = "your-secret-key-keep-it-secret"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30  # Short-lived access token
REFRESH_TOKEN_EXPIRE_DAYS = 30  # Long-lived refresh token

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    """Create short-lived JWT access token"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire, "type": "access"})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def create_refresh_token() -> str:
    """Create cryptographically secure refresh token"""
    return secrets.token_urlsafe(32)

def hash_token(token: str) -> str:
    """Hash token for secure storage"""
    return hashlib.sha256(token.encode()).hexdigest()

def get_refresh_token_expiry() -> datetime:
    """Get expiry time for refresh token"""
    return datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

# Password Reset and Email Verification Token Configuration
PASSWORD_RESET_TOKEN_EXPIRE_HOURS = 1
EMAIL_VERIFICATION_TOKEN_EXPIRE_HOURS = 24

def create_password_reset_token() -> str:
    """Create cryptographically secure password reset token (32 bytes)"""
    return secrets.token_urlsafe(32)

def create_email_verification_token() -> str:
    """Create cryptographically secure email verification token (32 bytes)"""
    return secrets.token_urlsafe(32)

def get_password_reset_token_expiry() -> datetime:
    """Get expiry time for password reset token (1 hour)"""
    return datetime.utcnow() + timedelta(hours=PASSWORD_RESET_TOKEN_EXPIRE_HOURS)

def get_email_verification_token_expiry() -> datetime:
    """Get expiry time for email verification token (24 hours)"""
    return datetime.utcnow() + timedelta(hours=EMAIL_VERIFICATION_TOKEN_EXPIRE_HOURS)
