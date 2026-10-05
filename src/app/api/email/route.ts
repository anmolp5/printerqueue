import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

const DEFAULT_FALLBACK_RECIPIENT = "anmolp5@illinois.edu";

const BADGE_LABELS: Record<string, { label: string; color: string }> = {
  confirmation: { label: "Reservation Confirmed", color: "#2563eb" },
  pre_booking_reminder: { label: "Upcoming Slot Reminder", color: "#ea580c" },
  slot_starting: { label: "Slot Starting Now", color: "#d97706" },
  print_started: { label: "Print Job In Progress", color: "#059669" },
  print_completed: { label: "Print Completed & Bed Cleared", color: "#16a34a" },
  early_offer: { label: "Early Slot Available", color: "#7c3aed" },
  late_cancel: { label: "Late Arrival Auto-Canceled", color: "#dc2626" },
  late_warning: { label: "15-Min Late Start Warning", color: "#ca8a04" },
  admin_override: { label: "Lab Admin Schedule Update", color: "#4f46e5" },
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      to,
      subject,
      text,
      actionUrl,
      actionLabel,
      type,
      resendApiKey,
      msGraphToken,
    } = body;

    const requestedTo = String(to || "").trim().toLowerCase();
    const recipient = requestedTo.endsWith("@illinois.edu")
      ? requestedTo
      : DEFAULT_FALLBACK_RECIPIENT;

    const badge = BADGE_LABELS[type] || {
      label: "Portal Notification",
      color: "#13294B",
    };

    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden;">
        <div style="background-color: #13294B; color: #ffffff; padding: 20px 24px; border-bottom: 4px solid #FF5F05;">
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #FF5F05;">
            University of Illinois Urbana-Champaign
          </div>
          <h2 style="margin: 4px 0 0 0; font-size: 18px; font-weight: 700;">
            Bambu Lab X1C Queue &amp; Booking Portal
          </h2>
        </div>

        <div style="padding: 24px;">
          <div style="margin-bottom: 16px;">
            <span style="display: inline-block; background-color: ${badge.color}; color: #ffffff; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 4px 10px; border-radius: 9999px;">
              ${badge.label}
            </span>
          </div>

          <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #0f172a;">
            ${subject}
          </h3>

          <div style="white-space: pre-line; color: #334155; font-size: 14px; line-height: 1.6; background-color: #f8fafc; padding: 16px; border-radius: 12px; border: 1px solid #e2e8f0;">
            ${text}
          </div>

          ${
            actionUrl
              ? `<div style="margin-top: 20px;">
                  <a href="${actionUrl}" style="background-color: #FF5F05; color: #ffffff; padding: 12px 20px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 14px; display: inline-block;">
                    ${actionLabel || "Open Booking Portal"}
                  </a>
                </div>`
              : ""
          }

          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8;">
            Sent exclusively to <strong>${recipient}</strong> • Bambu Lab X1C Shared Lab Queue
          </div>
        </div>
      </div>
    `;

    // 1. Try Resend if an API key is provided
    const apiKey = (resendApiKey || process.env.RESEND_API_KEY || "").trim();
    if (apiKey.length > 0) {
      const resend = new Resend(apiKey);
      const { data, error } = await resend.emails.send({
        from: "Bambu X1C Lab <onboarding@resend.dev>",
        to: [recipient],
        subject,
        text,
        html: htmlContent,
      });

      if (error) {
        return NextResponse.json(
          { error: `Resend Error: ${error.message}`, provider: "resend" },
          { status: 400 }
        );
      }

      return NextResponse.json({
        sent: true,
        provider: "resend",
        recipient,
        id: data?.id,
      });
    }

    // 2. Try UIUC Microsoft 365 Graph API (Mail.Send) if user has a Graph access token
    const graphToken = (msGraphToken || "").trim();
    if (graphToken.length > 0) {
      const graphRes = await fetch(
        "https://graph.microsoft.com/v1.0/me/sendMail",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${graphToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              subject,
              body: {
                contentType: "HTML",
                content: htmlContent,
              },
              toRecipients: [
                {
                  emailAddress: {
                    address: recipient,
                  },
                },
              ],
            },
            saveToSentItems: true,
          }),
        }
      );

      if (graphRes.ok || graphRes.status === 202) {
        return NextResponse.json({
          sent: true,
          provider: "microsoft-graph",
          recipient,
        });
      } else {
        let graphErr = "Microsoft 365 Mail.Send permission not granted yet.";
        try {
          const errJson = await graphRes.json();
          if (errJson?.error?.message) {
            graphErr = `Microsoft 365 Graph (${errJson.error.code || graphRes.status}): ${errJson.error.message}`;
          }
        } catch {
          // ignore
        }
        return NextResponse.json(
          {
            error: graphErr,
            provider: "microsoft-graph",
          },
          { status: 400 }
        );
      }
    }

    // 3. Fallback to server console log + client outbox inspector when neither Resend key nor Outlook Mail.Send token is configured
    console.log(
      `[Email Outbox -> ${recipient}] (${badge.label}) ${subject}\n${text}`
    );
    return NextResponse.json({
      sent: true,
      provider: "local-dev-fallback",
      recipient,
      message:
        "Previewed in portal (Click 'Connect UIUC Outlook Mail' or enter a Resend API Key to deliver to your real anmolp5@illinois.edu inbox)",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to send email";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
