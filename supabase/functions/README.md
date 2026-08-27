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
```

`send-notification` validates the caller's Supabase session and workspace membership before contacting Resend. The service-role key is provided automatically by Supabase and is never sent to the browser.

`exchange-rate` retrieves a daily NGN conversion from `open.er-api.com`, stores the dated snapshot, and reuses stored rates. Historical dates without an existing snapshot require manual entry.

`process-notifications` is a service-role-only queue worker. Schedule it from Supabase Cron with the service-role bearer token; it sends due task and payment reminders and records delivery results.
