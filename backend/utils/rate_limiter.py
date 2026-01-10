from fastapi import Request, HTTPException, status
import time
from collections import defaultdict
from typing import Dict, List

class RateLimiter:
    def __init__(self, requests_limit: int, time_window: int):
        self.requests_limit = requests_limit
        self.time_window = time_window  # in seconds
        self.ip_requests: Dict[str, List[float]] = defaultdict(list)
        self.cleanup_interval = 600  # Cleanup every 10 minutes
        self.last_cleanup = time.time()

    def _get_client_ip(self, request: Request) -> str:
        """
        Get the real client IP, respecting X-Forwarded-For if behind a proxy.
        Prioritize X-Forwarded-For > request.client.host
        """
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            # X-Forwarded-For: <client>, <proxy1>, <proxy2>
            # We want the first one (the client)
            return forwarded_for.split(",")[0].strip()

        return request.client.host or "127.0.0.1"

    async def __call__(self, request: Request):
        client_ip = self._get_client_ip(request)
        current_time = time.time()

        # Periodic cleanup to prevent memory leaks
        if current_time - self.last_cleanup > self.cleanup_interval:
            self._cleanup(current_time)
            self.last_cleanup = current_time

        # Get requests for this IP
        request_times = self.ip_requests[client_ip]

        # Filter out requests older than the time window
        request_times = [t for t in request_times if current_time - t < self.time_window]
        self.ip_requests[client_ip] = request_times

        if len(request_times) >= self.requests_limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please try again later."
            )

        # Add current request timestamp
        self.ip_requests[client_ip].append(current_time)
        return True

    def _cleanup(self, current_time: float):
        """Remove IP entries that haven't made requests recently"""
        ips_to_remove = []
        for ip, timestamps in self.ip_requests.items():
            # If the newest timestamp is older than the time window, the IP can be removed
            if not timestamps or (current_time - timestamps[-1] > self.time_window):
                ips_to_remove.append(ip)

        for ip in ips_to_remove:
            del self.ip_requests[ip]

# Create specific rate limiters
# 5 requests per minute for sensitive auth operations
# Note: In a real distributed system, use Redis. For this app, memory is fine.
auth_rate_limiter = RateLimiter(requests_limit=5, time_window=60)

# 5 requests per minute for expensive OCR operations
ocr_rate_limiter = RateLimiter(requests_limit=5, time_window=60)

# 3 requests per hour for password reset (prevent abuse)
password_reset_rate_limiter = RateLimiter(requests_limit=3, time_window=3600)

# 3 requests per hour for email verification (prevent spam)
email_verification_rate_limiter = RateLimiter(requests_limit=3, time_window=3600)

# 5 requests per minute for profile updates (prevent spam)
profile_update_rate_limiter = RateLimiter(requests_limit=5, time_window=60)
