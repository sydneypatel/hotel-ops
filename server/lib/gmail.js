const { google } = require('googleapis');

function makeOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getAuthUrl(state = '') {
  const client = makeOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    state,
  });
}

async function exchangeCode(code) {
  const client = makeOAuth2Client();
  const { tokens } = await client.getToken(code);
  return tokens;
}

async function makeGmailClient(accessToken, refreshToken) {
  const auth = makeOAuth2Client();
  auth.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth });
}

async function getUserEmail(accessToken, refreshToken) {
  const auth = makeOAuth2Client();
  auth.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  const oauth2 = google.oauth2({ version: 'v2', auth });
  const { data } = await oauth2.userinfo.get();
  return data.email;
}

async function registerWatch(gmail) {
  const { data } = await gmail.users.watch({
    userId: 'me',
    requestBody: {
      topicName: `projects/${process.env.GOOGLE_CLOUD_PROJECT}/topics/${process.env.PUBSUB_TOPIC}`,
      labelIds: ['INBOX'],
    },
  });
  return data;
}

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

async function getEmailDetails(gmail, messageId) {
  const { data: msg } = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  const headers = msg.payload.headers || [];
  const h = (name) => headers.find(h => h.name.toLowerCase() === name)?.value || '';
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
    body: body.slice(0, 600),
  };
}

// List messages from inbox with optional date filter
async function listMessages(gmail, { months = 1, maxResults = 200 } = {}) {
  const after = new Date();
  after.setMonth(after.getMonth() - parseInt(months));
  const afterStr = `${after.getFullYear()}/${String(after.getMonth()+1).padStart(2,'0')}/${String(after.getDate()).padStart(2,'0')}`;

  const allMessages = [];
  let pageToken = null;

  do {
    const params = {
      userId: 'me',
      q: `in:inbox after:${afterStr}`,
      maxResults: Math.min(maxResults - allMessages.length, 100),
    };
    if (pageToken) params.pageToken = pageToken;

    const { data } = await gmail.users.messages.list(params);
    if (data.messages) allMessages.push(...data.messages);
    pageToken = data.nextPageToken || null;
  } while (pageToken && allMessages.length < maxResults);

  return allMessages;
}

module.exports = {
  getAuthUrl,
  exchangeCode,
  makeGmailClient,
  getUserEmail,
  registerWatch,
  getNewMessageIds,
  getEmailDetails,
  listMessages,
};