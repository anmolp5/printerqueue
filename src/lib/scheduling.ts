import { CalendarBooking } from "./types";
import { getAdminSettings } from "./admin-settings";

export const MANDATORY_BUFFER_MINUTES = 10;
export const SLOT_INCREMENT_MINUTES = 15;

export const MAX_DURATION_MINUTES = Number(
  process.env.NEXT_PUBLIC_MAX_DURATION_MINUTES || 480
);

export function getActiveMaxDurationMinutes(): number {
  return getAdminSettings().bookingLimits.maxDurationMinutes || MAX_DURATION_MINUTES;
}

export function getActiveBufferMinutes(): number {
  const val = getAdminSettings().bookingLimits.cooldownBufferMinutes;
  return typeof val === "number" && val >= 0 ? val : MANDATORY_BUFFER_MINUTES;
}

/**
 * Checks whether a Date falls cleanly on a 15-minute boundary (:00, :15, :30, :45)
 * with 0 seconds and 0 milliseconds.
 */
export function isValid15MinSlot(date: Date): boolean {
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const ms = date.getMilliseconds();
  return minutes % SLOT_INCREMENT_MINUTES === 0 && seconds === 0 && ms === 0;
}

/**
 * Snaps any Date down/nearest to a 15-minute slot boundary.
 */
export function snapTo15MinSlot(date: Date, roundUp = false): Date {
  const result = new Date(date);
  result.setSeconds(0, 0);
  const mins = result.getMinutes();
  const remainder = mins % SLOT_INCREMENT_MINUTES;
  if (remainder !== 0) {
    const adjustment = roundUp
      ? SLOT_INCREMENT_MINUTES - remainder
      : -remainder;
    result.setMinutes(mins + adjustment);
  }
  return result;
}

/**
 * Returns the start of the current 15-minute time period (e.g. at 12:34, returns 12:30:00.000).
 */
export function getCurrentSlotFloor(now: Date = new Date()): Date {
  return snapTo15MinSlot(now, false);
}

/**
 * Returns true if the candidate slotTime is strictly before the current 15-minute time period.
 */
export function isSlotBeforeCurrentPeriod(
  slotTime: Date,
  now: Date = new Date()
): boolean {
  return slotTime.getTime() < getCurrentSlotFloor(now).getTime();
}

/**
 * Calculates total block duration including mandatory 10-minute buffer:
 * Total = D + 10 mins
 */
export function calculateTotalBlockMinutes(
  durationMinutes: number,
  bufferMinutes: number = MANDATORY_BUFFER_MINUTES
): number {
  return durationMinutes + bufferMinutes;
}

/**
 * Calculates End Time:
 * T_end = T_start + (D + 10) * 60 seconds
 */
export function calculateEndTime(
  startTime: Date,
  durationMinutes: number,
  bufferMinutes: number = MANDATORY_BUFFER_MINUTES
): Date {
  const totalMinutes = calculateTotalBlockMinutes(durationMinutes, bufferMinutes);
  return new Date(startTime.getTime() + totalMinutes * 60 * 1000);
}

/**
 * Visual Weekly Calendar Grid Mapping:
 * Row Index = (Hour * 4) + floor(Minute / 15)
 * Span Rows = ceil((Duration + 10) / 15)
 */
export function calculateGridRowIndex(date: Date): number {
  return date.getHours() * 4 + Math.floor(date.getMinutes() / 15);
}

export function calculateGridSpanRows(
  durationMinutes: number,
  bufferMinutes: number = MANDATORY_BUFFER_MINUTES
): number {
  return Math.ceil((durationMinutes + bufferMinutes) / 15);
}

/**
 * Evaluates half-open interval overlap `[startA, endA) && [startB, endB)`
 * matching PostgreSQL `tstzrange(start_time, end_time, '[)') with &&`
 */
export function doTimeRangesOverlap(
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date
): boolean {
  return startA.getTime() < endB.getTime() && endA.getTime() > startB.getTime();
}

/**
 * Checks if a candidate `[startTime, endTime)` collides with any active booking
 * (`scheduled` or `in_progress`), optionally excluding a booking ID (for edits/reschedules).
 */
export function findOverlappingBooking(
  startTime: Date,
  endTime: Date,
  existingBookings: CalendarBooking[],
  excludeBookingId?: string
): CalendarBooking | null {
  for (const b of existingBookings) {
    if (excludeBookingId && b.id === excludeBookingId) continue;
    if (b.status !== "scheduled" && b.status !== "in_progress") continue;

    const bStart = new Date(b.start_time);
    const bEnd = new Date(b.end_time);
    if (doTimeRangesOverlap(startTime, endTime, bStart, bEnd)) {
      return b;
    }
  }
  return null;
}

export interface LateEvaluationResult {
  action: "none" | "cancel_overlap" | "cancel_expired" | "warn_15m";
  reason?: string;
}

/**
 * Evaluates a single `scheduled` booking at `now` against the late-arrival policy:
 * 1. If `now < start_time`, no action.
 * 2. If there is a subsequent active booking (`nextBookingStartTime`):
 *    If `now + (duration_minutes + 10) min > nextBookingStartTime`, cancel (`cancel_overlap`).
 * 3. If there is NO subsequent active booking:
 *    - If `now >= end_time`, cancel (`cancel_expired`).
 *    - If `now >= start_time + 15 min` and not yet warned, send warning email (`warn_15m`).
 */
export function evaluateLateArrival(
  booking: CalendarBooking,
  now: Date,
  nextBookingStartTime?: Date | null
): LateEvaluationResult {
  if (booking.status !== "scheduled") {
    return { action: "none" };
  }

  const nowMs = now.getTime();
  const startMs = new Date(booking.start_time).getTime();
  const endMs = new Date(booking.end_time).getTime();

  if (nowMs < startMs) {
    return { action: "none" };
  }

  const bufferMins = booking.buffer_minutes ?? MANDATORY_BUFFER_MINUTES;
  const requiredFinishMs =
    nowMs + (booking.duration_minutes + bufferMins) * 60 * 1000;

  if (nextBookingStartTime) {
    const nextStartMs = nextBookingStartTime.getTime();
    if (requiredFinishMs > nextStartMs) {
      return {
        action: "cancel_overlap",
        reason: `Starting now would require finishing at ${new Date(
          requiredFinishMs
        ).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}, colliding with the next reservation at ${nextBookingStartTime.toLocaleTimeString(
          [],
          { hour: "2-digit", minute: "2-digit" }
        )}.`,
      };
    }
  }

  // Also check if now >= original end_time
  if (nowMs >= endMs) {
    return {
      action: "cancel_expired",
      reason: "Reservation window elapsed without starting the print.",
    };
  }

  // If no subsequent booking (or not colliding yet), check grace period reminder
  const graceMins =
    getAdminSettings().bookingLimits.lateArrivalGraceMinutes ?? 15;
  const graceAfterStart = startMs + graceMins * 60 * 1000;
  if (!nextBookingStartTime && nowMs >= graceAfterStart && !booking.late_warned) {
    return {
      action: "warn_15m",
      reason: `${graceMins} minutes past scheduled start time with no subsequent booking; sending reminder warning.`,
    };
  }

  return { action: "none" };
}

export interface DayBookingSegment {
  booking: CalendarBooking;
  segmentStart: Date;
  segmentEnd: Date;
  startMinsFromMidnight: number;
  segmentDurationMins: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/**
 * Splits bookings that cross midnight into clamped per-day segments `[00:00, 24:00]`
 * so overnight prints never overflow the bottom of a day column and properly render
 * their continuation block at 00:00 on the next day column.
 */
export function getDayBookingSegments(
  day: Date,
  bookings: CalendarBooking[],
  visibleStatuses: string[] = ["scheduled", "in_progress", "completed"]
): DayBookingSegment[] {
  const dayStart = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    0,
    0,
    0,
    0
  );
  const dayEnd = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate() + 1,
    0,
    0,
    0,
    0
  );
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayEnd.getTime();

  const segments: DayBookingSegment[] = [];

  for (const b of bookings) {
    if (!visibleStatuses.includes(b.status)) continue;

    const bStart = new Date(b.start_time);
    const bEnd = new Date(b.end_time);
    const bStartMs = bStart.getTime();
    const bEndMs = bEnd.getTime();

    // Check if booking [bStart, bEnd) overlaps [dayStart, dayEnd)
    if (bStartMs < dayEndMs && bEndMs > dayStartMs) {
      const clampedStartMs = Math.max(bStartMs, dayStartMs);
      const clampedEndMs = Math.min(bEndMs, dayEndMs);

      const startMinsFromMidnight = Math.max(
        0,
        Math.min(1440, (clampedStartMs - dayStartMs) / (60 * 1000))
      );
      const segmentDurationMins = Math.max(
        5,
        Math.min(
          1440 - startMinsFromMidnight,
          (clampedEndMs - clampedStartMs) / (60 * 1000)
        )
      );

      segments.push({
        booking: b,
        segmentStart: new Date(clampedStartMs),
        segmentEnd: new Date(clampedEndMs),
        startMinsFromMidnight,
        segmentDurationMins,
        continuesBefore: bStartMs < dayStartMs,
        continuesAfter: bEndMs > dayEndMs,
      });
    }
  }

  return segments;
}
