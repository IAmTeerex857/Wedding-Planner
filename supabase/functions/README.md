# Edge Functions

## Email configuration

Set server-only secrets in Supabase:

```sh
supabase secrets set RESEND_API_KEY=... RESEND_FROM_EMAIL="Wedding Office <hello@your-domain.com>"
```

Deploy the authenticated email function:

```sh
supabase functions deploy send-notification
supabase functions deploy exchange-rate
supabase functions deploy process-notifications
supabase functions deploy agent-message
supabase functions deploy review-action-batch
supabase functions deploy analyze-document
```

`send-notification` validates the caller's Supabase session and workspace membership before contacting Resend. The service-role key is provided automatically by Supabase and is never sent to the browser.

`exchange-rate` retrieves a daily NGN conversion from `open.er-api.com`, stores the dated snapshot, and reuses stored rates. Historical dates without an existing snapshot require manual entry.

`process-notifications` is a service-role-only queue worker. Schedule it from Supabase Cron with the service-role bearer token; it sends due task and payment reminders and records delivery results.

## I Do AI workflow

Set the Trigger.dev key only in Supabase Edge Function secrets, then deploy:

```sh
supabase secrets set TRIGGER_SECRET_KEY=... APP_URL=https://your-production-domain.example
supabase functions deploy agent-message
supabase functions deploy review-action-batch
```

`agent-message` requires a Supabase user bearer token, verifies `workspace_members`, stores an idempotent conversation turn, and queues `ido-ai-agent-turn`. `review-action-batch` atomically records a member's decision and queues the allowlisted domain executor after approval.

The Trigger.dev environment needs `OPENAI_API_KEY`, `APIFY_TOKEN`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`. Keep all four server-only. Deploy Trigger tasks after applying `202609070001_i_do_ai.sql`.

`send-notification` also sends planner invitation links. `APP_URL` is server-controlled so invitation emails cannot be redirected to an arbitrary domain.
