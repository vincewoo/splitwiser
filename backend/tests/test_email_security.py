import pytest
from unittest.mock import patch, MagicMock
import sys
import os

# Add backend to path if not already there
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from utils import email as email_utils

@pytest.mark.asyncio
async def test_send_friend_request_email_escapes_html():
    # Setup mocks
    with patch('utils.email.requests.post') as mock_post:
        # Configure email service to be "active"
        with patch.object(email_utils, 'BREVO_API_KEY', 'test_key'), \
             patch.object(email_utils, 'FROM_EMAIL', 'test@example.com'):

            # Setup response
            mock_response = MagicMock()
            mock_response.status_code = 201
            mock_response.json.return_value = {'messageId': '123'}
            mock_post.return_value = mock_response

            # Execute
            to_name_payload = "User <script>alert(1)</script>"
            from_name_payload = "Attacker <b>Bold</b>"

            await email_utils.send_friend_request_email(
                to_email="victim@example.com",
                to_name=to_name_payload,
                from_name=from_name_payload
            )

            # Verify
            mock_post.assert_called_once()
            call_args = mock_post.call_args
            # args[0] is url, kwargs['json'] is payload
            payload = call_args.kwargs['json']
            html_content = payload['htmlContent']

            # Check for escaped characters
            # We expect these assertions to FAIL initially
            assert "&lt;script&gt;" in html_content, "to_name was not escaped"
            assert "&lt;b&gt;" in html_content, "from_name was not escaped"
            assert "<script>" not in html_content, "raw script tag found"
            assert "<b>" not in html_content, "raw bold tag found"

@pytest.mark.asyncio
async def test_send_password_reset_email_escapes_html():
    with patch('utils.email.requests.post') as mock_post:
        with patch.object(email_utils, 'BREVO_API_KEY', 'test_key'), \
             patch.object(email_utils, 'FROM_EMAIL', 'test@example.com'):

            mock_response = MagicMock()
            mock_response.status_code = 201
            mock_post.return_value = mock_response

            user_name = "User <script>alert('reset')</script>"

            await email_utils.send_password_reset_email(
                user_email="victim@example.com",
                user_name=user_name,
                reset_token="abc"
            )

            call_args = mock_post.call_args
            payload = call_args.kwargs['json']
            html_content = payload['htmlContent']

            assert "&lt;script&gt;" in html_content
            assert "<script>" not in html_content

@pytest.mark.asyncio
async def test_send_email_verification_email_escapes_html():
    with patch('utils.email.requests.post') as mock_post:
        with patch.object(email_utils, 'BREVO_API_KEY', 'test_key'), \
             patch.object(email_utils, 'FROM_EMAIL', 'test@example.com'):

            mock_response = MagicMock()
            mock_response.status_code = 201
            mock_post.return_value = mock_response

            user_name = "User <script>alert('verify')</script>"

            await email_utils.send_email_verification_email(
                user_email="victim@example.com",
                user_name=user_name,
                new_email="new@example.com",
                verification_token="abc"
            )

            call_args = mock_post.call_args
            payload = call_args.kwargs['json']
            html_content = payload['htmlContent']

            assert "&lt;script&gt;" in html_content
            assert "<script>" not in html_content

@pytest.mark.asyncio
async def test_send_email_change_notification_escapes_html():
    with patch('utils.email.requests.post') as mock_post:
        with patch.object(email_utils, 'BREVO_API_KEY', 'test_key'), \
             patch.object(email_utils, 'FROM_EMAIL', 'test@example.com'):

            mock_response = MagicMock()
            mock_response.status_code = 201
            mock_post.return_value = mock_response

            user_name = "User <script>alert('change')</script>"
            # Attempt to inject via new_email if it were possible (e.g. valid email but tricky local part)
            # Standard email validation usually prevents chars like < >, but let's assume it gets through
            # or masked_email construction logic exposes something.
            new_email = "malicious<script>@example.com"

            await email_utils.send_email_change_notification(
                old_email="victim@example.com",
                user_name=user_name,
                new_email=new_email
            )

            call_args = mock_post.call_args
            payload = call_args.kwargs['json']
            html_content = payload['htmlContent']

            assert "&lt;script&gt;" in html_content, "user_name was not escaped"
            assert "<script>" not in html_content

            # Check masked email escaping
            # logic: masked_email = new_email_parts[0][:2] + "***@" + new_email_parts[1]
            # new_email = "malicious<script>@example.com"
            # parts = ["malicious<script>", "example.com"]
            # masked = "ma***@example.com"
            # So the script tag is actually removed by the masking logic in this case!
            # But let's try a case where it might remain if logic was different or input was different.

            # Let's try injecting in domain part maybe?
            # new_email = "user@example<script>.com"
            # masked = "us***@example<script>.com"

            # We'll re-run with domain injection

@pytest.mark.asyncio
async def test_send_email_change_notification_escapes_domain():
    with patch('utils.email.requests.post') as mock_post:
        with patch.object(email_utils, 'BREVO_API_KEY', 'test_key'), \
             patch.object(email_utils, 'FROM_EMAIL', 'test@example.com'):

            mock_response = MagicMock()
            mock_response.status_code = 201
            mock_post.return_value = mock_response

            user_name = "User"
            new_email = "user@example<script>.com"

            await email_utils.send_email_change_notification(
                old_email="victim@example.com",
                user_name=user_name,
                new_email=new_email
            )

            call_args = mock_post.call_args
            payload = call_args.kwargs['json']
            html_content = payload['htmlContent']

            assert "&lt;script&gt;" in html_content, "email domain was not escaped"
            assert "<script>" not in html_content

@pytest.mark.asyncio
async def test_send_password_changed_notification_escapes_html():
    with patch('utils.email.requests.post') as mock_post:
        with patch.object(email_utils, 'BREVO_API_KEY', 'test_key'), \
             patch.object(email_utils, 'FROM_EMAIL', 'test@example.com'):

            mock_response = MagicMock()
            mock_response.status_code = 201
            mock_post.return_value = mock_response

            user_name = "User <script>alert('pwd')</script>"

            await email_utils.send_password_changed_notification(
                user_email="victim@example.com",
                user_name=user_name
            )

            call_args = mock_post.call_args
            payload = call_args.kwargs['json']
            html_content = payload['htmlContent']

            assert "&lt;script&gt;" in html_content
            assert "<script>" not in html_content
