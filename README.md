# Timmy & Bisola Wedding Planner

Private React application for planning the Court, Traditional, and White weddings.

## Local development

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local`.
3. Add the Supabase project URL and anon key.
4. Run `npm run dev`.

Without Supabase variables, the app runs in preview mode with non-persistent placeholder data.

## Supabase

Apply every migration from `supabase/migrations` in filename order. Create Timmy and Bisola as email/password users in Supabase Auth with confirmed emails. The first owner creates the workspace in the app, then adds the second owner's existing email from Settings.

Server-only credentials, including `RESEND_API_KEY`, must be configured as Supabase Edge Function secrets and must never use the `VITE_` prefix. Deployment instructions are in `supabase/functions/README.md`.

## Commands

- `npm run dev`: start the local development server
- `npm run build`: type-check and create a production build
- `npm run lint`: run Oxlint
- `npm test`: run unit tests
- `npm run preview`: preview the production build

## Current integrations

- Authenticated workspace onboarding and two-owner access
- Persistent ceremonies, tasks, guests, RSVP records, tags, accommodation, budgets, expenses, contributions, and Traditional requirements
- CSV, XLSX, and pasted guest imports
- Installable PWA shell with offline navigation fallback
- Deployed Resend, exchange-rate, and notification-processing Edge Functions
- Server-enforced seating capacity, two-owner membership, and atomic guest imports
- Private file storage and 30-day recycle-bin recovery

## Vercel

Import this directory as a Vercel project. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Production and Preview environment variables. `vercel.json` provides SPA routing and baseline security headers. Resend remains server-side in Supabase and must not be added to Vercel.

## Scheduled reminders

In Supabase Dashboard, open **Integrations → Cron**, create an Edge Function job for `process-notifications`, and use `*/5 * * * *` as the schedule. The worker atomically claims due reminders and creates the Sunday 18:00 Africa/Lagos weekly summary. Configure the invocation with the project's service-role authorization through Supabase's Edge Function scheduler; never place that key in this repository.
