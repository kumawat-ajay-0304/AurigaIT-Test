# Dream cafe

A phone-first cafe membership and rewards system built with React, Vite, Express, and SQLite.

## Setup

Requirements:

- Node.js 20+
- npm

From the repository root:

```bash
cd DreamCafe
npm install
```

The application database is created at `server/dream-cafe.sqlite` on first API startup. The database file is local runtime data and is ignored by git.

## Run

Start the frontend and API together:

```bash
npm run dev
```

Open http://localhost:5173/.

The API runs on http://localhost:3001/. Vite proxies `/api` requests to the API during development.

Run services separately when needed:

```bash
npm run api
npm run dev:frontend
```

## Debug

1. Start with `npm run dev`.
2. Use the browser developer tools Network tab to inspect `/api` requests.
3. Check API availability with `curl http://localhost:3001/api/health`.
4. Check the notification outbox with `curl http://localhost:3001/outbox`.
5. Run `npm run build` for TypeScript and production-build errors.
6. Run `npm run lint` for frontend lint errors.
7. Run `node --check server/index.js` for API syntax errors.

For staff access, create a local staff account from `DreamCafe/`:

```bash
STAFF_NAME="Cafe Staff" STAFF_EMAIL="staff@example.com" STAFF_PASSWORD="password123" npm run create:staff
```

Use that account through the normal login page. Each browser tab has its own session, so staff and customer accounts can be used at the same time.

## API endpoints

### Authentication

- `POST /api/auth/register` creates a customer membership. Body: `name`, `email`, optional `phone`, and `password`.
- `POST /api/auth/login` authenticates a customer, staff member, or admin.
- `GET /api/auth/me` returns the authenticated account and customer profile.

### Menu and rewards

- `GET /api/menu` returns available menu items with rupee prices represented as paise.
- `POST /api/menu` creates a menu item. Staff/admin only.
- `PATCH /api/menu/:id` edits a menu item. Staff/admin only.
- `DELETE /api/menu/:id` permanently removes a menu item. Staff/admin only. Purchase history is preserved through item snapshots.
- `GET /api/rewards` returns active rewards.
- `POST /api/rewards/:id/redeem` spends customer points.

### Purchases and customers

- `POST /api/purchases` records a checked-out order and awards tier-based points atomically.
- `GET /api/customers/me` returns the current customer balance, tier, and purchase-day count.
- `GET /api/customers/me/activity` returns recent purchase activity.
- `GET /api/staff/customers` returns active customers, tiers, points, lifetime points, and purchase days. Staff/admin only.
- `DELETE /api/staff/customers/:id` removes a customer from active dashboards while keeping history. Staff/admin only.
- `POST /api/staff/customers/:id/reset-points` resets current and lifetime points and returns the member to Bronze. Staff/admin only.
- `POST /api/customers/me/cancel` cancels the current membership without deleting history.

### Loyalty and notifications

- `POST /clock` or `POST /api/clock` runs the deterministic 90-day unused-point expiry job. Body: `{ "now": "2026-09-17T00:00:00Z" }`.
- `GET /outbox` or `GET /api/outbox` returns tier-change notification events.
- `GET /api/health` checks API availability.

Tier thresholds are based on lifetime points: Bronze `0`, Silver `500`, Gold `1,500`, and Platinum `5,000`. Current earning rates are Bronze `1.0`, Silver `1.25`, Gold `1.5`, and Platinum `0.3` points per ₹1. Existing balances are preserved during tier-rule upgrades.

## Verify

```bash
npm run build
npm run lint
node --check server/index.js
```
