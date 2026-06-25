const express = require('express');
const router = express.Router();
const {
  getAuthUrl,
  exchangeCode,
  makeGmailClient,
  getUserEmail,
  registerWatch,
} = require('../lib/gmail');
const { classifyEmail, generateBriefing } = require('../lib/claude');
const { db } = require('../lib/db');

router.get('/connect', (req, res) => {
  const url = getAuthUrl();
  res.redirect(url);
});

router.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect(`${process.env.CLIENT_URL}?error=oauth_denied`);

  try {
    const tokens = await exchangeCode(code);
    const gmail = await makeGmailClient(tokens.access_token, tokens.refresh_token);
    const gmailEmail = await getUserEmail(tokens.access_token, tokens.refresh_token);
    const watch = await registerWatch(gmail);
    console.log(`[gmail] Watch registered for ${gmailEmail}, expires: ${new Date(parseInt(watch.expiration))}`);

    let user = await db.query('SELECT id FROM users WHERE email = $1', [gmailEmail]);
    if (!user.rows.length) {
      user = await db.query('INSERT INTO users (email) VALUES ($1) RETURNING id', [gmailEmail]);
    }
    const userId = user.rows[0].id;

    await db.query(`
      INSERT INTO gmail_connections (user_id, gmail_email, access_token, refresh_token, history_id, watch_expiry)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (gmail_email) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        history_id = EXCLUDED.history_id,
        watch_expiry = EXCLUDED.watch_expiry
    `, [userId, gmailEmail, tokens.access_token, tokens.refresh_token, watch.historyId, new Date(parseInt(watch.expiration))]);

    await db.query(`
      INSERT INTO hotel_configs (user_id, hotel_names) VALUES ($1, $2)
      ON CONFLICT (user_id) DO NOTHING
    `, [userId, []]);

    req.session.userId = userId;
    req.session.gmailEmail = gmailEmail;

    console.log(`[gmail] Setup complete for ${gmailEmail}`);
    res.redirect(`${process.env.CLIENT_URL}`);
  } catch (err) {
    console.error('[gmail] Callback error:', err);
    res.redirect(`${process.env.CLIENT_URL}?error=setup_failed`);
  }
});

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

router.get('/emails', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  const { hotel, priority, status, limit = 100 } = req.query;
  const params = [userId];
  const conditions = ['user_id = $1'];

  if (hotel && hotel !== 'all') { params.push(hotel); conditions.push(`hotel = $${params.length}`); }
  if (priority && priority !== 'all') { params.push(priority); conditions.push(`priority = $${params.length}`); }
  if (status && status !== 'all') { params.push(status); conditions.push(`status = $${params.length}`); }

  params.push(parseInt(limit));
  const query = `
    SELECT * FROM emails
    WHERE ${conditions.join(' AND ')}
    ORDER BY
      CASE priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 ELSE 5 END,
      received_at DESC
    LIMIT $${params.length}
  `;
  const result = await db.query(query, params);
  res.json(result.rows);
});

router.patch('/emails/:id/status', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  const { status } = req.body;
  const valid = ['new', 'in_progress', 'resolved'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  await db.query('UPDATE emails SET status = $1 WHERE id = $2 AND user_id = $3', [status, req.params.id, userId]);
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

router.get('/hotels', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  const result = await db.query('SELECT hotel_names FROM hotel_configs WHERE user_id = $1', [userId]);
  res.json({ hotels: result.rows[0]?.hotel_names || [] });
});

router.put('/hotels', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  const { hotels } = req.body;
  await db.query(`
    INSERT INTO hotel_configs (user_id, hotel_names) VALUES ($1, $2)
    ON CONFLICT (user_id) DO UPDATE SET hotel_names = EXCLUDED.hotel_names
  `, [userId, hotels]);
  res.json({ ok: true });
});

// AI Briefing
router.get('/briefing', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const emailsResult = await db.query(`
      SELECT subject, sender, hotel, category, priority, summary, action_items, requires_response, status, received_at
      FROM emails
      WHERE user_id = $1 AND status != 'resolved'
      ORDER BY
        CASE priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
        received_at DESC
      LIMIT 50
    `, [userId]);

    const hotelResult = await db.query('SELECT hotel_names FROM hotel_configs WHERE user_id = $1', [userId]);
    const emails = emailsResult.rows;
    const hotelNames = hotelResult.rows[0]?.hotel_names || [];

    if (!emails.length) {
      return res.json({
        briefing: {
          headline: 'Inbox is clear — no active items to review.',
          urgent: [],
          todaysPlan: [],
          watchList: [],
          clear: 'Nothing outstanding right now.',
        },
        generatedAt: new Date(),
      });
    }

    const briefing = await generateBriefing(emails, hotelNames);
    res.json({ briefing, generatedAt: new Date() });
  } catch (err) {
    console.error('[briefing] Error:', err);
    res.status(500).json({ error: 'Failed to generate briefing' });
  }
});

router.post('/renew-watches', async (req, res) => {
  try {
    // Find connections expiring in the next 24 hours
    const result = await db.query(`
      SELECT * FROM gmail_connections
      WHERE watch_expiry < NOW() + INTERVAL '24 hours'
    `);

    for (const conn of result.rows) {
      const gmail = await makeGmailClient(conn.access_token, conn.refresh_token);
      const watch = await registerWatch(gmail);
      await db.query(
        'UPDATE gmail_connections SET history_id = $1, watch_expiry = $2 WHERE id = $3',
        [watch.historyId, new Date(parseInt(watch.expiration)), conn.id]
      );
      console.log(`[cron] Renewed watch for ${conn.gmail_email}, expires: ${new Date(parseInt(watch.expiration))}`);
    }

    res.json({ ok: true, renewed: result.rows.length });
  } catch (err) {
    console.error('[cron] Renew error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;