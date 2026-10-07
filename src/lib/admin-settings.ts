import {
  AdminSettings,
  EmailNotificationType,
  EmailTemplateConfig,
} from "./types";
import { isSupabaseConfigured, supabase } from "./supabase";

export const SUPER_ADMIN_EMAIL = "anmolp5@illinois.edu";
const ADMIN_SETTINGS_STORAGE_KEY = "bambu_x1c_admin_settings_v1";

export const EMAIL_TEMPLATE_META: Record<
  EmailNotificationType,
  { label: string; description: string }
> = {
  confirmation: {
    label: "Reservation Confirmed",
    description: "Sent immediately when a student books a new print slot.",
  },
  pre_booking_reminder: {
    label: "Pre-Booking Reminder",
    description: "Sent X minutes before the scheduled print slot starts.",
  },
  slot_starting: {
    label: "Slot Starting Now",
    description: "Sent at the exact start time of a scheduled print slot.",
  },
  print_started: {
    label: "Print Started (In Progress)",
    description: "Sent when the user clicks 'Start Print' on the portal.",
  },
  print_completed: {
    label: "Print Completed & Bed Cleared",
    description:
      "Sent when the user marks their print complete and clears the build plate.",
  },
  early_offer: {
    label: "Early Slot Available (Magic Link)",
    description:
      "Sent to the next scheduled user when the preceding print finishes early.",
  },
  late_warning: {
    label: "Late-Arrival Warning (15m)",
    description:
      "Sent if a print hasn't been started 15 minutes into the slot and no one is behind them.",
  },
  late_cancel: {
    label: "Late-Arrival Auto-Cancellation",
    description:
      "Sent when an unstarted reservation is automatically canceled due to late arrival.",
  },
  admin_override: {
    label: "Lab Admin Schedule Adjustment",
    description:
      "Sent when a Lab Admin manually shifts, edits, or cancels a student's booking.",
  },
};

export const AVAILABLE_TEMPLATE_TOKENS = [
  { token: "{{fileName}}", description: "3D print file name (.3mf / .gcode)" },
  { token: "{{userEmail}}", description: "Student @illinois.edu email" },
  { token: "{{userName}}", description: "Student full name" },
  { token: "{{startTime}}", description: "Formatted start date & time" },
  { token: "{{endTime}}", description: "Formatted end time (incl. buffer)" },
  { token: "{{printFinishTime}}", description: "Estimated print completion time" },
  { token: "{{duration}}", description: "Print duration in minutes" },
  { token: "{{buffer}}", description: "Cooldown buffer in minutes" },
  { token: "{{minsBefore}}", description: "Reminder lead time in minutes" },
  { token: "{{status}}", description: "Updated booking status" },
  { token: "{{reason}}", description: "Cancellation or admin adjustment reason" },
  { token: "{{adminEmail}}", description: "Admin who performed the override" },
  { token: "{{previousFileName}}", description: "Preceding print that finished early" },
  { token: "{{newStartTime}}", description: "New earlier start time offered" },
];

export const DEFAULT_EMAIL_TEMPLATES: Record<
  EmailNotificationType,
  EmailTemplateConfig
> = {
  confirmation: {
    enabled: true,
    subject: 'Reservation Confirmed: "{{fileName}}" on Bambu Lab X1C',
    bodyTemplate: `Your Bambu Lab X1C 3D print reservation is confirmed!

• File Name: {{fileName}}
• Reserved By: {{userEmail}}
• Start Time: {{startTime}}
• Active Print Window: {{startTime}} – {{printFinishTime}} ({{duration}} mins)
• Cooldown & Bed Clear Buffer: {{printFinishTime}} – {{endTime}} (+{{buffer}} mins)
• Pre-Slot Email Reminder: {{minsBefore}}

IMPORTANT: Please click "Start Print" on the portal when your slot begins to prevent late-arrival auto-cancellation.`,
  },
  pre_booking_reminder: {
    enabled: true,
    subject:
      'Reminder: "{{fileName}}" Print Slot Starts in {{minsBefore}} Minutes',
    bodyTemplate: `Heads up! Your Bambu Lab X1C reservation is coming up in {{minsBefore}} minutes.

• File Name: {{fileName}}
• Scheduled Start: {{startTime}}
• Duration: {{duration}} mins (+{{buffer}}m cooldown buffer)

Remember to head to the lab and click "Start Print" on the portal when your slot begins.`,
  },
  slot_starting: {
    enabled: true,
    subject:
      'Slot Starting Now: Start Your Print "{{fileName}}" on Bambu X1C',
    bodyTemplate: `Your reserved Bambu Lab X1C time slot for "{{fileName}}" is starting right now ({{startTime}})!

Please load your filament, start the job on the printer, and click "Start Print" on the booking portal so your reservation is not auto-canceled for late arrival.`,
  },
  print_started: {
    enabled: true,
    subject:
      'Print Started: "{{fileName}}" is Now Printing on Bambu X1C',
    bodyTemplate: `Your print job "{{fileName}}" has been marked IN PROGRESS!

• Started At: {{startTime}}
• Estimated Print Completion: {{printFinishTime}} ({{duration}}m duration)
• Total Slot Ends (incl. +{{buffer}}m cooldown buffer): {{endTime}}

When your print finishes and you clear the build plate, click "Mark Complete & Clear Bed" on the portal to release any remaining time for the next student in queue.`,
  },
  print_completed: {
    enabled: true,
    subject: 'Print Completed & Bed Cleared: "{{fileName}}"',
    bodyTemplate: `Thank you for marking your Bambu Lab X1C print complete and clearing the build plate!

• File Name: {{fileName}}
• Completed At: {{startTime}}
• {{buffer}}-Minute Cooldown Buffer Ends: {{endTime}}
• Status: COMPLETED`,
  },
  early_offer: {
    enabled: true,
    subject: "Bambu X1C is available early! Shift your print up?",
    bodyTemplate: `Good news! The previous print ("{{previousFileName}}") finished early and the build plate has been cleared.

You can shift your reservation for "{{fileName}}" forward to {{newStartTime}} (instead of {{startTime}}).

Click the link below to log in with your @illinois.edu account and claim the earlier slot:`,
  },
  late_warning: {
    enabled: true,
    subject: "Reminder: Please Start Your Bambu X1C Print",
    bodyTemplate: `Your scheduled print "{{fileName}}" started 15 minutes ago, and you have not clicked "Start Print" yet. Since no one is currently booked immediately after you, your reservation remains open until your scheduled end time, or until a subsequent slot requires the printer.`,
  },
  late_cancel: {
    enabled: true,
    subject: "Bambu X1C Reservation Canceled (Late Arrival)",
    bodyTemplate: `Your reservation for "{{fileName}}" was automatically canceled (status: canceled_late).

Reason: {{reason}}`,
  },
  admin_override: {
    enabled: true,
    subject: 'Lab Admin Schedule Adjustment: "{{fileName}}"',
    bodyTemplate: `A Lab Admin ({{adminEmail}}) updated your reservation for "{{fileName}}":

• Status: {{status}}
• Start Time: {{startTime}}
• Duration: {{duration}} mins (+{{buffer}}m buffer)
• Admin Note: {{reason}}`,
  },
};

export function createDefaultAdminSettings(): AdminSettings {
  return {
    permissions: {
      superAdminEmail: SUPER_ADMIN_EMAIL,
      adminEmails: [SUPER_ADMIN_EMAIL, "admin@illinois.edu"],
      bannedEmails: [],
      allowedDomains: ["illinois.edu"],
      maintenanceMode: false,
      maintenanceMessage:
        "The Bambu Lab X1C is currently undergoing scheduled nozzle/extruder maintenance. New reservations are temporarily paused.",
    },
    bookingLimits: {
      maxDurationMinutes: Number(
        process.env.NEXT_PUBLIC_MAX_DURATION_MINUTES || 480
      ),
      minDurationMinutes: 15,
      maxActiveBookingsPerUser: null, // Unlimited by default
      cooldownBufferMinutes: 10,
      maxAdvanceBookingDays: 14,
      lateArrivalGraceMinutes: 15,
      operatingHours: {
        enabled: false,
        startHour: 8,
        endHour: 22,
      },
    },
    emailTemplates: JSON.parse(JSON.stringify(DEFAULT_EMAIL_TEMPLATES)),
    labProfile: {
      printerName: "Bambu Lab X1-Carbon Combo (AMS)",
      location: "UIUC Engineering Shared Lab",
      nozzleInfo: "0.4mm Hardened Steel Nozzle • Textured PEI Plate",
      supportedFilaments: [
        "PLA / PLA Matte",
        "PETG",
        "ABS / ASA",
        "TPU 95A",
        "PAHT-CF (Carbon Fiber Nylon)",
      ],
      notes:
        "Always clean the Textured PEI build plate with isopropyl alcohol before starting your print and remove all purge lines when clearing the bed.",
    },
    updatedAt: new Date().toISOString(),
  };
}

type SettingsListener = (settings: AdminSettings) => void;
const settingsListeners = new Set<SettingsListener>();

let cachedSettings: AdminSettings | null = null;

function ensureSuperAdminProtected(settings: AdminSettings): AdminSettings {
  const normalizedAdmins = Array.from(
    new Set([
      SUPER_ADMIN_EMAIL,
      ...(settings.permissions?.adminEmails || []).map((e) =>
        e.trim().toLowerCase()
      ),
    ])
  ).filter(Boolean);

  const normalizedBanned = (settings.permissions?.bannedEmails || [])
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e && e !== SUPER_ADMIN_EMAIL);

  const normalizedDomains = Array.from(
    new Set(
      (settings.permissions?.allowedDomains || ["illinois.edu"])
        .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
        .filter(Boolean)
    )
  );
  if (normalizedDomains.length === 0) {
    normalizedDomains.push("illinois.edu");
  }

  return {
    ...settings,
    permissions: {
      ...settings.permissions,
      superAdminEmail: SUPER_ADMIN_EMAIL,
      adminEmails: normalizedAdmins,
      bannedEmails: normalizedBanned,
      allowedDomains: normalizedDomains,
    },
  };
}

export function isSuperAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === SUPER_ADMIN_EMAIL;
}

export function getAdminSettings(): AdminSettings {
  if (typeof window === "undefined") {
    return cachedSettings || createDefaultAdminSettings();
  }

  try {
    const raw = window.localStorage.getItem(ADMIN_SETTINGS_STORAGE_KEY);
    if (!raw) {
      const defaults = createDefaultAdminSettings();
      cachedSettings = defaults;
      window.localStorage.setItem(
        ADMIN_SETTINGS_STORAGE_KEY,
        JSON.stringify(defaults)
      );
      return defaults;
    }

    const parsed = JSON.parse(raw) as Partial<AdminSettings>;
    const defaults = createDefaultAdminSettings();

    const merged: AdminSettings = ensureSuperAdminProtected({
      permissions: {
        ...defaults.permissions,
        ...(parsed.permissions || {}),
      },
      bookingLimits: {
        ...defaults.bookingLimits,
        ...(parsed.bookingLimits || {}),
        operatingHours: {
          ...defaults.bookingLimits.operatingHours,
          ...(parsed.bookingLimits?.operatingHours || {}),
        },
      },
      emailTemplates: {
        ...defaults.emailTemplates,
        ...(parsed.emailTemplates || {}),
      },
      labProfile: {
        ...defaults.labProfile,
        ...(parsed.labProfile || {}),
      },
      updatedAt: parsed.updatedAt || defaults.updatedAt,
      updatedBy: parsed.updatedBy,
    });

    cachedSettings = merged;
    return merged;
  } catch {
    return createDefaultAdminSettings();
  }
}

export function saveAdminSettings(
  nextSettings: AdminSettings,
  actorEmail?: string
): { data: AdminSettings; error?: string } {
  const current = getAdminSettings();

  // Enforce Super Admin guard: only anmolp5@illinois.edu can modify the adminEmails roster
  if (actorEmail && !isSuperAdmin(actorEmail)) {
    const prevAdmins = [...current.permissions.adminEmails].sort().join(",");
    const nextAdmins = [
      ...ensureSuperAdminProtected(nextSettings).permissions.adminEmails,
    ]
      .sort()
      .join(",");

    if (prevAdmins !== nextAdmins) {
      return {
        data: current,
        error: `Super Admin Protected: Only ${SUPER_ADMIN_EMAIL} can grant or revoke admin permissions.`,
      };
    }
  }

  const sanitized = ensureSuperAdminProtected({
    ...nextSettings,
    updatedAt: new Date().toISOString(),
    updatedBy: actorEmail || nextSettings.updatedBy,
  });

  cachedSettings = sanitized;

  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      ADMIN_SETTINGS_STORAGE_KEY,
      JSON.stringify(sanitized)
    );
  }

  settingsListeners.forEach((fn) => fn(sanitized));

  // Optional Supabase sync if configured
  if (isSupabaseConfigured && supabase) {
    supabase
      .from("system_settings")
      .upsert({
        id: "global",
        settings: sanitized,
        updated_at: sanitized.updatedAt,
      })
      .then(() => {});
  }

  return { data: sanitized };
}

export function resetAdminSettingsToDefaults(
  actorEmail?: string
): AdminSettings {
  const defaults = createDefaultAdminSettings();
  // If a secondary admin resets settings, preserve the existing adminEmails list
  if (actorEmail && !isSuperAdmin(actorEmail)) {
    const current = getAdminSettings();
    defaults.permissions.adminEmails = current.permissions.adminEmails;
  }
  const res = saveAdminSettings(defaults, actorEmail);
  return res.data;
}

export function subscribeToAdminSettings(
  listener: SettingsListener
): () => void {
  settingsListeners.add(listener);

  const handleStorage = (e: StorageEvent) => {
    if (e.key === ADMIN_SETTINGS_STORAGE_KEY) {
      listener(getAdminSettings());
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage);
  }

  return () => {
    settingsListeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
    }
  };
}

export function renderEmailTemplate(
  type: EmailNotificationType,
  variables: Record<string, string | number | undefined>
): { subject: string; text: string; enabled: boolean } {
  const settings = getAdminSettings();
  const template =
    settings.emailTemplates[type] || DEFAULT_EMAIL_TEMPLATES[type];

  const replaceTokens = (raw: string): string => {
    return raw.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      const val = variables[key];
      return val !== undefined && val !== null ? String(val) : "";
    });
  };

  return {
    subject: replaceTokens(template.subject),
    text: replaceTokens(template.bodyTemplate),
    enabled: template.enabled !== false,
  };
}

export function exportAdminSettingsJson(): string {
  return JSON.stringify(getAdminSettings(), null, 2);
}

export function importAdminSettingsJson(
  rawJson: string,
  actorEmail?: string
): { data?: AdminSettings; error?: string } {
  try {
    const parsed = JSON.parse(rawJson) as Partial<AdminSettings>;
    if (!parsed || typeof parsed !== "object") {
      return { error: "Invalid JSON settings file." };
    }
    const defaults = createDefaultAdminSettings();
    const merged: AdminSettings = {
      permissions: {
        ...defaults.permissions,
        ...(parsed.permissions || {}),
      },
      bookingLimits: {
        ...defaults.bookingLimits,
        ...(parsed.bookingLimits || {}),
        operatingHours: {
          ...defaults.bookingLimits.operatingHours,
          ...(parsed.bookingLimits?.operatingHours || {}),
        },
      },
      emailTemplates: {
        ...defaults.emailTemplates,
        ...(parsed.emailTemplates || {}),
      },
      labProfile: {
        ...defaults.labProfile,
        ...(parsed.labProfile || {}),
      },
      updatedAt: new Date().toISOString(),
      updatedBy: actorEmail,
    };

    const saved = saveAdminSettings(merged, actorEmail);
    if (saved.error) {
      return { error: saved.error };
    }
    return { data: saved.data };
  } catch (err: unknown) {
    return {
      error:
        err instanceof Error ? err.message : "Failed to parse JSON settings.",
    };
  }
}
