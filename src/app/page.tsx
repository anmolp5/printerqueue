"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  startOfWeek,
  addDays,
  format,
} from "date-fns";
import {
  Printer,
  ChevronLeft,
  ChevronRight,
  Plus,
  Shield,
  ShieldAlert,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  LogOut,
  LogIn,
  ListFilter,
  Sliders,
  Wrench,
} from "lucide-react";
import { WeeklyCalendar } from "@/components/WeeklyCalendar";
import { BookingModal } from "@/components/BookingModal";
import { ActiveBookingControls } from "@/components/ActiveBookingControls";
import { AdminBookingModal } from "@/components/AdminBookingModal";
import { DevAuthBanner } from "@/components/DevAuthBanner";
import { LoginScreen } from "@/components/LoginScreen";
import { useUserSession } from "@/hooks/useUserSession";
import {
  fetchBookings,
  subscribeToBookings,
  createBooking,
  startPrintJob,
  completeAndClearBed,
  cancelUserBooking,
  adminOverrideBooking,
  runAutoCancelLateCheck,
  triggerBookingReminderEmail,
  checkAndDispatchScheduledReminders,
  resetDemoData,
} from "@/lib/store";
import {
  getAdminSettings,
  subscribeToAdminSettings,
} from "@/lib/admin-settings";
import { snapTo15MinSlot } from "@/lib/scheduling";
import { AdminSettings, BookingStatus, CalendarBooking } from "@/lib/types";

export default function HomePage() {
  const {
    user,
    isAdmin,
    canToggleAdminRole,
    domainError,
    clearDomainError,
    switchDevPersona,
    toggleCurrentUserRole,
    signInWithCustomProfile,
    testExternalDomainRejection,
    signInWithMicrosoft,
    connectOutlookMailSend,
    signOut,
  } = useUserSession();

  const [bookings, setBookings] = useState<CalendarBooking[]>([]);
  const [adminSettings, setAdminSettings] = useState<AdminSettings>(() =>
    getAdminSettings()
  );
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  const [showCompleted, setShowCompleted] = useState<boolean>(true);

  // Modal states
  const [selectedSlotTime, setSelectedSlotTime] = useState<Date | null>(null);
  const [isBookingModalOpen, setIsBookingModalOpen] = useState<boolean>(false);
  const [adminSelectedBooking, setAdminSelectedBooking] =
    useState<CalendarBooking | null>(null);

  // Load initial bookings & subscribe to updates
  useEffect(() => {
    fetchBookings().then(setBookings);
    const unsubBookings = subscribeToBookings((updated) => {
      setBookings(updated);
    });
    setAdminSettings(getAdminSettings());
    const unsubSettings = subscribeToAdminSettings((updated) => {
      setAdminSettings(updated);
    });
    return () => {
      unsubBookings();
      unsubSettings();
    };
  }, []);

  // Periodic 5-minute late-arrival check + 15-second pre-booking reminder & slot-start check
  useEffect(() => {
    checkAndDispatchScheduledReminders();
    const reminderInterval = setInterval(() => {
      checkAndDispatchScheduledReminders();
    }, 15 * 1000);

    const lateInterval = setInterval(() => {
      runAutoCancelLateCheck();
    }, 5 * 60 * 1000);

    return () => {
      clearInterval(reminderInterval);
      clearInterval(lateInterval);
    };
  }, []);

  const handleSelectSlot = useCallback(
    (slotTime: Date) => {
      if (!user) {
        signInWithMicrosoft();
        return;
      }
      setSelectedSlotTime(slotTime);
      setIsBookingModalOpen(true);
    },
    [user, signInWithMicrosoft]
  );

  const handleSubmitBooking = async (params: {
    file_name: string;
    duration_minutes: number;
    start_time: Date;
    reminder_minutes_before?: number | null;
  }) => {
    if (!user) return { error: "Please sign in with your @illinois.edu account." };
    const res = await createBooking({
      user,
      file_name: params.file_name,
      duration_minutes: params.duration_minutes,
      start_time: params.start_time,
      reminder_minutes_before: params.reminder_minutes_before,
    });
    return { error: res.error, code: res.code };
  };

  const handleTriggerBookingEmail = async (
    bookingId: string,
    mode: "pre_booking_reminder" | "slot_starting"
  ) => {
    await triggerBookingReminderEmail(bookingId, mode);
  };

  const handleStartPrint = async (bookingId: string) => {
    if (!user) return;
    await startPrintJob(bookingId, user);
  };

  const handleCompleteBed = async (bookingId: string) => {
    if (!user) return {};
    const res = await completeAndClearBed(bookingId, user);
    return {
      nextBookingNotified: res.nextBookingNotified,
      magicLinkUrl: res.magicLinkUrl,
    };
  };

  const handleCancelBooking = async (bookingId: string) => {
    if (!user) return;
    await cancelUserBooking(bookingId, user);
  };

  const handleAdminOverride = async (params: {
    bookingId: string;
    newStartTime: Date;
    newDurationMinutes: number;
    newStatus: BookingStatus;
    sendNotification: boolean;
    reason?: string;
  }) => {
    if (!user) return { error: "Not authenticated" };
    const res = await adminOverrideBooking({
      bookingId: params.bookingId,
      adminUser: user,
      newStartTime: params.newStartTime,
      newDurationMinutes: params.newDurationMinutes,
      newStatus: params.newStatus,
      sendNotification: params.sendNotification,
      reason: params.reason,
    });
    return { error: res.error };
  };

  const activeJobNow = bookings.find((b) => b.status === "in_progress");
  const scheduledCount = bookings.filter((b) => b.status === "scheduled").length;
  const weekEnd = addDays(currentWeekStart, 6);

  if (!user) {
    return (
      <LoginScreen
        onSuccessLogin={signInWithCustomProfile}
        onMicrosoftRedirect={signInWithMicrosoft}
        domainError={domainError}
        onClearError={clearDomainError}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {/* Top Navigation Header */}
      <header className="bg-[#13294B] text-white border-b border-slate-800 shadow-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          {/* Brand & Live Printer Status */}
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-[#FF5F05] flex items-center justify-center shadow-inner">
              <Printer className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-base sm:text-lg font-bold tracking-tight">
                  {adminSettings.labProfile.printerName ||
                    "Bambu Lab X1C Queue & Booking Portal"}
                </h1>
                <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-white/10 text-orange-300 border border-white/15">
                  UIUC @illinois.edu
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-300 mt-0.5">
                {adminSettings.permissions.maintenanceMode ? (
                  <span className="inline-flex items-center gap-1.5 text-amber-300 font-medium">
                    <Wrench className="w-3.5 h-3.5 text-amber-400" />
                    Maintenance Mode Active — New student bookings paused
                  </span>
                ) : activeJobNow ? (
                  <span className="inline-flex items-center gap-1.5 text-amber-300 font-medium">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                    Printing: <strong>{activeJobNow.file_name}</strong> (until{" "}
                    {format(new Date(activeJobNow.end_time), "HH:mm")})
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-emerald-300 font-medium">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    Printer Idle — Available for Immediate Booking
                  </span>
                )}
                <span className="text-slate-500">•</span>
                <span>{scheduledCount} queued this week</span>
              </div>
            </div>
          </div>

          {/* Right User Profile, Admin Dashboard Link & Book Button */}
          <div className="flex items-center gap-2.5">
            {isAdmin && (
              <Link
                href="/admin"
                className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm border border-indigo-400/50 transition-colors"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Admin Dashboard</span>
              </Link>
            )}

            <button
              onClick={() => {
                setSelectedSlotTime(snapTo15MinSlot(new Date(), true));
                setIsBookingModalOpen(true);
              }}
              className="px-3.5 py-2 rounded-lg bg-[#FF5F05] hover:bg-orange-600 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Book Print Slot</span>
            </button>

            <div className="flex items-center gap-2.5 bg-slate-800/90 border border-slate-700 rounded-lg px-3 py-1.5 text-xs">
              <div className="flex flex-col text-right">
                <span className="font-semibold text-white leading-tight flex items-center justify-end gap-1">
                  {isAdmin && <Shield className="w-3 h-3 text-indigo-400" />}
                  {user.full_name}
                </span>
                <span className="text-[10px] text-slate-300">
                  {user.email}
                </span>
              </div>
              {canToggleAdminRole && (
                <button
                  onClick={toggleCurrentUserRole}
                  title="Admin View Switcher: Toggle between Admin Mode and Public Student View"
                  className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider border transition-colors cursor-pointer ${
                    isAdmin
                      ? "bg-indigo-600 text-white border-indigo-400 hover:bg-indigo-500"
                      : "bg-slate-700 text-slate-200 border-slate-600 hover:bg-slate-600"
                  }`}
                >
                  Role: {user.role}
                </button>
              )}
              <button
                onClick={signOut}
                title="Sign out to view Microsoft Entra Login Screen"
                className="px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:text-white rounded-md bg-slate-700/80 hover:bg-red-600 transition-colors flex items-center gap-1 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-5 flex-1">
        {/* Maintenance Mode Alert Banner */}
        {adminSettings.permissions.maintenanceMode && (
          <div className="rounded-xl bg-amber-950 text-amber-100 border border-amber-700 p-4 shadow-md flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-xs">
              <Wrench className="w-5 h-5 text-amber-400 shrink-0" />
              <div>
                <div className="font-bold text-sm text-amber-200">
                  Printer Maintenance Mode Active
                </div>
                <p className="text-amber-100/90 mt-0.5">
                  {adminSettings.permissions.maintenanceMessage}
                </p>
              </div>
            </div>
            {isAdmin && (
              <Link
                href="/admin"
                className="px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-600 text-white text-xs font-bold shrink-0"
              >
                Manage in Admin Dashboard
              </Link>
            )}
          </div>
        )}

        {/* Domain Guard Rejection Alert */}
        {domainError && (
          <div className="rounded-xl bg-red-950 text-white border border-red-700 p-4 shadow-lg flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-xs">
              <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />
              <div>
                <div className="font-bold text-sm text-red-200">
                  UIUC Entra ID Domain Guard Triggered
                </div>
                <p className="text-red-100/90 mt-0.5">{domainError}</p>
              </div>
            </div>
            <button
              onClick={clearDomainError}
              className="px-3 py-1.5 rounded-lg bg-red-800 hover:bg-red-700 text-xs font-semibold shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Scheduling Policy Highlights Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-zinc-200 p-3.5 flex items-start gap-3 shadow-2xs">
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
              <Clock className="w-4 h-4" />
            </div>
            <div className="text-xs">
              <div className="font-bold text-zinc-900">
                15-Min Grid + {adminSettings.bookingLimits.cooldownBufferMinutes}-Min Buffer
              </div>
              <p className="text-zinc-500 mt-0.5">
                Bookings snap to :00, :15, :30, :45 (up to{" "}
                {adminSettings.bookingLimits.maxDurationMinutes}m max) with a{" "}
                {adminSettings.bookingLimits.cooldownBufferMinutes}-minute
                post-print cooldown buffer.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-zinc-200 p-3.5 flex items-start gap-3 shadow-2xs">
            <div className="p-2 rounded-lg bg-amber-50 text-amber-600">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div className="text-xs">
              <div className="font-bold text-zinc-900">
                Late-Arrival Auto-Cancel ({adminSettings.bookingLimits.lateArrivalGraceMinutes}m Grace)
              </div>
              <p className="text-zinc-500 mt-0.5">
                Unstarted jobs auto-cancel if remaining time before the next
                slot is less than{" "}
                <code className="text-[11px]">
                  duration + {adminSettings.bookingLimits.cooldownBufferMinutes}m
                </code>
                .
              </p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-zinc-200 p-3.5 flex items-start gap-3 shadow-2xs">
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="text-xs">
              <div className="font-bold text-zinc-900">
                Early Completion Magic Link
              </div>
              <p className="text-zinc-500 mt-0.5">
                Clearing the bed early frees remaining time and emails the next
                user a 1-click link to shift up.
              </p>
            </div>
          </div>
        </div>

        {/* Active User Print Controls ("Start Print" / "Mark Complete & Clear Bed") */}
        <ActiveBookingControls
          bookings={bookings}
          user={user}
          onStartPrint={handleStartPrint}
          onCompleteBed={handleCompleteBed}
          onCancelBooking={handleCancelBooking}
          onTriggerBookingEmail={handleTriggerBookingEmail}
        />

        {/* Calendar Toolbar & Legend */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-zinc-200 shadow-2xs">
          {/* Week Navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentWeekStart(addDays(currentWeekStart, -7))}
              className="p-1.5 rounded-lg border border-zinc-200 hover:bg-zinc-100 text-zinc-700 transition-colors cursor-pointer"
              title="Previous Week"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() =>
                setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))
              }
              className="px-3 py-1.5 rounded-lg border border-zinc-200 hover:bg-zinc-100 text-xs font-semibold text-zinc-700 transition-colors cursor-pointer"
            >
              Today
            </button>
            <button
              onClick={() => setCurrentWeekStart(addDays(currentWeekStart, 7))}
              className="p-1.5 rounded-lg border border-zinc-200 hover:bg-zinc-100 text-zinc-700 transition-colors cursor-pointer"
              title="Next Week"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <span className="text-sm font-bold text-zinc-900 ml-2">
              {format(currentWeekStart, "MMM d")} –{" "}
              {format(weekEnd, "MMM d, yyyy")}
            </span>
          </div>

          {/* Status Legend & Filter */}
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-xs bg-blue-600 inline-block" />
              <span className="text-zinc-600 font-medium">Scheduled</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-xs bg-amber-600 inline-block" />
              <span className="text-zinc-600 font-medium">In Progress</span>
            </div>
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-zinc-600 font-medium">
              <input
                type="checkbox"
                checked={showCompleted}
                onChange={(e) => setShowCompleted(e.target.checked)}
                className="rounded text-emerald-600"
              />
              <span className="w-3 h-3 rounded-xs bg-emerald-700 inline-block" />
              <span>Show Completed</span>
            </label>
            {isAdmin && (
              <span className="px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 font-semibold flex items-center gap-1">
                <Shield className="w-3 h-3" />
                Admin Mode: Click any block to override
              </span>
            )}
          </div>
        </div>

        {/* 7-Day x 96-Slot Visual Weekly Calendar */}
        <WeeklyCalendar
          bookings={bookings}
          currentWeekStart={currentWeekStart}
          currentUserId={user?.id}
          currentUserEmail={user?.email}
          isAdmin={isAdmin}
          showCompleted={showCompleted}
          onSelectSlot={handleSelectSlot}
          onAdminClickBooking={(booking) => setAdminSelectedBooking(booking)}
        />

        {/* Recent & Canceled Reservations Log Table (Admin Only) */}
        {isAdmin && (
          <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden shadow-2xs">
            <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-600 flex items-center gap-1.5">
                <ListFilter className="w-3.5 h-3.5" />
                All Queue Reservations &amp; Status Audit Log
              </h3>
              <span className="text-[11px] text-zinc-400">
                PostgreSQL GiST Exclusion Constraint: prevent_booking_overlap
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 text-zinc-500 bg-zinc-50/50">
                    <th className="py-2.5 px-4 font-semibold">File Name</th>
                    <th className="py-2.5 px-4 font-semibold">User (@illinois.edu)</th>
                    <th className="py-2.5 px-4 font-semibold">Start Time</th>
                    <th className="py-2.5 px-4 font-semibold">End Time (+10m)</th>
                    <th className="py-2.5 px-4 font-semibold">Duration</th>
                    <th className="py-2.5 px-4 font-semibold">Status</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {bookings.map((b) => (
                    <tr key={b.id} className="hover:bg-zinc-50/80">
                      <td className="py-2.5 px-4 font-semibold text-zinc-900">
                        {b.file_name}
                      </td>
                      <td className="py-2.5 px-4 text-zinc-600">{b.user_email}</td>
                      <td className="py-2.5 px-4 text-zinc-700">
                        {format(new Date(b.start_time), "EEE MMM d, HH:mm")}
                      </td>
                      <td className="py-2.5 px-4 text-zinc-700">
                        {format(new Date(b.end_time), "HH:mm")}
                      </td>
                      <td className="py-2.5 px-4 text-zinc-600">
                        {b.duration_minutes}m + {b.buffer_minutes}m buf
                      </td>
                      <td className="py-2.5 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            b.status === "in_progress"
                              ? "bg-amber-100 text-amber-800"
                              : b.status === "scheduled"
                              ? "bg-blue-100 text-blue-800"
                              : b.status === "completed"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          {b.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {(isAdmin || b.user_id === user?.id) && (
                          <button
                            onClick={() => setAdminSelectedBooking(b)}
                            className="text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer"
                          >
                            {isAdmin ? "Admin Edit" : "View"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* New Booking Modal */}
      <BookingModal
        isOpen={isBookingModalOpen}
        initialSlotTime={selectedSlotTime}
        user={user}
        onClose={() => setIsBookingModalOpen(false)}
        onSubmitBooking={handleSubmitBooking}
      />

      {/* Admin Override / User Details Modal */}
      <AdminBookingModal
        booking={adminSelectedBooking}
        user={user}
        onClose={() => setAdminSelectedBooking(null)}
        onAdminOverride={handleAdminOverride}
        onUserCancel={handleCancelBooking}
      />

      {/* Admin & Dev Simulation Toolbar (Hidden in Public User View) */}
      {isAdmin && (
        <DevAuthBanner
          currentUser={user}
          onSwitchPersona={switchDevPersona}
          onTestExternalRejection={testExternalDomainRejection}
          onTriggerLateCron={async () => {
            const res = await runAutoCancelLateCheck();
            return {
              canceledCount: res.canceledBookings.length,
              warnedCount: res.warnedBookings.length,
            };
          }}
          onResetDemo={() => {
            resetDemoData();
          }}
          onConnectOutlookMail={connectOutlookMailSend}
        />
      )}
    </div>
  );
}
