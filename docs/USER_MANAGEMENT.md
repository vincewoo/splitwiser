# Guest User Management

Non-registered users can participate in expenses and later claim their profiles.

## Database Schema

**GuestMember Model:**
- `id` - Primary key
- `group_id` - Group the guest belongs to
- `name` - Guest's display name
- `created_by_id` - User who added the guest
- `claimed_by_id` - User who claimed this guest (nullable)
- `managed_by_id` - ID of manager (user or guest, nullable)
- `managed_by_type` - Type of manager: 'user' or 'guest' (nullable)

## Features

**1. Guest Creation**
- Any group member can add guests with just a name
- Guests can be payers or participants in expenses
- Endpoint: `POST /groups/{group_id}/guests`

**2. Guest Claiming**
- Registered users can claim guest profiles to merge expense history
- All expenses where guest was payer transfer to claiming user
- All expense splits involving guest transfer to claiming user
- Claiming user automatically added to group if not already member
- Endpoint: `POST /groups/{group_id}/guests/{guest_id}/claim`

**3. Guest Management (Balance Aggregation)**
- Link a guest to a "manager" (registered user OR another guest)
- Guest's balance aggregates with manager's balance in balance view
- Guest still appears separately in expense details
- Prevents circular management (cannot manage self)
- Cannot manage claimed guests
- Auto-unlink when manager leaves group
- Endpoints:
  - `POST /groups/{group_id}/guests/{guest_id}/manage` - Link to manager
  - `DELETE /groups/{group_id}/guests/{guest_id}/manage` - Unlink

## Example Use Case

```
1. Alice adds "Bob's Friend" as guest to group
2. Guest participates in several expenses
3. Bob registers and claims guest profile
4. All guest expenses transfer to Bob
5. Bob is automatically added to the group
```

## Frontend Components
- `ManageGuestModal.tsx` - UI for linking guests to managers
- `AddGuestModal.tsx` - Simple form to add guest by name
- Visual indicators show managed guest relationships in balance view

# Member Management for Registered Users

Similar to guest management, registered users can also be managed for balance aggregation.

## Database Schema

**GroupMember Model Additions:**
- `managed_by_id` - ID of manager (user or guest, nullable)
- `managed_by_type` - Type of manager: 'user' or 'guest' (nullable)

## Features

**1. Member Management**
- Link registered members to a manager (registered user OR guest)
- Member's balance aggregates with manager's balance in balance view
- Member still appears separately in expense details
- Prevents circular management (cannot manage self)
- Auto-unlink when manager leaves group
- Endpoints:
  - `POST /groups/{group_id}/members/{member_id}/manage` - Link to manager
  - `DELETE /groups/{group_id}/members/{member_id}/manage` - Unlink

**2. Visual Separation**
- Group Detail Page shows "Splitwisers" section for registered users
- Separate "Guests" section for non-registered users
- Clear visual distinction between member types

## Example Use Case

```
1. Alice and Bob are both registered users in a group
2. They're a couple and want to see their combined balance
3. Alice links Bob as managed by her
4. Balance view now shows "Alice: $100 (Includes: Bob)"
5. Expense details still show individual transactions
```

## Frontend Components
- `ManageMemberModal.tsx` - UI for linking members to managers
- `GroupDetailPage.tsx` - Section headers distinguish Splitwisers from Guests
- Visual indicators show managed member relationships in balance view

## Migration Scripts
- `backend/migrations/add_member_management.py` - Adds columns to group_members table
- `backend/migrations/migrate.sh` - Helper for direct installations
- `backend/migrations/migrate-docker.sh` - Helper for Docker deployments
- See `backend/migrations/README.md` for detailed instructions

# Claimed Guest Display Names

When guests claim their accounts, they should display using their registered user name.

## Implementation

**Helper Functions ([backend/utils/display.py](../backend/utils/display.py)):**
- `get_guest_display_name(guest, db)` - Returns claimed user's `full_name` if applicable, otherwise `guest.name`
- `get_participant_display_name(user_id, is_guest, db)` - Unified helper for any participant

**Updated Locations:**
All locations displaying guest names now use these helpers:
- `backend/routers/auth.py` - Transfer managed_by on claim
- `backend/routers/balances.py` - Balance breakdown display
- `backend/routers/groups.py` - 8 locations updated
- `backend/routers/expenses.py` - 4 locations updated
- `backend/routers/friends.py` - 2 locations updated

**Migration Scripts:**
- `backend/migrations/fix_management_after_claim.py` - Fixes existing data where managed_by wasn't transferred
- `backend/migrations/fix_claimed_guest_management.py` - Guest claiming fixes

**Documentation:**
- See [BUGFIX_CLAIMED_GUEST_DISPLAY.md](../BUGFIX_CLAIMED_GUEST_DISPLAY.md) for detailed technical analysis

# Public Share Links

Enable read-only group sharing without requiring authentication.

## Database Schema

**Group Model Additions:**
- `share_link_id` - Unique UUID for the public share link (nullable)
- `is_public` - Boolean flag indicating if public sharing is enabled (default: false)

## How It Works

**Enabling Public Sharing:**
1. Group owner opens group settings
2. Toggles "Enable public sharing"
3. Backend generates unique `share_link_id` (UUID)
4. Frontend displays shareable URL

**Accessing Public Links:**
1. Anyone with the link can view group balances and expenses
2. No login required
3. Read-only access (no modifications allowed)
4. Expense details accessible via modal

## API Endpoints

- `PUT /groups/{group_id}` - Toggle `is_public` flag, generates `share_link_id`
- `GET /public/groups/{share_link_id}` - Get group details (no auth)
- `GET /public/groups/{share_link_id}/expenses/{expense_id}` - Get expense details (no auth)

## Frontend Implementation

- `GroupDetailPage.tsx` - Handles both authenticated and public views
- Uses `isPublicView` prop to toggle between edit/read-only modes
- Share button copies public URL to clipboard
- All edit buttons hidden in public view
