const { google } = require('googleapis');

function makeOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getAuthUrl() {
  const client = makeOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // forces refresh_token every time
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  });
}

async function exchangeCode(code) {
  const client = makeOAuth2Client();
  const { tokens } = await client.getToken(code);
  return tokens; // { access_token, refresh_token, expiry_date }
}

async function makeGmailClient(accessToken, refreshToken) {
  const auth = makeOAuth2Client();
  auth.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  // Auto-refresh access token when expired
  auth.on('tokens', (tokens) => {
    if (tokens.refresh_token) {
      // TODO: persist updated tokens to DB
      console.log('Tokens refreshed for:', accessToken.slice(0, 10));
    }
  });
  return google.gmail({ version: 'v1', auth });
}

async function getUserEmail(accessToken, refreshToken) {
  const auth = makeOAuth2Client();
  auth.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  const oauth2 = google.oauth2({ version: 'v2', auth });
  const { data } = await oauth2.userinfo.get();
  return data.email;
}

// Register Gmail Push — expires in 7 days, renew via cron
async function registerWatch(gmail) {
  const { data } = await gmail.users.watch({
    userId: 'me',
    requestBody: {
      topicName: `projects/${process.env.GOOGLE_CLOUD_PROJECT}/topics/${process.env.PUBSUB_TOPIC}`,
      labelIds: ['INBOX'],
    },
  });
  return data; // { historyId, expiration }
}

async function stopWatch(gmail) {
  await gmail.users.stop({ userId: 'me' }).catch(() => {});
}

// Given a historyId, return all new INBOX message IDs added since then
async function getNewMessageIds(gmail, startHistoryId) {
  const { data } = await gmail.users.history.list({
    userId: 'me',
    startHistoryId,
    historyTypes: ['messageAdded'],
    labelId: 'INBOX',
  });

  if (!data.history) return [];

  const ids = new Set();
  for (const record of data.history) {
    for (const { message } of (record.messagesAdded || [])) {
      ids.add(message.id);
    }
  }
  return [...ids];
}

// Fetch and parse a single message
async function getEmailDetails(gmail, messageId) {
  const { data: msg } = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  const headers = msg.payload.headers || [];
  const h = (name) => headers.find(h => h.name.toLowerCase() === name)?.value || '';

  // Extract plaintext body (recursively search MIME parts)
  let body = '';
  function walk(part) {
    if (!part) return;
    if (part.mimeType === 'text/plain' && part.body?.data) {
      body = Buffer.from(part.body.data, 'base64').toString('utf-8');
    } else if (part.parts) {
      part.parts.forEach(walk);
    }
  }
  walk(msg.payload);

  return {
    id: messageId,
    subject: h('subject') || '(No subject)',
    from: h('from'),
    date: h('date'),
    snippet: msg.snippet || '',
    body: body.slice(0, 600), // first 600 chars for classification
  };
}

module.exports = {
  getAuthUrl,
  exchangeCode,
  makeGmailClient,
  getUserEmail,
  registerWatch,
  stopWatch,
  getNewMessageIds,
  getEmailDetails,
};
