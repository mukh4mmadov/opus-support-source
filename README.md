# OPUS Support

Booking site for OPUS Learning Center. Students book a support teacher, support teachers see the topic in advance and mark attendance, and the admin runs everything from one panel.

## Features

- Booking with a waiting list, lesson moves and cancellation rules
- Every rule runs inside Postgres as a guarded function, so a changed browser gains nothing
- QR check-in for students; teachers check in with a code that changes every 10 seconds, their location and a face check
- Chat before a lesson, ratings and complaints
- Reminders and missed-lesson marking run on a schedule in the database
- Admin panel: bookings, accounts with printable QR cards, statistics, settings and an activity log
- Installable app (PWA) with push notifications

## Stack

React 19, TypeScript, Vite, Tailwind CSS, TanStack Query, Supabase (Postgres, Edge Functions on Deno), Vitest, Playwright

## Structure

```
src/                   app screens for students, teachers and the admin
supabase/migrations/   database schema and rules
supabase/functions/    admin-users, account, send-push
scripts/               local backend, demo data, admin and key helpers
tests/                 unit, database and browser tests
```

## Try it on this computer

No account needed. Requires Node.js 24.

```
npm install
npm run demo
```

Open http://localhost:5173 and sign in:

| Role | Login | Password |
|---|---|---|
| Admin | admin | admin12345 |
| Support teacher | ozodbek | support123 |
| Student | aziza | student123 |

Demo data lives in the `.local-db` folder. Delete the folder to start over.

## Tests

```
npm test
npm run e2e
```

## Deploy

- Database and functions: Supabase. Migrations are in `supabase/migrations`, functions in `supabase/functions`.
- Site: Vercel, with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_VAPID_PUBLIC_KEY`.
- Function secrets: `VAPID_KEYS`, `VAPID_CONTACT`, `PUSH_SECRET` and `PASSWORD_KEY`.

Live: https://opus-support-uz.vercel.app
