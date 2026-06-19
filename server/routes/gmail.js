const express = require('express');
const router = express.Router();
const {
  getAuthUrl,
  exchangeCode,
  makeGmailClient,
  getUserEmail,
  registerWatch,
} = require('../lib/gmail');
const { db } = require('../lib/db');

/**
 * GET /api/gmail/connect
 * Redirect user to Google OAuth consent screen
 */
router.get('/connect', (req, res) => {
  const url = getAuthUrl();
  res.redirect(url);
});

/**
 * GET /api/gmail/callback
 * Google redirects here after user grants access
 */
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    console.error('OAuth error:', error);
    return res.redirect('/?error=oauth_denied');
  }

  try {
    // Exchange code for tokens
    const tokens = await exchangeCode(code);
    const gmail = await makeGmailClient(tokens.access_token, tokens.refresh_token);
    const gmailEmail = await getUserEmail(tokens.access_token, tokens.refresh_token);

    // Register Gmail Push watch
    const watch = await registerWatch(gmail);
    console.log(`[gmail] Watch registered for ${gmailEmail}, expires: ${new Date(parseInt(watch.expiration))}`);

    // For Phase 1 (personal Gmail): create/find user by email
    // In Phase 2 (multi-tenant): use req.session.userId from Clerk auth
    let user = await db.query('SELECT id FROM users WHERE email = $1', [gmailEmail]);
    if (!user.rows.length) {
      user = await db.query(
        'INSERT INTO users (email) VALUES ($1) RETURNING id',
        [gmailEmail]
      );
    }
    const userId = user.rows[0].id;

    // Upsert Gmail connection
    await db.query(`
      INSERT INTO gmail_connections
        (user_id, gmail_email, access_token, refresh_token, history_id, watch_expiry)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (gmail_email) DO UPDATE SET
        access_token  = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        history_id    = EXCLUDED.history_id,
        watch_expiry  = EXCLUDED.watch_expiry
    `, [
      userId,
      gmailEmail,
      tokens.access_token,
      tokens.refresh_token,
      watch.historyId,
      new Date(parseInt(watch.expiration)),
    ]);

    // Seed hotel config if it doesn't exist
    await db.query(`
      INSERT INTO hotel_configs (user_id, hotel_names)
      VALUES ($1, $2)
      ON CONFLICT (user_id) DO NOTHING
    `, [userId, []]);

    // Store userId in session so dashboard can use it
    req.session.userId = userId;
    req.session.gmailEmail = gmailEmail;

    console.log(`[gmail] Setup complete for ${gmailEmail}`);
    res.redirect('/dashboard');
  } catch (err) {
    console.error('[gmail] Callback error:', err);
    res.redirect('/?error=setup_failed');
  }
});

/**
 * GET /api/gmail/status
 * Check if Gmail is connected for current session
 */
router.get('/status', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.json({ connected: false });

  const result = await db.query(
    'SELECT gmail_email, watch_expiry FROM gmail_connections WHERE user_id = $1',
    [userId]
  );

  if (!result.rows.length) return res.json({ connected: false });

  const { gmail_email, watch_expiry } = result.rows[0];
  res.json({ connected: true, gmailEmail: gmail_email, watchExpiry: watch_expiry });
});

/**
 * GET /api/gmail/emails
 * Fetch classified emails for the dashboard
 * Query params: hotel, priority, status, limit
 */
router.get('/emails', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  const { hotel, priority, status, limit = 100 } = req.query;
  const params = [userId];
  const conditions = ['user_id = $1'];

  if (hotel && hotel !== 'all') {
    params.push(hotel);
    conditions.push(`hotel = $${params.length}`);
  }
  if (priority && priority !== 'all') {
    params.push(priority);
    conditions.push(`priority = $${params.length}`);
  }
  if (status && status !== 'all') {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  params.push(parseInt(limit));
  const query = `
    SELECT * FROM emails
    WHERE ${conditions.join(' AND ')}
    ORDER BY
      CASE priority
        WHEN 'URGENT' THEN 1
        WHEN 'HIGH'   THEN 2
        WHEN 'MEDIUM' THEN 3
        WHEN 'LOW'    THEN 4
        ELSE 5
      END,
      received_at DESC
    LIMIT $${params.length}
  `;

  const result = await db.query(query, params);
  res.json(result.rows);
});

/**
 * PATCH /api/gmail/emails/:id/status
 * Update email status (new → in_progress → resolved)
 */
router.patch('/emails/:id/status', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  const { status } = req.body;
  const validStatuses = ['new', 'in_progress', 'resolved'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  await db.query(
    'UPDATE emails SET status = $1 WHERE id = $2 AND user_id = $3',
    [status, req.params.id, userId]
  );
  res.json({ ok: true });
});

/**
 * GET /api/gmail/hotels
 * Get configured hotel names for this user
 */
router.get('/hotels', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  const result = await db.query(
    'SELECT hotel_names FROM hotel_configs WHERE user_id = $1',
    [userId]
  );
  res.json({ hotels: result.rows[0]?.hotel_names || [] });
});

/**
 * PUT /api/gmail/hotels
 * Update hotel names for classification
 */
router.put('/hotels', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  const { hotels } = req.body;
  await db.query(`
    INSERT INTO hotel_configs (user_id, hotel_names)
    VALUES ($1, $2)
    ON CONFLICT (user_id) DO UPDATE SET hotel_names = EXCLUDED.hotel_names
  `, [userId, hotels]);
  res.json({ ok: true });
});

router.delete('/emails/:id', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  await db.query('DELETE FROM emails WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
  res.json({ ok: true });
});

router.delete('/emails', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  await db.query("DELETE FROM emails WHERE user_id = $1 AND status = 'resolved'", [userId]);
  res.json({ ok: true });
});

module.exports = router;
