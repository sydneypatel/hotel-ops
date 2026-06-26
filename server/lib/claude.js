const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic(process.env.ANTHROPIC_API_KEY);

const DEFAULT_CATEGORIES = ['MAINTENANCE', 'GUEST', 'RESERVATIONS', 'VENDOR', 'STAFF', 'ADMIN'];

async function classifyEmail(emailData, hotelNames = [], customCategories = []) {
  const { subject, from, snippet, body } = emailData;

  const allCategories = [
    ...DEFAULT_CATEGORIES,
    ...customCategories.map(c => c.toUpperCase().replace(/\s+/g, '_')),
    'OTHER',
  ];

  const hotelContext = hotelNames.length > 0
    ? `Known hotel properties:\n${hotelNames.map(h => `- ${h}`).join('\n')}`
    : 'No hotel properties configured — use "Unknown" for hotel field.';

  const categoryList = allCategories.map(c => {
    const descriptions = {
      MAINTENANCE: 'repairs, facilities, equipment, housekeeping',
      GUEST: 'guest complaints, requests, feedback, check-in/out',
      RESERVATIONS: 'bookings, cancellations, availability, rates',
      VENDOR: 'suppliers, contractors, deliveries, invoices',
      STAFF: 'HR, scheduling, employee issues',
      ADMIN: 'corporate, legal, compliance, management',
      OTHER: 'personal, spam, newsletters, unclear',
    };
    return `- ${c}${descriptions[c] ? `: ${descriptions[c]}` : ' (custom category)'}`;
  }).join('\n');

  const prompt = `You are a hotel operations email classifier. Analyze this email and return a structured classification.

${hotelContext}

Available categories:
${categoryList}

Email to classify:
Subject: ${subject || '(no subject)'}
From: ${from || '(unknown)'}
Content: ${snippet || body || '(no content)'}

Respond with ONLY a valid JSON object, no markdown, no explanation:
{
  "hotel": "exact hotel name from the list above, or Unknown",
  "category": "one category from the list above",
  "priority": "URGENT|HIGH|MEDIUM|LOW",
  "summary": "2-3 sentence summary of what this email is about and what action is needed",
  "action_items": ["specific action 1", "specific action 2"],
  "requires_response": true or false
}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

async function generateBriefing(emails, hotelNames = []) {
  if (!emails.length) {
    return { headline: 'Inbox is clear.', urgent: [], todaysPlan: [], watchList: [], clear: 'Nothing outstanding.' };
  }

  const summary = emails.slice(0, 30).map(e =>
    `[${e.priority}] ${e.hotel || 'Unknown'} | ${e.category} | ${e.subject} — ${e.summary || (e.action_items || []).join('; ')}`
  ).join('\n');

  const prompt = `You are a sharp chief of staff for a hotel management company. Generate a concise operational briefing based on today's active emails.

Active emails:
${summary}

Respond with ONLY a valid JSON object, no markdown:
{
  "headline": "2-3 sentence executive summary of today's inbox",
  "urgent": ["urgent item 1", "urgent item 2"],
  "todaysPlan": ["1. First priority action", "2. Second priority action", "3. Third priority action"],
  "watchList": ["item to monitor 1", "item to monitor 2"],
  "clear": "One sentence about what is handled or low-priority"
}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

module.exports = { classifyEmail, generateBriefing };