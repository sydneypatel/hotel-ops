# Foyer

**AI-powered email triage dashboard for hotel management companies.**

Foyer connects to a Gmail inbox, classifies every incoming email by hotel property and category using Claude, and displays a real-time kanban dashboard with AI-generated briefings and scheduled, emailed daily reports.

Live at [foyer-ai.com](https://foyer-ai.com) (in Testing phase)

---

## What it does

- **Real-time inbox triage** — Gmail push notifications via Google Cloud Pub/Sub feed new emails into the pipeline the moment they arrive
- **AI classification** — Claude classifies each email by hotel property, category (Maintenance, Guest, Reservations, Vendor, Staff, Admin, or custom), priority (Urgent / High / Medium / Low), and extracts action items
- **Kanban dashboard** — New → In Progress → Complete columns with drag-and-drop, property/category filters, and priority sort
- **AI Briefing** — On-demand Claude-generated summary: urgent items, order of attack, watch list, and what's under control
- **Scheduled reports** — 3x daily email briefings (Morning 7am / Midday 12pm / Evening 6pm ET) sent to configurable recipients
- **Backfill** — Import up to 200 historical emails from any time window on first setup
- **Custom categories** — Define your own email categories; re-classification runs automatically on save
- **Multi-tenant auth** — Clerk handles sign-in; each user connects their own Gmail and gets their own isolated dashboard

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React (CRA), deployed on Vercel |
| Backend | Node.js / Express, deployed on Railway |
| Database | PostgreSQL (Railway) |
| Auth | Clerk (production instance, `foyer-ai.com`) |
| AI | Anthropic Claude API (`claude-sonnet-4-6`) |
| Email delivery | Gmail API + Google Cloud Pub/Sub (inbound), Resend (outbound reports) |
| Scheduling | cron-job.org (4 jobs: watch renewal + 3 report sends) |
| Domain | Namecheap → `foyer-ai.com` |

---

## Architecture

```
Gmail Inbox
    │
    ▼ (Push notification)
Google Cloud Pub/Sub
    │
    ▼ POST /webhook/gmail
Railway (Express server)
    │
    ├── getNewMessageIds() → Gmail API
    ├── getEmailDetails() → Gmail API
    ├── classifyEmail() → Claude API
    └── INSERT → PostgreSQL
                    │
                    ▼
            React Dashboard (Vercel)
            foyer-ai.com
```

**Scheduled reports:**
```
cron-job.org → POST /api/gmail/report-send?time=morning|midday|evening
                    │
                    ├── generateBriefing() → Claude API
                    └── sendReport() → Resend API → recipient inboxes
```

---

## Project structure

```
hotel-ops/
├── client/                          # React frontend
│   ├── public/
│   │   └── favicon.ico              # Foyer arch logo
│   └── src/
│       └── App.js                   # Full dashboard UI + Clerk auth
│
└── server/                          # Express backend
    ├── index.js                     # App entry, CORS, Clerk middleware
    ├── lib/
    │   ├── gmail.js                 # Gmail API helpers (auth, watch, fetch, list)
    │   ├── claude.js                # classifyEmail + generateBriefing
    │   ├── email.js                 # sendReport via Resend
    │   └── db.js                   # PostgreSQL pool
    └── routes/
        ├── gmail.js                 # All API routes
        └── webhook.js               # Pub/Sub push handler
```

---

## Database schema

```sql
users               -- clerk_id, email
gmail_connections   -- access/refresh tokens, history_id, watch_expiry
hotel_configs       -- hotel_names[], custom_categories[]
report_configs      -- recipient_emails[], send_morning/midday/evening
emails              -- full classification + status + soft delete
```

---

## Setup

### Prerequisites
- Node.js 18+
- PostgreSQL database
- Google Cloud project with Gmail API + Pub/Sub enabled
- Clerk account (production instance)
- Resend account
- Anthropic API key

### Environment variables

**Server (`server/.env`):**
```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://your-railway-url/api/gmail/callback
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
PUBSUB_TOPIC=gmail-push-notifications
ANTHROPIC_API_KEY=
DATABASE_URL=
CLERK_SECRET_KEY=sk_live_...
CLERK_PUBLISHABLE_KEY=pk_live_...
CLIENT_URL=https://foyer-ai.com
RESEND_API_KEY=
CRON_SECRET=
```

**Client (`client/.env`):**
```
REACT_APP_CLERK_PUBLISHABLE_KEY=pk_live_...
```

### Database setup
```sql
-- Run schema.sql then migrations:
ALTER TABLE users ADD COLUMN IF NOT EXISTS clerk_id TEXT UNIQUE;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS gmail_message_id TEXT;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE hotel_configs ADD COLUMN IF NOT EXISTS custom_categories TEXT[] DEFAULT '{}';
CREATE TABLE report_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  recipient_emails TEXT[] DEFAULT '{}',
  send_morning BOOLEAN DEFAULT TRUE,
  send_midday BOOLEAN DEFAULT TRUE,
  send_evening BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS emails_msg_idx 
  ON emails(user_id, gmail_message_id) WHERE gmail_message_id IS NOT NULL;
```

### Google Cloud setup
1. Create a project and enable Gmail API + Pub/Sub API
2. Create an OAuth 2.0 client (Web application)
3. Add authorized redirect URI: `https://your-railway-url/api/gmail/callback`
4. Add `https://clerk.foyer-ai.com/v1/oauth_callback` for Clerk SSO
5. Create Pub/Sub topic `gmail-push-notifications`
6. Create push subscription pointing to `https://your-railway-url/webhook/gmail`

### Cron jobs (cron-job.org)
| Job | URL | Schedule | Header |
|-----|-----|----------|--------|
| Watch renewal | `/api/gmail/renew-watches` | 6am ET daily | — |
| Morning report | `/api/gmail/report-send?time=morning` | 7am ET daily | `x-cron-secret` |
| Midday report | `/api/gmail/report-send?time=midday` | 12pm ET daily | `x-cron-secret` |
| Evening report | `/api/gmail/report-send?time=evening` | 6pm ET daily | `x-cron-secret` |

### Local development
```bash
# Server
cd server
npm install
npm run dev   # nodemon index.js on :3001

# Client
cd client
npm install
npm start     # CRA dev server on :3000
```

---

## Key features in depth

### Email classification
Claude receives subject, sender, and body preview for each email and returns:
- `hotel` — matched against your configured property names
- `category` — one of the default or custom categories
- `priority` — URGENT / HIGH / MEDIUM / LOW
- `summary` — 2-3 sentence plain-language description
- `action_items` — specific next steps
- `requires_response` — boolean

### Re-classification
When you add hotel names → emails with `hotel = 'Unknown'` are automatically re-classified.  
When you add custom categories → emails with `category = 'OTHER'` are automatically re-classified.  
"Re-run all emails" in the Categories tab forces a full re-classification.

### Backfill
Settings → Import → choose 1–6 months → Claude classifies up to 200 emails from your Gmail history. Already-imported emails are skipped via `ON CONFLICT DO NOTHING`. Deleted emails (soft-deleted) are also skipped.

### Soft delete
Emails are never hard-deleted from the database. Deleting from the dashboard sets `deleted_at = NOW()`. This ensures re-imports don't resurface emails you've dismissed.

---

## Roadmap

- [ ] Staff email-in workflow (reply to ops inbox to update card status)
- [ ] Custom SOPs per property
- [ ] Assignee per card
- [ ] Analytics tab (volume by hotel/category, response times)
- [ ] Stripe billing + invite/waitlist flow
- [ ] Google OAuth app verification for multi-tenant onboarding
- [ ] Resend domain verification → send from `reports@foyer-ai.com`
- [ ] Foyer landing page

---

## Built by
Sydney Patel — [foyer-ai.com](https://foyer-ai.com)