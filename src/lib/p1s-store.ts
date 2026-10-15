import { addMinutes } from "date-fns";
import { CalendarBooking, UserProfile, BookingStatus } from "./types";
import {
  MANDATORY_BUFFER_MINUTES,
  MAX_DURATION_MINUTES,
  calculateEndTime,
  findOverlappingBooking,
  isValid15MinSlot,
  snapTo15MinSlot,
} from "./scheduling";
import { getAdminSettings } from "./admin-settings";

export const P1S_STORAGE_KEY = "bambu_p1s_sandbox_bookings";

export type P1sBookingsListener = (bookings: CalendarBooking[]) => void;
export const p1sBookingListeners = new Set<P1sBookingsListener>();

/**
 * Returns all active and historical bookings strictly from the P1S sandbox local store.
 * Never modifies or reads from the production X1C bookings key.
 */
export function getP1sBookings(): CalendarBooking[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(P1S_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as CalendarBooking[];
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Saves bookings to the P1S sandbox storage and notifies all registered listeners.
 */
export function saveP1sBookings(bookings: CalendarBooking[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(P1S_STORAGE_KEY, JSON.stringify(bookings));
  } catch {
    // ignore local storage quota / private browsing errors
  }
  p1sBookingListeners.forEach((listener) => {
    try {
      listener(bookings);
    } catch (e) {
      console.error("[P1S Store] Listener error:", e);
    }
  });

  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(
      new CustomEvent("p1s_bookings_changed", { detail: bookings })
    );
  }
}

/**
 * Subscribes a callback to P1S sandbox booking updates.
 * Returns an unsubscribe teardown function.
 */
export function subscribeToP1sBookings(listener: P1sBookingsListener): () => void {
  p1sBookingListeners.add(listener);
  return () => {
    p1sBookingListeners.delete(listener);
  };
}

/**
 * Creates a new reservation in the P1S real-hardware sandbox.
 * Enforces 5-minute slot boundary, duration limits, and overlap exclusion constraints.
 */
export async function createP1sBooking(params: {
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
    reminder_minutes_before = null,
  } = params;

  if (!file_name || !file_name.trim()) {
    return {
      error: "Please enter a 3D model file name (.gcode or .3mf).",
      code: "22023",
    };
  }

  // 1. Validate 5-minute increment boundary (:00, :05, :10, :15...)
  if (!isValid15MinSlot(start_time)) {
    return {
      error: "Start time must fall on a 5-minute increment (:00, :05, :10, :15, ...).",
      code: "22023",
    };
  }

  const settings = getAdminSettings();
  const activeBuffer =
    typeof settings.bookingLimits.cooldownBufferMinutes === "number"
      ? settings.bookingLimits.cooldownBufferMinutes
      : MANDATORY_BUFFER_MINUTES;
  const activeMaxDuration =
    settings.bookingLimits.maxDurationMinutes || MAX_DURATION_MINUTES;
  const activeMinDuration = settings.bookingLimits.minDurationMinutes || 5;

  if (
    duration_minutes < activeMinDuration ||
    duration_minutes > activeMaxDuration
  ) {
    return {
      error: `Print duration must be between ${activeMinDuration} and ${activeMaxDuration} minutes.`,
      code: "22023",
    };
  }

  const end_time = calculateEndTime(
    start_time,
    duration_minutes,
    activeBuffer
  );

  const all = getP1sBookings();

  // 2. Prevent overlapping bookings on P1S (GiST exclusion simulation)
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

  const newBooking: CalendarBooking = {
    id: `p1s-booking-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    user_id: user.id,
    user_email: user.email,
    user_name: user.full_name || user.email,
    file_name: file_name.trim(),
    duration_minutes,
    buffer_minutes: activeBuffer,
    start_time: start_time.toISOString(),
    end_time: end_time.toISOString(),
    status: "scheduled",
    reminder_minutes_before: reminder_minutes_before ?? null,
    reminder_sent: false,
    slot_start_notified: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const updated = [...all, newBooking];
  saveP1sBookings(updated);

  return { data: newBooking };
}

/**
 * Edits or overrides an existing P1S sandbox booking (Admin or Owner).
 */
export async function editP1sBooking(params: {
  bookingId: string;
  adminUser: UserProfile;
  newStartTime: Date;
  newDurationMinutes: number;
  newStatus: BookingStatus;
  sendNotification?: boolean;
  reason?: string;
}): Promise<{ data?: CalendarBooking; error?: string }> {
  const {
    bookingId,
    newStartTime,
    newDurationMinutes,
    newStatus,
  } = params;

  const all = getP1sBookings();
  const target = all.find((b) => b.id === bookingId);
  if (!target) {
    return { error: "P1S booking not found." };
  }

  const settings = getAdminSettings();
  const activeBuffer =
    typeof settings.bookingLimits.cooldownBufferMinutes === "number"
      ? settings.bookingLimits.cooldownBufferMinutes
      : MANDATORY_BUFFER_MINUTES;

  const snappedStart = snapTo15MinSlot(newStartTime);
  const newEndTime = calculateEndTime(
    snappedStart,
    newDurationMinutes,
    activeBuffer
  );

  // If new status is active, check for collision with other active bookings
  if (newStatus === "scheduled" || newStatus === "in_progress") {
    const overlap = findOverlappingBooking(
      snappedStart,
      newEndTime,
      all,
      bookingId
    );
    if (overlap) {
      return {
        error: `Schedule collision: Time slot overlaps with "${overlap.file_name}" (${overlap.user_email}). [Code 23P01]`,
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

  saveP1sBookings(all.map((b) => (b.id === bookingId ? updatedBooking : b)));
  return { data: updatedBooking };
}

/**
 * Cancels a P1S sandbox booking.
 */
export async function cancelP1sBooking(
  bookingId: string,
  user: UserProfile
): Promise<{ data?: CalendarBooking; error?: string }> {
  const all = getP1sBookings();
  const target = all.find((b) => b.id === bookingId);
  if (!target) {
    return { error: "P1S booking not found." };
  }

  const updatedBooking: CalendarBooking = {
    ...target,
    status: user.role === "admin" ? "canceled_admin" : "canceled_user",
    updated_at: new Date().toISOString(),
  };

  saveP1sBookings(all.map((b) => (b.id === bookingId ? updatedBooking : b)));
  return { data: updatedBooking };
}

/**
 * Completely resets and clears all bookings from the P1S sandbox store.
 */
export function clearP1sBookings(): void {
  saveP1sBookings([]);
}

/**
 * Transitions a P1S booking to in_progress (Simulated Print Start).
 */
export async function startP1sPrintJob(
  bookingId: string,
  user: UserProfile
): Promise<{ data?: CalendarBooking; error?: string }> {
  const all = getP1sBookings();
  const target = all.find((b) => b.id === bookingId);
  if (!target) return { error: "P1S booking not found." };

  const now = new Date();
  const updatedBooking: CalendarBooking = {
    ...target,
    status: "in_progress",
    actual_started_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  saveP1sBookings(all.map((b) => (b.id === bookingId ? updatedBooking : b)));
  return { data: updatedBooking };
}

/**
 * Transitions a P1S booking to completed (Simulated Print Finish & Bed Cleared).
 */
export async function completeP1sPrintJob(
  bookingId: string,
  user: UserProfile
): Promise<{ data?: CalendarBooking; error?: string }> {
  const all = getP1sBookings();
  const target = all.find((b) => b.id === bookingId);
  if (!target) return { error: "P1S booking not found." };

  const now = new Date();
  const updatedBooking: CalendarBooking = {
    ...target,
    status: "completed",
    actual_completed_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  saveP1sBookings(all.map((b) => (b.id === bookingId ? updatedBooking : b)));
  return { data: updatedBooking };
}

/**
 * Helper to seed sample test reservations on the P1S sandbox for torture testing.
 */
export function seedP1sSampleBookings(user: UserProfile): CalendarBooking[] {
  const now = new Date();
  const slot1Start = snapTo15MinSlot(addMinutes(now, 10));
  const slot1End = addMinutes(slot1Start, 60 + 10);

  const slot2Start = snapTo15MinSlot(addMinutes(slot1End, 30));
  const slot2End = addMinutes(slot2Start, 90 + 10);

  const samples: CalendarBooking[] = [
    {
      id: `p1s-seed-1-${Date.now()}`,
      user_id: user.id,
      user_email: user.email,
      user_name: user.full_name || "Sandbox Tester",
      file_name: "torture_overhang_test_p1s.3mf",
      duration_minutes: 60,
      buffer_minutes: 10,
      start_time: slot1Start.toISOString(),
      end_time: slot1End.toISOString(),
      status: "scheduled",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: `p1s-seed-2-${Date.now()}`,
      user_id: "user-p1s-torture",
      user_email: "stress_test@illinois.edu",
      user_name: "P1S Lab Stress Bot",
      file_name: "benchy_high_speed_test.gcode",
      duration_minutes: 90,
      buffer_minutes: 10,
      start_time: slot2Start.toISOString(),
      end_time: slot2End.toISOString(),
      status: "scheduled",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  saveP1sBookings(samples);
  return samples;
}
