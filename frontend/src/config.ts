/**
 * Application configuration
 * Centralizes environment-specific settings
 */

// Use relative URL in production (goes through nginx proxy), absolute in development
// In dev, use the current hostname so it works from other devices on the network
export const API_BASE_URL = import.meta.env.PROD
    ? '/api'
    : `http://${window.location.hostname}:8000`;
