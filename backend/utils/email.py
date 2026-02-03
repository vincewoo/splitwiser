"""Email service using Brevo API for Splitwiser"""

import os
import logging
import requests
import html
from typing import Optional

# Configure logging
logger = logging.getLogger(__name__)

# Environment configuration
BREVO_API_KEY = os.getenv("BREVO_API_KEY")  # Your Brevo API key
FROM_EMAIL = os.getenv("FROM_EMAIL")  # Verified sender email in Brevo
FROM_NAME = os.getenv("FROM_NAME", "Splitwiser")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

# Brevo API endpoint
BREVO_API_URL = "https://api.brevo.com/v3/smtp/email"


def is_email_configured() -> bool:
    """Check if email service is properly configured"""
    return bool(BREVO_API_KEY and FROM_EMAIL)


async def send_email(
    to_email: str,
    subject: str,
    html_content: str,
    text_content: str
) -> bool:
    """
    Send an email via Brevo API

    Args:
        to_email: Recipient email address
        subject: Email subject line
        html_content: HTML version of email body
        text_content: Plain text version of email body

    Returns:
        bool: True if email sent successfully, False otherwise
    """
    if not is_email_configured():
        logger.error("Email service not configured: BREVO_API_KEY and FROM_EMAIL required")
        return False

    try:
        # Prepare Brevo API request
        headers = {
            "accept": "application/json",
            "api-key": BREVO_API_KEY,
            "content-type": "application/json"
        }

        payload = {
            "sender": {
                "name": FROM_NAME,
                "email": FROM_EMAIL
            },
            "to": [
                {
                    "email": to_email
                }
            ],
            "subject": subject,
            "htmlContent": html_content,
            "textContent": text_content
        }

        # Send request to Brevo API
        response = requests.post(
            BREVO_API_URL,
            json=payload,
            headers=headers,
            timeout=10
        )

        # Check response
        if response.status_code == 201:
            logger.info(f"Email sent successfully to {to_email} (Message ID: {response.json().get('messageId')})")
            return True
        else:
            logger.error(f"Brevo API error ({response.status_code}): {response.text}")
            return False

    except requests.exceptions.Timeout:
        logger.error("Brevo API request timed out")
        return False
    except requests.exceptions.RequestException as e:
        logger.error(f"Brevo API request failed: {e}")
        return False
    except Exception as e:
        logger.error(f"Unexpected error sending email: {e}")
        return False


async def send_password_reset_email(
    user_email: str,
    user_name: str,
    reset_token: str
) -> bool:
    """
    Send password reset email with reset link

    Args:
        user_email: User's email address
        user_name: User's full name
        reset_token: Password reset token (not hashed)

    Returns:
        bool: True if email sent successfully
    """
    reset_link = f"{FRONTEND_URL}/reset-password/{reset_token}"
    safe_user_name = html.escape(user_name)

    subject = "Reset Your Splitwiser Password"

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
            .header {{ background-color: #4F46E5; color: white; padding: 20px; text-align: center; }}
            .content {{ padding: 20px; background-color: #f9f9f9; }}
            .button {{ display: inline-block; padding: 12px 24px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }}
            .link-text {{ word-break: break-all; color: #1E40AF; background-color: #EFF6FF; padding: 12px; border-radius: 4px; font-family: monospace; font-size: 14px; }}
            .footer {{ padding: 20px; text-align: center; font-size: 12px; color: #666; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Password Reset Request</h1>
            </div>
            <div class="content">
                <p>Hi {safe_user_name},</p>
                <p>We received a request to reset your password for your Splitwiser account.</p>
                <p>Click the button below to reset your password:</p>
                <p style="text-align: center;">
                    <a href="{reset_link}" class="button">Reset Password</a>
                </p>
                <p>Or copy and paste this link into your browser:</p>
                <p class="link-text">{reset_link}</p>
                <p><strong>This link will expire in 1 hour.</strong></p>
                <p>If you didn't request a password reset, you can safely ignore this email. Your password will not be changed.</p>
            </div>
            <div class="footer">
                <p>This is an automated message from Splitwiser. Please do not reply to this email.</p>
            </div>
        </div>
    </body>
    </html>
    """

    text_content = f"""
Hi {user_name},

We received a request to reset your password for your Splitwiser account.

Click the link below to reset your password:
{reset_link}

This link will expire in 1 hour.

If you didn't request a password reset, you can safely ignore this email. Your password will not be changed.

---
This is an automated message from Splitwiser.
    """

    return await send_email(user_email, subject, html_content, text_content)


async def send_email_verification_email(
    user_email: str,
    user_name: str,
    new_email: str,
    verification_token: str
) -> bool:
    """
    Send email verification link to new email address

    Args:
        user_email: User's current email (not used, but kept for consistency)
        user_name: User's full name
        new_email: New email address to verify
        verification_token: Email verification token (not hashed)

    Returns:
        bool: True if email sent successfully
    """
    verification_link = f"{FRONTEND_URL}/verify-email/{verification_token}"
    safe_user_name = html.escape(user_name)

    subject = "Verify Your New Email Address - Splitwiser"

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
            .header {{ background-color: #4F46E5; color: white; padding: 20px; text-align: center; }}
            .content {{ padding: 20px; background-color: #f9f9f9; }}
            .button {{ display: inline-block; padding: 12px 24px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }}
            .link-text {{ word-break: break-all; color: #1E40AF; background-color: #EFF6FF; padding: 12px; border-radius: 4px; font-family: monospace; font-size: 14px; }}
            .footer {{ padding: 20px; text-align: center; font-size: 12px; color: #666; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Verify Your Email Address</h1>
            </div>
            <div class="content">
                <p>Hi {safe_user_name},</p>
                <p>Please verify your new email address for your Splitwiser account.</p>
                <p>Click the button below to verify this email address:</p>
                <p style="text-align: center;">
                    <a href="{verification_link}" class="button">Verify Email</a>
                </p>
                <p>Or copy and paste this link into your browser:</p>
                <p class="link-text">{verification_link}</p>
                <p><strong>This link will expire in 24 hours.</strong></p>
                <p>If you didn't request this email change, please contact support immediately.</p>
            </div>
            <div class="footer">
                <p>This is an automated message from Splitwiser. Please do not reply to this email.</p>
            </div>
        </div>
    </body>
    </html>
    """

    text_content = f"""
Hi {user_name},

Please verify your new email address for your Splitwiser account.

Click the link below to verify this email address:
{verification_link}

This link will expire in 24 hours.

If you didn't request this email change, please contact support immediately.

---
This is an automated message from Splitwiser.
    """

    return await send_email(new_email, subject, html_content, text_content)


async def send_email_change_notification(
    old_email: str,
    user_name: str,
    new_email: str
) -> bool:
    """
    Send notification to old email that address was changed

    Args:
        old_email: User's old email address
        user_name: User's full name
        new_email: New email address (partially masked for security)

    Returns:
        bool: True if email sent successfully
    """
    # Mask the new email for security
    new_email_parts = new_email.split('@')
    if len(new_email_parts) == 2:
        masked_email = new_email_parts[0][:2] + "***@" + new_email_parts[1]
    else:
        masked_email = "***"

    safe_user_name = html.escape(user_name)
    subject = "Your Splitwiser Email Address Has Been Changed"

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
            .header {{ background-color: #EF4444; color: white; padding: 20px; text-align: center; }}
            .content {{ padding: 20px; background-color: #f9f9f9; }}
            .warning {{ background-color: #FEF2F2; border-left: 4px solid #EF4444; padding: 10px; margin: 20px 0; }}
            .footer {{ padding: 20px; text-align: center; font-size: 12px; color: #666; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Security Alert</h1>
            </div>
            <div class="content">
                <p>Hi {safe_user_name},</p>
                <p>This is a security notification that the email address for your Splitwiser account has been changed.</p>
                <div class="warning">
                    <strong>New email address:</strong> {masked_email}
                </div>
                <p>If you made this change, you can safely ignore this email.</p>
                <p><strong>If you did NOT make this change:</strong></p>
                <ul>
                    <li>Your account may have been compromised</li>
                    <li>Contact support immediately</li>
                    <li>Change your password on all accounts that share the same password</li>
                </ul>
            </div>
            <div class="footer">
                <p>This is an automated security message from Splitwiser. Please do not reply to this email.</p>
            </div>
        </div>
    </body>
    </html>
    """

    text_content = f"""
Hi {user_name},

SECURITY ALERT

This is a security notification that the email address for your Splitwiser account has been changed.

New email address: {masked_email}

If you made this change, you can safely ignore this email.

If you did NOT make this change:
- Your account may have been compromised
- Contact support immediately
- Change your password on all accounts that share the same password

---
This is an automated security message from Splitwiser.
    """

    return await send_email(old_email, subject, html_content, text_content)


async def send_password_changed_notification(
    user_email: str,
    user_name: str
) -> bool:
    """
    Send notification that password was changed

    Args:
        user_email: User's email address
        user_name: User's full name

    Returns:
        bool: True if email sent successfully
    """
    safe_user_name = html.escape(user_name)
    subject = "Your Splitwiser Password Has Been Changed"

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
            .header {{ background-color: #10B981; color: white; padding: 20px; text-align: center; }}
            .content {{ padding: 20px; background-color: #f9f9f9; }}
            .info {{ background-color: #F0FDF4; border-left: 4px solid #10B981; padding: 10px; margin: 20px 0; }}
            .footer {{ padding: 20px; text-align: center; font-size: 12px; color: #666; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Password Changed Successfully</h1>
            </div>
            <div class="content">
                <p>Hi {safe_user_name},</p>
                <p>This is a confirmation that your Splitwiser account password has been changed successfully.</p>
                <div class="info">
                    <p>For your security, you have been logged out of all other devices.</p>
                </div>
                <p>If you made this change, you can safely ignore this email.</p>
                <p><strong>If you did NOT make this change:</strong></p>
                <ul>
                    <li>Your account may have been compromised</li>
                    <li>Contact support immediately</li>
                    <li>Use the "Forgot Password" feature to reset your password</li>
                </ul>
            </div>
            <div class="footer">
                <p>This is an automated security message from Splitwiser. Please do not reply to this email.</p>
            </div>
        </div>
    </body>
    </html>
    """

    text_content = f"""
Hi {user_name},

This is a confirmation that your Splitwiser account password has been changed successfully.

For your security, you have been logged out of all other devices.

If you made this change, you can safely ignore this email.

If you did NOT make this change:
- Your account may have been compromised
- Contact support immediately
- Use the "Forgot Password" feature to reset your password

---
This is an automated security message from Splitwiser.
    """

    return await send_email(user_email, subject, html_content, text_content)


async def send_friend_request_email(
    to_email: str,
    to_name: str,
    from_name: str
) -> bool:
    """
    Send friend request notification email

    Args:
        to_email: Email address of the user receiving the friend request
        to_name: Full name of the user receiving the request
        from_name: Full name of the user sending the request

    Returns:
        bool: True if email sent successfully
    """
    friend_requests_link = f"{FRONTEND_URL}/account"

    safe_to_name = html.escape(to_name)
    safe_from_name = html.escape(from_name)

    subject = f"{from_name} sent you a friend request on Splitwiser"

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
            .header {{ background-color: #4F46E5; color: white; padding: 20px; text-align: center; }}
            .content {{ padding: 20px; background-color: #f9f9f9; }}
            .button {{ display: inline-block; padding: 12px 24px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }}
            .info {{ background-color: #EFF6FF; border-left: 4px solid #4F46E5; padding: 10px; margin: 20px 0; }}
            .link-text {{ word-break: break-all; color: #1E40AF; background-color: #EFF6FF; padding: 12px; border-radius: 4px; font-family: monospace; font-size: 14px; }}
            .footer {{ padding: 20px; text-align: center; font-size: 12px; color: #666; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>New Friend Request</h1>
            </div>
            <div class="content">
                <p>Hi {safe_to_name},</p>
                <p><strong>{safe_from_name}</strong> has sent you a friend request on Splitwiser!</p>
                <div class="info">
                    <p>Adding friends makes it easy to split expenses and keep track of who owes what.</p>
                </div>
                <p>Click the button below to view and respond to the request:</p>
                <p style="text-align: center;">
                    <a href="{friend_requests_link}" class="button">View Friend Request</a>
                </p>
                <p>Or copy and paste this link into your browser:</p>
                <p class="link-text">{friend_requests_link}</p>
            </div>
            <div class="footer">
                <p>This is an automated message from Splitwiser. Please do not reply to this email.</p>
            </div>
        </div>
    </body>
    </html>
    """

    text_content = f"""
Hi {to_name},

{from_name} has sent you a friend request on Splitwiser!

Adding friends makes it easy to split expenses and keep track of who owes what.

Click the link below to view and respond to the request:
{friend_requests_link}

---
This is an automated message from Splitwiser.
    """

    return await send_email(to_email, subject, html_content, text_content)
