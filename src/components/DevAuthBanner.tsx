"use client";

import React, { useState, useEffect } from "react";
import {
  UserCheck,
  Shield,
  Mail,
  Timer,
  RotateCcw,
  ExternalLink,
  X,
  Ban,
  Trash2,
  KeyRound,
  Check,
  Lock,
  Send,
  AlertCircle,
} from "lucide-react";
import { DispatchedEmail, UserProfile } from "@/lib/types";
import { DEV_PERSONAS } from "@/lib/store";
import {
  STRICT_RECIPIENT_EMAIL,
  getDispatchedEmails,
  subscribeToEmails,
  clearDispatchedEmails,
  getStoredResendApiKey,
  setStoredResendApiKey,
  getStoredMsGraphToken,
  dispatchEmail,
} from "@/lib/email";
import {
  CUSTOM_CLIENT_SECRET_STORAGE_KEY,
  getActiveAzureClientSecret,
  isEmailInAdminAllowlist,
} from "@/lib/auth-config";
import {
  getAdminSettings,
  subscribeToAdminSettings,
} from "@/lib/admin-settings";
import Link from "next/link";

interface DevAuthBannerProps {
  currentUser: UserProfile | null;
  onSwitchPersona: (personaId: string) => void;
  onTestExternalRejection: (email: string) => void;
  onTriggerLateCron: () => Promise<{
    canceledCount: number;
    warnedCount: number;
  }>;
  onResetDemo: () => void;
  onConnectOutlookMail?: () => void;
}

export const DevAuthBanner: React.FC<DevAuthBannerProps> = ({
  currentUser,
  onSwitchPersona,
  onTestExternalRejection,
  onTriggerLateCron,
  onResetDemo,
  onConnectOutlookMail,
}) => {
  const activeEmail = currentUser?.email || STRICT_RECIPIENT_EMAIL;
  const [emails, setEmails] = useState<DispatchedEmail[]>([]);
  const [latestToastEmail, setLatestToastEmail] =
    useState<DispatchedEmail | null>(null);
  const [isEmailDrawerOpen, setIsEmailDrawerOpen] = useState(false);
  const [cronStatus, setCronStatus] = useState<string | null>(null);
  const [resendKeyInput, setResendKeyInput] = useState<string>("");
  const [azureSecretInput, setAzureSecretInput] = useState<string>("");
  const [hasMsGraphToken, setHasMsGraphToken] = useState<boolean>(false);
  const [keySavedBanner, setKeySavedBanner] = useState<boolean>(false);
  const [secretSavedBanner, setSecretSavedBanner] = useState<boolean>(false);
  const [isSendingTest, setIsSendingTest] = useState<boolean>(false);
  const [adminEmailsList, setAdminEmailsList] = useState<string[]>(
    () => getAdminSettings().permissions.adminEmails
  );

  useEffect(() => {
    setEmails(getDispatchedEmails());
    setResendKeyInput(getStoredResendApiKey());
    setAzureSecretInput(getActiveAzureClientSecret());
    setHasMsGraphToken(Boolean(getStoredMsGraphToken()));
    const unsubEmails = subscribeToEmails((updated, newlyDispatched) => {
      setEmails(updated);
      setHasMsGraphToken(Boolean(getStoredMsGraphToken()));
      if (newlyDispatched) {
        setLatestToastEmail(newlyDispatched);
      }
    });
    const unsubAdmin = subscribeToAdminSettings((s) => {
      setAdminEmailsList(s.permissions.adminEmails);
    });
    return () => {
      unsubEmails();
      unsubAdmin();
    };
  }, []);

  const handleSaveResendKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setStoredResendApiKey(resendKeyInput);
    setKeySavedBanner(true);
    setTimeout(() => setKeySavedBanner(false), 3000);
  };

  const handleSaveAzureSecret = (e: React.FormEvent) => {
    e.preventDefault();
    if (typeof window !== "undefined") {
      if (azureSecretInput.trim()) {
        window.localStorage.setItem(
          CUSTOM_CLIENT_SECRET_STORAGE_KEY,
          azureSecretInput.trim()
        );
      } else {
        window.localStorage.removeItem(CUSTOM_CLIENT_SECRET_STORAGE_KEY);
      }
    }
    setSecretSavedBanner(true);
    setTimeout(() => setSecretSavedBanner(false), 3000);
  };

  const handleSendTestEmail = async () => {
    setIsSendingTest(true);
    await dispatchEmail({
      to: activeEmail,
      subject: `Test Email from Bambu Lab X1C Portal (${new Date().toLocaleTimeString()})`,
      text: `This is a test email from the UIUC Bambu Lab X1C Queue & Booking Portal.\n\n• Logged-In Account: ${activeEmail}\n• Events Enabled: Reservation Confirmed, Pre-Booking Reminder, Slot Starting, Print Started, and Print Completed + Early Slot Magic Link.`,
      actionUrl: "http://localhost:3000",
      actionLabel: "Open Bambu Lab X1C Portal",
      type: "confirmation",
    });
    setIsSendingTest(false);
  };

  const handleRunCron = async () => {
    const res = await onTriggerLateCron();
    setCronStatus(
      `Cron executed: ${res.canceledCount} late-canceled, ${res.warnedCount} warned`
    );
    setTimeout(() => setCronStatus(null), 5000);
  };

  return (
    <>
      {/* Live Pop-up Preview Toast whenever an email is sent */}
      {latestToastEmail && !isEmailDrawerOpen && (
        <div className="fixed bottom-16 right-4 z-50 max-w-md w-full bg-white rounded-2xl border-2 border-orange-500 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4">
          <div className="bg-zinc-900 text-white px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-orange-400" />
              <span className="text-xs font-bold">
                Email Event → {latestToastEmail.to}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setIsEmailDrawerOpen(true);
                  setLatestToastEmail(null);
                }}
                className="text-[11px] font-semibold text-orange-300 hover:text-orange-200 underline cursor-pointer"
              >
                Email Settings &amp; Outbox ({emails.length})
              </button>
              <button
                onClick={() => setLatestToastEmail(null)}
                className="text-zinc-400 hover:text-white p-0.5 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="p-4 space-y-2">
            {/* Delivery Status Banner inside Toast */}
            {latestToastEmail.deliveryStatus === "sent_resend" ||
            latestToastEmail.deliveryStatus === "sent_microsoft_graph" ? (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-[11px] font-semibold text-emerald-800 flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>{latestToastEmail.deliveryMessage}</span>
              </div>
            ) : latestToastEmail.deliveryStatus === "error" ? (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-1.5 text-[11px] font-medium text-red-800 flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div>{latestToastEmail.deliveryMessage}</div>
                  <button
                    onClick={() => {
                      setIsEmailDrawerOpen(true);
                      setLatestToastEmail(null);
                    }}
                    className="underline font-bold text-red-900 cursor-pointer"
                  >
                    Open Email Delivery Settings →
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-900 space-y-1.5">
                <div className="font-bold flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>
                    In-App Preview Mode (Waiting for Microsoft Token or Resend Key)
                  </span>
                </div>
                <p className="text-amber-800 text-[10px]">
                  To deliver directly to <strong>{latestToastEmail.to}</strong>,
                  make sure <code className="font-semibold">http://localhost:3000</code>{" "}
                  is under <strong>Single-page application (SPA)</strong> in Azure
                  with <code className="font-semibold">Mail.Send</code> permission, or
                  add a Client Secret / Resend Key:
                </p>
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  {onConnectOutlookMail && (
                    <button
                      onClick={onConnectOutlookMail}
                      className="px-2.5 py-1 rounded bg-[#13294B] hover:bg-slate-800 text-white font-bold text-[10px] cursor-pointer"
                    >
                      Sign In with Microsoft (Mail.Send)
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setIsEmailDrawerOpen(true);
                      setLatestToastEmail(null);
                    }}
                    className="px-2.5 py-1 rounded bg-orange-600 hover:bg-orange-700 text-white font-bold text-[10px] cursor-pointer"
                  >
                    Open Email Delivery Setup
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-zinc-700">
                To: <strong className="text-blue-600">{latestToastEmail.to}</strong>
              </span>
              <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 font-bold uppercase text-[10px]">
                {latestToastEmail.type.replace(/_/g, " ")}
              </span>
            </div>
            <div className="text-xs font-bold text-zinc-900">
              {latestToastEmail.subject}
            </div>
            <pre className="text-[11px] text-zinc-600 whitespace-pre-wrap font-sans bg-zinc-50 p-2.5 rounded-lg border border-zinc-200 max-h-40 overflow-y-auto">
              {latestToastEmail.text}
            </pre>
            {latestToastEmail.actionUrl && (
              <div className="pt-1 flex items-center justify-end">
                <Link
                  href={latestToastEmail.actionUrl.replace(
                    /^https?:\/\/[^/]+/,
                    ""
                  )}
                  onClick={() => setLatestToastEmail(null)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold shadow-2xs transition-colors"
                >
                  <span>{latestToastEmail.actionLabel || "Open Link"}</span>
                  <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Email Inspector Modal */}
      {isEmailDrawerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
          onClick={() => setIsEmailDrawerOpen(false)}
        >
          <div
            className="bg-white rounded-2xl border border-zinc-200 shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-zinc-900 text-white px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail className="w-5 h-5 text-orange-400" />
                <div>
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    <span>Transactional Email Outbox &amp; Inbox Delivery Setup</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
                      <Lock className="w-3 h-3" />
                      Active Account: {activeEmail}
                    </span>
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    Automatically sends to whichever @illinois.edu account is logged in
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSendTestEmail}
                  disabled={isSendingTest}
                  className="px-2.5 py-1 rounded-md bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs flex items-center gap-1 cursor-pointer"
                >
                  <Send className="w-3 h-3" />
                  <span>{isSendingTest ? "Sending..." : "Send Test Email"}</span>
                </button>
                {emails.length > 0 && (
                  <button
                    onClick={() => clearDispatchedEmails()}
                    className="text-xs text-zinc-400 hover:text-red-400 flex items-center gap-1 px-2 py-1 rounded cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Clear
                  </button>
                )}
                <button
                  onClick={() => setIsEmailDrawerOpen(false)}
                  className="text-zinc-400 hover:text-white p-1 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Real Inbox Delivery Options Bar */}
            <div className="bg-zinc-100 border-b border-zinc-200 px-6 py-3.5 space-y-3 text-xs">
              <div className="space-y-2 pb-2.5 border-b border-zinc-200/80">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="font-bold text-zinc-900">
                      Option 1 (Automatic on Login): Send via Logged-In UIUC Microsoft 365 ({activeEmail})
                    </div>
                    <div className="text-[11px] text-zinc-600">
                      In Azure Portal → <strong>API permissions</strong>, add <code className="font-semibold">Mail.Send</code> (Delegated). In <strong>Authentication</strong>, put <code className="font-semibold">http://localhost:3000</code> under <strong>Single-page application (SPA)</strong> (or paste your Web Client Secret below):
                    </div>
                  </div>
                  {onConnectOutlookMail && (
                    <button
                      type="button"
                      onClick={onConnectOutlookMail}
                      className="px-3 py-1.5 rounded-lg bg-[#13294B] hover:bg-slate-800 text-white font-bold text-xs shrink-0 cursor-pointer"
                    >
                      {hasMsGraphToken
                        ? "✓ Outlook Token Active (Re-Sync)"
                        : "Sign In with Microsoft (Mail.Send)"}
                    </button>
                  )}
                </div>

                {/* Optional Azure Web Client Secret if Redirect URI is under "Web" instead of "SPA" */}
                <form
                  onSubmit={handleSaveAzureSecret}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1"
                >
                  <span className="text-[11px] text-zinc-600">
                    If your Azure Redirect URI is set to <strong>Web</strong> instead of <strong>SPA</strong>, paste your Azure <strong>Client Secret Value</strong> here:
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      type="password"
                      value={azureSecretInput}
                      onChange={(e) => setAzureSecretInput(e.target.value)}
                      placeholder="Optional Azure Client Secret..."
                      className="px-2.5 py-1 text-xs border border-zinc-300 rounded-md bg-white text-zinc-900 focus:outline-none focus:ring-2 focus:ring-orange-500 w-48"
                    />
                    <button
                      type="submit"
                      className="px-3 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-xs flex items-center gap-1 cursor-pointer"
                    >
                      {secretSavedBanner ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Saved</span>
                        </>
                      ) : (
                        <span>Save Secret</span>
                      )}
                    </button>
                  </div>
                </form>
              </div>

              <form
                onSubmit={handleSaveResendKey}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 text-zinc-700">
                  <KeyRound className="w-4 h-4 text-orange-600 shrink-0" />
                  <div>
                    <div className="font-bold text-zinc-900">
                      Option 2: Server-Side Resend API Key (free at resend.com/api-keys)
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      Paste your <code className="font-semibold">re_...</code> key below (or in <code className="font-semibold">.env.local</code> as <code className="font-semibold">RESEND_API_KEY</code>)
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <input
                    type="password"
                    value={resendKeyInput}
                    onChange={(e) => setResendKeyInput(e.target.value)}
                    placeholder="re_123456789..."
                    className="px-2.5 py-1.5 text-xs border border-zinc-300 rounded-md bg-white text-zinc-900 focus:outline-none focus:ring-2 focus:ring-orange-500 w-48"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800 text-white font-semibold text-xs flex items-center gap-1 cursor-pointer"
                  >
                    {keySavedBanner ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Saved</span>
                      </>
                    ) : (
                      <span>Save Key</span>
                    )}
                  </button>
                </div>
              </form>
            </div>

            <div className="p-5 overflow-y-auto space-y-3 flex-1 bg-zinc-50">
              {emails.length === 0 ? (
                <div className="text-center py-12 text-xs text-zinc-500">
                  No transactional emails sent yet. Create a booking, click
                  &ldquo;Send Reminder Email&rdquo;, start a print, or mark a print
                  complete to see the exact email sent to{" "}
                  <strong>{STRICT_RECIPIENT_EMAIL}</strong>!
                </div>
              ) : (
                emails.map((em) => (
                  <div
                    key={em.id}
                    className="bg-white rounded-xl border border-zinc-200 p-4 shadow-2xs space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-zinc-900">
                          To: <span className="text-blue-600">{em.to}</span>
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 font-bold uppercase text-[10px]">
                          {em.type.replace(/_/g, " ")}
                        </span>
                        {em.deliveryStatus === "sent_resend" ||
                        em.deliveryStatus === "sent_microsoft_graph" ? (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                            ✓ {em.deliveryMessage || "Delivered to Inbox"}
                          </span>
                        ) : em.deliveryStatus === "error" ? (
                          <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 font-bold text-[10px]">
                            ⚠ {em.deliveryMessage}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-semibold text-[10px]">
                            In-App Preview Only
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-zinc-400">
                        {new Date(em.sentAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="text-sm font-bold text-zinc-800">
                      {em.subject}
                    </div>
                    <pre className="text-xs text-zinc-600 whitespace-pre-wrap font-sans bg-zinc-50 p-3 rounded-lg border border-zinc-100">
                      {em.text}
                    </pre>
                    {em.actionUrl && (
                      <div className="pt-1">
                        <Link
                          href={em.actionUrl.replace(/^https?:\/\/[^/]+/, "")}
                          onClick={() => setIsEmailDrawerOpen(false)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold shadow-2xs transition-colors"
                        >
                          <span>{em.actionLabel || "Open Magic Link"}</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Sticky Dev Toolbar */}
      <div className="fixed bottom-0 inset-x-0 z-40 bg-zinc-900/95 backdrop-blur-xs text-white border-t border-zinc-700 px-4 py-2.5 shadow-2xl">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Persona Switcher */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-orange-500/20 text-orange-300 border border-orange-500/30 font-bold text-[10px] uppercase tracking-wider">
              Dev Auth Toolbar
            </span>
            <span className="text-zinc-400 hidden sm:inline">
              Switch UIUC Persona:
            </span>
            {[
              ...DEV_PERSONAS,
              ...adminEmailsList
                .filter(
                  (em) =>
                    !DEV_PERSONAS.some(
                      (p) => p.email.toLowerCase() === em.toLowerCase()
                    )
                )
                .map((em) => ({
                  id: em.toLowerCase(),
                  name: em.split("@")[0],
                  email: em.toLowerCase(),
                  role: "admin" as const,
                })),
            ].map((p) => {
              const active =
                currentUser?.id === p.id ||
                currentUser?.email.toLowerCase() === p.email.toLowerCase();
              const liveRole = isEmailInAdminAllowlist(p.email)
                ? "admin"
                : "user";
              return (
                <button
                  key={p.id}
                  onClick={() => onSwitchPersona(p.email)}
                  className={`px-2.5 py-1 rounded-md font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                    active
                      ? liveRole === "admin"
                        ? "bg-indigo-600 text-white shadow-2xs ring-1 ring-indigo-400"
                        : "bg-orange-600 text-white shadow-2xs ring-1 ring-orange-400"
                      : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  }`}
                >
                  {liveRole === "admin" ? (
                    <Shield className="w-3 h-3" />
                  ) : (
                    <UserCheck className="w-3 h-3" />
                  )}
                  <span>{p.email.split("@")[0]}</span>
                  <span className="text-[10px] opacity-75">({liveRole})</span>
                </button>
              );
            })}

            <button
              onClick={() => onTestExternalRejection("external.user@gmail.com")}
              title="Simulate login attempt with non-@illinois.edu account"
              className="px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-red-950 text-red-300 border border-red-800/50 flex items-center gap-1 transition-colors cursor-pointer"
            >
              <Ban className="w-3 h-3" />
              <span>Test @gmail.com Reject</span>
            </button>
          </div>

          {/* Simulation Actions */}
          <div className="flex items-center gap-2">
            {cronStatus && (
              <span className="text-[11px] text-emerald-400 font-medium bg-emerald-950/80 px-2.5 py-1 rounded border border-emerald-700">
                {cronStatus}
              </span>
            )}

            <button
              onClick={handleRunCron}
              title="Execute the 5-minute late-arrival auto-cancellation Edge Function logic now"
              className="px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Timer className="w-3.5 h-3.5 text-amber-400" />
              <span>Run 5m Late Cron</span>
            </button>

            <button
              onClick={() => setIsEmailDrawerOpen(true)}
              className="px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Mail className="w-3.5 h-3.5 text-orange-400" />
              <span>Emails</span>
              <span className="px-1.5 py-0.2 rounded-full bg-orange-600 text-white text-[10px] font-bold">
                {emails.length}
              </span>
            </button>

            <button
              onClick={onResetDemo}
              title="Reset calendar to initial sample bookings"
              className="px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 flex items-center gap-1 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Demo</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
