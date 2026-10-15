import { describe, it, expect, beforeEach } from "vitest";
import { editBooking, getLocalBookings, resetDemoData } from "../store";
import { CalendarBooking, UserProfile } from "../types";

describe("editBooking logic & conflict detection", () => {
  const studentUser: UserProfile = {
    id: "user-student-1",
    email: "student1@illinois.edu",
    full_name: "Student One",
    role: "student",
  };

  const otherStudent: UserProfile = {
    id: "user-student-2",
    email: "student2@illinois.edu",
    full_name: "Student Two",
    role: "student",
  };

  const adminUser: UserProfile = {
    id: "user-admin-1",
    email: "anmolp5@illinois.edu",
    full_name: "Admin User",
    role: "admin",
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

  it("strictly rejects editing once booking has started (status !== scheduled)", async () => {
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
});
