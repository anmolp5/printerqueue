import { describe, it, expect } from "vitest";
import {
  isValid15MinSlot,
  snapTo15MinSlot,
  calculateTotalBlockMinutes,
  calculateEndTime,
  calculateGridRowIndex,
  calculateGridSpanRows,
  doTimeRangesOverlap,
  findOverlappingBooking,
  evaluateLateArrival,
  getDayBookingSegments,
} from "../scheduling";
import { isValidUiucEmail } from "../auth-config";
import { CalendarBooking } from "../types";

describe("UIUC Domain Guard", () => {
  it("accepts valid @illinois.edu addresses", () => {
    expect(isValidUiucEmail("anmolp5@illinois.edu")).toBe(true);
    expect(isValidUiucEmail("ADMIN@ILLINOIS.EDU")).toBe(true);
  });

  it("rejects non-illinois.edu addresses", () => {
    expect(isValidUiucEmail("user@gmail.com")).toBe(false);
    expect(isValidUiucEmail("student@uic.edu")).toBe(false);
    expect(isValidUiucEmail("")).toBe(false);
  });
});

describe("15-Minute Slot & 10-Minute Buffer Math", () => {
  it("validates 15-minute slot boundaries (:00, :15, :30, :45)", () => {
    expect(isValid15MinSlot(new Date("2026-10-05T10:00:00.000Z"))).toBe(true);
    expect(isValid15MinSlot(new Date("2026-10-05T10:15:00.000Z"))).toBe(true);
    expect(isValid15MinSlot(new Date("2026-10-05T10:30:00.000Z"))).toBe(true);
    expect(isValid15MinSlot(new Date("2026-10-05T10:45:00.000Z"))).toBe(true);
    expect(isValid15MinSlot(new Date("2026-10-05T10:10:00.000Z"))).toBe(false);
  });

  it("snaps arbitrary times to 15-minute increments", () => {
    const raw = new Date("2026-10-05T10:07:22.000Z");
    expect(snapTo15MinSlot(raw, false).toISOString()).toBe(
      "2026-10-05T10:00:00.000Z"
    );
    expect(snapTo15MinSlot(raw, true).toISOString()).toBe(
      "2026-10-05T10:15:00.000Z"
    );
  });

  it("appends mandatory 10-minute buffer to print duration", () => {
    const start = new Date("2026-10-05T12:00:00.000Z");
    expect(calculateTotalBlockMinutes(45)).toBe(55);
    expect(calculateEndTime(start, 45).toISOString()).toBe(
      "2026-10-05T12:55:00.000Z"
    );
  });

  it("maps time and duration to 96-row grid coordinates", () => {
    const d = new Date(2026, 9, 5, 2, 30, 0); // 02:30 local
    expect(calculateGridRowIndex(d)).toBe(2 * 4 + 2); // row 10
    expect(calculateGridSpanRows(45, 10)).toBe(Math.ceil(55 / 15)); // 4 rows
  });
});

describe("GiST Range Exclusion Overlap Logic", () => {
  const sampleBooking: CalendarBooking = {
    id: "b-1",
    user_id: "u-1",
    user_email: "student@illinois.edu",
    file_name: "benchy.3mf",
    duration_minutes: 50,
    buffer_minutes: 10,
    start_time: "2026-10-05T10:00:00.000Z",
    end_time: "2026-10-05T11:00:00.000Z", // 50m + 10m = 60m
    status: "scheduled",
  };

  it("detects overlapping intervals and allows adjacent [) intervals", () => {
    const bStart = new Date(sampleBooking.start_time);
    const bEnd = new Date(sampleBooking.end_time);

    // Collides inside buffer (10:45 - 11:30)
    expect(
      doTimeRangesOverlap(
        new Date("2026-10-05T10:45:00.000Z"),
        new Date("2026-10-05T11:30:00.000Z"),
        bStart,
        bEnd
      )
    ).toBe(true);

    // Starts exactly when previous ends (11:00 - 12:00) -> no overlap in [) range
    expect(
      doTimeRangesOverlap(
        new Date("2026-10-05T11:00:00.000Z"),
        new Date("2026-10-05T12:00:00.000Z"),
        bStart,
        bEnd
      )
    ).toBe(false);

    expect(
      findOverlappingBooking(
        new Date("2026-10-05T10:30:00.000Z"),
        new Date("2026-10-05T11:15:00.000Z"),
        [sampleBooking]
      )?.id
    ).toBe("b-1");
  });
});

describe("Late-Arrival Auto-Cancellation Rules", () => {
  const booking: CalendarBooking = {
    id: "b-late",
    user_id: "u-1",
    user_email: "late@illinois.edu",
    file_name: "gear.3mf",
    duration_minutes: 60,
    buffer_minutes: 10,
    start_time: "2026-10-05T10:00:00.000Z",
    end_time: "2026-10-05T11:10:00.000Z",
    status: "scheduled",
  };

  it("auto-cancels when remaining time before next booking is less than duration + 10m buffer", () => {
    const nextStart = new Date("2026-10-05T11:15:00.000Z");
    // At 10:10, requiredFinish = 10:10 + 70m = 11:20 > 11:15 -> cancel_overlap!
    const now = new Date("2026-10-05T10:10:00.000Z");
    const result = evaluateLateArrival(booking, now, nextStart);
    expect(result.action).toBe("cancel_overlap");
  });

  it("sends 15-minute warning if no subsequent booking exists, and cancels at end_time", () => {
    // 16 minutes late with no next booking
    const warnTime = new Date("2026-10-05T10:16:00.000Z");
    expect(evaluateLateArrival(booking, warnTime, null).action).toBe("warn_15m");

    // Past original end_time with no next booking
    const expiredTime = new Date("2026-10-05T11:11:00.000Z");
    expect(evaluateLateArrival(booking, expiredTime, null).action).toBe(
      "cancel_expired"
    );
  });
});

describe("Overnight Multi-Day Print Splitting", () => {
  it("splits a print crossing midnight into clamped segments for Day 1 and Day 2", () => {
    const day1 = new Date(2026, 9, 5, 0, 0, 0); // Oct 5 local
    const day2 = new Date(2026, 9, 6, 0, 0, 0); // Oct 6 local

    // Starts Oct 5 at 22:00 (10:00 PM), runs 240m + 10m buffer = 250m -> ends Oct 6 at 02:10 AM
    const start = new Date(2026, 9, 5, 22, 0, 0);
    const end = new Date(2026, 9, 6, 2, 10, 0);

    const overnightBooking: CalendarBooking = {
      id: "b-overnight",
      user_id: "u-1",
      user_email: "anmolp5@illinois.edu",
      file_name: "overnight_chassis.3mf",
      duration_minutes: 240,
      buffer_minutes: 10,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      status: "scheduled",
    };

    const segsDay1 = getDayBookingSegments(day1, [overnightBooking]);
    expect(segsDay1).toHaveLength(1);
    expect(segsDay1[0].startMinsFromMidnight).toBe(22 * 60); // 1320
    expect(segsDay1[0].segmentDurationMins).toBe(120); // clamped to 22:00 -> 24:00 (120 mins)
    expect(segsDay1[0].continuesBefore).toBe(false);
    expect(segsDay1[0].continuesAfter).toBe(true);

    const segsDay2 = getDayBookingSegments(day2, [overnightBooking]);
    expect(segsDay2).toHaveLength(1);
    expect(segsDay2[0].startMinsFromMidnight).toBe(0); // starts at 00:00
    expect(segsDay2[0].segmentDurationMins).toBe(130); // 00:00 -> 02:10 (130 mins)
    expect(segsDay2[0].continuesBefore).toBe(true);
    expect(segsDay2[0].continuesAfter).toBe(false);
  });
});
