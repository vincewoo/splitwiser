# Progressive Web App (PWA)

Splitwiser is installable as a Progressive Web App with offline support.

## Architecture

**PWA Manifest ([frontend/public/manifest.json](../frontend/public/manifest.json)):**
- App name, description, and theme colors
- Start URL and display mode (standalone)
- Icon definitions (192x192, 512x512, maskable)
- Dark mode theme support

**Service Worker:**
- Caches static assets for offline use
- Intercepts network requests
- Provides fallback for offline scenarios
- Background sync for pending operations

**IndexedDB Storage ([frontend/src/db/schema.ts](../frontend/src/db/schema.ts)):**
- `expenses` table - Offline expense creation
- `groups` table - Cached group data
- `exchange_rates` table - Currency conversion offline
- `sync_queue` table - Pending operations to sync

## Offline API Wrapper ([frontend/src/services/offlineApi.ts](../frontend/src/services/offlineApi.ts))

Wraps standard API calls with offline fallback:
- Detects online/offline state
- Stores operations in IndexedDB when offline
- Returns cached data when offline
- Queues mutations for later sync

## Sync Manager ([frontend/src/services/syncManager.ts](../frontend/src/services/syncManager.ts))

Background sync for pending operations:
- Monitors online/offline state changes
- Processes sync queue when connection restored
- Retries failed operations
- Handles conflict resolution

## Features

**Offline Capabilities:**
- Create and edit expenses without internet
- View cached groups and balances
- Currency conversion using cached rates
- Queue operations for automatic sync

**Installation:**
- Install to home screen on iOS and Android
- Standalone app experience (no browser chrome)
- App icon on device home screen
- Launch like a native app

**Performance:**
- Fast loading via service worker caching
- Reduced network requests
- Instant UI feedback for offline operations

## Usage

**Exchange Rates Caching:**
```typescript
// Rates cached in IndexedDB for offline use
// Refreshed when online or when adding/editing expenses offline
```

**Offline Expense Creation:**
```typescript
// 1. User creates expense while offline
// 2. Stored in IndexedDB with pending status
// 3. Added to sync_queue
// 4. When online, sync manager processes queue
// 5. Expense created on server
// 6. Local copy updated with server response
```

# Mobile-Friendly Features

## Custom Dialogs

Replaced browser `alert()`, `prompt()`, and `confirm()` with custom modals:
- **AddFriendModal** - Custom friend request dialog
- **AddGuestModal** - Guest addition with validation
- **DeleteGroupConfirm** - Confirmation dialogs with proper styling
- Mobile-responsive with touch-friendly buttons

## iOS Keyboard Fix

Number inputs show numeric keypad on iOS:
```tsx
<input
  type="text"
  inputMode="decimal"
  pattern="[0-9]*"
/>
```

## Web Share API

Native sharing on mobile devices:
```typescript
if (navigator.share) {
  await navigator.share({
    title: 'Group Share',
    url: shareUrl
  });
} else {
  // Fallback to clipboard
  navigator.clipboard.writeText(shareUrl);
}
```

## PWA Theme

iPhone PWA with proper dark mode support:
- `theme-color` meta tag updates based on theme
- Maskable icons for Android adaptive icons
- Splash screen with app branding
