/**
 * Bambu Cloud Guard - Notifier
 * Dispatches alert emails via Resend REST API and push notifications via ntfy.sh
 */

export async function sendGuardAlert(params) {
  const {
    recipients = ['anmolp5@illinois.edu'],
    subject,
    title,
    message,
    severity = 'warning', // 'warning' | 'critical' | 'info'
    printerInfo = {},
    resendApiKey = '',
    dryRun = false
  } = params;

  const results = {
    emailSent: false,
    ntfySent: false,
    recipients,
    errors: []
  };

  const badgeColor = severity === 'critical' ? '#dc2626' : severity === 'warning' ? '#ea580c' : '#13294B';
  const dryRunPrefix = dryRun ? '[DRY RUN] ' : '';

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e4e4e7; border-radius: 12px; overflow: hidden;">
      <div style="background: #13294B; color: #ffffff; padding: 18px 24px; border-bottom: 4px solid #FF5F05;">
        <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #FF5F05;">
          UIUC Bambu Lab X1-Carbon Security Guard
        </div>
        <div style="font-size: 17px; font-weight: 700; margin-top: 4px;">
          ${dryRunPrefix}${title}
        </div>
      </div>

      <div style="padding: 24px;">
        ${dryRun ? `
          <div style="margin-bottom: 16px; padding: 10px 14px; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; color: #92400e; font-size: 12px; font-weight: 600;">
            ⚠️ MONITOR ONLY (DRY RUN): No physical cancel/pause commands were sent to the printer.
          </div>
        ` : ''}

        <div style="margin-bottom: 16px;">
          <span style="display: inline-block; background: ${badgeColor}; color: #ffffff; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; padding: 4px 10px; border-radius: 9999px;">
            ${severity.toUpperCase()} ALERT
          </span>
        </div>

        <div style="font-size: 14px; line-height: 1.6; color: #27272a; white-space: pre-line; background: #f8fafc; padding: 16px; border-radius: 10px; border: 1px solid #e2e8f0;">
          ${message}
        </div>

        <div style="margin-top: 20px; padding: 14px; background: #f4f4f5; border-radius: 8px; font-size: 12px; color: #52525b;">
          <strong>Printer Telemetry:</strong><br />
          • Device: Bambu Lab X1-Carbon (SN: ${printerInfo.serialNumber || '00M09C432301761'})<br />
          • Active Sliced File: <code>${printerInfo.fileName || 'N/A'}</code><br />
          • Printer State: <strong>${printerInfo.state || 'RUNNING'}</strong> (${printerInfo.progress || 0}% complete)<br />
          • Time Remaining: ${printerInfo.remainingTime || 0} minutes
        </div>

        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #f4f4f5; font-size: 11px; color: #71717a;">
          Delivered to authorized recipients: <strong>${recipients.join(', ')}</strong><br />
          University of Illinois Urbana-Champaign Shared Lab
        </div>
      </div>
    </div>
  `;

  // 1. Send via Resend REST API if key is provided
  const cleanKey = (resendApiKey || '').trim();
  if (cleanKey.length > 5) {
    try {
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cleanKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Bambu Lab Guard <onboarding@resend.dev>',
          to: recipients,
          subject: `${dryRunPrefix}${subject}`,
          html: htmlBody,
          text: message
        })
      });

      if (emailRes.ok) {
        results.emailSent = true;
      } else {
        const errText = await emailRes.text();
        results.errors.push(`Resend error (${emailRes.status}): ${errText}`);
      }
    } catch (e) {
      results.errors.push(`Email delivery failed: ${e.message}`);
    }
  }

  // 2. Dispatch push notification to ntfy.sh topic (always works, 100% free)
  try {
    const ntfyRes = await fetch('https://ntfy.sh/uiuc_bambu_x1c_alerts', {
      method: 'POST',
      headers: {
        'Title': `${dryRunPrefix}${title}`,
        'Priority': severity === 'critical' ? '5' : '4',
        'Tags': severity === 'critical' ? 'warning,printer' : 'information_source'
      },
      body: message
    });
    if (ntfyRes.ok) {
      results.ntfySent = true;
    }
  } catch (e) {
    // ignore push notification errors
  }

  return results;
}
