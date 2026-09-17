# Dream cafe implementation notes

## Product direction

The project began as a small phone-first rewards dashboard for Dream cafe. The implementation kept the interface focused on the recurring cafe workflow: browse the menu, build an order, check out, earn points, redeem benefits, and view membership details. Staff use the same authentication entry point but receive a separate operations view for members and menu management.

## Core design decisions

- **React and Vite:** keeps the mobile UI fast to iterate and easy to run locally.
- **Express and SQLite:** gives the project a small REST API and a durable local database without introducing infrastructure that is unnecessary for this stage.
- **Role-based authorization:** the account role is stored server-side and enforced by JWT middleware. The client chooses a dashboard from the authenticated role, but the API remains the source of authorization.
- **Per-tab sessions:** tokens use `sessionStorage`, so a staff tab and one or more customer tabs can be active simultaneously.
- **Purchase-driven visits:** staff do not manually record visits. Purchase dates are stored and visit counts are calculated from distinct purchase dates.
- **Soft customer deactivation:** cancelling or removing a membership hides it from active dashboards while preserving the user record, purchases, and points history.
- **Hard menu deletion with history snapshots:** menu rows can be physically deleted. Purchase lines retain the item name and price snapshot, so historical orders remain understandable and their foreign key can safely become null.
- **Cart checkout:** customer menu actions add items to a cart. Points are awarded only once the order is checked out as one purchase transaction.

## Loyalty implementation

Tier rules are data-driven through `tier_rules`. Lifetime points determine the highest tier a customer qualifies for. Current thresholds are Bronze `0`, Silver `500`, Gold `1,500`, and Platinum `5,000` lifetime points. Existing balances are not recalculated during migration; startup promotion only moves an active member upward when the stored lifetime total already qualifies.

Prices are stored in paise in the existing SQLite column and exposed by the API as `price_paise`. The UI displays rupees. Tier-specific earning uses the current tier's points-per-rupee rule at checkout.

Points are represented as ledger lots. The `/clock` job evaluates purchase lots older than 90 days, accounts for deductions in order, writes expiration ledger entries, and reduces the current usable balance. Lifetime points are intentionally not reduced by expiration, so a member's earned tier is not demoted when unused points expire.

## Notification flow

A tier promotion is detected inside the atomic purchase transaction by comparing the customer's previous tier rank with the calculated next tier. The notification service writes a `tier.changed` event to `notification_outbox` with the member, previous tier, new tier, and message. `/outbox` exposes the durable events for the notification-service boundary and grading.

## Testing and fixes

Validation was kept close to each change:

- `npm run build` catches TypeScript and Vite integration errors.
- `npm run lint` checks the React and API-adjacent source tree.
- `node --check server/index.js` catches server syntax errors.
- SQLite schema inspection verified tier rules, ledger expiry columns, active flags, and purchase snapshots.
- API smoke tests covered registration, login, customer purchase points, staff authorization, customer removal, menu deletion, tier promotion, notification outbox creation, and deterministic `/clock` responses.
- A stale API process caused several apparent 404s during development. Restarting the API and adding startup migrations exposed the real state and verified the routes against the current schema.
- A profile migration temporarily left dependent foreign keys pointing to `customer_profiles_legacy`. The server now repairs dependent tables while preserving their rows before continuing startup.

The current project is intentionally local-first. Production deployment should replace the development JWT secret, use environment configuration, add a managed database or migration tool, and connect the outbox to a real notification worker.
