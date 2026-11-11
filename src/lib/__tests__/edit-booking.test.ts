import { describe, it, expect, beforeEach } from "vitest";
import { editBooking, getLocalBookings, resetDemoData } from "../store";
import { CalendarBooking, UserProfile } from "../types";

describe("editBooking logic & conflict detection", () => {
  const studentUser: UserProfile = {
    id: "user-student-1",
    microsoft_oid: "oid-student-1",
    email: "student1@illinois.edu",
    full_name: "Student One",
    role: "user",
    created_at: new Date().toISOString(),
  };

  const otherStudent: UserProfile = {
    id: "user-student-2",
    microsoft_oid: "oid-student-2",
    email: "student2@illinois.edu",
    full_name: "Student Two",
    role: "user",
    created_at: new Date().toISOString(),
  };

  const adminUser: UserProfile = {
    id: "user-admin-1",
    microsoft_oid: "oid-admin-1",
    email: "anmolp5@illinois.edu",
    full_name: "Admin User",
    role: "admin",
    created_at: new Date().toISOString(),
  };

  beforeEach(() => {
    if (typeof window !== "undefined") {
      window.localStorage.clear();
    }
    resetDemoData();
  });

  const baseBooking: CalendarBooking = {
    id: "booking-edit-1",
    user_id: "user-student-1",
    user_email: "student1@illinois.edu",
    file_name: "orig_part.gcode",
    duration_minutes: 60,
    buffer_minutes: 10,
    start_time: "2026-10-20T10:00:00.000Z",
    end_time: "2026-10-20T11:10:00.000Z",
    status: "scheduled",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const secondBooking: CalendarBooking = {
    id: "booking-edit-2",
    user_id: "user-student-2",
    user_email: "student2@illinois.edu",
    file_name: "robot_arm.gcode",
    duration_minutes: 60,
    buffer_minutes: 10,
    start_time: "2026-10-20T14:00:00.000Z",
    end_time: "2026-10-20T15:10:00.000Z",
    status: "scheduled",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  it("fails if booking does not exist", async () => {
    const res = await editBooking({
      bookingId: "nonexistent",
      user: studentUser,
      file_name: "new.gcode",
      start_time: new Date("2026-10-20T10:00:00.000Z"),
      duration_minutes: 45,
    });
    expect(res.error).toBe("Booking not found.");
  });

  it("checks ownership: rejects other non-admin users", async () => {
    window.localStorage.setItem(
      "bambu_x1c_bookings_v1",
      JSON.stringify([baseBooking])
    );

    const res = await editBooking({
      bookingId: baseBooking.id,
      user: otherStudent,
      file_name: "hacked.gcode",
      start_time: new Date("2026-10-20T10:00:00.000Z"),
      duration_minutes: 45,
    });
    expect(res.error).toContain("Unauthorized");
  });

  it("allows admins to edit a student's booking", async () => {
    window.localStorage.setItem(
      "bambu_x1c_bookings_v1",
      JSON.stringify([baseBooking])
    );

    const res = await editBooking({
      bookingId: baseBooking.id,
      user: adminUser,
      file_name: "admin_fixed.gcode",
      start_time: new Date("2026-10-20T10:00:00.000Z"),
      duration_minutes: 45,
    });
    expect(res.error).toBeUndefined();
    expect(res.data?.file_name).toBe("admin_fixed.gcode");
  });

  it("strictly rejects students from editing once booking has started (status !== scheduled)", async () => {
    const inProgressBooking: CalendarBooking = {
      ...baseBooking,
      status: "in_progress",
    };
    window.localStorage.setItem(
      "bambu_x1c_bookings_v1",
      JSON.stringify([inProgressBooking])
    );

    const res = await editBooking({
      bookingId: inProgressBooking.id,
      user: studentUser,
      file_name: "should_fail.gcode",
      start_time: new Date("2026-10-20T10:00:00.000Z"),
      duration_minutes: 45,
    });
    expect(res.error).toBe(
      "This reservation has already started and cannot be edited."
    );
  });

  it("allows admins to edit an in-progress reservation and preserves actual_started_at", async () => {
    const actualStartedAt = "2026-10-20T10:02:15.000Z";
    const inProgressBooking: CalendarBooking = {
      ...baseBooking,
      status: "in_progress",
      actual_started_at: actualStartedAt,
    };
    window.localStorage.setItem(
      "bambu_x1c_bookings_v1",
      JSON.stringify([inProgressBooking])
    );

    const res = await editBooking({
      bookingId: inProgressBooking.id,
      user: adminUser,
      file_name: "admin_extended.gcode",
      start_time: new Date("2026-10-20T10:00:00.000Z"),
      duration_minutes: 90,
    });

    expect(res.error).toBeUndefined();
    expect(res.data?.status).toBe("in_progress");
    expect(res.data?.file_name).toBe("admin_extended.gcode");
    expect(res.data?.duration_minutes).toBe(90);
    expect(res.data?.actual_started_at).toBe(actualStartedAt);
    expect(res.data?.end_time).toBe("2026-10-20T11:40:00.000Z");

    const localAfter = getLocalBookings();
    const saved = localAfter.find((b) => b.id === inProgressBooking.id);
    expect(saved?.actual_started_at).toBe(actualStartedAt);
    expect(saved?.file_name).toBe("admin_extended.gcode");
  });

  it("detects collisions when admin extends in-progress booking into the next reservation", async () => {
    const inProgressBooking: CalendarBooking = {
      ...baseBooking,
      status: "in_progress",
      start_time: "2026-10-20T12:00:00.000Z",
      end_time: "2026-10-20T13:10:00.000Z",
      duration_minutes: 60,
    };
    window.localStorage.setItem(
      "bambu_x1c_bookings_v1",
      JSON.stringify([inProgressBooking, secondBooking])
    );

    // Admin tries to extend duration to 150 min (12:00 -> 14:30 + 10m buffer = 14:40), overlapping secondBooking at 14:00
    const res = await editBooking({
      bookingId: inProgressBooking.id,
      user: adminUser,
      file_name: "in_progress_long.gcode",
      start_time: new Date("2026-10-20T12:00:00.000Z"),
      duration_minutes: 150,
    });

    expect(res.error).toBe(
      `Conflicts with existing booking "${secondBooking.file_name}" (${secondBooking.user_email}).`
    );
  });

  it("validates empty file_name and duration ranges", async () => {
    window.localStorage.setItem(
      "bambu_x1c_bookings_v1",
      JSON.stringify([baseBooking])
    );

    const resEmptyFile = await editBooking({
      bookingId: baseBooking.id,
      user: studentUser,
      file_name: "   ",
      start_time: new Date("2026-10-20T10:00:00.000Z"),
      duration_minutes: 45,
    });
    expect(resEmptyFile.error).toBe("File name cannot be empty.");

    const resZeroDuration = await editBooking({
      bookingId: baseBooking.id,
      user: studentUser,
      file_name: "valid.gcode",
      start_time: new Date("2026-10-20T10:00:00.000Z"),
      duration_minutes: 0,
    });
    expect(resZeroDuration.error).toBe(
      "Duration must be between 1 and 720 minutes."
    );

    const resTooLongDuration = await editBooking({
      bookingId: baseBooking.id,
      user: studentUser,
      file_name: "valid.gcode",
      start_time: new Date("2026-10-20T10:00:00.000Z"),
      duration_minutes: 800,
    });
    expect(resTooLongDuration.error).toBe(
      "Duration must be between 1 and 720 minutes."
    );
  });

  it("detects collisions with other bookings and returns proper error string", async () => {
    window.localStorage.setItem(
      "bambu_x1c_bookings_v1",
      JSON.stringify([baseBooking, secondBooking])
    );

    // Try shifting booking 1 to 14:15, overlapping secondBooking (14:00-15:10)
    const res = await editBooking({
      bookingId: baseBooking.id,
      user: studentUser,
      file_name: "colliding_shift.gcode",
      start_time: new Date("2026-10-20T14:15:00.000Z"),
      duration_minutes: 30,
    });

    expect(res.error).toBe(
      `Conflicts with existing booking "${secondBooking.file_name}" (${secondBooking.user_email}).`
    );
  });

  it("does not consider the booking itself as a collision", async () => {
    window.localStorage.setItem(
      "bambu_x1c_bookings_v1",
      JSON.stringify([baseBooking])
    );

    // Changing duration or shifting 10 mins within same window
    const res = await editBooking({
      bookingId: baseBooking.id,
      user: studentUser,
      file_name: "orig_part_v2.gcode",
      start_time: new Date("2026-10-20T10:00:00.000Z"),
      duration_minutes: 75,
    });

    expect(res.error).toBeUndefined();
    expect(res.data?.duration_minutes).toBe(75);
    expect(res.data?.file_name).toBe("orig_part_v2.gcode");
  });

  it("persists edited in-progress booking and triggers cloud push", async () => {
    let pushedData: any = null;
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/bookings") && init?.method === "POST") {
        pushedData = JSON.parse(init.body as string);
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const inProgressBooking: CalendarBooking = {
      ...baseBooking,
      status: "in_progress",
      actual_started_at: "2026-10-20T10:05:00.000Z",
    };
    window.localStorage.setItem(
      "bambu_x1c_bookings_v1",
      JSON.stringify([inProgressBooking])
    );

    const res = await editBooking({
      bookingId: inProgressBooking.id,
      user: adminUser,
      file_name: "synced_cloud_part.gcode",
      start_time: new Date("2026-10-20T10:00:00.000Z"),
      duration_minutes: 80,
    });

    expect(res.error).toBeUndefined();
    expect(res.data?.file_name).toBe("synced_cloud_part.gcode");
    expect(res.data?.status).toBe("in_progress");
    expect(res.data?.actual_started_at).toBe("2026-10-20T10:05:00.000Z");

    expect(pushedData).toBeDefined();
    expect(Array.isArray(pushedData.bookings)).toBe(true);
    const cloudBooking = pushedData.bookings.find(
      (b: CalendarBooking) => b.id === inProgressBooking.id
    );
    expect(cloudBooking).toBeDefined();
    expect(cloudBooking.file_name).toBe("synced_cloud_part.gcode");
    expect(cloudBooking.duration_minutes).toBe(80);
    expect(cloudBooking.status).toBe("in_progress");
    expect(cloudBooking.actual_started_at).toBe("2026-10-20T10:05:00.000Z");

    globalThis.fetch = originalFetch;
  });
});

