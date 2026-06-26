const express = require('express');
const router = express.Router();
const { requireAuth, getAuth } = require('@clerk/express');
const {
  getAuthUrl, exchangeCode, makeGmailClient,
  getUserEmail, registerWatch, listMessages,
} = require('../lib/gmail');
const { classifyEmail, generateBriefing } = require('../lib/claude');
const { sendReport } = require('../lib/email');
const { db } = require('../lib/db');

// ─── Helper: look up our DB user by Clerk user ID ─────────────────────────────

async function getUserByClerk(req) {
  const { userId } = getAuth(req);
  if (!userId) return null;
  const result = await db.query('SELECT * FROM users WHERE clerk_id = $1', [userId]);
  return result.rows[0] || null;
}

// ─── Auth URL — frontend calls this, then redirects user to the returned URL ──

router.get('/auth-url', requireAuth(), (req, res) => {
  const { userId } = getAuth(req);
  console.log('[auth-url] userId:', userId);
  if (!userId) return res.status(401).json({ error: 'No userId' });
  const url = getAuthUrl(userId);
  res.json({ url });
});

// ─── OAuth Callback — redirect from Google, no auth header (redirect flow) ────

router.get('/callback', async (req, res) => {
  const { code, state: clerkUserId, error } = req.query;
  if (error) return res.redirect(`${process.env.CLIENT_URL}?error=oauth_denied`);
  try {
    const tokens    = await exchangeCode(code);
    const gmail     = await makeGmailClient(tokens.access_token, tokens.refresh_token);
    const gmailEmail = await getUserEmail(tokens.access_token, tokens.refresh_token);
    const watch     = await registerWatch(gmail);
    console.log(`[gmail] Watch registered for ${gmailEmail}`);

    // Create or update user — keyed by clerk_id
    let user;
    if (clerkUserId) {
      user = await db.query('SELECT id FROM users WHERE clerk_id = $1', [clerkUserId]);
      if (!user.rows.length) {
        const legacy = await db.query('SELECT id FROM users WHERE email = $1', [gmailEmail]);
        if (legacy.rows.length) {
          await db.query('UPDATE users SET clerk_id = $1 WHERE id = $2', [clerkUserId, legacy.rows[0].id]);
          user = legacy;
        } else {
          user = await db.query('INSERT INTO users (email, clerk_id) VALUES ($1, $2) RETURNING id', [gmailEmail, clerkUserId]);
        }
      }
    } else {
      // Fallback — no clerk ID, use email
      user = await db.query('SELECT id FROM users WHERE email = $1', [gmailEmail]);
      if (!user.rows.length) {
        user = await db.query('INSERT INTO users (email) VALUES ($1) RETURNING id', [gmailEmail]);
      }
    }
    const userId = user.rows[0].id;

    await db.query(`
      INSERT INTO gmail_connections (user_id, gmail_email, access_token, refresh_token, history_id, watch_expiry)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (gmail_email) DO UPDATE SET
        access_token=EXCLUDED.access_token, refresh_token=EXCLUDED.refresh_token,
        history_id=EXCLUDED.history_id, watch_expiry=EXCLUDED.watch_expiry
    `, [userId, gmailEmail, tokens.access_token, tokens.refresh_token, watch.historyId, new Date(parseInt(watch.expiration))]);

    await db.query(`INSERT INTO hotel_configs (user_id, hotel_names) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`, [userId, []]);
    await db.query(`INSERT INTO report_configs (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId]);

    console.log(`[gmail] Setup complete for ${gmailEmail} (clerk: ${clerkUserId})`);
    res.redirect(`${process.env.CLIENT_URL}`);
  } catch (err) {
    console.error('[gmail] Callback error:', err);
    res.redirect(`${process.env.CLIENT_URL}?error=setup_failed`);
  }
});

// ─── Status ───────────────────────────────────────────────────────────────────

router.get('/status', requireAuth(), async (req, res) => {
  const user = await getUserByClerk(req);
  if (!user) return res.json({ connected: false });
  const r = await db.query('SELECT gmail_email, watch_expiry FROM gmail_connections WHERE user_id = $1', [user.id]);
  if (!r.rows.length) return res.json({ connected: false });
  res.json({ connected: true, gmailEmail: r.rows[0].gmail_email, watchExpiry: r.rows[0].watch_expiry });
});

// ─── Emails ───────────────────────────────────────────────────────────────────

router.get('/emails', requireAuth(), async (req, res) => {
  const user = await getUserByClerk(req);
  if (!user) return res.status(404).json({ error: 'Connect Gmail first' });

  const { hotel, priority, status, limit = 100 } = req.query;
  const params = [user.id];
  const conditions = ['user_id = $1'];
  if (hotel && hotel !== 'all')    { params.push(hotel);    conditions.push(`hotel = $${params.length}`); }
  if (priority && priority !== 'all') { params.push(priority); conditions.push(`priority = $${params.length}`); }
  if (status && status !== 'all')  { params.push(status);   conditions.push(`status = $${params.length}`); }
  params.push(parseInt(limit));
  const result = await db.query(`
    SELECT * FROM emails WHERE ${conditions.join(' AND ')}
    ORDER BY received_at DESC
    LIMIT $${params.length}
  `, params);
  res.json(result.rows);
});

router.patch('/emails/:id/status', requireAuth(), async (req, res) => {
  const user = await getUserByClerk(req);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const { status } = req.body;
  if (!['new','in_progress','resolved'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  await db.query('UPDATE emails SET status = $1 WHERE id = $2 AND user_id = $3', [status, req.params.id, user.id]);
  res.json({ ok: true });
});

router.delete('/emails/:id', requireAuth(), async (req, res) => {
  const user = await getUserByClerk(req);
  if (!user) return res.status(404).json({ error: 'Not found' });
  await db.query('DELETE FROM emails WHERE id = $1 AND user_id = $2', [req.params.id, user.id]);
  res.json({ ok: true });
});

router.delete('/emails', requireAuth(), async (req, res) => {
  const user = await getUserByClerk(req);
  if (!user) return res.status(404).json({ error: 'Not found' });
  await db.query("DELETE FROM emails WHERE user_id = $1 AND status = 'resolved'", [user.id]);
  res.json({ ok: true });
});

// ─── Hotels ───────────────────────────────────────────────────────────────────

router.get('/hotels', requireAuth(), async (req, res) => {
  const user = await getUserByClerk(req);
  if (!user) return res.json({ hotels: [] });
  const r = await db.query('SELECT hotel_names FROM hotel_configs WHERE user_id = $1', [user.id]);
  res.json({ hotels: r.rows[0]?.hotel_names || [] });
});

router.put('/hotels', requireAuth(), async (req, res) => {
  const user = await getUserByClerk(req);
  if (!user) return res.status(404).json({ error: 'Not found' });
  await db.query(`
    INSERT INTO hotel_configs (user_id, hotel_names) VALUES ($1, $2)
    ON CONFLICT (user_id) DO UPDATE SET hotel_names = EXCLUDED.hotel_names
  `, [user.id, req.body.hotels]);
  res.json({ ok: true });
});

// ─── Categories ───────────────────────────────────────────────────────────────

router.get('/categories', requireAuth(), async (req, res) => {
  const user = await getUserByClerk(req);
  if (!user) return res.json({ categories: [] });
  const r = await db.query('SELECT custom_categories FROM hotel_configs WHERE user_id = $1', [user.id]);
  res.json({ categories: r.rows[0]?.custom_categories || [] });
});

router.put('/categories', requireAuth(), async (req, res) => {
  const user = await getUserByClerk(req);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const { categories } = req.body;
  await db.query(`
    INSERT INTO hotel_configs (user_id, custom_categories) VALUES ($1, $2)
    ON CONFLICT (user_id) DO UPDATE SET custom_categories = EXCLUDED.custom_categories
  `, [user.id, categories]);
  res.json({ ok: true });
});

// ─── Reclassify ───────────────────────────────────────────────────────────────
// scope=other   → emails with category = 'OTHER'
// scope=unknown → emails with hotel = 'Unknown'
// scope=both    → OTHER category OR Unknown hotel (default)
// scope=all     → all emails (full rerun)

router.post('/reclassify', requireAuth(), async (req, res) => {
  const user = await getUserByClerk(req);
  if (!user) return res.status(404).json({ error: 'Not found' });

  const { scope = 'both' } = req.query;

  const configResult = await db.query(
    'SELECT custom_categories, hotel_names FROM hotel_configs WHERE user_id = $1',
    [user.id]
  );
  const customCategories = configResult.rows[0]?.custom_categories || [];
  const hotelNames       = configResult.rows[0]?.hotel_names || [];

  const queries = {
    other:   "SELECT * FROM emails WHERE user_id = $1 AND category = 'OTHER' ORDER BY received_at DESC LIMIT 50",
    unknown: "SELECT * FROM emails WHERE user_id = $1 AND hotel = 'Unknown' ORDER BY received_at DESC LIMIT 50",
    both:    "SELECT * FROM emails WHERE user_id = $1 AND (category = 'OTHER' OR hotel = 'Unknown') ORDER BY received_at DESC LIMIT 50",
    all:     "SELECT * FROM emails WHERE user_id = $1 ORDER BY received_at DESC LIMIT 100",
  };

  const emails = await db.query(queries[scope] || queries.both, [user.id]);
  let updated = 0;

  for (const email of emails.rows) {
    try {
      const classification = await classifyEmail({
        subject: email.subject,
        from:    email.sender,
        snippet: email.summary || email.subject,
        body:    '',
      }, hotelNames, customCategories);

      await db.query(`
        UPDATE emails SET
          hotel = $1, category = $2, priority = $3,
          summary = $4, action_items = $5, requires_response = $6
        WHERE id = $7
      `, [
        classification.hotel, classification.category, classification.priority,
        classification.summary, classification.action_items, classification.requires_response,
        email.id,
      ]);
      updated++;
    } catch(e) {
      console.error(`[reclassify] Failed for email ${email.id}:`, e.message);
    }
  }

  console.log(`[reclassify] scope=${scope} updated=${updated}/${emails.rows.length}`);
  res.json({ ok: true, updated, total: emails.rows.length });
});

router.post('/backfill', requireAuth(), async (req, res) => {
  const user = await getUserByClerk(req);
  if (!user) return res.status(404).json({ error: 'Not found' });

  const { months = 1 } = req.query;

  const conn = await db.query(
    'SELECT * FROM gmail_connections WHERE user_id = $1',
    [user.id]
  );
  if (!conn.rows.length) return res.status(400).json({ error: 'Gmail not connected' });

  const gmail = await makeGmailClient(conn.rows[0].access_token, conn.rows[0].refresh_token);

  const configResult = await db.query(
    'SELECT hotel_names, custom_categories FROM hotel_configs WHERE user_id = $1',
    [user.id]
  );
  const hotelNames       = configResult.rows[0]?.hotel_names || [];
  const customCategories = configResult.rows[0]?.custom_categories || [];

  console.log(`[backfill] Fetching inbox from last ${months} month(s) for user ${user.id}`);
  const messages = await listMessages(gmail, { months: parseInt(months), maxResults: 200 });
  console.log(`[backfill] Found ${messages.length} messages`);

  let saved = 0;
  let skipped = 0;
  let failed = 0;

  for (const msg of messages) {
    // Skip if already in DB
    const existing = await db.query(
      'SELECT id FROM emails WHERE user_id = $1 AND gmail_message_id = $2',
      [user.id, msg.id]
    );
    if (existing.rows.length) { skipped++; continue; }

    try {
      const details        = await getEmailDetails(gmail, msg.id);
      const classification = await classifyEmail(details, hotelNames, customCategories);

      await db.query(`
        INSERT INTO emails
          (user_id, gmail_message_id, subject, sender, hotel, category, priority,
           summary, action_items, requires_response, status, received_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'new',$11)
        ON CONFLICT DO NOTHING
      `, [
        user.id, msg.id,
        details.subject, details.from,
        classification.hotel, classification.category, classification.priority,
        classification.summary, classification.action_items, classification.requires_response,
        details.date ? new Date(details.date) : new Date(),
      ]);
      saved++;

      // Delay to avoid Gmail API rate limits
      await new Promise(r => setTimeout(r, 150));
    } catch(e) {
      console.error(`[backfill] Failed for ${msg.id}:`, e.message);
      failed++;
    }
  }

  console.log(`[backfill] Done — saved:${saved} skipped:${skipped} failed:${failed} total:${messages.length}`);
  res.json({ ok: true, saved, skipped, failed, total: messages.length });
});

// ─── Briefing ─────────────────────────────────────────────────────────────────

router.get('/briefing', requireAuth(), async (req, res) => {
  const user = await getUserByClerk(req);
  if (!user) return res.status(404).json({ error: 'Not found' });
  try {
    const emailsResult = await db.query(`
      SELECT subject, sender, hotel, category, priority, summary, action_items, requires_response, status, received_at
      FROM emails WHERE user_id = $1 AND status != 'resolved'
      ORDER BY CASE priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END, received_at DESC
      LIMIT 50
    `, [user.id]);
    const hotelResult = await db.query('SELECT hotel_names FROM hotel_configs WHERE user_id = $1', [user.id]);
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

router.get('/report-config', requireAuth(), async (req, res) => {
  const user = await getUserByClerk(req);
  if (!user) return res.json({ recipient_emails: [], send_morning: true, send_midday: true, send_evening: true });
  const r = await db.query('SELECT * FROM report_configs WHERE user_id = $1', [user.id]);
  res.json(r.rows[0] || { recipient_emails: [], send_morning: true, send_midday: true, send_evening: true });
});

router.put('/report-config', requireAuth(), async (req, res) => {
  const user = await getUserByClerk(req);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const { recipient_emails, send_morning, send_midday, send_evening } = req.body;
  await db.query(`
    INSERT INTO report_configs (user_id, recipient_emails, send_morning, send_midday, send_evening)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (user_id) DO UPDATE SET
      recipient_emails=EXCLUDED.recipient_emails,
      send_morning=EXCLUDED.send_morning,
      send_midday=EXCLUDED.send_midday,
      send_evening=EXCLUDED.send_evening
  `, [user.id, recipient_emails, send_morning, send_midday, send_evening]);
  res.json({ ok: true });
});

// ─── Scheduled Report Send ────────────────────────────────────────────────────

router.post('/report-send', async (req, res) => {
  if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { time = 'morning' } = req.query;
  const timeLabels = { morning:'Morning Briefing', midday:'Midday Update', evening:'Evening Wrap-up' };
  const timeLabel  = timeLabels[time] || 'Briefing';

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
      const briefing   = await generateBriefing(emails, hotelNames);
      const stats      = { total: emails.length, urgent: emails.filter(e=>e.priority==='URGENT').length, replies: emails.filter(e=>e.requires_response).length };
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
    const result = await db.query(`SELECT * FROM gmail_connections WHERE watch_expiry < NOW() + INTERVAL '24 hours'`);
    for (const conn of result.rows) {
      const gmail = await makeGmailClient(conn.access_token, conn.refresh_token);
      const watch = await registerWatch(gmail);
      await db.query('UPDATE gmail_connections SET history_id=$1, watch_expiry=$2 WHERE id=$3',
        [watch.historyId, new Date(parseInt(watch.expiration)), conn.id]);
      console.log(`[cron] Renewed watch for ${conn.gmail_email}`);
    }
    res.json({ ok: true, renewed: result.rows.length });
  } catch (err) {
    console.error('[cron] Renew error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;