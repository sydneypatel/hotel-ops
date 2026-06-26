const express = require('express');
const router = express.Router();
const {
  getAuthUrl, exchangeCode, makeGmailClient,
  getUserEmail, registerWatch,
} = require('../lib/gmail');
const { classifyEmail, generateBriefing } = require('../lib/claude');
const { sendReport } = require('../lib/email');
const { db } = require('../lib/db');

// ─── Auth ─────────────────────────────────────────────────────────────────────

router.get('/connect', (req, res) => res.redirect(getAuthUrl()));

router.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect(`${process.env.CLIENT_URL}?error=oauth_denied`);
  try {
    const tokens   = await exchangeCode(code);
    const gmail    = await makeGmailClient(tokens.access_token, tokens.refresh_token);
    const email    = await getUserEmail(tokens.access_token, tokens.refresh_token);
    const watch    = await registerWatch(gmail);
    console.log(`[gmail] Watch registered for ${email}, expires: ${new Date(parseInt(watch.expiration))}`);

    let user = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (!user.rows.length) user = await db.query('INSERT INTO users (email) VALUES ($1) RETURNING id', [email]);
    const userId = user.rows[0].id;

    await db.query(`
      INSERT INTO gmail_connections (user_id, gmail_email, access_token, refresh_token, history_id, watch_expiry)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (gmail_email) DO UPDATE SET
        access_token=EXCLUDED.access_token, refresh_token=EXCLUDED.refresh_token,
        history_id=EXCLUDED.history_id, watch_expiry=EXCLUDED.watch_expiry
    `, [userId, email, tokens.access_token, tokens.refresh_token, watch.historyId, new Date(parseInt(watch.expiration))]);

    await db.query(`INSERT INTO hotel_configs (user_id, hotel_names) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`, [userId, []]);
    await db.query(`INSERT INTO report_configs (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId]);

    req.session.userId    = userId;
    req.session.gmailEmail = email;
    console.log(`[gmail] Setup complete for ${email}`);
    res.redirect(`${process.env.CLIENT_URL}`);
  } catch (err) {
    console.error('[gmail] Callback error:', err);
    res.redirect(`${process.env.CLIENT_URL}?error=setup_failed`);
  }
});

router.get('/status', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.json({ connected: false });
  const r = await db.query('SELECT gmail_email, watch_expiry FROM gmail_connections WHERE user_id = $1', [userId]);
  if (!r.rows.length) return res.json({ connected: false });
  res.json({ connected: true, gmailEmail: r.rows[0].gmail_email, watchExpiry: r.rows[0].watch_expiry });
});

// ─── Emails ───────────────────────────────────────────────────────────────────

router.get('/emails', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  const { hotel, priority, status, limit = 100 } = req.query;
  const params = [userId];
  const conditions = ['user_id = $1'];
  if (hotel && hotel !== 'all')    { params.push(hotel);           conditions.push(`hotel = $${params.length}`); }
  if (priority && priority !== 'all') { params.push(priority);    conditions.push(`priority = $${params.length}`); }
  if (status && status !== 'all')  { params.push(status);          conditions.push(`status = $${params.length}`); }
  params.push(parseInt(limit));
  const result = await db.query(`
    SELECT * FROM emails WHERE ${conditions.join(' AND ')}
    ORDER BY received_at DESC
    LIMIT $${params.length}
  `, params);
  res.json(result.rows);
});

router.patch('/emails/:id/status', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  const { status } = req.body;
  if (!['new','in_progress','resolved'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
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

// ─── Hotels ───────────────────────────────────────────────────────────────────

router.get('/hotels', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  const r = await db.query('SELECT hotel_names FROM hotel_configs WHERE user_id = $1', [userId]);
  res.json({ hotels: r.rows[0]?.hotel_names || [] });
});

router.put('/hotels', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  await db.query(`
    INSERT INTO hotel_configs (user_id, hotel_names) VALUES ($1, $2)
    ON CONFLICT (user_id) DO UPDATE SET hotel_names = EXCLUDED.hotel_names
  `, [userId, req.body.hotels]);
  res.json({ ok: true });
});

// ─── Briefing ─────────────────────────────────────────────────────────────────

router.get('/briefing', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const emailsResult = await db.query(`
      SELECT subject, sender, hotel, category, priority, summary, action_items, requires_response, status, received_at
      FROM emails WHERE user_id = $1 AND status != 'resolved'
      ORDER BY CASE priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END, received_at DESC
      LIMIT 50
    `, [userId]);
    const hotelResult = await db.query('SELECT hotel_names FROM hotel_configs WHERE user_id = $1', [userId]);
    const emails     = emailsResult.rows;
    const hotelNames = hotelResult.rows[0]?.hotel_names || [];
    if (!emails.length) return res.json({ briefing: { headline:'Inbox is clear.', urgent:[], todaysPlan:[], watchList:[], clear:'Nothing outstanding.' }, generatedAt: new Date() });
    const briefing = await generateBriefing(emails, hotelNames);
    res.json({ briefing, generatedAt: new Date() });
  } catch (err) {
    console.error('[briefing] Error:', err);
    res.status(500).json({ error: 'Failed to generate briefing' });
  }
});

// ─── Report Config ────────────────────────────────────────────────────────────

router.get('/report-config', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  const r = await db.query('SELECT * FROM report_configs WHERE user_id = $1', [userId]);
  res.json(r.rows[0] || { recipient_emails: [], send_morning: true, send_midday: true, send_evening: true });
});

router.put('/report-config', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  const { recipient_emails, send_morning, send_midday, send_evening } = req.body;
  await db.query(`
    INSERT INTO report_configs (user_id, recipient_emails, send_morning, send_midday, send_evening)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (user_id) DO UPDATE SET
      recipient_emails=EXCLUDED.recipient_emails,
      send_morning=EXCLUDED.send_morning,
      send_midday=EXCLUDED.send_midday,
      send_evening=EXCLUDED.send_evening
  `, [userId, recipient_emails, send_morning, send_midday, send_evening]);
  res.json({ ok: true });
});

// ─── Scheduled Report Send (called by cron) ───────────────────────────────────

router.post('/report-send', async (req, res) => {
  // Simple secret check so random people can't spam your reports
  if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { time = 'morning' } = req.query; // morning | midday | evening
  const timeLabels = { morning: 'Morning Briefing', midday: 'Midday Update', evening: 'Evening Wrap-up' };
  const timeLabel = timeLabels[time] || 'Briefing';

  try {
    const configs = await db.query(`
      SELECT rc.*, u.id as user_id FROM report_configs rc
      JOIN users u ON rc.user_id = u.id
      WHERE array_length(rc.recipient_emails, 1) > 0
    `);

    for (const config of configs.rows) {
      if (time === 'morning' && !config.send_morning) continue;
      if (time === 'midday'  && !config.send_midday)  continue;
      if (time === 'evening' && !config.send_evening) continue;

      const emailsResult = await db.query(`
        SELECT subject, sender, hotel, category, priority, summary, action_items, requires_response, status
        FROM emails WHERE user_id = $1 AND status != 'resolved'
        ORDER BY CASE priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END
        LIMIT 50
      `, [config.user_id]);

      const hotelResult = await db.query('SELECT hotel_names FROM hotel_configs WHERE user_id = $1', [config.user_id]);
      const emails     = emailsResult.rows;
      const hotelNames = hotelResult.rows[0]?.hotel_names || [];

      const briefing = await generateBriefing(emails, hotelNames);
      const stats = {
        total:   emails.length,
        urgent:  emails.filter(e => e.priority === 'URGENT').length,
        replies: emails.filter(e => e.requires_response).length,
      };

      await sendReport(config.recipient_emails, timeLabel, briefing, stats);
      console.log(`[report] Sent ${timeLabel} to ${config.recipient_emails.join(', ')}`);
    }

    res.json({ ok: true, sent: configs.rows.length });
  } catch (err) {
    console.error('[report] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Watch Renewal ────────────────────────────────────────────────────────────

router.post('/renew-watches', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT * FROM gmail_connections WHERE watch_expiry < NOW() + INTERVAL '24 hours'
    `);
    for (const conn of result.rows) {
      const gmail = await makeGmailClient(conn.access_token, conn.refresh_token);
      const watch = await registerWatch(gmail);
      await db.query(
        'UPDATE gmail_connections SET history_id = $1, watch_expiry = $2 WHERE id = $3',
        [watch.historyId, new Date(parseInt(watch.expiration)), conn.id]
      );
      console.log(`[cron] Renewed watch for ${conn.gmail_email}`);
    }
    res.json({ ok: true, renewed: result.rows.length });
  } catch (err) {
    console.error('[cron] Renew error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;