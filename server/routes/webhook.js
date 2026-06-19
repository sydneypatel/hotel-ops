const express = require('express');
const router = express.Router();
const { makeGmailClient, getEmailDetails, getNewMessageIds } = require('../lib/gmail');
const { classifyEmail } = require('../lib/claude');
const { db } = require('../lib/db');

/**
 * POST /webhook/gmail
 *
 * Google Cloud Pub/Sub pushes here when a new email arrives.
 * Must respond 200 fast (before processing) or Pub/Sub will retry.
 *
 * Message shape:
 * {
 *   message: {
 *     data: base64({ emailAddress: "...", historyId: "..." }),
 *     messageId: "...",
 *     publishTime: "..."
 *   },
 *   subscription: "projects/.../subscriptions/..."
 * }
 */
router.post('/gmail', express.raw({ type: '*/*' }), async (req, res) => {
  // Ack immediately — Pub/Sub retries if you don't respond within 10s
  res.status(200).send('ok');

  try {
    const body = JSON.parse(req.body.toString());
    const message = body.message;
    if (!message?.data) return;

    const payload = JSON.parse(Buffer.from(message.data, 'base64').toString('utf-8'));
    const { emailAddress, historyId } = payload;

    console.log(`[webhook] Push received for ${emailAddress}, historyId: ${historyId}`);

    // Look up the Gmail connection for this email address
    const connResult = await db.query(
      `SELECT gc.*, u.id as user_id
       FROM gmail_connections gc
       JOIN users u ON gc.user_id = u.id
       WHERE gc.gmail_email = $1`,
      [emailAddress]
    );

    if (!connResult.rows.length) {
      console.log(`[webhook] No connection found for ${emailAddress}`);
      return;
    }

    const conn = connResult.rows[0];
    const prevHistoryId = conn.history_id;

    // Update the stored historyId so next push starts from here
    await db.query(
      'UPDATE gmail_connections SET history_id = $1 WHERE gmail_email = $2',
      [historyId, emailAddress]
    );

    // First ever push — no diff available yet, just store the historyId
    if (!prevHistoryId) {
      console.log('[webhook] First push — historyId stored, waiting for next push to diff');
      return;
    }

    // Get Gmail client with stored OAuth tokens
    const gmail = await makeGmailClient(conn.access_token, conn.refresh_token);

    // Fetch message IDs added since last historyId
    const newMessageIds = await getNewMessageIds(gmail, prevHistoryId);
    console.log(`[webhook] ${newMessageIds.length} new message(s) to process`);

    // Get hotel config for this user
    const configResult = await db.query(
      'SELECT hotel_names FROM hotel_configs WHERE user_id = $1',
      [conn.user_id]
    );
    const hotelNames = configResult.rows[0]?.hotel_names || [];

    // Process each new message
    for (const messageId of newMessageIds) {
      // Skip if already in DB (idempotency)
      const exists = await db.query(
        'SELECT id FROM emails WHERE user_id = $1 AND gmail_message_id = $2',
        [conn.user_id, messageId]
      );
      if (exists.rows.length) continue;

      try {
        const emailData = await getEmailDetails(gmail, messageId);
        const classification = await classifyEmail(emailData, hotelNames);

        await db.query(`
          INSERT INTO emails
            (user_id, gmail_message_id, subject, sender, received_at, snippet, body_preview,
             hotel, category, priority, summary, action_items, requires_response)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          ON CONFLICT (user_id, gmail_message_id) DO NOTHING
        `, [
          conn.user_id,
          messageId,
          emailData.subject,
          emailData.from,
          new Date(),
          emailData.snippet,
          emailData.body,
          classification.hotel,
          classification.category,
          classification.priority,
          classification.summary,
          classification.actionItems || [],
          classification.requiresResponse || false,
        ]);

        console.log(`[webhook] Saved: "${emailData.subject}" → ${classification.priority} / ${classification.category} / ${classification.hotel}`);
      } catch (err) {
        console.error(`[webhook] Failed to process message ${messageId}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[webhook] Fatal error:', err);
  }
});

module.exports = router;
