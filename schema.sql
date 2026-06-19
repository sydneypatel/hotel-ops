-- Hotel Ops SaaS — database schema
-- Run this once against your Postgres instance

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT UNIQUE NOT NULL,
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE gmail_connections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  gmail_email   TEXT UNIQUE NOT NULL,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  history_id    TEXT,               -- last processed Gmail historyId
  watch_expiry  TIMESTAMP,          -- Gmail watch expires every 7 days, renew daily
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE hotel_configs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  hotel_names  TEXT[] DEFAULT '{}', -- e.g. ['Grand Metropolitan', 'Riverside Inn']
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE emails (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES users(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL,
  subject          TEXT,
  sender           TEXT,
  received_at      TIMESTAMP,
  snippet          TEXT,
  body_preview     TEXT,
  -- AI classification fields
  hotel            TEXT DEFAULT 'Unknown',
  category         TEXT,  -- MAINTENANCE | GUEST | RESERVATIONS | VENDOR | STAFF | ADMIN | OTHER
  priority         TEXT,  -- URGENT | HIGH | MEDIUM | LOW
  summary          TEXT,
  action_items     TEXT[],
  requires_response BOOLEAN DEFAULT FALSE,
  -- Status for kanban
  status           TEXT DEFAULT 'new',  -- new | in_progress | resolved
  created_at       TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, gmail_message_id)
);

-- Indexes for dashboard queries
CREATE INDEX idx_emails_user_priority  ON emails(user_id, priority);
CREATE INDEX idx_emails_user_hotel     ON emails(user_id, hotel);
CREATE INDEX idx_emails_user_status    ON emails(user_id, status);
CREATE INDEX idx_emails_received       ON emails(user_id, received_at DESC);
