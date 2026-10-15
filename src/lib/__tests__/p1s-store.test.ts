import { describe, it, expect, beforeEach } from "vitest";
import {
  getP1sBookings,
  createP1sBooking,
  editP1sBooking,
  cancelP1sBooking,
  clearP1sBookings,
  subscribeToP1sBookings,
  P1S_STORAGE_KEY,
  p1sBookingListeners,
} from "../p1s-store";
import { UserProfile } from "../types";

const mockAdmin: UserProfile = {
  id: "user-admin-p1s",
  microsoft_oid: "oid-admin",
  email: "anmolp5@illinois.edu",
  full_name: "Anmol Prabhakar",
  role: "admin",
  created_at: new Date().toISOString(),
};

const mockStudent: UserProfile = {
  id: "user-student-p1s",
  microsoft_oid: "oid-student",
  email: "student@illinois.edu",
  full_name: "Student Tester",
  role: "user",
  created_at: new Date().toISOString(),
};

describe("P1S Real-Hardware Sandbox Store", () => {
  beforeEach(() => {
    localStorage.clear();
    clearP1sBookings();
  });

  it("strictly persists to bambu_p1s_sandbox_bookings and leaves X1C store untouched", async () => {
    // Setup dummy X1C production data
    localStorage.setItem("bambu_x1c_bookings_v1", JSON.stringify([{ id: "x1c-prod-1" }]));

    expect(getP1sBookings()).toEqual([]);

    const startTime = new Date("2026-10-15T14:00:00.000Z");
    const result = await createP1sBooking({
      user: mockStudent,
      file_name: "p1s_test_bracket.3mf",
      duration_minutes: 60,
      start_time: startTime,
    });

    expect(result.data).toBeDefined();
    expect(result.data?.file_name).toBe("p1s_test_bracket.3mf");

    // Check P1S key
    const rawP1s = localStorage.getItem(P1S_STORAGE_KEY);
    expect(rawP1s).toBeDefined();
    const parsedP1s = JSON.parse(rawP1s!);
    expect(parsedP1s.length).toBe(1);
    expect(parsedP1s[0].file_name).toBe("p1s_test_bracket.3mf");

    // Verify production X1C store remains completely untouched!
    const rawX1c = localStorage.getItem("bambu_x1c_bookings_v1");
    expect(rawX1c).toBe(JSON.stringify([{ id: "x1c-prod-1" }]));
  });

  it("enforces 5-minute increment boundaries (:00, :05, :10, :15...)", async () => {
    const invalidTime = new Date("2026-10-15T14:03:00.000Z"); // Not a multiple of 5
    const res = await createP1sBooking({
      user: mockStudent,
      file_name: "test.3mf",
      duration_minutes: 30,
      start_time: invalidTime,
    });

    expect(res.error).toContain("5-minute increment");
    expect(res.code).toBe("22023");
  });

  it("detects and prevents overlapping P1S reservations (GiST 23P01 simulation)", async () => {
    const slot1Start = new Date("2026-10-15T10:00:00.000Z");
    const firstRes = await createP1sBooking({
      user: mockAdmin,
      file_name: "first_job.3mf",
      duration_minutes: 60, // 10:00 -> 11:10 (incl 10m buffer)
      start_time: slot1Start,
    });
    expect(firstRes.data).toBeDefined();

    // Attempt overlapping reservation starting at 10:30
    const overlappingStart = new Date("2026-10-15T10:30:00.000Z");
    const secondRes = await createP1sBooking({
      user: mockStudent,
      file_name: "conflicting_job.3mf",
      duration_minutes: 30,
      start_time: overlappingStart,
    });

    expect(secondRes.error).toContain("overlaps with");
    expect(secondRes.code).toBe("23P01");
    expect(getP1sBookings().length).toBe(1);
  });

  it("notifies listeners on reactive subscription", async () => {
    let notifiedCount = 0;
    let latestList: any[] = [];

    const unsubscribe = subscribeToP1sBookings((bookings) => {
      notifiedCount++;
      latestList = bookings;
    });

    const startTime = new Date("2026-10-15T12:00:00.000Z");
    await createP1sBooking({
      user: mockStudent,
      file_name: "reactive_test.3mf",
      duration_minutes: 45,
      start_time: startTime,
    });

    expect(notifiedCount).toBeGreaterThan(0);
    expect(latestList.length).toBe(1);
    expect(latestList[0].file_name).toBe("reactive_test.3mf");

    unsubscribe();
  });

  it("edits an existing reservation with collision checking", async () => {
    const startTime = new Date("2026-10-15T09:00:00.000Z");
    const created = await createP1sBooking({
      user: mockAdmin,
      file_name: "edit_me.3mf",
      duration_minutes: 60,
      start_time: startTime,
    });

    const bookingId = created.data!.id;
    const newStartTime = new Date("2026-10-15T09:30:00.000Z");

    const editRes = await editP1sBooking({
      bookingId,
      adminUser: mockAdmin,
      newStartTime,
      newDurationMinutes: 90,
      newStatus: "scheduled",
    });

    expect(editRes.data).toBeDefined();
    expect(editRes.data?.duration_minutes).toBe(90);
    expect(new Date(editRes.data!.start_time).toISOString()).toBe(newStartTime.toISOString());
  });

  it("cancels a P1S booking correctly", async () => {
    const startTime = new Date("2026-10-15T08:00:00.000Z");
    const created = await createP1sBooking({
      user: mockStudent,
      file_name: "cancel_me.3mf",
      duration_minutes: 30,
      start_time: startTime,
    });

    const bookingId = created.data!.id;
    const cancelRes = await cancelP1sBooking(bookingId, mockAdmin);

    expect(cancelRes.data).toBeDefined();
    expect(cancelRes.data?.status).toBe("canceled_admin");
  });

  it("clears all P1S bookings when clearP1sBookings is called", async () => {
    const startTime = new Date("2026-10-15T15:00:00.000Z");
    await createP1sBooking({
      user: mockStudent,
      file_name: "clear_me.3mf",
      duration_minutes: 30,
      start_time: startTime,
    });

    expect(getP1sBookings().length).toBe(1);
    clearP1sBookings();
    expect(getP1sBookings()).toEqual([]);
  });
});
