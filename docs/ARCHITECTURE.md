# Hotel Management System: Architecture

This document is the blueprint for the whole platform. Phase 1 is implemented in this repository; later phases extend the same schema, services and permission model rather than adding parallel ones.

## 1. Guiding principles

1. **One source of truth.** Every module reads and writes the same PostgreSQL database. Nothing is duplicated across modules: a room's state lives on `rooms`, money lives in the ledger, and every screen derives from those.
2. **Business logic lives in services, not in screens.** `src/server/services/*` holds every rule (availability, pricing, check-in, check-out, ledger posting). Server actions and API routes are thin wrappers that authenticate, authorize, validate input with Zod, and call a service.
3. **Every multi-record change is one database transaction.** A check-out posts charges, applies deposits, records payment, writes journal entries, closes the folio, changes the room and creates a housekeeping task in one `prisma.$transaction`. If any step fails, nothing is saved.
4. **The ledger is the financial truth.** Dashboards and reports read journal lines, never "amount" columns copied around the app. Posted entries are immutable; corrections are reversals.
5. **Idempotency on money and bookings.** Payments, bookings and journal entries carry unique keys (`idempotency_key`, `source_type + source_id + purpose`) so a double click or a network retry cannot create a second record.
6. **Tenant and property isolation.** Every operational row carries `property_id`; every query goes through `requirePropertyAccess()`. Users only see properties they are assigned to.
7. **No pretend integrations.** OTA, payment gateway, email, SMS and WhatsApp are behind adapter interfaces. Until real credentials are configured, the system records the message or sync as `NOT_CONFIGURED` and says so in the UI.

## 2. System architecture

```
Browser (Next.js App Router, React Server Components, Tailwind)
   │  forms → Server Actions          public booking engine / OTA webhooks → Route Handlers (/api/*)
   ▼
Auth & RBAC layer  (session cookie → user → roles → permissions → property scope)
   ▼
Domain services  (src/server/services)
   availability · pricing · reservations · front-desk · folio · ledger · housekeeping
   maintenance · pos · inventory · procurement · hr · payroll · crm · notifications · audit
   ▼
Prisma ORM  ──►  PostgreSQL  (constraints, exclusion constraint for double-booking, indexes)
   ▼
Adapters  (email, SMS, WhatsApp, payment gateway, OTA channel manager, file storage)
```

- **Frontend:** Next.js 15, React 19, TypeScript, Tailwind CSS v4, shadcn-style components (in `src/components/ui`), Lucide icons, Recharts.
- **Backend:** Next.js Server Actions for app mutations; Route Handlers for public/external APIs (booking engine, webhooks).
- **Database:** PostgreSQL 16 via Prisma 6. Money uses `NUMERIC(14,2)`.
- **Hosting:** Vercel (or any Node host) + managed PostgreSQL (Supabase/Neon/RDS). File storage via an S3-compatible adapter (Supabase Storage).
- **Background work:** a `jobs` table plus a cron route (night audit, reminders, low-stock checks, notification dispatch). Can move to a queue later without changing services.

## 3. Multi-property model

`organizations` 1─* `properties`. Users belong to one organization and are granted access to specific properties through `user_properties`. Roles are defined per organization and can be granted globally or for a single property (`user_roles.property_id` nullable). Every operational table (rooms, reservations, folios, journal entries, employees, inventory) carries `property_id`; consolidated reports aggregate across the properties the user can see. The active property is chosen in the top bar and stored in a cookie, and re-checked on every request.

## 4. Database schema

The full schema is modelled below. Tables marked **(P1)** exist in Phase 1 (`prisma/schema.prisma`); the rest are added in their phase with the relationships shown.

### Platform & security
| Table | Purpose / key relations |
|---|---|
| organizations (P1) | Tenant root |
| properties (P1) | Hotels/branches; `organization_id`; currency, time zone, check-in/out times, tax & service rates |
| users (P1) | `organization_id`, password hash, status, failed-login counters, `department_id` |
| roles (P1) | `organization_id`, `key`, `is_system` (built-ins cannot be deleted) |
| permissions (P1) | `module` × `action` catalogue (`reservations.create`) |
| role_permissions (P1) | role ↔ permission |
| user_roles (P1) | user ↔ role, optional `property_id` scope |
| user_properties (P1) | which properties a user can access |
| sessions (P1) | hashed session token, IP, user agent, expiry, revoked flag |
| login_attempts (P1) | rate limiting and lockout |
| audit_logs (P1) | who did what, before/after JSON, IP, entity reference |
| sequences (P1) | per-property counters for booking refs, invoice numbers, receipts |
| idempotency_keys (P1) | request de-duplication for payments and bookings |
| hotel_settings | (in Phase 1 the key settings live on `properties`) |
| notifications (P1), notification_templates, notification_preferences | in-app + channel delivery log |

### Rooms & inventory of rooms
| Table | Purpose |
|---|---|
| room_types (P1) | name, code, base occupancy, max occupancy, base price, extra adult/child charge, bed config, size |
| amenities (P1), room_type_amenities (P1), room_amenities (P1) | amenity catalogue per type and per room |
| room_rates (P1) | rate rules: seasonal date ranges, weekend days, holidays, priority |
| rooms (P1) | number, name, floor, building/wing, type, `occupancy_status`, `housekeeping_status`, `service_status` |
| room_status_logs (P1) | full history of every status change |
| room_blocks (P1) | out-of-service / maintenance / blocked date ranges; excluded from availability |
| room_images | file storage references |

### Guests & CRM
| Table | Purpose |
|---|---|
| guests (P1) | profile, contact, nationality, company, VIP, category, preferences, marketing consent |
| guest_documents (P1) | ID type/number; access gated by `guests.view_sensitive` |
| loyalty_accounts, loyalty_transactions, coupons, campaigns, guest_feedback, complaints | Phase 5 / Phase 2 |

### Reservations & front desk
| Table | Purpose |
|---|---|
| reservations (P1) | booking ref, primary guest, source, status, dates, adults/children, totals, cancellation policy, corporate/group flags |
| reservation_rooms (P1) | each room line: room type, assigned room (nullable until assignment), dates, occupants, status. **Exclusion constraint** prevents two active lines overlapping on the same room |
| reservation_nights (P1) | per-night rate snapshot, extra-person charge, posted flag (drives revenue recognition) |
| reservation_guests (P1) | additional occupants |
| reservation_events (P1) | booking history: created, modified, extended, room changed, cancelled |
| check_ins / check_outs | captured as timestamps + user on `reservation_rooms` and as `reservation_events` |

### Billing & finance
| Table | Purpose |
|---|---|
| folios (P1) | one guest folio per reservation (and for walk-in POS accounts) |
| folio_transactions (P1) | charges, taxes, service charges, discounts, payments, refunds; each linked to its journal entry |
| payments (P1) | method, amount, reference, `idempotency_key`, kind (deposit / settlement / refund) |
| invoices (P1), invoice_items (P1) | final invoice snapshot at check-out |
| accounts (P1) | chart of accounts (asset, liability, equity, income, expense), hierarchical |
| journal_entries (P1), journal_lines (P1) | double-entry ledger; `source_type + source_id + purpose` unique; reversal link |
| refunds | via payments with kind REFUND |
| tax_rates, financial_years, accounting_periods, budgets, cost_centers, bank_accounts, bank_reconciliations, expenses, expense_categories | Phase 3 |

### Operations
| Table | Purpose |
|---|---|
| housekeeping_tasks (P1) | room, type (checkout clean, daily, deep, inspection), priority, assignee, status, due time, notes |
| maintenance_requests (P1 minimal, Phase 2 full) | room, category, priority, assignee, status, cost, blocks room when needed |
| housekeeping_issues, lost_found, minibar_postings, equipment, preventive_schedules | Phase 2 |
| service_categories, hotel_services, service_orders | Phase 2 (post to folio) |
| restaurants, dining_areas, restaurant_tables, menu_categories, menu_items, recipes, orders, order_items, kitchen_tickets | Phase 2 |
| event_venues, event_packages, event_bookings, event_items | Phase 5 |

### HR, inventory & procurement (Phase 4)
departments, employees, employee_documents, shifts, shift_assignments, attendance, leave_types, leave_policies, leave_requests, leave_balances, payroll_runs, payroll_items, salary_components, loans, evaluations, disciplinary_records, training_records; inventory_categories, inventory_items, units, warehouses, stock_locations, stock_batches, inventory_transactions, stock_transfers, suppliers, purchase_requests, purchase_orders, purchase_order_items, goods_received_notes, supplier_invoices, purchase_returns.

### Channel & booking engine (Phase 5)
channel_connections (credentials encrypted, status), channel_room_mappings, channel_rate_mappings, channel_sync_logs, ota_reservations_raw, rate_plans, packages, competitor_rates.

## 5. Roles & permissions (RBAC)

**Permissions** are `module.action` pairs. Actions: `view`, `create`, `edit`, `delete`, `approve`, `export`, plus special ones (`guests.view_sensitive`, `finance.view_sensitive`, `frontdesk.checkin`, `frontdesk.checkout`, `reservations.cancel`, `reservations.override_rate`, `users.manage_sessions`).

Modules: dashboard, reservations, frontdesk, rooms, guests, housekeeping, maintenance, restaurant, services, events, hr, payroll, finance, inventory, procurement, sales, reports, notifications, settings, users, roles, audit.

**Evaluation:** a user's effective permissions are the union over their active roles (global roles + roles scoped to the active property). `super_admin` bypasses checks. Every server action calls `requirePermission(code)` before touching data; the sidebar and dashboard widgets are filtered by the same function, so what a user sees and what they can do never disagree.

Default role grants (customizable; Super Admin can create custom roles):

| Role | Main grants |
|---|---|
| Super Admin | everything, all properties, user/role/session management |
| Hotel Owner | view + export everything, approve finance/payroll/procurement; no day-to-day edits |
| General Manager | full operations, approve, reports, users view |
| Hotel Administrator | settings, users, rooms, operations (no finance approve) |
| Front Desk Manager | reservations (all), front desk, guests incl. sensitive, rooms view/edit status, rate override, cancel |
| Receptionist | reservations create/edit, front desk check-in/out, guests create/edit, rooms view |
| Cashier | front desk view, folio payments, finance payments create |
| Accountant | finance (all except approve period close), reports, export |
| Auditor | read-only finance, audit log, reports, export |
| HR Manager | HR, attendance, leave, payroll create, employees sensitive |
| Housekeeping Manager | housekeeping all, rooms status, maintenance create |
| Housekeeping Staff | housekeeping view/edit own tasks |
| Maintenance Manager | maintenance all, rooms block |
| Restaurant Manager | restaurant/POS all, inventory view |
| Kitchen Staff | kitchen tickets view/edit |
| Inventory Manager | inventory all, procurement requests |
| Procurement Officer | procurement all, suppliers |
| Sales & Marketing Manager | sales, rates, CRM, guests view, reports |
| Security Staff | front desk view (in-house list), guests view (non-sensitive) |

Role-based dashboards: the dashboard is composed of widgets, each requiring a permission (finance KPIs need `finance.view`; front desk panels need `frontdesk.view`; housekeeping panels need `housekeeping.view`). The same page therefore shows a GM the full picture, a receptionist arrivals/departures, and a housekeeper their room queue.

## 6. Room state model

A room has three independent dimensions, so no state is lost when two things happen at once (an occupied room that is also flagged dirty during a stay):

- `occupancy_status`: `VACANT` | `OCCUPIED`
- `housekeeping_status`: `DIRTY` → `CLEANING_ASSIGNED` → `CLEANING_IN_PROGRESS` → `CLEAN` (inspection pending) → `INSPECTED`
- `service_status`: `IN_SERVICE` | `OUT_OF_SERVICE` | `UNDER_MAINTENANCE` | `BLOCKED`

The display status (Available, Reserved, Occupied, Dirty, Cleaning in Progress, Clean, Inspected, Out of Service, Under Maintenance, Blocked) is derived from these plus today's assigned arrivals. A room is **ready for check-in** only when it is `VACANT`, `IN_SERVICE`, and `INSPECTED` (or `CLEAN` if the property turns off mandatory inspection). Rooms not `IN_SERVICE` or with an overlapping `room_block` are excluded from availability.

## 7. Availability & double-booking prevention

- **Room-level:** a PostgreSQL exclusion constraint on `reservation_rooms` using `daterange(check_in, check_out)` and `room_id` where status is active. The database itself refuses an overlapping assignment, even under concurrent requests.
- **Type-level (unassigned lines):** inside the booking transaction we take a `pg_advisory_xact_lock` on the property, then check, for each night, that `sellable rooms of the type − overlapping active lines of the type ≥ requested`.
- Night-based: check-out day is not occupied (half-open interval `[check_in, check_out)`).

## 8. Pricing

`pricing.quote(roomType, checkIn, checkOut, adults, children)` returns a per-night breakdown: for each night pick the highest-priority matching `room_rate` (seasonal range, weekend days, holiday flag) or fall back to the base price; add extra-adult/child charges beyond base occupancy. Discounts, service charge and tax are applied on top using property settings. The breakdown is stored in `reservation_nights` so later price changes never alter existing bookings.

## 9. Core workflows

**W1 New reservation:** validate → lock property → check availability → create/attach guest → create reservation, room lines and nights (snapshot rates) → open folio → if advance paid: payment + journal *(Dr Cash/Bank, Cr Guest Deposits)* → booking event + audit + notification → confirmation voucher. Idempotent by key.

**W2 Check-in:** reservation must be CONFIRMED and arrival date ≤ today → verify guest ID (stored as guest document) → assign a ready room (exclusion constraint re-checks) → record occupants and timestamp → room `OCCUPIED` → reservation `CHECKED_IN` → folio active → check-in receipt.

**W3 Folio charges (night audit / services / restaurant):** each night's room charge is posted to the folio as charge + tax + service charge; journal *(Dr Accounts Receivable, Cr Room Revenue, Cr Taxes Payable, Cr Service Charge Revenue)*. Restaurant/service charges posted to a room use the same folio service with their revenue account.

**W4 Check-out:** post all unposted nights → apply discount (journal Dr Discounts Allowed, Cr AR) → apply deposits *(Dr Guest Deposits, Cr AR)* → take payment *(Dr Cash/Bank, Cr AR)* → if balance remains and the user has permission, leave it as receivable → generate invoice → reservation `CHECKED_OUT` → room `VACANT` + `DIRTY` → housekeeping task created → audit + notification. All one transaction.

**W5 Housekeeping:** task created on checkout → assign → start → mark clean → inspect → room `INSPECTED` (ready).

**W6 Inventory, W7 Payroll, W8 Financial reporting:** as specified; all post through the same `ledger.post()` service, which rejects unbalanced entries and duplicate source references.

**Cancellation:** reservation `CANCELLED`, lines released, cancellation fee per policy posted as revenue from deposit; refund of the remainder *(Dr Guest Deposits, Cr Cash/Bank)*.

## 10. Accounting rules enforced in code

- `ledger.post()` rejects entries where total debit ≠ total credit or any line has both or neither side.
- Unique `(source_type, source_id, purpose)` prevents duplicate postings.
- No delete path exists for journal entries; `ledger.reverse()` creates a mirror entry and links it.
- Every entry stores `source_type`, `source_id`, `created_by`, `property_id`.

Default chart of accounts (codes): 1000 Cash in Hand, 1010 Bank, 1100 Accounts Receivable (Guest Ledger), 1200 Inventory, 1500 Fixed Assets, 1510 Equipment; 2000 Accounts Payable, 2100 Guest Deposits, 2200 Taxes Payable, 2300 Salaries Payable, 2400 Loans Payable; 3000 Owner's Capital, 3100 Retained Earnings, 3200 Owner Drawings; 4000 Room Revenue, 4100 Restaurant Revenue, 4200 Laundry, 4300 Conference, 4400 Event, 4500 Spa, 4600 Other Service Revenue, 4650 Service Charge Revenue, 4900 Discounts Allowed (contra-revenue); 5000 Salaries & Wages, 5100 Utilities, 5200 F&B Cost, 5300 Housekeeping, 5400 Maintenance, 5500 Marketing, 5600 Internet, 5700 Rent, 5800 Administrative, 5900 Other.

## 11. Security

- Passwords hashed with bcrypt (cost 12). Accounts lock for 15 minutes after 5 failed attempts; login is also rate limited per IP.
- Sessions: random 32-byte token in an `HttpOnly`, `SameSite=Lax`, `Secure` (in production) cookie; only the SHA-256 hash is stored. Sessions can be listed and revoked; deactivating a user revokes all sessions.
- CSRF: Server Actions check the `Origin` header; there are no state-changing GET routes.
- Input validation with Zod on every action; Prisma parameterizes all SQL (the few raw queries use tagged templates).
- XSS: React escapes output; no `dangerouslySetInnerHTML` with user data.
- Sensitive data: ID documents need `guests.view_sensitive`; financial figures need `finance.view`.
- Audit log on every mutation with before/after values.

## 12. Code layout

```
prisma/schema.prisma, migrations/, seed.ts
src/app/(auth)/login
src/app/(app)/dashboard | reservations | frontdesk | rooms | guests | housekeeping | settings ...
src/app/api/...                     public / integration endpoints
src/components/ui                   design-system primitives
src/components/<module>             module components
src/server/auth                     session, password, rbac
src/server/services                 domain logic (pure, transactional)
src/server/actions                  server actions (authz + validation + service call)
src/lib                             money, dates, formatting, zod schemas
```

## 13. Phase plan

1. **Core hotel operations (this PR):** auth, RBAC, users/roles admin, sessions, audit log, dashboard, rooms & types & rates & status board, reservations (availability, pricing, groups, modify/extend/shorten/cancel, calendar with drag-and-drop), guests, front desk, check-in/out with folio, payments, invoice, ledger postings, auto housekeeping task.
2. Housekeeping, maintenance, services, restaurant POS, kitchen display.
3. Full accounting UI: chart of accounts, manual journals, AR/AP, expenses, bank, financial statements, period close.
4. HR, attendance, leave, payroll, inventory, procurement.
5. Booking engine, OTA adapters, CRM/loyalty, events, revenue management, consolidated multi-property.
6. QA, security testing, performance, deployment.
