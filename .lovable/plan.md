
# B2B Trade & Credit Management Platform — v1 Plan

Full-stack app on Lovable's TanStack Start + Lovable Cloud (Supabase) stack. Building the full spec in one pass, WhatsApp/cron deferred (stubbed with `wa.me` links + in-app notifications), seeded demo accounts for all three roles.

## Deferrals (explicit)
- **WhatsApp Business Cloud API + daily cron reminders** — replaced by click-to-send `wa.me` links from Admin/Employee UIs and in-app notifications. Edge function scaffold NOT built.
- **OTP auth, call recording, background GPS, OCR order slips** — per spec, out of scope.
- **KYC third-party providers** — abstraction file created, defaults to manual admin toggle.
- **SendGrid email** — Supabase Auth's built-in transactional email only.

## Stack decisions
- **Auth**: Lovable Cloud email/password + email verification. Google/Apple not requested — skip.
- **Roles**: separate `user_roles` table + `has_role()` security definer function (per platform rules — NEVER on profiles). The spec's `profiles.role` column is replaced by this pattern.
- **Data reads**: TanStack Query (`ensureQueryData` + `useSuspenseQuery`) via `createServerFn` with `requireSupabaseAuth`.
- **Realtime**: Supabase channels for `orders`, `invoices`, `notifications`.
- **Storage**: private bucket `kyc-documents` + `task-attachments`, signed URLs.
- **PDF**: `jspdf` + `jspdf-autotable` client-side (payslips, invoice/ledger export).
- **CSV**: `papaparse`.
- **Charts**: `recharts`.
- **Maps**: Google Maps Embed API iframe (requires `VITE_GOOGLE_MAPS_EMBED_KEY` — will prompt).
- **Forms**: `react-hook-form` + `zod`.

## Route structure
```
/                              → landing, redirects by role after login
/auth                          → sign in / sign up (public)
/reset-password                → password reset target (public)
/_authenticated/
  dashboard                    → role-router (redirects to /admin, /employee, or /client home)
  admin/
    index                      → KPIs + reporting
    employees                  → list + CRUD + payslip
    employees/$id
    customers                  → list + CRUD + KYC
    customers/$id
    orders                     → list + create + detail
    orders/$id
    invoices                   → list + generate + record payment
    invoices/$id
    credit                     → credit purse + overdue report
    audit                      → audit log viewer
    locations                  → employees on map
  employee/
    index                      → today: tasks, clock, clients
    clients                    → assigned client list
    orders/new                 → order punching
    tasks
    location                   → share location button
    duty                       → clock in/out
  client/
    index                      → outstanding + activity
    orders                     → accept/decline/request changes
    invoices                   → accept/decline + download
    ledger                     → hisab view
    profile                    → KYC docs upload
```

## Database (single migration, per platform rules)

Tables:
- `profiles(id→auth.users, email, name, phone, avatar_url, created_at, updated_at)` + `handle_new_user()` trigger
- `app_role` enum (`admin`, `employee`, `client`)
- `user_roles(id, user_id, role, unique(user_id, role))` + `has_role(_user_id, _role)` SECURITY DEFINER
- `employee_profiles(id→profiles, reporting_manager_id, territory, order_limit, max_order_value, commission_rate, base_salary, penalty_rate, active)`
- `clients(id, user_id→profiles, business_name, business_type, contact_person, email, phone, gst_number, pan_encrypted, address, bank_account, credit_limit, credit_terms, penalty_rate_per_day, kyc_verified, active, ...)`
- `client_employees(client_id, employee_id)` — assignment junction (needed so employee RLS doesn't depend on orders existing)
- `orders(id, order_number, client_id, employee_id, order_date, delivery_date, status, total_amount, notes, change_request jsonb)`
- `order_items(id, order_id, product_name, product_code, quantity, rate, amount)`
- `invoices(id, invoice_number, order_id, client_id, invoice_date, due_date, amount, status, payment_date, payment_amount, penalty_amount)`
- `payments(id, invoice_id, client_id, amount, payment_date, method, notes)` — split out for partial-payment history
- `ledger_entries(id, client_id, type, reference_id, amount, running_balance, date, notes)`
- `credit_purse(id, client_id unique, credit_limit, used_credit, remaining_credit, utilization_percent, last_updated)` — refreshed by trigger
- `tasks(id, employee_id, assigned_by, title, description, due_date, status, completed_date, notes)`
- `task_attachments(id, task_id, file_url, filename)`
- `duty_sessions(id, employee_id, clock_in_time, clock_out_time, duration_minutes)`
- `employee_locations(id, employee_id, latitude, longitude, accuracy_meters, timestamp)`
- `notifications(id, user_id, type, title, message, reference_id, status, created_at, read_at)`
- `notification_logs(id, user_id, channel, message, delivery_status, sent_at, error_message)`
- `audit_logs(id, actor_id, action, target_type, target_id, old_value jsonb, new_value jsonb, timestamp)`

Every `CREATE TABLE` in public gets `GRANT SELECT,INSERT,UPDATE,DELETE ... TO authenticated;` + `GRANT ALL ... TO service_role;` and `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`.

RLS pattern (examples — full set in migration):
- Admin all-access via `has_role(auth.uid(), 'admin')` on every table
- Client rows: `client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())`
- Employee rows: assigned via `client_employees` OR authored via `employee_id = auth.uid()`
- `user_roles`: users read own row; only admin writes
- `notifications`: user reads/updates own only

Triggers:
- `handle_new_user()` → creates `profiles` row + default `client` role on signup
- `update_credit_purse()` on invoice/payment change → refresh snapshot
- `write_ledger_entry()` on order confirm / invoice approve / payment insert
- `updated_at` timestamps

## Server functions (`src/lib/*.functions.ts`)
`auth`, `clients`, `orders`, `invoices`, `payments`, `ledger`, `tasks`, `duty`, `locations`, `employees`, `notifications`, `audit`, `reports`, `kyc`. All use `.middleware([requireSupabaseAuth])` except public read-only (none needed here).

Role checks inside handlers via `context.supabase.rpc('has_role', ...)` before privileged operations. `supabaseAdmin` used only for: creating employee/client user accounts (admin action) and seed script.

## KYC abstraction
`src/services/kycVerificationService.ts` with `verifyGST` / `verifyPAN`; provider switch reads `VITE_KYC_PROVIDER` (default `manual` → returns `{verified: null}` so admin toggles manually).

## Notifications
- In-app: insert into `notifications`; UI subscribes via Supabase channel, shows bell + toast.
- WhatsApp v1: `wa.me/<phone>?text=<encoded>` link buttons on order/invoice detail pages for admin & employee.
- Reminder cron: NOT built. `notification_logs` schema is present so future cron can log.

## Seed data (in migration)
Three demo accounts via `supabaseAdmin` seed migration:
- `admin@demo.com` / `Demo1234!` → admin role
- `employee@demo.com` / `Demo1234!` → employee + `employee_profiles`
- `client@demo.com` / `Demo1234!` → client + `clients` row + assigned to demo employee

Plus: 3 orders (pending / confirmed / invoiced), 2 invoices (one paid, one overdue with penalty), 1 payment, 2 tasks, credit purse populated.

## Design system
Dark professional business palette (deep navy `#0f172a` bg, indigo `#4f46e5` primary, emerald success, amber warn, rose destructive) — all as HSL/oklch tokens in `src/styles.css`. Inter for body, but pair with `Space Grotesk` for headings to avoid generic AI look. All shadcn components consumed via semantic tokens only.

Sidebar navigation (shadcn sidebar) per role, collapsible to icon rail. Mobile-first for `/employee/*` routes (large tap targets, 16px+ text).

## Build order
1. Enable Lovable Cloud
2. Migration: enums, tables, GRANTs, RLS, triggers, `has_role`, seed accounts + demo data
3. Prompt for `VITE_GOOGLE_MAPS_EMBED_KEY` (optional, gate the map behind availability)
4. Design tokens + fonts + shadcn sidebar shell
5. `/auth`, `/reset-password`, root role-router
6. `_authenticated` layout (managed) + role-scoped sidebars
7. Server fns + hooks per domain (clients, orders, invoices, payments, ledger, credit, tasks, duty, locations, notifications, audit, reports, employees, kyc)
8. Admin dashboard (KPIs, employees, customers, orders, invoices, credit, audit, locations, reports w/ Recharts)
9. Employee dashboard (mobile-first: clients, order punching, tasks, clock, share-location, wa.me buttons)
10. Client dashboard (orders accept/decline/request-changes, invoices accept/decline + PDF download, ledger + CSV export, KYC upload)
11. Realtime subscriptions on notifications + orders/invoices
12. Payslip PDF generator, ledger CSV export
13. Head metadata per route, verify build

## Technical constraints (from platform rules)
- `supabaseAdmin` never imported at module scope of `.functions.ts` — dynamic `await import(...)` inside handlers
- Every route has `errorComponent` + `notFoundComponent`
- `<Link>` + `params` for all dynamic navigation
- No og:image on `__root`; leaf routes get their own head()
- Sign-in affordance reflects session state; sign-out clears query cache

## Files not built in v1
- `supabase/functions/send-whatsapp-*/` — deferred
- Any cron/EasyCron wiring — deferred
- Real KYC provider client — deferred (interface only)
