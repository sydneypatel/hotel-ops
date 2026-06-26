require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { clerkMiddleware } = require('@clerk/express');

const webhookRoutes = require('./routes/webhook');
const gmailRoutes   = require('./routes/gmail');

const app = express();
const PORT = process.env.PORT || 3001;

app.set('trust proxy', 1);

app.use(cors({
  origin: [
    process.env.CLIENT_URL,
    'https://www.foyer-ai.com',
    'https://foyer-ai.com',
  ],
  credentials: false,
}));

// Webhook uses raw body — must be before express.json()
app.use('/webhook', webhookRoutes);

app.use(express.json());

// Clerk middleware — reads JWT from Authorization header, populates req.auth
app.use(clerkMiddleware());

// Routes
app.use('/api/gmail', gmailRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date() }));

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║   Hotel Ops API running on :${PORT}   ║
╚══════════════════════════════════════╝

Endpoints:
  GET  /api/gmail/auth-url     → get Google OAuth URL
  GET  /api/gmail/callback     → OAuth redirect target
  GET  /api/gmail/status       → check Gmail connection
  GET  /api/gmail/emails       → fetch classified emails
  GET  /api/gmail/hotels       → get hotel names
  PUT  /api/gmail/hotels       → update hotel names
  GET  /api/gmail/briefing     → generate AI briefing
  GET  /api/gmail/report-config
  PUT  /api/gmail/report-config
  POST /api/gmail/report-send  → send scheduled report
  POST /api/gmail/renew-watches
  POST /webhook/gmail          → Pub/Sub push target
  `);
});