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
import { getAppBaseUrl, isValidUiucEmail } from "./auth-config";
import { dispatchEmail } from "./email";
import { isSupabaseConfigured, supabase } from "./supabase";

const BOOKINGS_STORAGE_KEY = "bambu_x1c_bookings_v1";

export const DEV_PERSONAS: UserProfile[] = [
  {
    id: "user-student-1",
    microsoft_oid: "oid-student-1-uiuc",
    email: "anmolp5@illinois.edu",
    full_name: "Anmol Prabhakar",
    role: "user",
    created_at: new Date().toISOString(),
  },
  {
    id: "user-student-2",
    microsoft_oid: "oid-student-2-uiuc",
    email: "mchen42@illinois.edu",
    full_name: "Maya Chen (Student)",
    role: "user",
    created_at: new Date().toISOString(),
  },
  {
    id: "user-admin-1",
    microsoft_oid: "manual-init-admin-oid",
    email: "admin@illinois.edu",
    full_name: "Lab Admin (Staff)",
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

function createSeedBookings(): CalendarBooking[] {
  const now = new Date();
  const monday = startOfWeek(now, { weekStartsOn: 1 });

  // Create an active print right now (started 30m ago, 90m duration + 10m buffer)
  const activeStart = snapTo15MinSlot(addMinutes(now, -30));
  const activeEnd = calculateEndTime(activeStart, 90, 10);

  // Create a scheduled print right after the active print (for testing early completion shift!)
  const nextScheduledStart = snapTo15MinSlot(addMinutes(activeEnd, 15), true);
  const nextScheduledEnd = calculateEndTime(nextScheduledStart, 60, 10);

  // Additional weekly bookings for visual richness on the calendar
  const tueMorning = setMinutes(setHours(addDays(monday, 1), 9), 0);
  const wedAfternoon = setMinutes(setHours(addDays(monday, 2), 14), 15);
  const thuMorning = setMinutes(setHours(addDays(monday, 3), 10), 30);
  const friAfternoon = setMinutes(setHours(addDays(monday, 4), 13), 0);

  const seed: CalendarBooking[] = [
    {
      id: "booking-seed-active",
      user_id: "user-student-1",
      user_email: "anmolp5@illinois.edu",
      user_name: "Anmol Prabhakar",
      file_name: "drone_arm_cf_nylon.3mf",
      duration_minutes: 90,
      buffer_minutes: 10,
      start_time: activeStart.toISOString(),
      end_time: activeEnd.toISOString(),
      status: "in_progress",
      actual_started_at: addMinutes(activeStart, 2).toISOString(),
      created_at: addMinutes(activeStart, -120).toISOString(),
      updated_at: addMinutes(activeStart, 2).toISOString(),
    },
    {
      id: "booking-seed-next",
      user_id: "user-student-2",
      user_email: "mchen42@illinois.edu",
      user_name: "Maya Chen",
      file_name: "planetary_gearbox_v4.gcode",
      duration_minutes: 60,
      buffer_minutes: 10,
      start_time: nextScheduledStart.toISOString(),
      end_time: nextScheduledEnd.toISOString(),
      status: "scheduled",
      created_at: addMinutes(activeStart, -60).toISOString(),
      updated_at: addMinutes(activeStart, -60).toISOString(),
    },
  ];

  // Add extra bookings on other days if they don't overlap with today's two slots
  const candidates: Array<{
    id: string;
    user_id: string;
    user_email: string;
    user_name: string;
    file_name: string;
    duration: number;
    start: Date;
  }> = [
    {
      id: "booking-seed-tue",
      user_id: "user-student-2",
      user_email: "mchen42@illinois.edu",
      user_name: "Maya Chen",
      file_name: "sensor_housing_petg.3mf",
      duration: 75,
      start: tueMorning,
    },
    {
      id: "booking-seed-wed",
      user_id: "user-admin-1",
      user_email: "admin@illinois.edu",
      user_name: "Lab Admin",
      file_name: "x1c_calibration_plate.3mf",
      duration: 45,
      start: wedAfternoon,
    },
    {
      id: "booking-seed-thu",
      user_id: "user-student-2",
      user_email: "mchen42@illinois.edu",
      user_name: "Maya Chen",
      file_name: "robotics_gripper_left.3mf",
      duration: 120,
      start: thuMorning,
    },
    {
      id: "booking-seed-fri",
      user_id: "user-admin-1",
      user_email: "admin@illinois.edu",
      user_name: "Lab Admin",
      file_name: "fixture_jig_pla_matte.gcode",
      duration: 90,
      start: friAfternoon,
    },
  ];

  for (const c of candidates) {
    const cEnd = calculateEndTime(c.start, c.duration, 10);
    if (!findOverlappingBooking(c.start, cEnd, seed)) {
      seed.push({
        id: c.id,
        user_id: c.user_id,
        user_email: c.user_email,
        user_name: c.user_name,
        file_name: c.file_name,
        duration_minutes: c.duration,
        buffer_minutes: 10,
        start_time: c.start.toISOString(),
        end_time: cEnd.toISOString(),
        status: "scheduled",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  }

  return seed;
}

type BookingsListener = (bookings: CalendarBooking[]) => void;
const bookingListeners = new Set<BookingsListener>();

export function getLocalBookings(): CalendarBooking[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(BOOKINGS_STORAGE_KEY);
    if (!raw) {
      const seeded = createSeedBookings();
      window.localStorage.setItem(BOOKINGS_STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    const parsed = JSON.parse(raw) as CalendarBooking[];
    // Auto-migrate any old aprabha2@illinois.edu records to anmolp5@illinois.edu
    let migrated = false;
    const normalized = parsed.map((b) => {
      if (b.user_email === "aprabha2@illinois.edu") {
        migrated = true;
        return { ...b, user_email: "anmolp5@illinois.edu" };
      }
      return b;
    });
    if (migrated) {
      window.localStorage.setItem(
        BOOKINGS_STORAGE_KEY,
        JSON.stringify(normalized)
      );
    }
    return normalized;
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
  const seeded = createSeedBookings();
  saveLocalBookings(seeded);
  return seeded;
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

  // 1. Validate @illinois.edu domain
  if (!isValidUiucEmail(user.email)) {
    return {
      error: "Access restricted: Only @illinois.edu emails can create reservations.",
      code: "42501",
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

  // 3. Validate duration limits
  if (duration_minutes <= 0 || duration_minutes > MAX_DURATION_MINUTES) {
    return {
      error: `Print duration must be between 1 and ${MAX_DURATION_MINUTES} minutes (${
        MAX_DURATION_MINUTES / 60
      } hours).`,
      code: "22023",
    };
  }

  const end_time = calculateEndTime(
    start_time,
    duration_minutes,
    MANDATORY_BUFFER_MINUTES
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
        buffer_minutes: MANDATORY_BUFFER_MINUTES,
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
            "Selected time slot overlaps an existing booking or its mandatory 10-minute cooldown buffer (PostgreSQL Error 23P01: prevent_booking_overlap).",
          code: "23P01",
        };
      }
      return { error: error.message, code: error.code };
    }
    return { data: data as CalendarBooking };
  }

  // Local store with exact PostgreSQL GiST exclusion constraint simulation
  const all = getLocalBookings();

  const overlapping = findOverlappingBooking(start_time, end_time, all);
  if (overlapping) {
    return {
      error: `Selected time slot (${start_time.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })} – ${end_time.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })} incl. 10m buffer) overlaps with "${
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
    buffer_minutes: MANDATORY_BUFFER_MINUTES,
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

  await dispatchEmail({
    to: user.email,
    subject: `Reservation Confirmed: "${newBooking.file_name}" on Bambu Lab X1C`,
    text: `Your Bambu Lab X1C 3D print reservation is confirmed!\n\n• File Name: ${
      newBooking.file_name
    }\n• Reserved By: ${user.email}\n• Start Time: ${start_time.toLocaleString()}\n• Active Print Window: ${start_time.toLocaleTimeString(
      [],
      { hour: "2-digit", minute: "2-digit" }
    )} – ${printFinish.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })} (${duration_minutes} mins)\n• Cooldown & Bed Clear Buffer: ${printFinish.toLocaleTimeString(
      [],
      { hour: "2-digit", minute: "2-digit" }
    )} – ${end_time.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })} (+10 mins)\n• Pre-Slot Email Reminder: ${
      normalizedReminder
        ? `${normalizedReminder} minutes before start`
        : "Disabled"
    }\n\nIMPORTANT: Please click "Start Print" on the portal when your slot begins to prevent late-arrival auto-cancellation.`,
    type: "confirmation",
  });

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

  await dispatchEmail({
    to: target.user_email,
    subject: `Print Started: "${target.file_name}" is Now Printing on Bambu X1C`,
    text: `Your print job "${
      target.file_name
    }" has been marked IN PROGRESS!\n\n• Started At: ${now.toLocaleTimeString(
      [],
      { hour: "2-digit", minute: "2-digit" }
    )}\n• Estimated Print Completion: ${estPrintFinish.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })} (${
      target.duration_minutes
    }m duration)\n• Total Slot Ends (incl. +10m cooldown buffer): ${scheduledEnd.toLocaleTimeString(
      [],
      { hour: "2-digit", minute: "2-digit" }
    )}\n\nWhen your print finishes and you clear the build plate, click "Mark Complete & Clear Bed" on the portal to release any remaining time for the next student in queue.`,
    type: "print_started",
  });

  return { data: updatedBooking };
}

/**
 * Section 4.3: Early Completion & Slot Offer Flow
 * 1. Marks booking `completed`, sets `actual_completed_at = now()`,
 *    and updates `end_time = now() + 10 minutes` (frees remaining schedule block).
 * 2. Sends Print Completed confirmation email to the user who finished.
 * 3. Finds immediate next `scheduled` booking and sends Early Slot Offer magic link email.
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
  const newEndWithCooldown = addMinutes(now, MANDATORY_BUFFER_MINUTES);

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

  // 1. Send Print Completed confirmation email to the user who completed their print
  await dispatchEmail({
    to: target.user_email,
    subject: `Print Completed & Bed Cleared: "${target.file_name}"`,
    text: `Thank you for marking your Bambu Lab X1C print complete and clearing the build plate!\n\n• File Name: ${
      target.file_name
    }\n• Completed At: ${now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}\n• 10-Minute Cooldown Buffer Ends: ${effectiveEnd.toLocaleTimeString(
      [],
      { hour: "2-digit", minute: "2-digit" }
    )}\n• Status: COMPLETED`,
    type: "print_completed",
  });

  let nextBookingNotified: CalendarBooking | null = null;
  let magicLinkUrl: string | undefined;

  if (nextBookings.length > 0) {
    const nextJob = nextBookings[0];
    // Snap the earliest available start time to the next 15-minute increment after the 10-min cooldown
    const earliestNewStart = snapTo15MinSlot(effectiveEnd, true);

    // Only offer if the new start time is genuinely earlier than their current scheduled start_time
    if (earliestNewStart.getTime() < new Date(nextJob.start_time).getTime()) {
      nextBookingNotified = nextJob;
      const baseUrl = getAppBaseUrl();

      magicLinkUrl = `${baseUrl}/portal/reschedule?booking_id=${encodeURIComponent(
        nextJob.id
      )}&new_start=${encodeURIComponent(earliestNewStart.toISOString())}`;

      await dispatchEmail({
        to: nextJob.user_email,
        subject: "Bambu X1C is available early! Shift your print up?",
        text: `Good news! The previous print ("${target.file_name}") finished early and the build plate has been cleared.\n\nYou can shift your reservation for "${nextJob.file_name}" forward to ${earliestNewStart.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })} (instead of ${new Date(nextJob.start_time).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}).\n\nClick the link below to log in with your @illinois.edu account and claim the earlier slot:`,
        actionUrl: magicLinkUrl,
        actionLabel: "Shift Print Up Now",
        type: "early_offer",
      });
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
    await dispatchEmail({
      to: target.user_email,
      subject: `Slot Starting Now: Start Your Print "${target.file_name}" on Bambu X1C`,
      text: `Your reserved Bambu Lab X1C time slot for "${
        target.file_name
      }" is starting right now (${startDate.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })})!\n\nPlease load your filament, start the job on the printer, and click "Start Print" on the booking portal so your reservation is not auto-canceled for late arrival.`,
      actionUrl: getAppBaseUrl(),
      actionLabel: "Open Portal & Click Start Print",
      type: "slot_starting",
    });

    saveLocalBookings(
      all.map((b) =>
        b.id === bookingId ? { ...b, slot_start_notified: true } : b
      )
    );
    return { sent: true };
  }

  await dispatchEmail({
    to: target.user_email,
    subject: `Reminder: "${target.file_name}" Print Slot Starts in ${minsBefore} Minutes`,
    text: `Heads up! Your Bambu Lab X1C reservation is coming up in ${minsBefore} minutes.\n\n• File Name: ${
      target.file_name
    }\n• Scheduled Start: ${startDate.toLocaleString()}\n• Duration: ${
      target.duration_minutes
    } mins (+10m cooldown buffer)\n\nRemember to head to the lab and click "Start Print" on the portal when your slot begins.`,
    actionUrl: getAppBaseUrl(),
    actionLabel: "View My Reservation",
    type: "pre_booking_reminder",
  });

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
  if (target.user_id !== user.id && user.role !== "admin") {
    return { error: "Unauthorized." };
  }

  const updatedBooking: CalendarBooking = {
    ...target,
    status: user.role === "admin" && target.user_id !== user.id ? "canceled_admin" : "canceled_user",
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

  const snappedStart = snapTo15MinSlot(newStartTime);
  const newEndTime = calculateEndTime(
    snappedStart,
    newDurationMinutes,
    MANDATORY_BUFFER_MINUTES
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
    status: newStatus,
    updated_at: new Date().toISOString(),
  };

  saveLocalBookings(all.map((b) => (b.id === bookingId ? updatedBooking : b)));

  if (sendNotification) {
    await dispatchEmail({
      to: target.user_email,
      subject: `Lab Admin Schedule Adjustment: "${target.file_name}"`,
      text: `A Lab Admin (${adminUser.email}) updated your reservation for "${
        target.file_name
      }":\n\n• Status: ${newStatus.toUpperCase()}\n• Start Time: ${snappedStart.toLocaleString()}\n• Duration: ${newDurationMinutes} mins (+10m buffer)\n${
        reason ? `• Admin Note: ${reason}` : ""
      }`,
      type: "admin_override",
    });
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

        await dispatchEmail({
          to: booking.user_email,
          subject: "Bambu X1C Reservation Canceled (Late Arrival)",
          text: `Your reservation for "${booking.file_name}" was automatically canceled (status: canceled_late).\n\nReason: ${evaluation.reason}`,
          type: "late_cancel",
        });
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

        await dispatchEmail({
          to: booking.user_email,
          subject: "Reminder: Please Start Your Bambu X1C Print",
          text: `Your scheduled print "${booking.file_name}" started 15 minutes ago, and you have not clicked "Start Print" yet. Since no one is currently booked immediately after you, your reservation remains open until your scheduled end time, or until a subsequent slot requires the printer.`,
          type: "late_warning",
        });
      }
    }
  }

  if (canceledBookings.length > 0 || warnedBookings.length > 0) {
    saveLocalBookings(updatedList);
  }

  return { canceledBookings, warnedBookings };
}
