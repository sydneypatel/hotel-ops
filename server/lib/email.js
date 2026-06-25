const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

function buildHtml(timeLabel, briefing, stats) {
  const now = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const urgentHtml = briefing.urgent?.length
    ? briefing.urgent.map(i => `<div style="display:flex;gap:8px;font-size:13px;color:#991b1b;padding:3px 0;line-height:1.55;"><span style="flex-shrink:0;font-weight:700;">→</span><span>${i}</span></div>`).join('')
    : '<div style="font-size:13px;color:#991b1b;">No urgent items.</div>';

  const planHtml = briefing.todaysPlan?.length
    ? briefing.todaysPlan.map(i => `<div style="font-size:13px;color:#374151;padding:3px 0;line-height:1.55;">${i}</div>`).join('')
    : '<div style="font-size:13px;color:#374151;">No specific plan items.</div>';

  const watchHtml = briefing.watchList?.length
    ? briefing.watchList.map(i => `<div style="display:flex;gap:8px;font-size:13px;color:#92400e;padding:3px 0;line-height:1.55;"><span style="flex-shrink:0;">→</span><span>${i}</span></div>`).join('')
    : '<div style="font-size:13px;color:#92400e;">Nothing to watch right now.</div>';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:20px;background:#f9fafb;font-family:system-ui,-apple-system,sans-serif;">
<div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">

  <div style="background:#111;padding:20px 24px;">
    <div style="color:white;font-size:18px;font-weight:700;">Dashboard</div>
    <div style="color:#9ca3af;font-size:13px;margin-top:3px;">${timeLabel} &middot; ${now}</div>
  </div>

  <div style="padding:18px 24px;border-bottom:1px solid #f3f4f6;">
    <p style="margin:0;font-size:14px;color:#374151;line-height:1.65;font-weight:500;">${briefing.headline || ''}</p>
  </div>

  <div style="padding:18px 24px;">

    <div style="background:#fef2f2;border-radius:8px;padding:13px 15px;margin-bottom:12px;">
      <div style="font-size:11px;font-weight:700;color:#E24B4A;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">🚨 Urgent — Act Now</div>
      ${urgentHtml}
    </div>

    <div style="background:#f8fafc;border-radius:8px;padding:13px 15px;margin-bottom:12px;">
      <div style="font-size:11px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">📋 Order of Attack</div>
      ${planHtml}
    </div>

    <div style="background:#fffbeb;border-radius:8px;padding:13px 15px;margin-bottom:12px;">
      <div style="font-size:11px;font-weight:700;color:#BA7517;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">👀 Watch List</div>
      ${watchHtml}
    </div>

    <div style="background:#f0fdf4;border-radius:8px;padding:13px 15px;">
      <div style="font-size:11px;font-weight:700;color:#1D9E75;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">✓ Under Control</div>
      <div style="font-size:13px;color:#166534;line-height:1.55;">${briefing.clear || 'Nothing outstanding.'}</div>
    </div>

  </div>

  <div style="padding:14px 24px;border-top:1px solid #f3f4f6;display:flex;justify-content:space-between;align-items:center;">
    <div style="font-size:12px;color:#9ca3af;">${stats.total} active &middot; ${stats.urgent} urgent &middot; ${stats.replies} need reply</div>
    <a href="${process.env.CLIENT_URL || 'https://hotel-ops-two.vercel.app'}"
       style="background:#111;color:white;text-decoration:none;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;display:inline-block;">
      View Dashboard &rarr;
    </a>
  </div>

</div>
</body>
</html>`;
}

async function sendReport(recipients, timeLabel, briefing, stats) {
  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);

  const now = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  await resend.emails.send({
    from: 'Hotel Ops <onboarding@resend.dev>',
    to: recipients,
    subject: `Hotel Ops — ${timeLabel} | ${now}`,
    html: buildHtml(timeLabel, briefing, stats),
  });
}

module.exports = { sendReport };