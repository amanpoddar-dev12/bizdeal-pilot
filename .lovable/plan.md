# Settings Page with Admin Management, Language & Theme

Add a new **Settings** section to the app, accessible from the sidebar for all authenticated users, with role-gated features.

## Sidebar entry
- Add `Settings` (Gear icon) to every role's sidebar in `src/components/app-sidebar.tsx`, pointing to `/settings`.

## Route
- New route `src/routes/_authenticated/settings.tsx` rendering a tabbed layout:
  - **Appearance** (all users): theme + language
  - **Admin users** (admin role only, conditionally rendered)

## Feature 1 — Admin creates admin accounts (admin only)

- New server fn `src/lib/admin-users.functions.ts`:
  - `createAdminUser` — `.middleware([requireSupabaseAuth])`, verifies caller has `admin` role via `context.supabase.rpc('has_role', { _user_id, _role: 'admin' })`. On pass, dynamically imports `supabaseAdmin` and calls `auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } })`, then inserts an `admin` row into `user_roles` (the `handle_new_user` trigger already creates the profile + default `client` role — we also remove that default `client` row so the new user is admin-only).
  - `listAdmins` — returns profiles joined with `user_roles` where role = admin (admin-gated).
- UI: Form with Zod validation (name ≥ 2, valid email, password ≥ 10 chars + complexity check, confirm-password match). On submit → toast success/error, refetch admin list, clear form. Show existing admin list below.
- Section is hidden entirely for non-admin roles (double-gated: UI check + server-side role check).

## Feature 2 — Language switcher (persisted)

- Install `i18next`, `react-i18next`, `i18next-browser-languagedetector`.
- New `src/i18n/index.ts` initializing i18next with resource bundles for **English** and **Hindi** (starter set; more can be added). Detector order: `localStorage` → `navigator`. Cache key: `kredix.lang`.
- Wrap app in i18n init (import once in `src/routes/__root.tsx`).
- Add `user_settings` table for cross-device persistence:
  - Columns: `user_id` (PK, FK auth.users), `language` text, `theme` text, timestamps.
  - RLS: user can select/insert/update their own row. Grants for authenticated + service_role.
- Server fns `src/lib/user-settings.functions.ts`: `getUserSettings`, `upsertUserSettings` (both `requireSupabaseAuth`).
- On login, hydrate i18n language + theme from `user_settings` (fallback to localStorage). On change → optimistic local update + persist to DB.
- Translate Settings page strings as the initial translated surface; other pages can be migrated later.

## Feature 3 — Dark mode

- Add `ThemeProvider` in `src/components/theme-provider.tsx` managing `light | dark | system`, toggling the `dark` class on `<html>`. Persisted to localStorage under `kredix.theme` and synced to `user_settings.theme`.
- Mount provider in `__root.tsx` around `<Outlet />`.
- Settings → Appearance tab: theme selector (Light / Dark / System) + language selector (English / Hindi), each saving immediately.
- Add a compact theme toggle button in the authenticated header (`_authenticated/route.tsx`) for quick access.

## Database migration

```sql
CREATE TABLE public.user_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  language text NOT NULL DEFAULT 'en',
  theme text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;
GRANT ALL ON public.user_settings TO service_role;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own settings" ON public.user_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER user_settings_updated_at BEFORE UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

## Security notes
- Admin creation is server-verified with `has_role` before touching `supabaseAdmin` — never trust the client role.
- Password validated both client-side (zod) and by Supabase Auth policy.
- `user_settings` scoped strictly by `auth.uid()`.

## Files touched
- New: `src/routes/_authenticated/settings.tsx`, `src/lib/admin-users.functions.ts`, `src/lib/user-settings.functions.ts`, `src/i18n/index.ts`, `src/i18n/locales/{en,hi}.json`, `src/components/theme-provider.tsx`, `src/components/theme-toggle.tsx`
- Edit: `src/components/app-sidebar.tsx`, `src/routes/__root.tsx`, `src/routes/_authenticated/route.tsx`
- Migration: `user_settings` table
