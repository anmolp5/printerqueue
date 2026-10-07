import {
  addDays,
  addMinutes,
  setHours,
  setMinutes,
  startOfWeek,
} from "date-fns";
import { CalendarBooking, UserProfile, BookingStatus } from "./types";
import {
  MANDATORY_BUFFER_MINUTES,
  MAX_DURATION_MINUTES,
  calculateEndTime,
  evaluateLateArrival,
  findOverlappingBooking,
  isSlotBeforeCurrentPeriod,
  isValid15MinSlot,
  snapTo15MinSlot,
} from "./scheduling";
import {
  getAppBaseUrl,
  isUserBanned,
  isValidUiucEmail,
} from "./auth-config";
import { getAdminSettings, renderEmailTemplate } from "./admin-settings";
import { dispatchEmail } from "./email";
import { isSupabaseConfigured, supabase } from "./supabase";

const BOOKINGS_STORAGE_KEY = "bambu_x1c_bookings_v1";

export const DEV_PERSONAS: UserProfile[] = [
  {
    id: "user-student-1",
    microsoft_oid: "oid-student-1-uiuc",
    email: "anmolp5@illinois.edu",
    full_name: "Anmol Prabhakar",
    role: "admin",
    created_at: new Date().toISOString(),
  },
];

export function isBookingOwnedByUser(
  booking: CalendarBooking,
  user: UserProfile | null | undefined
): boolean {
  if (!user) return false;
  return (
    booking.user_id === user.id ||
    booking.user_email.trim().toLowerCase() === user.email.trim().toLowerCase()
  );
}

const DEMO_TEST_EMAILS = new Set([
  "mchen42@illinois.edu",
  "admin@illinois.edu",
  "test.admin@illinois.edu",
  "staff1@illinois.edu",
  "external.user@gmail.com",
]);

function isDemoBooking(b: CalendarBooking): boolean {
  if (b.id.startsWith("booking-seed-")) return true;
  if (DEMO_TEST_EMAILS.has(b.user_email.trim().toLowerCase())) return true;
  return false;
}

type BookingsListener = (bookings: CalendarBooking[]) => void;
const bookingListeners = new Set<BookingsListener>();

export function getLocalBookings(): CalendarBooking[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(BOOKINGS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as CalendarBooking[];
    let changed = false;
    const cleaned = parsed
      .filter((b) => {
        if (isDemoBooking(b)) {
          changed = true;
          return false;
        }
        return true;
      })
      .map((b) => {
        if (b.user_email === "aprabha2@illinois.edu") {
          changed = true;
          return { ...b, user_email: "anmolp5@illinois.edu" };
        }
        return b;
      });

    if (changed) {
      window.localStorage.setItem(
        BOOKINGS_STORAGE_KEY,
        JSON.stringify(cleaned)
      );
    }
    return cleaned;
  } catch {
    return [];
  }
}

function saveLocalBookings(bookings: CalendarBooking[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BOOKINGS_STORAGE_KEY, JSON.stringify(bookings));
  bookingListeners.forEach((fn) => fn(bookings));
}

export function resetDemoData(): CalendarBooking[] {
  saveLocalBookings([]);
  return [];
}

export function subscribeToBookings(listener: BookingsListener): () => void {
  bookingListeners.add(listener);

  // If Supabase Realtime is configured, also subscribe to channel('public:bookings')
  let supabaseSub: { unsubscribe: () => void } | null = null;
  if (isSupabaseConfigured && supabase) {
    const channel = supabase
      .channel("public:bookings")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings" },
        async () => {
          const { data } = await supabase!
            .from("bookings")
            .select("*")
            .order("start_time", { ascending: true });
          if (data) listener(data as CalendarBooking[]);
        }
      )
      .subscribe();
    supabaseSub = { unsubscribe: () => supabase!.removeChannel(channel) };
  }

  return () => {
    bookingListeners.delete(listener);
    if (supabaseSub) supabaseSub.unsubscribe();
  };
}

export async function fetchBookings(): Promise<CalendarBooking[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("bookings")
      .select("*")
      .order("start_time", { ascending: true });
    if (!error && data) return data as CalendarBooking[];
  }
  return getLocalBookings();
}

export async function createBooking(params: {
  user: UserProfile;
  file_name: string;
  duration_minutes: number;
  start_time: Date;
  reminder_minutes_before?: number | null;
}): Promise<{ data?: CalendarBooking; error?: string; code?: string }> {
  const {
    user,
    file_name,
    duration_minutes,
    start_time,
    reminder_minutes_before = 15,
  } = params;

  const settings = getAdminSettings();
  const { permissions, bookingLimits } = settings;
  const activeBuffer =
    typeof bookingLimits.cooldownBufferMinutes === "number"
      ? bookingLimits.cooldownBufferMinutes
      : MANDATORY_BUFFER_MINUTES;
  const activeMaxDuration =
    bookingLimits.maxDurationMinutes || MAX_DURATION_MINUTES;
  const activeMinDuration = bookingLimits.minDurationMinutes || 1;

  // 1. Validate allowed domain
  if (!isValidUiucEmail(user.email)) {
    const domainsLabel = permissions.allowedDomains
      .map((d) => `@${d}`)
      .join(", ");
    return {
      error: `Access restricted: Only authorized domain emails (${domainsLabel}) can create reservations.`,
      code: "42501",
    };
  }

  // 1b. Check if user is restricted/banned
  if (isUserBanned(user.email)) {
    return {
      error:
        "Access restricted: Your account has been temporarily restricted from creating reservations by a Lab Admin.",
      code: "42501",
    };
  }

  // 1c. Check Maintenance Mode (non-admins blocked when active)
  if (permissions.maintenanceMode && user.role !== "admin") {
    return {
      error:
        permissions.maintenanceMessage ||
        "The printer queue is currently paused for scheduled maintenance.",
      code: "50300",
    };
  }

  // 2. Validate 15-minute slot increment (:00, :15, :30, :45)
  if (!isValid15MinSlot(start_time)) {
    return {
      error: "Start time must fall on a 15-minute increment (:00, :15, :30, :45).",
      code: "22023",
    };
  }

  // 2b. Disallow starting a booking before the current 15-minute time period
  if (isSlotBeforeCurrentPeriod(start_time)) {
    return {
      error:
        "Cannot start a booking before the current 15-minute time period.",
      code: "22023",
    };
  }

  // 2c. Validate advance booking horizon for non-admins
  if (
    user.role !== "admin" &&
    bookingLimits.maxAdvanceBookingDays &&
    bookingLimits.maxAdvanceBookingDays > 0
  ) {
    const maxFutureMs =
      Date.now() + bookingLimits.maxAdvanceBookingDays * 24 * 60 * 60 * 1000;
    if (start_time.getTime() > maxFutureMs) {
      return {
        error: `Reservations can only be scheduled up to ${bookingLimits.maxAdvanceBookingDays} days in advance.`,
        code: "22023",
      };
    }
  }

  // 2d. Validate operating hours if enabled
  if (user.role !== "admin" && bookingLimits.operatingHours?.enabled) {
    const { startHour, endHour } = bookingLimits.operatingHours;
    const hr = start_time.getHours();
    if (hr < startHour || hr >= endHour) {
      return {
        error: `Lab operating hours are ${String(startHour).padStart(
          2,
          "0"
        )}:00 to ${String(endHour).padStart(
          2,
          "0"
        )}:00. Please select a start time within operating hours.`,
        code: "22023",
      };
    }
  }

  // 3. Validate duration limits
  if (
    duration_minutes < activeMinDuration ||
    duration_minutes > activeMaxDuration
  ) {
    return {
      error: `Print duration must be between ${activeMinDuration} and ${activeMaxDuration} minutes (${(
        activeMaxDuration / 60
      ).toFixed(1)} hours).`,
      code: "22023",
    };
  }

  const end_time = calculateEndTime(
    start_time,
    duration_minutes,
    activeBuffer
  );

  // If Supabase is active
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("bookings")
      .insert({
        user_id: user.id,
        user_email: user.email,
        file_name: file_name.trim(),
        duration_minutes,
        buffer_minutes: activeBuffer,
        start_time: start_time.toISOString(),
        end_time: end_time.toISOString(),
        status: "scheduled",
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23P01") {
        return {
          error:
            "Selected time slot overlaps an existing booking or its mandatory cooldown buffer (PostgreSQL Error 23P01: prevent_booking_overlap).",
          code: "23P01",
        };
      }
      return { error: error.message, code: error.code };
    }
    return { data: data as CalendarBooking };
  }

  // Local store with exact PostgreSQL GiST exclusion constraint simulation
  const all = getLocalBookings();

  // Optional active booking limit per user (if configured by Admin)
  if (
    user.role !== "admin" &&
    typeof bookingLimits.maxActiveBookingsPerUser === "number" &&
    bookingLimits.maxActiveBookingsPerUser > 0
  ) {
    const userActiveCount = all.filter(
      (b) =>
        isBookingOwnedByUser(b, user) &&
        (b.status === "scheduled" || b.status === "in_progress")
    ).length;
    if (userActiveCount >= bookingLimits.maxActiveBookingsPerUser) {
      return {
        error: `You already have ${userActiveCount} active reservation(s) (limit: ${bookingLimits.maxActiveBookingsPerUser}). Complete or cancel an active booking before scheduling another.`,
        code: "P0001",
      };
    }
  }

  const overlapping = findOverlappingBooking(start_time, end_time, all);
  if (overlapping) {
    return {
      error: `Selected time slot (${start_time.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })} – ${end_time.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })} incl. ${activeBuffer}m buffer) overlaps with "${
        overlapping.file_name
      }" (${overlapping.user_email}). [Code 23P01: exclusion violation]`,
      code: "23P01",
    };
  }

  const normalizedReminder =
    reminder_minutes_before && reminder_minutes_before > 0
      ? Math.round(reminder_minutes_before)
      : null;

  const newBooking: CalendarBooking = {
    id: `booking-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    user_id: user.id,
    user_email: user.email,
    user_name: user.full_name,
    file_name: file_name.trim(),
    duration_minutes,
    buffer_minutes: activeBuffer,
    start_time: start_time.toISOString(),
    end_time: end_time.toISOString(),
    status: "scheduled",
    reminder_minutes_before: normalizedReminder,
    reminder_sent: false,
    slot_start_notified: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const updated = [...all, newBooking];
  saveLocalBookings(updated);

  const printFinish = new Date(
    start_time.getTime() + duration_minutes * 60 * 1000
  );

  const rendered = renderEmailTemplate("confirmation", {
    fileName: newBooking.file_name,
    userEmail: user.email,
    userName: user.full_name,
    startTime: start_time.toLocaleString(),
    printFinishTime: printFinish.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    endTime: end_time.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    duration: duration_minutes,
    buffer: activeBuffer,
    minsBefore: normalizedReminder
      ? `${normalizedReminder} minutes before start`
      : "Disabled",
  });

  if (rendered.enabled) {
    await dispatchEmail({
      to: user.email,
      subject: rendered.subject,
      text: rendered.text,
      type: "confirmation",
    });
  }

  return { data: newBooking };
}

/**
 * Transitions a `scheduled` booking to `in_progress` when the user clicks "Start Print"
 * and sends a Print Started confirmation email.
 */
export async function startPrintJob(
  bookingId: string,
  user: UserProfile
): Promise<{ data?: CalendarBooking; error?: string }> {
  const now = new Date();

  const all = getLocalBookings();
  const target = all.find((b) => b.id === bookingId);
  if (!target) return { error: "Booking not found." };
  if (!isBookingOwnedByUser(target, user) && user.role !== "admin") {
    return { error: "Unauthorized: You can only start your own print job." };
  }

  const updatedBooking: CalendarBooking = {
    ...target,
    status: "in_progress",
    actual_started_at: now.toISOString(),
    slot_start_notified: true,
    updated_at: now.toISOString(),
  };

  saveLocalBookings(all.map((b) => (b.id === bookingId ? updatedBooking : b)));

  const estPrintFinish = addMinutes(now, target.duration_minutes);
  const scheduledEnd = new Date(target.end_time);

  const rendered = renderEmailTemplate("print_started", {
    fileName: target.file_name,
    userEmail: target.user_email,
    userName: target.user_name || target.user_email,
    startTime: now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    printFinishTime: estPrintFinish.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    endTime: scheduledEnd.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    duration: target.duration_minutes,
    buffer: target.buffer_minutes,
  });

  if (rendered.enabled) {
    await dispatchEmail({
      to: target.user_email,
      subject: rendered.subject,
      text: rendered.text,
      type: "print_started",
    });
  }

  return { data: updatedBooking };
}

/**
 * Section 4.3: Early Completion & Slot Offer Flow
 */
export async function completeAndClearBed(
  bookingId: string,
  user: UserProfile
): Promise<{
  data?: CalendarBooking;
  nextBookingNotified?: CalendarBooking | null;
  magicLinkUrl?: string;
  error?: string;
}> {
  const now = new Date();
  const activeBuffer =
    getAdminSettings().bookingLimits.cooldownBufferMinutes ??
    MANDATORY_BUFFER_MINUTES;
  const newEndWithCooldown = addMinutes(now, activeBuffer);

  const all = getLocalBookings();
  const target = all.find((b) => b.id === bookingId);
  if (!target) return { error: "Booking not found." };
  if (!isBookingOwnedByUser(target, user) && user.role !== "admin") {
    return { error: "Unauthorized: You can only complete your own print job." };
  }

  const originalEnd = new Date(target.end_time);
  const effectiveEnd =
    newEndWithCooldown.getTime() < originalEnd.getTime()
      ? newEndWithCooldown
      : originalEnd;

  const updatedBooking: CalendarBooking = {
    ...target,
    status: "completed",
    actual_completed_at: now.toISOString(),
    end_time: effectiveEnd.toISOString(),
    updated_at: now.toISOString(),
  };

  const nextBookings = all
    .filter(
      (b) =>
        b.id !== bookingId &&
        b.status === "scheduled" &&
        new Date(b.start_time).getTime() > new Date(target.start_time).getTime()
    )
    .sort(
      (a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );

  const updatedList = all.map((b) => (b.id === bookingId ? updatedBooking : b));
  saveLocalBookings(updatedList);

  const renderedComplete = renderEmailTemplate("print_completed", {
    fileName: target.file_name,
    userEmail: target.user_email,
    userName: target.user_name || target.user_email,
    startTime: now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    endTime: effectiveEnd.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    duration: target.duration_minutes,
    buffer: activeBuffer,
    status: "COMPLETED",
  });

  if (renderedComplete.enabled) {
    await dispatchEmail({
      to: target.user_email,
      subject: renderedComplete.subject,
      text: renderedComplete.text,
      type: "print_completed",
    });
  }

  let nextBookingNotified: CalendarBooking | null = null;
  let magicLinkUrl: string | undefined;

  if (nextBookings.length > 0) {
    const nextJob = nextBookings[0];
    const earliestNewStart = snapTo15MinSlot(effectiveEnd, true);

    if (earliestNewStart.getTime() < new Date(nextJob.start_time).getTime()) {
      nextBookingNotified = nextJob;
      const baseUrl = getAppBaseUrl();

      magicLinkUrl = `${baseUrl}/portal/reschedule?booking_id=${encodeURIComponent(
        nextJob.id
      )}&new_start=${encodeURIComponent(earliestNewStart.toISOString())}`;

      const renderedOffer = renderEmailTemplate("early_offer", {
        fileName: nextJob.file_name,
        previousFileName: target.file_name,
        userEmail: nextJob.user_email,
        userName: nextJob.user_name || nextJob.user_email,
        newStartTime: earliestNewStart.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        startTime: new Date(nextJob.start_time).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        duration: nextJob.duration_minutes,
        buffer: nextJob.buffer_minutes,
      });

      if (renderedOffer.enabled) {
        await dispatchEmail({
          to: nextJob.user_email,
          subject: renderedOffer.subject,
          text: renderedOffer.text,
          actionUrl: magicLinkUrl,
          actionLabel: "Shift Print Up Now",
          type: "early_offer",
        });
      }
    }
  }

  return {
    data: updatedBooking,
    nextBookingNotified,
    magicLinkUrl,
  };
}

/**
 * Manually or automatically sends the pre-booking reminder email ("X minutes before slot")
 * or the "Slot Starting Now" notification email.
 */
export async function triggerBookingReminderEmail(
  bookingId: string,
  kind: "pre_booking_reminder" | "slot_starting" = "pre_booking_reminder"
): Promise<{ sent: boolean }> {
  const all = getLocalBookings();
  const target = all.find((b) => b.id === bookingId);
  if (!target) return { sent: false };

  const startDate = new Date(target.start_time);
  const minsBefore = target.reminder_minutes_before || 15;

  if (kind === "slot_starting") {
    const rendered = renderEmailTemplate("slot_starting", {
      fileName: target.file_name,
      userEmail: target.user_email,
      userName: target.user_name || target.user_email,
      startTime: startDate.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      duration: target.duration_minutes,
      buffer: target.buffer_minutes,
    });

    if (rendered.enabled) {
      await dispatchEmail({
        to: target.user_email,
        subject: rendered.subject,
        text: rendered.text,
        actionUrl: getAppBaseUrl(),
        actionLabel: "Open Portal & Click Start Print",
        type: "slot_starting",
      });
    }

    saveLocalBookings(
      all.map((b) =>
        b.id === bookingId ? { ...b, slot_start_notified: true } : b
      )
    );
    return { sent: true };
  }

  const renderedReminder = renderEmailTemplate("pre_booking_reminder", {
    fileName: target.file_name,
    userEmail: target.user_email,
    userName: target.user_name || target.user_email,
    startTime: startDate.toLocaleString(),
    duration: target.duration_minutes,
    buffer: target.buffer_minutes,
    minsBefore,
  });

  if (renderedReminder.enabled) {
    await dispatchEmail({
      to: target.user_email,
      subject: renderedReminder.subject,
      text: renderedReminder.text,
      actionUrl: getAppBaseUrl(),
      actionLabel: "View My Reservation",
      type: "pre_booking_reminder",
    });
  }

  saveLocalBookings(
    all.map((b) => (b.id === bookingId ? { ...b, reminder_sent: true } : b))
  );
  return { sent: true };
}

/**
 * Background check that dispatches any due pre-booking reminders (`now >= start - reminder_minutes`)
 * and slot-starting notifications (`now >= start`).
 */
export async function checkAndDispatchScheduledReminders(): Promise<void> {
  const nowMs = Date.now();
  const all = getLocalBookings();

  for (const b of all) {
    if (b.status !== "scheduled") continue;
    const startMs = new Date(b.start_time).getTime();

    // 1. Check pre-booking reminder
    if (
      b.reminder_minutes_before &&
      b.reminder_minutes_before > 0 &&
      !b.reminder_sent
    ) {
      const reminderTriggerMs =
        startMs - b.reminder_minutes_before * 60 * 1000;
      if (nowMs >= reminderTriggerMs && nowMs < startMs) {
        await triggerBookingReminderEmail(b.id, "pre_booking_reminder");
      }
    }

    // 2. Check slot starting notification
    if (!b.slot_start_notified && nowMs >= startMs) {
      await triggerBookingReminderEmail(b.id, "slot_starting");
    }
  }
}

/**
 * Reschedules a booking earlier when the user accepts the magic link in `/portal/reschedule`.
 */
export async function acceptEarlyReschedule(params: {
  bookingId: string;
  newStartTime: Date;
  user: UserProfile;
}): Promise<{ data?: CalendarBooking; error?: string }> {
  const { bookingId, newStartTime, user } = params;
  const all = getLocalBookings();
  const target = all.find((b) => b.id === bookingId);

  if (!target) {
    return { error: "Reservation not found." };
  }

  if (target.user_id !== user.id && user.role !== "admin") {
    return {
      error: `Authentication mismatch: This reservation belongs to ${target.user_email}, but you are signed in as ${user.email}.`,
    };
  }

  if (target.status !== "scheduled") {
    return {
      error: `Reservation cannot be shifted because its status is currently "${target.status}".`,
    };
  }

  const snappedStart = snapTo15MinSlot(newStartTime);
  const newEndTime = calculateEndTime(
    snappedStart,
    target.duration_minutes,
    target.buffer_minutes
  );

  const overlap = findOverlappingBooking(
    snappedStart,
    newEndTime,
    all,
    bookingId
  );
  if (overlap) {
    return {
      error: `Cannot shift to ${snappedStart.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })} because it overlaps with "${overlap.file_name}".`,
    };
  }

  const updatedBooking: CalendarBooking = {
    ...target,
    start_time: snappedStart.toISOString(),
    end_time: newEndTime.toISOString(),
    updated_at: new Date().toISOString(),
  };

  saveLocalBookings(all.map((b) => (b.id === bookingId ? updatedBooking : b)));
  return { data: updatedBooking };
}

/**
 * Allows a user to cancel their own scheduled reservation.
 */
export async function cancelUserBooking(
  bookingId: string,
  user: UserProfile
): Promise<{ data?: CalendarBooking; error?: string }> {
  const all = getLocalBookings();
  const target = all.find((b) => b.id === bookingId);
  if (!target) return { error: "Booking not found." };
  if (
    !isBookingOwnedByUser(target, user) &&
    user.role !== "admin"
  ) {
    return { error: "Unauthorized." };
  }

  const updatedBooking: CalendarBooking = {
    ...target,
    status:
      user.role === "admin" && !isBookingOwnedByUser(target, user)
        ? "canceled_admin"
        : "canceled_user",
    updated_at: new Date().toISOString(),
  };

  saveLocalBookings(all.map((b) => (b.id === bookingId ? updatedBooking : b)));
  return { data: updatedBooking };
}

/**
 * Section 6: Admin Management & Manual Overrides
 */
export async function adminOverrideBooking(params: {
  bookingId: string;
  adminUser: UserProfile;
  newStartTime: Date;
  newDurationMinutes: number;
  newStatus: BookingStatus;
  sendNotification: boolean;
  reason?: string;
}): Promise<{ data?: CalendarBooking; error?: string }> {
  const {
    bookingId,
    adminUser,
    newStartTime,
    newDurationMinutes,
    newStatus,
    sendNotification,
    reason,
  } = params;

  if (adminUser.role !== "admin") {
    return { error: "Forbidden: Only Lab Admins can perform schedule overrides." };
  }

  const all = getLocalBookings();
  const target = all.find((b) => b.id === bookingId);
  if (!target) return { error: "Booking not found." };

  const activeBuffer =
    getAdminSettings().bookingLimits.cooldownBufferMinutes ??
    MANDATORY_BUFFER_MINUTES;
  const snappedStart = snapTo15MinSlot(newStartTime);
  const newEndTime = calculateEndTime(
    snappedStart,
    newDurationMinutes,
    activeBuffer
  );

  // If the new status is active, ensure no overlap with other active bookings
  if (newStatus === "scheduled" || newStatus === "in_progress") {
    const overlap = findOverlappingBooking(
      snappedStart,
      newEndTime,
      all,
      bookingId
    );
    if (overlap) {
      return {
        error: `Admin override collides with existing booking "${overlap.file_name}" (${overlap.user_email}) [Code 23P01].`,
      };
    }
  }

  const updatedBooking: CalendarBooking = {
    ...target,
    start_time: snappedStart.toISOString(),
    end_time: newEndTime.toISOString(),
    duration_minutes: newDurationMinutes,
    buffer_minutes: activeBuffer,
    status: newStatus,
    updated_at: new Date().toISOString(),
  };

  saveLocalBookings(all.map((b) => (b.id === bookingId ? updatedBooking : b)));

  if (sendNotification) {
    const rendered = renderEmailTemplate("admin_override", {
      fileName: target.file_name,
      userEmail: target.user_email,
      userName: target.user_name || target.user_email,
      adminEmail: adminUser.email,
      status: newStatus.toUpperCase(),
      startTime: snappedStart.toLocaleString(),
      duration: newDurationMinutes,
      buffer: activeBuffer,
      reason: reason || "Schedule adjustment by Lab Admin.",
    });

    if (rendered.enabled) {
      await dispatchEmail({
        to: target.user_email,
        subject: rendered.subject,
        text: rendered.text,
        type: "admin_override",
      });
    }
  }

  return { data: updatedBooking };
}

/**
 * Section 4.2: Runs the Late-Arrival Auto-Cancellation check across all `scheduled` bookings.
 */
export async function runAutoCancelLateCheck(simulatedNow?: Date): Promise<{
  canceledBookings: CalendarBooking[];
  warnedBookings: CalendarBooking[];
}> {
  const now = simulatedNow || new Date();
  const all = getLocalBookings();
  const canceledBookings: CalendarBooking[] = [];
  const warnedBookings: CalendarBooking[] = [];

  // Sort active bookings chronologically
  const activeSorted = all
    .filter((b) => b.status === "scheduled" || b.status === "in_progress")
    .sort(
      (a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );

  const updatedList = [...all];

  for (const booking of activeSorted) {
    if (booking.status !== "scheduled") continue;

    // Find immediate next active booking after this one
    const nextBooking = activeSorted.find(
      (b) =>
        b.id !== booking.id &&
        new Date(b.start_time).getTime() > new Date(booking.start_time).getTime()
    );

    const evaluation = evaluateLateArrival(
      booking,
      now,
      nextBooking ? new Date(nextBooking.start_time) : null
    );

    if (
      evaluation.action === "cancel_overlap" ||
      evaluation.action === "cancel_expired"
    ) {
      const idx = updatedList.findIndex((item) => item.id === booking.id);
      if (idx !== -1) {
        const updatedItem: CalendarBooking = {
          ...updatedList[idx],
          status: "canceled_late",
          updated_at: now.toISOString(),
        };
        updatedList[idx] = updatedItem;
        canceledBookings.push(updatedItem);

        const renderedCancel = renderEmailTemplate("late_cancel", {
          fileName: booking.file_name,
          userEmail: booking.user_email,
          userName: booking.user_name || booking.user_email,
          reason: evaluation.reason || "Late arrival auto-cancellation.",
        });

        if (renderedCancel.enabled) {
          await dispatchEmail({
            to: booking.user_email,
            subject: renderedCancel.subject,
            text: renderedCancel.text,
            type: "late_cancel",
          });
        }
      }
    } else if (evaluation.action === "warn_15m") {
      const idx = updatedList.findIndex((item) => item.id === booking.id);
      if (idx !== -1) {
        const updatedItem: CalendarBooking = {
          ...updatedList[idx],
          late_warned: true,
          updated_at: now.toISOString(),
        };
        updatedList[idx] = updatedItem;
        warnedBookings.push(updatedItem);

        const renderedWarn = renderEmailTemplate("late_warning", {
          fileName: booking.file_name,
          userEmail: booking.user_email,
          userName: booking.user_name || booking.user_email,
          reason: evaluation.reason,
        });

        if (renderedWarn.enabled) {
          await dispatchEmail({
            to: booking.user_email,
            subject: renderedWarn.subject,
            text: renderedWarn.text,
            type: "late_warning",
          });
        }
      }
    }
  }

  if (canceledBookings.length > 0 || warnedBookings.length > 0) {
    saveLocalBookings(updatedList);
  }

  return { canceledBookings, warnedBookings };
}
