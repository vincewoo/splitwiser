# Refresh Token Authentication

Secure authentication with short-lived access tokens and long-lived refresh tokens.

## Architecture

**Token Types:**
1. **Access Token (JWT)**
   - Short-lived (30 minutes)
   - Contains user email and expiry
   - Used for API authentication
   - Transmitted in Authorization header

2. **Refresh Token (Random)**
   - Long-lived (30 days)
   - Cryptographically secure random token (256-bit)
   - Stored hashed (SHA-256) in database
   - Used to obtain new access tokens

## Database Schema

**RefreshToken Model:**
- `id` - Primary key
- `user_id` - Owner of token
- `token_hash` - SHA-256 hash (plaintext never stored)
- `expires_at` - Expiry datetime
- `created_at` - Creation datetime
- `revoked` - Boolean flag for logout

## Authentication Flow

**Login:**
```
1. POST /token with credentials
2. Server validates password
3. Server creates access token (JWT, 30 min)
4. Server creates refresh token (random, 30 days)
5. Server stores HASHED refresh token in database
6. Server returns both tokens to client
7. Client stores both in localStorage
```

**Token Refresh:**
```
1. Access token expires (401 error)
2. Client POST /auth/refresh with refresh token
3. Server validates refresh token hash
4. Server checks not revoked and not expired
5. Server creates new access token
6. Client updates localStorage
7. Client retries original request
```

**Logout:**
```
1. Client POST /auth/logout with refresh token
2. Server marks token as revoked in database
3. Client clears localStorage
```

## Security Benefits
- Access tokens short-lived (minimizes attack window)
- Refresh tokens stored hashed (protects against DB breach)
- Token revocation on logout (prevents reuse)
- Automatic refresh provides seamless UX
- No password storage in client after login

## Frontend Implementation
- `AuthContext.tsx` implements automatic token refresh on 401
- Transparent retry logic for expired access tokens
- All API calls automatically use current access token

## Functions

**Backend ([auth.py](../backend/auth.py)):**
- `create_access_token(data)` - Generate JWT with 30 min expiry
- `create_refresh_token()` - Generate secure random token
- `hash_token(token)` - SHA-256 hash for storage
- `verify_access_token(token)` - Validate JWT

**Frontend ([AuthContext.tsx](../frontend/src/AuthContext.tsx)):**
- `refreshAccessToken()` - Exchange refresh token for new access token
- `fetchWithRefresh()` - Auto-retry on 401 with token refresh

# Email Notifications

Splitwiser supports transactional emails via Brevo API (optional feature).

## Email Service Architecture

**Email Utility ([backend/utils/email.py](../backend/utils/email.py)):**
- Brevo API integration (not SMTP)
- Async email sending with error handling
- HTML and plain text email templates
- Environment-based configuration
- Graceful fallback if not configured

## Email Types

1. **Password Reset**
   - Triggered by "Forgot Password" flow
   - Contains secure reset link (expires in 1 hour)
   - Sent via `send_password_reset_email()`

2. **Password Changed Notification**
   - Sent after successful password change
   - Security notification to alert user
   - Sent via `send_password_changed_notification()`

3. **Email Verification**
   - Sent when user changes email address
   - Contains verification link (expires in 24 hours)
   - Sent via `send_email_verification_email()`

4. **Email Change Notification**
   - Security alert sent to old email address
   - Notifies user of email change
   - Sent via `send_email_change_notification()`

5. **Friend Request Notification**
   - Sent when someone sends you a friend request
   - Contains link to view pending requests
   - Sent via `send_friend_request_email()`

## Configuration

**Environment Variables:**
- `BREVO_API_KEY` - Your Brevo API key
- `FROM_EMAIL` - Verified sender email in Brevo
- `FROM_NAME` - Sender display name (default: "Splitwiser")
- `FRONTEND_URL` - Base URL for email links

**Configuration Check:**
```python
from backend.utils.email import is_email_configured
if is_email_configured():
    # Email service is ready
```

## API Integration

**Brevo API:**
- Endpoint: `https://api.brevo.com/v3/smtp/email`
- Authentication: API key in request headers
- No SMTP configuration needed
- Free tier: 300 emails/day

## Error Handling

- Gracefully handles API failures (logs error, returns False)
- Timeout protection (10 second limit)
- Configuration validation before sending
- Detailed error logging for debugging

See [EMAIL_SETUP.md](../EMAIL_SETUP.md) for step-by-step configuration instructions.
