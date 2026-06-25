require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');

const webhookRoutes = require('./routes/webhook');
const gmailRoutes   = require('./routes/gmail_routes');

const app = express();
const PORT = process.env.PORT || 3001;

const pgSession = require('connect-pg-simple')(session);
const { db } = require('./lib/db');



app.set('trust proxy', 1);

// --- Middleware ---
app.use(cors({
  origin: process.env.CLIENT_URL,
  credentials: true,
}));

// Webhook route uses raw body (Pub/Sub requires it) — register BEFORE express.json()
app.use('/webhook', webhookRoutes);

app.use(express.json());

app.use(session({
  store: new pgSession({
    pool: db,
    tableName: 'session',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    httpOnly: true,
    sameSite: 'none',  // ← add this
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

// --- Routes ---
app.use('/api/gmail', gmailRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date() }));

// --- Start ---
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║   Hotel Ops API running on :${PORT}   ║
╚══════════════════════════════════════╝

Endpoints:
  GET  /api/gmail/connect      → start Gmail OAuth
  GET  /api/gmail/callback     → OAuth redirect target
  GET  /api/gmail/status       → check connection
  GET  /api/gmail/emails       → fetch classified emails
  GET  /api/gmail/hotels       → get hotel names
  PUT  /api/gmail/hotels       → update hotel names
  POST /webhook/gmail          → Pub/Sub push target

Pub/Sub webhook URL (use this in Google Cloud Console):
  http://localhost:${PORT}/webhook/gmail  ← ngrok this for local dev
  `);
});
