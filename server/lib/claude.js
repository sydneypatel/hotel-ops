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
    // Fallback if parsing fails
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

module.exports = { classifyEmail };
