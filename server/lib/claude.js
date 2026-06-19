const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function classifyEmail(emailData, hotelNames = []) {
  const hotelList = hotelNames.length > 0
    ? `Known hotel properties: ${hotelNames.join(', ')}.`
    : 'No hotel properties configured yet — use "Unknown" for hotel field.';

  const prompt = `You are a hotel management email triage assistant.
${hotelList}

Classify the email below. Return ONLY a valid JSON object — no markdown, no preamble:
{
  "hotel": "hotel name from the list above, or 'Unknown'",
  "category": "MAINTENANCE|GUEST|RESERVATIONS|VENDOR|STAFF|ADMIN|OTHER",
  "priority": "URGENT|HIGH|MEDIUM|LOW",
  "summary": "1-2 sentence plain English summary of what this email is about",
  "actionItems": ["specific action 1", "specific action 2"],
  "requiresResponse": true
}

Category definitions:
- MAINTENANCE: repairs, facilities, equipment, HVAC, plumbing, electrical
- GUEST: complaints, requests, feedback, reviews
- RESERVATIONS: bookings, cancellations, availability inquiries
- VENDOR: suppliers, contractors, invoices, deliveries
- STAFF: HR, scheduling, payroll, internal team comms
- ADMIN: legal, billing, compliance, administrative tasks
- OTHER: newsletters, marketing, unrelated

Priority:
- URGENT: safety issue or needs action in the next few hours
- HIGH: needs attention today
- MEDIUM: this week
- LOW: no rush

Email:
Subject: ${emailData.subject}
From: ${emailData.from}
Date: ${emailData.date}
---
${emailData.body || emailData.snippet}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text;
  const clean = text.replace(/```json\n?|```/g, '').trim();

  try {
    return JSON.parse(clean);
  } catch {
    console.error('Failed to parse classification:', clean);
    return {
      hotel: 'Unknown',
      category: 'OTHER',
      priority: 'MEDIUM',
      summary: emailData.snippet || '(Classification failed)',
      actionItems: ['Review manually'],
      requiresResponse: false,
    };
  }
}

async function generateBriefing(emails, hotelNames = []) {
  const now = new Date().toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: `You are an AI chief of staff for a hotel management company. It is ${now}.

Review the active inbox below and generate a briefing. Be specific — name the hotels and issues. Be direct, no fluff.

Return ONLY valid JSON (no markdown, no preamble):
{
  "headline": "1 sentence situation overview — specific, names hotels and key issues",
  "urgent": ["specific action needed right now with hotel name", "another urgent action"],
  "todaysPlan": ["1. First priority — hotel name + specific action", "2. Second priority", "3. Third"],
  "watchList": ["thing that could escalate if not monitored — be specific"],
  "clear": "1 sentence on what is under control or can wait"
}

Active emails (${emails.length} total, excluding resolved):
${JSON.stringify(emails.map(e => ({
  subject: e.subject,
  sender: e.sender,
  hotel: e.hotel,
  category: e.category,
  priority: e.priority,
  summary: e.summary,
  actionItems: e.action_items,
  requiresResponse: e.requires_response,
  status: e.status,
})))}

Known hotel properties: ${hotelNames.length ? hotelNames.join(', ') : 'not configured'}`
    }],
  });

  const text = response.content[0].text;
  const clean = text.replace(/```json\n?|```/g, '').trim();

  try {
    return JSON.parse(clean);
  } catch {
    console.error('Failed to parse briefing:', clean);
    return {
      headline: 'Unable to generate briefing — try again.',
      urgent: [],
      todaysPlan: [],
      watchList: [],
      clear: '',
    };
  }
}

module.exports = { classifyEmail, generateBriefing };