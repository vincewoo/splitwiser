"""
Splitwiser Backend API

A FastAPI backend for expense splitting and group management.
This module sets up the app and mounts routers - all endpoint logic is in routers/.
"""

import os
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import models
from database import engine

# Import routers
from routers import auth, groups, members, expenses, balances, friends, receipts


# Create database tables
models.Base.metadata.create_all(bind=engine)

# Create receipts directory if not exists
DATA_DIR = os.getenv("DATA_DIR", "data")
RECEIPT_DIR = os.path.join(DATA_DIR, "receipts")
os.makedirs(RECEIPT_DIR, exist_ok=True)

# Initialize FastAPI app
app = FastAPI(
    title="Splitwiser API",
    description="API for expense splitting and group management",
    version="1.0.0"
)

# Mount static files for receipts
app.mount("/static/receipts", StaticFiles(directory=RECEIPT_DIR), name="receipts")

# Security Headers Middleware
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = (
        "default-src 'none'; "
        "img-src 'self' data: https://fastapi.tiangolo.com; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
        "frame-ancestors 'none';"
    )
    return response

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict this to frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router)
app.include_router(groups.router)
app.include_router(members.router)
app.include_router(expenses.router)
app.include_router(balances.router)
app.include_router(friends.router)
app.include_router(receipts.router)
