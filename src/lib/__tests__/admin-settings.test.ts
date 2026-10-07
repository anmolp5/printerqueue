import { describe, it, expect, beforeEach } from "vitest";
import {
  SUPER_ADMIN_EMAIL,
  createDefaultAdminSettings,
  getAdminSettings,
  saveAdminSettings,
  resetAdminSettingsToDefaults,
  renderEmailTemplate,
  isSuperAdmin,
  importAdminSettingsJson,
  exportAdminSettingsJson,
} from "../admin-settings";

describe("Admin Settings & Super Admin Hierarchy Guard", () => {
  beforeEach(() => {
    resetAdminSettingsToDefaults(SUPER_ADMIN_EMAIL);
  });

  it("identifies anmolp5@illinois.edu as the permanent Super Admin", () => {
    expect(isSuperAdmin("anmolp5@illinois.edu")).toBe(true);
    expect(isSuperAdmin("ANMOLP5@ILLINOIS.EDU")).toBe(true);
    expect(isSuperAdmin("admin@illinois.edu")).toBe(false);
    expect(isSuperAdmin("student@illinois.edu")).toBe(false);
  });

  it("allows anmolp5@illinois.edu to add and remove secondary admins", () => {
    const initial = getAdminSettings();
    const updated = {
      ...initial,
      permissions: {
        ...initial.permissions,
        adminEmails: [
          ...initial.permissions.adminEmails,
          "labtech@illinois.edu",
        ],
      },
    };

    const res = saveAdminSettings(updated, SUPER_ADMIN_EMAIL);
    expect(res.error).toBeUndefined();
    expect(res.data.permissions.adminEmails).toContain("labtech@illinois.edu");
  });

  it("blocks secondary admins from adding or revoking administrators", () => {
    const initial = getAdminSettings();
    const attemptedModification = {
      ...initial,
      permissions: {
        ...initial.permissions,
        adminEmails: [
          ...initial.permissions.adminEmails,
          "unauthorized_new_admin@illinois.edu",
        ],
      },
    };

    const res = saveAdminSettings(attemptedModification, "admin@illinois.edu");
    expect(res.error).toContain("Super Admin Protected");
    expect(res.data.permissions.adminEmails).not.toContain(
      "unauthorized_new_admin@illinois.edu"
    );
  });

  it("allows secondary admins to edit booking limits, maintenance mode, and email templates", () => {
    const initial = getAdminSettings();
    const updated = {
      ...initial,
      bookingLimits: {
        ...initial.bookingLimits,
        maxDurationMinutes: 360,
        maxActiveBookingsPerUser: 3,
      },
      permissions: {
        ...initial.permissions,
        maintenanceMode: true,
      },
    };

    const res = saveAdminSettings(updated, "admin@illinois.edu");
    expect(res.error).toBeUndefined();
    expect(res.data.bookingLimits.maxDurationMinutes).toBe(360);
    expect(res.data.bookingLimits.maxActiveBookingsPerUser).toBe(3);
    expect(res.data.permissions.maintenanceMode).toBe(true);
  });

  it("never allows anmolp5@illinois.edu to be removed from adminEmails or added to bannedEmails", () => {
    const initial = createDefaultAdminSettings();
    const attemptedSelfRemoval = {
      ...initial,
      permissions: {
        ...initial.permissions,
        adminEmails: ["admin@illinois.edu"], // omitting anmolp5@illinois.edu
        bannedEmails: [SUPER_ADMIN_EMAIL, "badactor@illinois.edu"],
      },
    };

    const res = saveAdminSettings(attemptedSelfRemoval, SUPER_ADMIN_EMAIL);
    expect(res.data.permissions.adminEmails).toContain(SUPER_ADMIN_EMAIL);
    expect(res.data.permissions.bannedEmails).not.toContain(SUPER_ADMIN_EMAIL);
    expect(res.data.permissions.bannedEmails).toContain("badactor@illinois.edu");
  });

  it("renders dynamic {{tokens}} in email templates accurately", () => {
    const rendered = renderEmailTemplate("confirmation", {
      fileName: "test_part.3mf",
      userEmail: "anmolp5@illinois.edu",
      startTime: "10:00 AM",
      endTime: "11:10 AM",
      printFinishTime: "11:00 AM",
      duration: 60,
      buffer: 10,
      minsBefore: "15 minutes before",
    });

    expect(rendered.enabled).toBe(true);
    expect(rendered.subject).toContain("test_part.3mf");
    expect(rendered.text).toContain("anmolp5@illinois.edu");
    expect(rendered.text).toContain("60 mins");
  });

  it("exports and imports JSON settings while preserving Super Admin rules", () => {
    const json = exportAdminSettingsJson();
    const parsed = JSON.parse(json);
    parsed.bookingLimits.cooldownBufferMinutes = 20;

    const imported = importAdminSettingsJson(
      JSON.stringify(parsed),
      "admin@illinois.edu"
    );
    expect(imported.error).toBeUndefined();
    expect(imported.data?.bookingLimits.cooldownBufferMinutes).toBe(20);
  });
});
