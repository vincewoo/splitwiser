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
- `groups` table - Cached group data. Rows are *merged*, not replaced, when a
  `GET /groups` response is cached (see `services/groupCache.ts`): that endpoint
  carries no `members`/`guests`, so replacing would strip the roster off every
  group and the next offline read would report a full group as empty. The
  roster is only ever written by `GET /groups/{id}`, and only refreshed when
  that endpoint is called again — a list sync alone will not notice a
  membership change made on another device.
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
- **AddPersonSheet** - Adding a friend by email
- **AddGuestModal** - Guest addition with validation
- **DeleteGroupConfirm** - Confirmation dialogs with proper styling
- Mobile-responsive with touch-friendly buttons

## Pull to Refresh

Installed, the app owns the viewport: the shell is `overflow-hidden` and each
screen scrolls inside its own container, so the browser's pull-to-refresh
never fires — and would reload the whole app if it did.
`frontend/src/components/PullToRefresh.tsx` is the replacement, mounted once
around the shell's routed content on mobile.

- It listens for touches and finds whatever is scrolling under the finger
  (`utils/pullToRefresh.ts::scrollableAncestor`). A drag only becomes a pull
  when that scroller is at the top and the movement is downward; a scrolled
  list, a sideways swipe, or a touch inside a `role="dialog"` (a sheet being
  dragged down is a sheet being dismissed) are left alone.
- Once a pull is under way `touchmove` is cancelled, so the page does not
  rubber-band alongside the indicator. The `touchmove` listener is non-passive
  — the only way `preventDefault` can take over the gesture — which is also
  why the listeners are attached by hand rather than as React props. But it is
  only attached while an eligible pull is in progress: from a `touchstart`
  that passes `canStartPull` until the gesture ends or is cancelled. Ordinary
  scrolling never runs it, so it keeps the browser's passive fast path.
- The indicator lags the finger 2:1 and caps at `MAX_PULL`; letting go past
  `PULL_THRESHOLD` (64px of indicator travel) runs the refresh and holds the
  spinner until it lands.
- What it runs is `refreshAll()` from `AppDataContext` — the same refresh
  every mutation triggers — so a pull reaches every screen through
  `refreshGeneration` (below) rather than needing a per-screen hook.

### Refresh generation

`AppDataContext.refreshGeneration` is a counter bumped by every
`refreshAll()`. Screens that fetch their own data — `useGroupData`,
`useExpenseFeed`, `useSettlement`, `useOpenTabs`, the person page — put it in
their fetch effect's dependencies, so a mutation recorded anywhere (the
shell's add-expense modal behind the FAB, a settlement on `/settle`, an edit
from the activity feed, a pull to refresh) reaches the screen showing the
affected data without it remounting. The group Spending summary
(`SummarySection`) follows it too, receiving the generation as a prop from
`GroupPage`. Two surfaces stay out on purpose: `TabBoardPage` polls on its
own schedule, and the public share-link and claim pages live outside the app
shell, where no `AppDataProvider` refreshes exist.

This is what fixed "an expense added from the FAB does not appear in the
group until you back out and come back": the shell-mounted modal only ever
refreshed the four collections the context owns, and the group page's own
fetch had no way to hear about it. The initial load does not bump the
counter — screens mounting alongside the provider fetch on their own, and a
bump then would only make them fetch twice. Screens keep existing data on
screen while they re-fetch, so a refresh never flashes a spinner over content
that is already there — though how varies: `useSettlement`'s `loading` is
only true before the first load, while `useGroupData` and the person page
still flip `loading` on every refetch and rely on `loading && !group` /
`loading && !friend` render guards plus the stale data staying on screen.

## Viewport Lock

The viewport meta in `frontend/index.html` pins `maximum-scale=1.0,
user-scalable=no`, so the app renders at a fixed scale. iOS Safari ignores
that meta in-browser, so an inline script in the same file cancels the
WebKit-only `gesturestart`/`gesturechange` events — it looks redundant next
to the meta, but do not remove it as cleanup. This is a deliberate
accessibility tradeoff: pinch zoom is gone (WCAG 1.4.4), accepted because
the app-shaped PWA lays itself out for the screen rather than presenting a
document to magnify. It also stops iOS auto-zooming focused inputs.

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
