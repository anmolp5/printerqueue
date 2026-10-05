import { DispatchedEmail, EmailNotificationType } from "./types";

const EMAIL_STORAGE_KEY = "bambu_x1c_dev_outbox_v1";
export const RESEND_KEY_STORAGE_KEY = "bambu_x1c_resend_api_key";
export const MS_GRAPH_TOKEN_STORAGE_KEY = "bambu_x1c_ms_graph_token";

// Hard lock: All emails are strictly routed ONLY to anmolp5@illinois.edu
export const STRICT_RECIPIENT_EMAIL = "anmolp5@illinois.edu";

type EmailListener = (
  emails: DispatchedEmail[],
  latestEmail?: DispatchedEmail
) => void;
const listeners = new Set<EmailListener>();

export function getStoredResendApiKey(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(RESEND_KEY_STORAGE_KEY) || "";
}

export function setStoredResendApiKey(key: string) {
  if (typeof window === "undefined") return;
  if (key.trim()) {
    window.localStorage.setItem(RESEND_KEY_STORAGE_KEY, key.trim());
  } else {
    window.localStorage.removeItem(RESEND_KEY_STORAGE_KEY);
  }
}

export function getStoredMsGraphToken(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(MS_GRAPH_TOKEN_STORAGE_KEY) || "";
}

export function setStoredMsGraphToken(token: string) {
  if (typeof window === "undefined") return;
  if (token.trim()) {
    window.localStorage.setItem(MS_GRAPH_TOKEN_STORAGE_KEY, token.trim());
  } else {
    window.localStorage.removeItem(MS_GRAPH_TOKEN_STORAGE_KEY);
  }
}

export function getDispatchedEmails(): DispatchedEmail[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(EMAIL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveDispatchedEmail(email: DispatchedEmail, notifyLatest = true) {
  if (typeof window === "undefined") return;
  const current = getDispatchedEmails();
  const existingIdx = current.findIndex((e) => e.id === email.id);
  let updated: DispatchedEmail[];
  if (existingIdx >= 0) {
    updated = [...current];
    updated[existingIdx] = email;
  } else {
    updated = [email, ...current].slice(0, 50);
  }
  window.localStorage.setItem(EMAIL_STORAGE_KEY, JSON.stringify(updated));
  listeners.forEach((fn) => fn(updated, notifyLatest ? email : undefined));
}

export function subscribeToEmails(listener: EmailListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearDispatchedEmails() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(EMAIL_STORAGE_KEY);
  listeners.forEach((fn) => fn([]));
}

export async function dispatchEmail(params: {
  to: string;
  subject: string;
  text: string;
  actionUrl?: string;
  actionLabel?: string;
  type: EmailNotificationType;
}): Promise<DispatchedEmail> {
  const intended = params.to.trim().toLowerCase();
  // Route to the logged-in @illinois.edu account (with fallback to anmolp5@illinois.edu if non-illinois)
  const recipient = intended.endsWith("@illinois.edu")
    ? intended
    : STRICT_RECIPIENT_EMAIL;

  const record: DispatchedEmail = {
    id: `email-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    to: recipient,
    intendedRecipient: intended,
    subject: params.subject,
    text: params.text,
    actionUrl: params.actionUrl,
    actionLabel: params.actionLabel,
    sentAt: new Date().toISOString(),
    type: params.type,
    deliveryStatus: "local_preview",
  };

  // Save immediately to outbox and trigger UI toast
  saveDispatchedEmail(record, true);

  if (typeof window !== "undefined") {
    const msGraphToken = getStoredMsGraphToken();
    const customApiKey = getStoredResendApiKey();

    // 1. Direct browser-to-Microsoft Graph delivery (works on static GitHub Pages & localhost)
    if (msGraphToken && msGraphToken.trim().length > 10) {
      const htmlBody = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e4e4e7; border-radius: 12px; background: #ffffff;">
          <div style="background: #13294B; color: #ffffff; padding: 16px 20px; border-radius: 8px; margin-bottom: 20px; border-bottom: 3px solid #FF5F05;">
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #FF5F05; font-weight: 700;">UIUC Bambu Lab X1C Queue Portal</div>
            <div style="font-size: 16px; font-weight: 700; margin-top: 4px;">${record.subject}</div>
          </div>
          <div style="font-size: 14px; line-height: 1.6; color: #27272a; white-space: pre-wrap;">${record.text}</div>
          ${
            record.actionUrl
              ? `<div style="margin-top: 24px;">
                  <a href="${record.actionUrl}" style="display: inline-block; background: #FF5F05; color: #ffffff; font-weight: 700; font-size: 14px; padding: 12px 20px; border-radius: 8px; text-decoration: none;">
                    ${record.actionLabel || "Open Bambu Lab X1C Portal"}
                  </a>
                </div>`
              : ""
          }
          <div style="margin-top: 28px; padding-top: 14px; border-top: 1px solid #f4f4f5; font-size: 11px; color: #71717a;">
            Sent to <strong>${recipient}</strong> • University of Illinois Urbana-Champaign Bambu Lab X1C Portal
          </div>
        </div>
      `;

      try {
        const graphRes = await fetch(
          "https://graph.microsoft.com/v1.0/me/sendMail",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${msGraphToken.trim()}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: {
                subject: record.subject,
                body: {
                  contentType: "HTML",
                  content: htmlBody,
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
          record.deliveryStatus = "sent_microsoft_graph";
          record.deliveryMessage = `Delivered to ${recipient} inbox via UIUC Microsoft 365`;
          saveDispatchedEmail(record, true);
          return record;
        }
      } catch {
        // Fall through to local API fallback if available
      }
    }

    // 2. Fallback to server API route (when running locally with Resend or server route)
    try {
      const res = await fetch("/api/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...record,
          resendApiKey: customApiKey || undefined,
          msGraphToken: msGraphToken || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.provider === "resend") {
          record.deliveryStatus = "sent_resend";
          record.deliveryMessage = `Delivered to ${recipient} inbox via Resend`;
          saveDispatchedEmail(record, true);
        } else if (data.provider === "microsoft-graph") {
          record.deliveryStatus = "sent_microsoft_graph";
          record.deliveryMessage = `Delivered to ${recipient} inbox via UIUC Microsoft 365`;
          saveDispatchedEmail(record, true);
        }
      }
    } catch {
      // Static GitHub Pages fallback
    }
  }

  return record;
}
