"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Lock,
  ArrowLeft,
  Sliders,
  Mail,
  ListFilter,
  Printer,
  Database,
  Plus,
  Trash2,
  Save,
  RotateCcw,
  Send,
  Download,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Search,
  Play,
  XCircle,
  Bell,
  Crown,
  Sparkles,
  Wrench,
  Clock,
  FileSpreadsheet,
} from "lucide-react";
import { useUserSession } from "@/hooks/useUserSession";
import {
  SUPER_ADMIN_EMAIL,
  EMAIL_TEMPLATE_META,
  AVAILABLE_TEMPLATE_TOKENS,
  DEFAULT_EMAIL_TEMPLATES,
  getAdminSettings,
  saveAdminSettings,
  resetAdminSettingsToDefaults,
  subscribeToAdminSettings,
  renderEmailTemplate,
  exportAdminSettingsJson,
  importAdminSettingsJson,
  isSuperAdmin,
} from "@/lib/admin-settings";
import {
  fetchBookings,
  subscribeToBookings,
  startPrintJob,
  completeAndClearBed,
  adminOverrideBooking,
  triggerBookingReminderEmail,
  cancelUserBooking,
  resetDemoData,
} from "@/lib/store";
import {
  dispatchEmail,
  getDispatchedEmails,
  clearDispatchedEmails,
  subscribeToEmails,
} from "@/lib/email";
import { AdminBookingModal } from "@/components/AdminBookingModal";
import {
  AdminSettings,
  BookingStatus,
  CalendarBooking,
  DispatchedEmail,
  EmailNotificationType,
} from "@/lib/types";

type AdminTabId =
  | "permissions"
  | "limits"
  | "emails"
  | "queue"
  | "profile"
  | "system";

const SAMPLE_PREVIEW_VARIABLES: Record<string, string | number> = {
  fileName: "planetary_gearbox_v4.3mf",
  userEmail: "anmolp5@illinois.edu",
  userName: "Anmol Prabhakar",
  startTime: "Thu Oct 8, 2:00 PM",
  endTime: "Thu Oct 8, 3:40 PM",
  printFinishTime: "3:30 PM",
  duration: 90,
  buffer: 10,
  minsBefore: 15,
  status: "scheduled",
  reason: "Nozzle calibration shifted queue by 15 minutes.",
  adminEmail: "anmolp5@illinois.edu",
  previousFileName: "drone_arm_mount.3mf",
  newStartTime: "1:15 PM",
};

export default function AdminDashboardPage() {
  const { user, isAdmin, canToggleAdminRole, toggleCurrentUserRole } =
    useUserSession();

  const [activeTab, setActiveTab] = useState<AdminTabId>("permissions");
  const [settings, setSettings] = useState<AdminSettings>(() =>
    getAdminSettings()
  );
  const [bookings, setBookings] = useState<CalendarBooking[]>([]);
  const [outboxEmails, setOutboxEmails] = useState<DispatchedEmail[]>(
    []
  );

  // Toast / status banner
  const [statusToast, setStatusToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Permissions tab inputs
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [newBannedEmail, setNewBannedEmail] = useState("");
  const [newDomain, setNewDomain] = useState("");

  // Email Templates tab state
  const [selectedTemplateType, setSelectedTemplateType] =
    useState<EmailNotificationType>("confirmation");
  const [isSendingTestEmail, setIsSendingTestEmail] = useState(false);

  // Queue Manager tab state
  const [queueSearch, setQueueSearch] = useState("");
  const [queueStatusFilter, setQueueStatusFilter] = useState<string>("all");
  const [adminSelectedBooking, setAdminSelectedBooking] =
    useState<CalendarBooking | null>(null);

  // Lab Profile tab state
  const [newFilamentInput, setNewFilamentInput] = useState("");

  // System Backup tab state
  const [importJsonText, setImportJsonText] = useState("");

  const userIsSuperAdmin = isSuperAdmin(user?.email);

  useEffect(() => {
    setSettings(getAdminSettings());
    const unsubSettings = subscribeToAdminSettings((updated) => {
      setSettings(updated);
    });

    fetchBookings().then(setBookings);
    const unsubBookings = subscribeToBookings((updated) => {
      setBookings(updated);
    });

    setOutboxEmails(getDispatchedEmails());
    const unsubOutbox = subscribeToEmails((updated) => {
      setOutboxEmails(updated);
    });

    return () => {
      unsubSettings();
      unsubBookings();
      unsubOutbox();
    };
  }, []);

  const showToast = (type: "success" | "error", message: string) => {
    setStatusToast({ type, message });
    setTimeout(() => {
      setStatusToast((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  };

  const commitSettings = (
    nextSettings: AdminSettings,
    successMessage = "Admin settings saved and applied live."
  ) => {
    const res = saveAdminSettings(nextSettings, user?.email);
    if (res.error) {
      showToast("error", res.error);
      setSettings(res.data);
      return false;
    }
    setSettings(res.data);
    showToast("success", successMessage);
    return true;
  };

  // --- Permissions handlers ---
  const handleAddAdminEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userIsSuperAdmin) {
      showToast(
        "error",
        `Super Admin Protected: Only ${SUPER_ADMIN_EMAIL} can add new admins.`
      );
      return;
    }
    const cleaned = newAdminEmail.trim().toLowerCase();
    if (!cleaned || !cleaned.includes("@")) {
      showToast("error", "Please enter a valid email address.");
      return;
    }
    if (settings.permissions.adminEmails.includes(cleaned)) {
      showToast("error", `"${cleaned}" is already an administrator.`);
      return;
    }
    const next: AdminSettings = {
      ...settings,
      permissions: {
        ...settings.permissions,
        adminEmails: [...settings.permissions.adminEmails, cleaned],
      },
    };
    if (
      commitSettings(
        next,
        `Added ${cleaned} to the Lab Administrators allowlist.`
      )
    ) {
      setNewAdminEmail("");
    }
  };

  const handleRemoveAdminEmail = (emailToRemove: string) => {
    if (!userIsSuperAdmin) {
      showToast(
        "error",
        `Super Admin Protected: Only ${SUPER_ADMIN_EMAIL} can revoke admin permissions.`
      );
      return;
    }
    if (emailToRemove.toLowerCase() === SUPER_ADMIN_EMAIL) {
      showToast(
        "error",
        `${SUPER_ADMIN_EMAIL} is the permanent Super Admin and cannot be removed.`
      );
      return;
    }
    const next: AdminSettings = {
      ...settings,
      permissions: {
        ...settings.permissions,
        adminEmails: settings.permissions.adminEmails.filter(
          (e) => e.toLowerCase() !== emailToRemove.toLowerCase()
        ),
      },
    };
    commitSettings(
      next,
      `Revoked admin permissions for ${emailToRemove}.`
    );
  };

  const handleAddBannedEmail = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newBannedEmail.trim().toLowerCase();
    if (!cleaned || !cleaned.includes("@")) {
      showToast("error", "Please enter a valid email address to restrict.");
      return;
    }
    if (cleaned === SUPER_ADMIN_EMAIL) {
      showToast("error", "Cannot restrict the Super Admin account.");
      return;
    }
    if (settings.permissions.bannedEmails.includes(cleaned)) {
      showToast("error", `"${cleaned}" is already on the restricted list.`);
      return;
    }
    const next: AdminSettings = {
      ...settings,
      permissions: {
        ...settings.permissions,
        bannedEmails: [...settings.permissions.bannedEmails, cleaned],
      },
    };
    if (commitSettings(next, `Restricted "${cleaned}" from booking slots.`)) {
      setNewBannedEmail("");
    }
  };

  const handleRemoveBannedEmail = (emailToRemove: string) => {
    const next: AdminSettings = {
      ...settings,
      permissions: {
        ...settings.permissions,
        bannedEmails: settings.permissions.bannedEmails.filter(
          (e) => e !== emailToRemove
        ),
      },
    };
    commitSettings(next, `Restored booking access for "${emailToRemove}".`);
  };

  const handleAddAllowedDomain = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newDomain.trim().toLowerCase().replace(/^@/, "");
    if (!cleaned || !cleaned.includes(".")) {
      showToast("error", "Enter a valid domain such as illinois.edu");
      return;
    }
    if (settings.permissions.allowedDomains.includes(cleaned)) {
      showToast("error", `@${cleaned} is already an allowed domain.`);
      return;
    }
    const next: AdminSettings = {
      ...settings,
      permissions: {
        ...settings.permissions,
        allowedDomains: [...settings.permissions.allowedDomains, cleaned],
      },
    };
    if (commitSettings(next, `Added @${cleaned} to allowed login domains.`)) {
      setNewDomain("");
    }
  };

  const handleRemoveAllowedDomain = (domainToRemove: string) => {
    if (settings.permissions.allowedDomains.length <= 1) {
      showToast("error", "At least one allowed email domain must remain active.");
      return;
    }
    const next: AdminSettings = {
      ...settings,
      permissions: {
        ...settings.permissions,
        allowedDomains: settings.permissions.allowedDomains.filter(
          (d) => d !== domainToRemove
        ),
      },
    };
    commitSettings(next, `Removed @${domainToRemove} from allowed domains.`);
  };

  // --- Email Template Preview & Test ---
  const activeTemplateConfig =
    settings.emailTemplates[selectedTemplateType] ||
    DEFAULT_EMAIL_TEMPLATES[selectedTemplateType];

  const liveRenderedPreview = useMemo(() => {
    const replaceTokens = (raw: string): string =>
      raw.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
        const val = SAMPLE_PREVIEW_VARIABLES[key];
        return val !== undefined ? String(val) : `{{${key}}}`;
      });
    return {
      subject: replaceTokens(activeTemplateConfig.subject),
      body: replaceTokens(activeTemplateConfig.bodyTemplate),
    };
  }, [activeTemplateConfig]);

  const handleSendTestEmail = async () => {
    if (!user) return;
    setIsSendingTestEmail(true);
    try {
      const rendered = renderEmailTemplate(selectedTemplateType, {
        ...SAMPLE_PREVIEW_VARIABLES,
        userEmail: user.email,
        userName: user.full_name,
      });
      await dispatchEmail({
        to: user.email,
        subject: `[TEST] ${rendered.subject}`,
        text: rendered.text,
        type: selectedTemplateType,
        actionUrl: window.location.origin,
      });
      showToast(
        "success",
        `Test "${EMAIL_TEMPLATE_META[selectedTemplateType].label}" email sent to ${user.email}!`
      );
    } catch {
      showToast("error", "Failed to dispatch test email.");
    } finally {
      setIsSendingTestEmail(false);
    }
  };

  const handleResetSingleTemplate = () => {
    const defaultTpl = DEFAULT_EMAIL_TEMPLATES[selectedTemplateType];
    const next: AdminSettings = {
      ...settings,
      emailTemplates: {
        ...settings.emailTemplates,
        [selectedTemplateType]: { ...defaultTpl },
      },
    };
    commitSettings(
      next,
      `Reset "${EMAIL_TEMPLATE_META[selectedTemplateType].label}" template to default.`
    );
  };

  // --- Filtered Queue & CSV Export ---
  const filteredBookings = useMemo(() => {
    return bookings.filter((b) => {
      const matchesStatus =
        queueStatusFilter === "all" || b.status === queueStatusFilter;
      const q = queueSearch.trim().toLowerCase();
      const matchesSearch =
        !q ||
        b.file_name.toLowerCase().includes(q) ||
        b.user_email.toLowerCase().includes(q) ||
        (b.user_name || "").toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [bookings, queueSearch, queueStatusFilter]);

  const handleExportQueueCsv = () => {
    const headers = [
      "Booking ID",
      "File Name",
      "Student Email",
      "Start Time",
      "End Time",
      "Duration (min)",
      "Buffer (min)",
      "Status",
    ];
    const rows = filteredBookings.map((b) => [
      b.id,
      `"${b.file_name.replace(/"/g, '""')}"`,
      b.user_email,
      new Date(b.start_time).toISOString(),
      new Date(b.end_time).toISOString(),
      b.duration_minutes,
      b.buffer_minutes,
      b.status,
    ]);
    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `bambu_x1c_queue_${format(new Date(), "yyyy-MM-dd")}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("success", `Exported ${filteredBookings.length} bookings to CSV.`);
  };

  const handleDownloadSettingsJson = () => {
    const json = exportAdminSettingsJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `bambu_x1c_admin_settings_${format(
      new Date(),
      "yyyy-MM-dd"
    )}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("success", "Downloaded Admin Settings JSON backup.");
  };

  const handleImportSettingsJson = () => {
    if (!importJsonText.trim()) {
      showToast("error", "Paste a valid JSON configuration first.");
      return;
    }
    const res = importAdminSettingsJson(importJsonText, user?.email);
    if (res.error) {
      showToast("error", res.error);
      return;
    }
    if (res.data) {
      setSettings(res.data);
      setImportJsonText("");
      showToast("success", "Imported and applied Admin Settings JSON!");
    }
  };

  // --- Unauthorized View if not Admin ---
  if (!user || !isAdmin) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">
            Lab Administrator Access Required
          </h1>
          <p className="text-xs text-slate-600 leading-relaxed">
            This dashboard is restricted to authorized UIUC Lab Administrators.
            {user ? (
              <>
                {" "}
                You are currently viewing the site as{" "}
                <strong className="text-slate-900">{user.email}</strong> with role{" "}
                <code className="px-1.5 py-0.5 rounded bg-slate-100 font-bold">
                  {user.role}
                </code>
                .
              </>
            ) : (
              " Please sign in with your @illinois.edu administrator account."
            )}
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-2">
            <Link
              href="/"
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[#13294B] hover:bg-slate-800 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Return to Print Queue</span>
            </Link>
            {user && canToggleAdminRole && (
              <button
                onClick={toggleCurrentUserRole}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Shield className="w-4 h-4" />
                <span>Switch Back to Admin Role</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {/* Top Admin Header */}
      <header className="bg-[#13294B] text-white border-b border-slate-800 shadow-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <Link
              href="/"
              className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-1.5 border border-white/15 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Calendar</span>
            </Link>
            <div className="h-6 w-px bg-white/15 hidden sm:block" />
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#FF5F05] flex items-center justify-center shadow-inner">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base sm:text-lg font-bold tracking-tight">
                    Admin Control Center
                  </h1>
                  {userIsSuperAdmin ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-400/20 text-amber-300 border border-amber-400/40">
                      <Crown className="w-3 h-3" />
                      Super Admin
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-indigo-400/20 text-indigo-200 border border-indigo-400/40">
                      <ShieldCheck className="w-3 h-3" />
                      Lab Admin
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-300">
                  Signed in as <strong>{user.email}</strong> •{" "}
                  {userIsSuperAdmin
                    ? "Full Owner Privileges (Can Manage Admins)"
                    : `Standard Admin (Only ${SUPER_ADMIN_EMAIL} can add/remove admins)`}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => commitSettings(settings)}
              className="px-3.5 py-2 rounded-lg bg-[#FF5F05] hover:bg-orange-600 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save All Changes</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6 flex-1">
        {/* Live Toast Notification */}
        {statusToast && (
          <div
            className={`rounded-xl p-3.5 border shadow-md flex items-center justify-between gap-3 text-xs font-medium ${
              statusToast.type === "success"
                ? "bg-emerald-950 text-emerald-100 border-emerald-700"
                : "bg-red-950 text-red-100 border-red-700"
            }`}
          >
            <div className="flex items-center gap-2.5">
              {statusToast.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              )}
              <span>{statusToast.message}</span>
            </div>
            <button
              onClick={() => setStatusToast(null)}
              className="text-[11px] underline opacity-80 hover:opacity-100 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Top Summary KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <div className="bg-white rounded-xl border border-zinc-200 p-4 shadow-2xs">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>Queue Reservations</span>
              <ListFilter className="w-4 h-4 text-blue-600" />
            </div>
            <div className="text-2xl font-bold text-zinc-900 mt-1">
              {
                bookings.filter(
                  (b) => b.status === "scheduled" || b.status === "in_progress"
                ).length
              }{" "}
              <span className="text-xs font-normal text-zinc-500">
                active ({bookings.length} total)
              </span>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-zinc-200 p-4 shadow-2xs">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>Authorized Lab Admins</span>
              <Crown className="w-4 h-4 text-amber-500" />
            </div>
            <div className="text-2xl font-bold text-zinc-900 mt-1">
              {settings.permissions.adminEmails.length}{" "}
              <span className="text-xs font-normal text-zinc-500">
                Owner: {SUPER_ADMIN_EMAIL}
              </span>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-zinc-200 p-4 shadow-2xs">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>Booking Limits Policy</span>
              <Clock className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="text-2xl font-bold text-zinc-900 mt-1">
              {settings.bookingLimits.maxDurationMinutes}m{" "}
              <span className="text-xs font-normal text-zinc-500">
                max • +{settings.bookingLimits.cooldownBufferMinutes}m buffer
              </span>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-zinc-200 p-4 shadow-2xs">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>Printer Portal Status</span>
              <Wrench className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              {settings.permissions.maintenanceMode ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                  Maintenance Mode (Paused)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-900 border border-emerald-300">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  Operational &amp; Accepting Slots
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="bg-white rounded-xl border border-zinc-200 p-1.5 shadow-2xs flex flex-wrap gap-1.5">
          {[
            {
              id: "permissions" as AdminTabId,
              label: "Permissions & Admins",
              icon: Shield,
            },
            {
              id: "limits" as AdminTabId,
              label: "Booking Limits & Rules",
              icon: Sliders,
            },
            {
              id: "emails" as AdminTabId,
              label: "Email Templates",
              icon: Mail,
            },
            {
              id: "queue" as AdminTabId,
              label: "Queue Manager",
              icon: ListFilter,
            },
            {
              id: "profile" as AdminTabId,
              label: "Printer & Lab Profile",
              icon: Printer,
            },
            {
              id: "system" as AdminTabId,
              label: "Logs & Backup",
              icon: Database,
            },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer ${
                  isActive
                    ? "bg-[#13294B] text-white shadow-xs"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* ==================== TAB 1: PERMISSIONS & ADMINS ==================== */}
        {activeTab === "permissions" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Column: Admin Roster (Super Admin Guarded) */}
            <div className="bg-white rounded-xl border border-zinc-200 p-5 shadow-2xs space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
                    <Crown className="w-4 h-4 text-amber-500" />
                    <span>Lab Administrators Allowlist</span>
                  </h2>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Any email listed below can access this Admin Dashboard. Only{" "}
                    <strong className="text-zinc-800">{SUPER_ADMIN_EMAIL}</strong>{" "}
                    can add or remove administrators.
                  </p>
                </div>
              </div>

              {/* Super Admin Protection Banner for Secondary Admins */}
              {!userIsSuperAdmin ? (
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3.5 flex items-start gap-2.5 text-xs text-amber-900">
                  <Lock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold">
                      Super Admin Protected (Read-Only Roster)
                    </div>
                    <p className="text-amber-800 mt-0.5">
                      You are signed in as <strong>{user.email}</strong>. You
                      have full access to view and edit booking limits, email
                      templates, and the print queue, but only{" "}
                      <strong>{SUPER_ADMIN_EMAIL}</strong> can promote or revoke
                      administrators.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 flex items-center gap-2 text-xs text-emerald-900">
                  <Crown className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    <strong>Super Admin Verified ({SUPER_ADMIN_EMAIL}):</strong>{" "}
                    You have exclusive authority to add or revoke Lab
                    Administrators below.
                  </span>
                </div>
              )}

              {/* Add Admin Form */}
              <form onSubmit={handleAddAdminEmail} className="flex gap-2">
                <input
                  type="email"
                  value={newAdminEmail}
                  onChange={(e) => setNewAdminEmail(e.target.value)}
                  disabled={!userIsSuperAdmin}
                  placeholder={
                    userIsSuperAdmin
                      ? "netid@illinois.edu"
                      : `Locked — Only ${SUPER_ADMIN_EMAIL} can add admins`
                  }
                  className="flex-1 px-3 py-2 rounded-lg border border-zinc-300 text-xs focus:outline-none focus:ring-2 focus:ring-[#13294B] disabled:bg-zinc-100 disabled:text-zinc-400"
                />
                <button
                  type="submit"
                  disabled={!userIsSuperAdmin}
                  className="px-3.5 py-2 rounded-lg bg-[#13294B] hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Admin</span>
                </button>
              </form>

              {/* Current Admins List */}
              <div className="divide-y divide-zinc-100 border border-zinc-200 rounded-xl overflow-hidden">
                {settings.permissions.adminEmails.map((adminEmail) => {
                  const isOwner =
                    adminEmail.toLowerCase() === SUPER_ADMIN_EMAIL;
                  return (
                    <div
                      key={adminEmail}
                      className="px-3.5 py-2.5 flex items-center justify-between gap-2 bg-white hover:bg-zinc-50 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <Shield className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        <span className="font-semibold text-zinc-900">
                          {adminEmail}
                        </span>
                        {isOwner ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-100 text-amber-900 border border-amber-300">
                            Super Admin (Owner)
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                            Lab Admin
                          </span>
                        )}
                      </div>
                      {isOwner ? (
                        <span className="text-[11px] text-zinc-400 flex items-center gap-1">
                          <Lock className="w-3 h-3" /> Permanent
                        </span>
                      ) : (
                        <button
                          onClick={() => handleRemoveAdminEmail(adminEmail)}
                          disabled={!userIsSuperAdmin}
                          title={
                            userIsSuperAdmin
                              ? "Revoke admin permissions"
                              : `Only ${SUPER_ADMIN_EMAIL} can revoke admins`
                          }
                          className="text-red-600 hover:text-red-800 font-semibold flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Revoke</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Column: Maintenance Mode, Banned Users & Allowed Domains */}
            <div className="space-y-6">
              {/* Maintenance Mode Card */}
              <div className="bg-white rounded-xl border border-zinc-200 p-5 shadow-2xs space-y-3.5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
                      <Wrench className="w-4 h-4 text-amber-600" />
                      <span>Printer Maintenance Mode Lockout</span>
                    </h2>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      When enabled, students cannot create new bookings (admins
                      can still book and override).
                    </p>
                  </div>
                  <label className="inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.permissions.maintenanceMode}
                      onChange={(e) => {
                        const next: AdminSettings = {
                          ...settings,
                          permissions: {
                            ...settings.permissions,
                            maintenanceMode: e.target.checked,
                          },
                        };
                        commitSettings(
                          next,
                          e.target.checked
                            ? "Maintenance Mode ENABLED — New student bookings paused."
                            : "Maintenance Mode DISABLED — Student bookings resumed."
                        );
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-zinc-200 rounded-full peer peer-checked:bg-amber-600 relative after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5" />
                  </label>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Maintenance Banner Announcement Message
                  </label>
                  <textarea
                    rows={2}
                    value={settings.permissions.maintenanceMessage}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        permissions: {
                          ...settings.permissions,
                          maintenanceMessage: e.target.value,
                        },
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-xs focus:outline-none focus:ring-2 focus:ring-[#13294B]"
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      onClick={() =>
                        commitSettings(
                          settings,
                          "Updated maintenance banner message."
                        )
                      }
                      className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold cursor-pointer"
                    >
                      Save Banner Message
                    </button>
                  </div>
                </div>
              </div>

              {/* Restricted / Suspended Student Emails */}
              <div className="bg-white rounded-xl border border-zinc-200 p-5 shadow-2xs space-y-3.5">
                <div>
                  <h2 className="text-sm font-bold text-zinc-900">
                    Restricted / Suspended Users
                  </h2>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Block specific emails from creating new reservations (e.g.,
                    repeated no-shows or safety violations).
                  </p>
                </div>

                <form onSubmit={handleAddBannedEmail} className="flex gap-2">
                  <input
                    type="email"
                    value={newBannedEmail}
                    onChange={(e) => setNewBannedEmail(e.target.value)}
                    placeholder="student@illinois.edu"
                    className="flex-1 px-3 py-2 rounded-lg border border-zinc-300 text-xs"
                  />
                  <button
                    type="submit"
                    className="px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer"
                  >
                    Restrict User
                  </button>
                </form>

                {settings.permissions.bannedEmails.length === 0 ? (
                  <p className="text-xs text-zinc-400 italic">
                    No students are currently restricted.
                  </p>
                ) : (
                  <div className="divide-y divide-zinc-100 border border-zinc-200 rounded-xl overflow-hidden">
                    {settings.permissions.bannedEmails.map((email) => (
                      <div
                        key={email}
                        className="px-3.5 py-2 flex items-center justify-between text-xs"
                      >
                        <span className="font-medium text-red-800">{email}</span>
                        <button
                          onClick={() => handleRemoveBannedEmail(email)}
                          className="text-xs font-semibold text-emerald-700 hover:underline cursor-pointer"
                        >
                          Unblock
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Allowed Email Domains */}
              <div className="bg-white rounded-xl border border-zinc-200 p-5 shadow-2xs space-y-3.5">
                <div>
                  <h2 className="text-sm font-bold text-zinc-900">
                    Allowed Login Email Domains
                  </h2>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Only accounts matching these domains can sign in and book
                    slots.
                  </p>
                </div>

                <form onSubmit={handleAddAllowedDomain} className="flex gap-2">
                  <input
                    type="text"
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    placeholder="illinois.edu"
                    className="flex-1 px-3 py-2 rounded-lg border border-zinc-300 text-xs"
                  />
                  <button
                    type="submit"
                    className="px-3.5 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold cursor-pointer"
                  >
                    Add Domain
                  </button>
                </form>

                <div className="flex flex-wrap gap-2">
                  {settings.permissions.allowedDomains.map((domain) => (
                    <span
                      key={domain}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 text-blue-800 border border-blue-200 text-xs font-semibold"
                    >
                      @{domain}
                      {settings.permissions.allowedDomains.length > 1 && (
                        <button
                          onClick={() => handleRemoveAllowedDomain(domain)}
                          className="text-blue-500 hover:text-red-600 cursor-pointer"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 2: BOOKING LIMITS & RULES ==================== */}
        {activeTab === "limits" && (
          <div className="bg-white rounded-xl border border-zinc-200 p-6 shadow-2xs space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-200 pb-4">
              <div>
                <h2 className="text-base font-bold text-zinc-900">
                  Booking Limits &amp; Scheduling Engine Rules
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Configure duration caps, concurrent reservation limits,
                  cooldown buffers, and operating hours.
                </p>
              </div>
              <button
                onClick={() =>
                  commitSettings(
                    settings,
                    "Updated booking limits and scheduling policies."
                  )
                }
                className="px-4 py-2 rounded-lg bg-[#FF5F05] hover:bg-orange-600 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save Booking Limits</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Max Print Duration */}
              <div className="p-4 rounded-xl border border-zinc-200 bg-zinc-50/50 space-y-3">
                <label className="block text-xs font-bold text-zinc-900">
                  Maximum Print Duration (Minutes)
                </label>
                <p className="text-[11px] text-zinc-500">
                  Longest single print slot a student can reserve (snaps to
                  15-minute increments).
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={15}
                    max={2880}
                    step={15}
                    value={settings.bookingLimits.maxDurationMinutes}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        bookingLimits: {
                          ...settings.bookingLimits,
                          maxDurationMinutes: Math.max(
                            15,
                            Number(e.target.value) || 60
                          ),
                        },
                      })
                    }
                    className="w-32 px-3 py-2 rounded-lg border border-zinc-300 bg-white text-sm font-bold text-zinc-900"
                  />
                  <span className="text-xs font-semibold text-zinc-600">
                    ={(settings.bookingLimits.maxDurationMinutes / 60).toFixed(
                      1
                    )}{" "}
                    hours
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {[120, 240, 360, 480, 720, 1440].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() =>
                        setSettings({
                          ...settings,
                          bookingLimits: {
                            ...settings.bookingLimits,
                            maxDurationMinutes: preset,
                          },
                        })
                      }
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold border cursor-pointer ${
                        settings.bookingLimits.maxDurationMinutes === preset
                          ? "bg-[#13294B] text-white border-[#13294B]"
                          : "bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-100"
                      }`}
                    >
                      {preset / 60}h ({preset}m)
                    </button>
                  ))}
                </div>
              </div>

              {/* Max Active Bookings Per User */}
              <div className="p-4 rounded-xl border border-zinc-200 bg-zinc-50/50 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-zinc-900">
                    Max Active Bookings Per Student
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={
                        settings.bookingLimits.maxActiveBookingsPerUser === null
                      }
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          bookingLimits: {
                            ...settings.bookingLimits,
                            maxActiveBookingsPerUser: e.target.checked
                              ? null
                              : 2,
                          },
                        })
                      }
                      className="rounded text-indigo-600"
                    />
                    <span>Unlimited Slots</span>
                  </label>
                </div>
                <p className="text-[11px] text-zinc-500">
                  Control how many upcoming/in-progress slots a single student
                  can hold simultaneously.
                </p>
                {settings.bookingLimits.maxActiveBookingsPerUser === null ? (
                  <div className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
                    Currently set to <strong>Unlimited</strong> active bookings
                    per user.
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={settings.bookingLimits.maxActiveBookingsPerUser}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          bookingLimits: {
                            ...settings.bookingLimits,
                            maxActiveBookingsPerUser: Math.max(
                              1,
                              Number(e.target.value) || 1
                            ),
                          },
                        })
                      }
                      className="w-28 px-3 py-2 rounded-lg border border-zinc-300 bg-white text-sm font-bold text-zinc-900"
                    />
                    <span className="text-xs text-zinc-600">
                      concurrent active reservations max
                    </span>
                  </div>
                )}
              </div>

              {/* Cooldown Buffer Minutes */}
              <div className="p-4 rounded-xl border border-zinc-200 bg-zinc-50/50 space-y-3">
                <label className="block text-xs font-bold text-zinc-900">
                  Mandatory Post-Print Cooldown Buffer (Minutes)
                </label>
                <p className="text-[11px] text-zinc-500">
                  Automatically appended to every reservation for build plate
                  cooling and part removal.
                </p>
                <div className="flex items-center gap-2">
                  {[0, 5, 10, 15, 20, 30].map((buf) => (
                    <button
                      key={buf}
                      type="button"
                      onClick={() =>
                        setSettings({
                          ...settings,
                          bookingLimits: {
                            ...settings.bookingLimits,
                            cooldownBufferMinutes: buf,
                          },
                        })
                      }
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer ${
                        settings.bookingLimits.cooldownBufferMinutes === buf
                          ? "bg-[#13294B] text-white border-[#13294B]"
                          : "bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-100"
                      }`}
                    >
                      +{buf}m
                    </button>
                  ))}
                </div>
              </div>

              {/* Advance Booking Horizon & Late Arrival Grace */}
              <div className="p-4 rounded-xl border border-zinc-200 bg-zinc-50/50 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-900">
                    Advance Booking Horizon (Days)
                  </label>
                  <p className="text-[11px] text-zinc-500 mt-0.5 mb-2">
                    How far ahead students can book slots.
                  </p>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={settings.bookingLimits.maxAdvanceBookingDays}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        bookingLimits: {
                          ...settings.bookingLimits,
                          maxAdvanceBookingDays: Math.max(
                            1,
                            Number(e.target.value) || 14
                          ),
                        },
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 bg-white text-sm font-bold text-zinc-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-900">
                    Late-Arrival Grace Period (Mins)
                  </label>
                  <p className="text-[11px] text-zinc-500 mt-0.5 mb-2">
                    Minutes before late warning triggers.
                  </p>
                  <input
                    type="number"
                    min={5}
                    max={60}
                    step={5}
                    value={settings.bookingLimits.lateArrivalGraceMinutes}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        bookingLimits: {
                          ...settings.bookingLimits,
                          lateArrivalGraceMinutes: Math.max(
                            5,
                            Number(e.target.value) || 15
                          ),
                        },
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 bg-white text-sm font-bold text-zinc-900"
                  />
                </div>
              </div>

              {/* Lab Operating Hours */}
              <div className="md:col-span-2 p-4 rounded-xl border border-zinc-200 bg-zinc-50/50 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-xs font-bold text-zinc-900">
                      Restrict Bookings to Lab Operating Hours
                    </label>
                    <p className="text-[11px] text-zinc-500">
                      Leave unchecked for 24/7 booking availability, or enable
                      to restrict start times to daytime lab hours.
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs font-bold text-zinc-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.bookingLimits.operatingHours.enabled}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          bookingLimits: {
                            ...settings.bookingLimits,
                            operatingHours: {
                              ...settings.bookingLimits.operatingHours,
                              enabled: e.target.checked,
                            },
                          },
                        })
                      }
                      className="rounded text-[#13294B]"
                    />
                    <span>Enable Operating Hours Window</span>
                  </label>
                </div>

                {settings.bookingLimits.operatingHours.enabled && (
                  <div className="flex flex-wrap items-center gap-4 pt-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-semibold text-zinc-700">
                        Opens at Hour (0-23):
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={settings.bookingLimits.operatingHours.startHour}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            bookingLimits: {
                              ...settings.bookingLimits,
                              operatingHours: {
                                ...settings.bookingLimits.operatingHours,
                                startHour: Math.min(
                                  23,
                                  Math.max(0, Number(e.target.value) || 0)
                                ),
                              },
                            },
                          })
                        }
                        className="w-20 px-2.5 py-1.5 rounded-lg border border-zinc-300 bg-white font-bold"
                      />
                      <span>:00</span>
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-semibold text-zinc-700">
                        Closes at Hour (1-24):
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={24}
                        value={settings.bookingLimits.operatingHours.endHour}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            bookingLimits: {
                              ...settings.bookingLimits,
                              operatingHours: {
                                ...settings.bookingLimits.operatingHours,
                                endHour: Math.min(
                                  24,
                                  Math.max(1, Number(e.target.value) || 22)
                                ),
                              },
                            },
                          })
                        }
                        className="w-20 px-2.5 py-1.5 rounded-lg border border-zinc-300 bg-white font-bold"
                      />
                      <span>:00</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 3: EMAIL TEMPLATES EDITOR ==================== */}
        {activeTab === "emails" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Template Selector Sidebar */}
            <div className="lg:col-span-4 bg-white rounded-xl border border-zinc-200 p-3.5 shadow-2xs space-y-1.5">
              <div className="px-2 py-1.5 text-xs font-bold uppercase tracking-wider text-zinc-500">
                Notification Templates (9)
              </div>
              {(
                Object.keys(EMAIL_TEMPLATE_META) as EmailNotificationType[]
              ).map((type) => {
                const meta = EMAIL_TEMPLATE_META[type];
                const cfg =
                  settings.emailTemplates[type] ||
                  DEFAULT_EMAIL_TEMPLATES[type];
                const isSelected = selectedTemplateType === type;
                return (
                  <button
                    key={type}
                    onClick={() => setSelectedTemplateType(type)}
                    className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? "bg-[#13294B] text-white border-[#13294B] shadow-xs"
                        : "bg-white hover:bg-zinc-50 text-zinc-800 border-zinc-200"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold">{meta.label}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          cfg.enabled
                            ? isSelected
                              ? "bg-emerald-400/20 text-emerald-200"
                              : "bg-emerald-100 text-emerald-800"
                            : isSelected
                            ? "bg-red-400/20 text-red-200"
                            : "bg-zinc-200 text-zinc-600"
                        }`}
                      >
                        {cfg.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                    <p
                      className={`text-[11px] mt-1 line-clamp-2 ${
                        isSelected ? "text-slate-300" : "text-zinc-500"
                      }`}
                    >
                      {meta.description}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Template Editor & Live Preview */}
            <div className="lg:col-span-8 space-y-5">
              <div className="bg-white rounded-xl border border-zinc-200 p-5 shadow-2xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3.5">
                  <div>
                    <h2 className="text-base font-bold text-zinc-900">
                      {EMAIL_TEMPLATE_META[selectedTemplateType].label}
                    </h2>
                    <p className="text-xs text-zinc-500">
                      {EMAIL_TEMPLATE_META[selectedTemplateType].description}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="inline-flex items-center gap-2 text-xs font-bold text-zinc-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activeTemplateConfig.enabled}
                        onChange={(e) => {
                          const next: AdminSettings = {
                            ...settings,
                            emailTemplates: {
                              ...settings.emailTemplates,
                              [selectedTemplateType]: {
                                ...activeTemplateConfig,
                                enabled: e.target.checked,
                              },
                            },
                          };
                          commitSettings(
                            next,
                            `${EMAIL_TEMPLATE_META[selectedTemplateType].label} emails ${
                              e.target.checked ? "enabled" : "disabled"
                            }.`
                          );
                        }}
                        className="rounded text-emerald-600"
                      />
                      <span>Send this email automatically</span>
                    </label>
                  </div>
                </div>

                {/* Subject Line */}
                <div>
                  <label className="block text-xs font-bold text-zinc-800 mb-1">
                    Email Subject Line
                  </label>
                  <input
                    type="text"
                    value={activeTemplateConfig.subject}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        emailTemplates: {
                          ...settings.emailTemplates,
                          [selectedTemplateType]: {
                            ...activeTemplateConfig,
                            subject: e.target.value,
                          },
                        },
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#13294B]"
                  />
                </div>

                {/* Body Template */}
                <div>
                  <label className="block text-xs font-bold text-zinc-800 mb-1">
                    Email Body Template
                  </label>
                  <textarea
                    rows={8}
                    value={activeTemplateConfig.bodyTemplate}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        emailTemplates: {
                          ...settings.emailTemplates,
                          [selectedTemplateType]: {
                            ...activeTemplateConfig,
                            bodyTemplate: e.target.value,
                          },
                        },
                      })
                    }
                    className="w-full px-3 py-2.5 rounded-lg border border-zinc-300 text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#13294B]"
                  />
                </div>

                {/* Dynamic Token Chips */}
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold text-zinc-600">
                    Click any dynamic placeholder token to insert into the email
                    body:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {AVAILABLE_TEMPLATE_TOKENS.map((item) => (
                      <button
                        key={item.token}
                        type="button"
                        title={item.description}
                        onClick={() =>
                          setSettings({
                            ...settings,
                            emailTemplates: {
                              ...settings.emailTemplates,
                              [selectedTemplateType]: {
                                ...activeTemplateConfig,
                                bodyTemplate: `${activeTemplateConfig.bodyTemplate} ${item.token}`,
                              },
                            },
                          })
                        }
                        className="px-2 py-1 rounded-md bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 text-[11px] font-mono font-semibold cursor-pointer"
                      >
                        {item.token}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-100">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleResetSingleTemplate}
                      className="px-3 py-2 rounded-lg border border-zinc-300 hover:bg-zinc-100 text-zinc-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reset to Default</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleSendTestEmail}
                      disabled={isSendingTestEmail}
                      className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>
                        {isSendingTestEmail
                          ? "Sending..."
                          : `Send Test Email to ${user.email}`}
                      </span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      commitSettings(
                        settings,
                        `Saved "${EMAIL_TEMPLATE_META[selectedTemplateType].label}" email template.`
                      )
                    }
                    className="px-4 py-2 rounded-lg bg-[#FF5F05] hover:bg-orange-600 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save Template</span>
                  </button>
                </div>
              </div>

              {/* Live Rendered Preview Card */}
              <div className="bg-slate-900 text-slate-100 rounded-xl border border-slate-800 p-5 shadow-md space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-orange-400 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    Live Rendered Preview (Sample Reservation Data)
                  </span>
                  <span className="text-[11px] text-slate-400">
                    To: {user.email}
                  </span>
                </div>
                <div className="p-3.5 rounded-lg bg-slate-800/90 border border-slate-700 space-y-2">
                  <div className="text-xs font-bold text-white border-b border-slate-700 pb-2">
                    Subject: {liveRenderedPreview.subject}
                  </div>
                  <pre className="text-xs text-slate-200 whitespace-pre-wrap font-sans leading-relaxed">
                    {liveRenderedPreview.body}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 4: QUEUE & RESERVATIONS MANAGER ==================== */}
        {activeTab === "queue" && (
          <div className="bg-white rounded-xl border border-zinc-200 shadow-2xs overflow-hidden">
            <div className="p-4 bg-zinc-50 border-b border-zinc-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5 flex-1">
                <div className="relative flex-1 min-w-[220px] max-w-sm">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={queueSearch}
                    onChange={(e) => setQueueSearch(e.target.value)}
                    placeholder="Search by file name or @illinois.edu email..."
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-zinc-300 bg-white text-xs"
                  />
                </div>

                <select
                  value={queueStatusFilter}
                  onChange={(e) => setQueueStatusFilter(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-zinc-300 bg-white text-xs font-semibold text-zinc-700"
                >
                  <option value="all">All Statuses ({bookings.length})</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="canceled_late">Canceled (Late)</option>
                  <option value="canceled_user">Canceled (By User)</option>
                  <option value="canceled_admin">Canceled (By Admin)</option>
                </select>
              </div>

              <button
                onClick={handleExportQueueCsv}
                className="px-3.5 py-2 rounded-lg bg-[#13294B] hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Export CSV ({filteredBookings.length})</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 text-zinc-500 bg-zinc-50/70">
                    <th className="py-3 px-4 font-semibold">File Name</th>
                    <th className="py-3 px-4 font-semibold">Student</th>
                    <th className="py-3 px-4 font-semibold">Start Time</th>
                    <th className="py-3 px-4 font-semibold">End Time</th>
                    <th className="py-3 px-4 font-semibold">Duration</th>
                    <th className="py-3 px-4 font-semibold">Status</th>
                    <th className="py-3 px-4 font-semibold text-right">
                      Quick Admin Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {filteredBookings.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="py-8 text-center text-zinc-400 italic"
                      >
                        No reservations match your filter criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredBookings.map((b) => (
                      <tr key={b.id} className="hover:bg-zinc-50/80">
                        <td className="py-3 px-4 font-bold text-zinc-900">
                          {b.file_name}
                        </td>
                        <td className="py-3 px-4 text-zinc-600">
                          {b.user_email}
                        </td>
                        <td className="py-3 px-4 text-zinc-700">
                          {format(new Date(b.start_time), "EEE MMM d, HH:mm")}
                        </td>
                        <td className="py-3 px-4 text-zinc-700">
                          {format(new Date(b.end_time), "EEE MMM d, HH:mm")}
                        </td>
                        <td className="py-3 px-4 text-zinc-600">
                          {b.duration_minutes}m + {b.buffer_minutes}m
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              b.status === "in_progress"
                                ? "bg-amber-100 text-amber-800"
                                : b.status === "scheduled"
                                ? "bg-blue-100 text-blue-800"
                                : b.status === "completed"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-red-100 text-red-800"
                            }`}
                          >
                            {b.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            {b.status === "scheduled" && (
                              <>
                                <button
                                  onClick={async () => {
                                    await startPrintJob(b.id, user);
                                    showToast(
                                      "success",
                                      `Started print "${b.file_name}".`
                                    );
                                  }}
                                  title="Force Start Print"
                                  className="px-2 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-semibold flex items-center gap-1 cursor-pointer"
                                >
                                  <Play className="w-3 h-3" />
                                  <span>Start</span>
                                </button>
                                <button
                                  onClick={async () => {
                                    await triggerBookingReminderEmail(
                                      b.id,
                                      "pre_booking_reminder"
                                    );
                                    showToast(
                                      "success",
                                      `Sent reminder email to ${b.user_email}.`
                                    );
                                  }}
                                  title="Send Email Reminder Now"
                                  className="px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-semibold flex items-center gap-1 cursor-pointer"
                                >
                                  <Bell className="w-3 h-3" />
                                  <span>Remind</span>
                                </button>
                              </>
                            )}
                            {b.status === "in_progress" && (
                              <button
                                onClick={async () => {
                                  await completeAndClearBed(b.id, user);
                                  showToast(
                                    "success",
                                    `Marked "${b.file_name}" complete & cleared bed.`
                                  );
                                }}
                                className="px-2 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-semibold flex items-center gap-1 cursor-pointer"
                              >
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Complete</span>
                              </button>
                            )}
                            <button
                              onClick={() => setAdminSelectedBooking(b)}
                              className="px-2.5 py-1 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-semibold cursor-pointer"
                            >
                              Edit / Shift
                            </button>
                            {(b.status === "scheduled" ||
                              b.status === "in_progress") && (
                              <button
                                onClick={async () => {
                                  await adminOverrideBooking({
                                    bookingId: b.id,
                                    adminUser: user,
                                    newStartTime: new Date(b.start_time),
                                    newDurationMinutes: b.duration_minutes,
                                    newStatus: "canceled_admin",
                                    sendNotification: true,
                                    reason: "Canceled by Lab Admin via Queue Manager.",
                                  });
                                  showToast(
                                    "success",
                                    `Canceled "${b.file_name}" and notified ${b.user_email}.`
                                  );
                                }}
                                title="Cancel Reservation"
                                className="px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-semibold flex items-center gap-1 cursor-pointer"
                              >
                                <XCircle className="w-3 h-3" />
                                <span>Cancel</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ==================== TAB 5: PRINTER & LAB PROFILE ==================== */}
        {activeTab === "profile" && (
          <div className="bg-white rounded-xl border border-zinc-200 p-6 shadow-2xs space-y-5">
            <div className="flex items-center justify-between border-b border-zinc-200 pb-4">
              <div>
                <h2 className="text-base font-bold text-zinc-900">
                  Printer Hardware &amp; Lab Profile Settings
                </h2>
                <p className="text-xs text-zinc-500">
                  Customize the printer title, hardware specs, and supported
                  filament materials shown on the booking portal.
                </p>
              </div>
              <button
                onClick={() =>
                  commitSettings(settings, "Updated printer & lab profile.")
                }
                className="px-4 py-2 rounded-lg bg-[#FF5F05] hover:bg-orange-600 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save Lab Profile</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-zinc-800 mb-1">
                  Printer Display Name
                </label>
                <input
                  type="text"
                  value={settings.labProfile.printerName}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      labProfile: {
                        ...settings.labProfile,
                        printerName: e.target.value,
                      },
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-800 mb-1">
                  Lab Room / Building Location
                </label>
                <input
                  type="text"
                  value={settings.labProfile.location}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      labProfile: {
                        ...settings.labProfile,
                        location: e.target.value,
                      },
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-xs"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-zinc-800 mb-1">
                  Installed Nozzle &amp; Build Plate Configuration
                </label>
                <input
                  type="text"
                  value={settings.labProfile.nozzleInfo}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      labProfile: {
                        ...settings.labProfile,
                        nozzleInfo: e.target.value,
                      },
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-xs"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-zinc-800 mb-1">
                  Lab Guidelines &amp; Bed Clearing Instructions
                </label>
                <textarea
                  rows={3}
                  value={settings.labProfile.notes}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      labProfile: {
                        ...settings.labProfile,
                        notes: e.target.value,
                      },
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-xs"
                />
              </div>

              <div className="md:col-span-2 space-y-2">
                <label className="block text-xs font-bold text-zinc-800">
                  Approved Filaments
                </label>
                <div className="flex flex-wrap gap-2">
                  {settings.labProfile.supportedFilaments.map((fil) => (
                    <span
                      key={fil}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-100 text-zinc-800 border border-zinc-300 text-xs font-semibold"
                    >
                      {fil}
                      <button
                        type="button"
                        onClick={() =>
                          setSettings({
                            ...settings,
                            labProfile: {
                              ...settings.labProfile,
                              supportedFilaments:
                                settings.labProfile.supportedFilaments.filter(
                                  (f) => f !== fil
                                ),
                            },
                          })
                        }
                        className="text-zinc-400 hover:text-red-600 cursor-pointer"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2 max-w-sm pt-1">
                  <input
                    type="text"
                    value={newFilamentInput}
                    onChange={(e) => setNewFilamentInput(e.target.value)}
                    placeholder="Add filament (e.g., PC / Polycarbonate)"
                    className="flex-1 px-3 py-1.5 rounded-lg border border-zinc-300 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const val = newFilamentInput.trim();
                      if (!val) return;
                      setSettings({
                        ...settings,
                        labProfile: {
                          ...settings.labProfile,
                          supportedFilaments: [
                            ...settings.labProfile.supportedFilaments,
                            val,
                          ],
                        },
                      });
                      setNewFilamentInput("");
                    }}
                    className="px-3 py-1.5 rounded-lg bg-zinc-900 text-white text-xs font-bold cursor-pointer"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 6: SYSTEM LOGS & BACKUP ==================== */}
        {activeTab === "system" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Dispatched Email Outbox Log */}
            <div className="bg-white rounded-xl border border-zinc-200 p-5 shadow-2xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-zinc-900">
                    Dispatched Email Outbox Audit Log ({outboxEmails.length})
                  </h2>
                  <p className="text-xs text-zinc-500">
                    Recent automated &amp; test notifications sent from this
                    portal.
                  </p>
                </div>
                {outboxEmails.length > 0 && (
                  <button
                    onClick={() => {
                      clearDispatchedEmails();
                      showToast("success", "Cleared email outbox log.");
                    }}
                    className="text-xs text-red-600 hover:underline font-semibold cursor-pointer"
                  >
                    Clear Log
                  </button>
                )}
              </div>

              {outboxEmails.length === 0 ? (
                <p className="text-xs text-zinc-400 italic py-6 text-center">
                  No emails dispatched in this session yet.
                </p>
              ) : (
                <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                  {outboxEmails.map((mail, idx) => (
                    <div
                      key={`${mail.sentAt}-${idx}`}
                      className="p-3 rounded-xl border border-zinc-200 bg-zinc-50 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-zinc-900">
                          {mail.subject}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-mono">
                          {mail.deliveryStatus || "sent"}
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        To: <strong>{mail.to}</strong> •{" "}
                        {format(new Date(mail.sentAt), "MMM d, HH:mm:ss")}
                      </div>
                      <pre className="text-[11px] text-zinc-600 whitespace-pre-wrap font-sans pt-1">
                        {mail.text}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Settings JSON Export / Import & Factory Reset */}
            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-zinc-200 p-5 shadow-2xs space-y-4">
                <h2 className="text-sm font-bold text-zinc-900">
                  Export &amp; Import Configuration JSON
                </h2>
                <p className="text-xs text-zinc-500">
                  Download a complete snapshot of permissions, booking limits,
                  and email templates, or restore from JSON.
                </p>
                <div className="flex flex-wrap gap-2.5">
                  <button
                    onClick={handleDownloadSettingsJson}
                    className="px-3.5 py-2 rounded-lg bg-[#13294B] hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export Settings JSON</span>
                  </button>
                </div>

                <div className="pt-2 space-y-2">
                  <label className="block text-xs font-bold text-zinc-700">
                    Restore / Import Settings JSON
                  </label>
                  <textarea
                    rows={4}
                    value={importJsonText}
                    onChange={(e) => setImportJsonText(e.target.value)}
                    placeholder='Paste exported JSON configuration here...'
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-xs font-mono"
                  />
                  <button
                    onClick={handleImportSettingsJson}
                    className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Apply Imported JSON</span>
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-red-200 p-5 shadow-2xs space-y-3">
                <h2 className="text-sm font-bold text-red-900">
                  Reset &amp; Recovery Actions
                </h2>
                <p className="text-xs text-zinc-600">
                  Reset demo queue bookings or restore all admin settings
                  (limits, email templates, lab profile) back to factory
                  defaults.
                </p>
                <div className="flex flex-wrap gap-2.5 pt-1">
                  <button
                    onClick={() => {
                      resetDemoData();
                      showToast("success", "Reset demo queue bookings.");
                    }}
                    className="px-3.5 py-2 rounded-lg border border-zinc-300 hover:bg-zinc-100 text-zinc-800 text-xs font-bold cursor-pointer"
                  >
                    Reset Demo Queue Bookings
                  </button>
                  <button
                    onClick={() => {
                      const restored = resetAdminSettingsToDefaults(
                        user?.email
                      );
                      setSettings(restored);
                      showToast(
                        "success",
                        "Restored all admin settings to factory defaults."
                      );
                    }}
                    className="px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Factory Reset Settings</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Admin Override Modal for Queue Manager */}
      <AdminBookingModal
        booking={adminSelectedBooking}
        user={user}
        onClose={() => setAdminSelectedBooking(null)}
        onAdminOverride={async (params) => {
          const res = await adminOverrideBooking({
            bookingId: params.bookingId,
            adminUser: user,
            newStartTime: params.newStartTime,
            newDurationMinutes: params.newDurationMinutes,
            newStatus: params.newStatus as BookingStatus,
            sendNotification: params.sendNotification,
            reason: params.reason,
          });
          if (!res.error) {
            showToast("success", "Updated reservation successfully.");
          }
          return { error: res.error };
        }}
        onUserCancel={async (bookingId) => {
          await cancelUserBooking(bookingId, user);
          showToast("success", "Canceled reservation.");
        }}
      />
    </div>
  );
}
