"use client";

import React, { useState } from "react";
import { format } from "date-fns";
import {
  Play,
  CheckCircle2,
  Trash2,
  Clock,
  Sparkles,
  ExternalLink,
  AlertTriangle,
  Bell,
  Mail,
} from "lucide-react";
import { CalendarBooking, UserProfile } from "@/lib/types";
import { STRICT_RECIPIENT_EMAIL } from "@/lib/email";
import Link from "next/link";

interface ActiveBookingControlsProps {
  bookings: CalendarBooking[];
  user: UserProfile | null;
  onStartPrint: (bookingId: string) => Promise<void>;
  onCompleteBed: (bookingId: string) => Promise<{
    nextBookingNotified?: CalendarBooking | null;
    magicLinkUrl?: string;
  }>;
  onCancelBooking: (bookingId: string) => Promise<void>;
  onTriggerBookingEmail?: (
    bookingId: string,
    mode: "pre_booking_reminder" | "slot_starting"
  ) => Promise<void>;
}

export const ActiveBookingControls: React.FC<ActiveBookingControlsProps> = ({
  bookings,
  user,
  onStartPrint,
  onCompleteBed,
  onCancelBooking,
  onTriggerBookingEmail,
}) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [earlyOfferToast, setEarlyOfferToast] = useState<{
    nextEmail: string;
    nextFile: string;
    magicLinkUrl: string;
  } | null>(null);

  if (!user) return null;

  const isAdmin = user.role === "admin";

  const myActiveBookings = bookings
    .filter(
      (b) =>
        (b.user_id === user.id ||
          b.user_email.trim().toLowerCase() ===
            user.email.trim().toLowerCase()) &&
        (b.status === "scheduled" || b.status === "in_progress")
    )
    .sort(
      (a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );

  return (
    <div className="space-y-3">
      {/* Early Completion Offer Dispatched Banner */}
      {earlyOfferToast && (
        <div className="rounded-xl bg-emerald-950 text-white border border-emerald-700 p-4 shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <div className="font-bold text-sm text-emerald-200">
                Print Marked Complete &amp; Build Plate Cleared! (+10m Cooldown Applied)
              </div>
              <p className="text-emerald-100/90">
                {isAdmin ? (
                  <>
                    Completion confirmation sent to <strong>{user.email}</strong>.
                    Automated early-slot offer also dispatched for{" "}
                    <code className="bg-emerald-900 px-1.5 py-0.5 rounded">
                      {earlyOfferToast.nextFile}
                    </code>{" "}
                    with a one-click magic link to shift their reservation up.
                  </>
                ) : (
                  <>
                    A completion confirmation email has been sent to{" "}
                    <strong>{user.email}</strong>, and the next user in the queue
                    has been notified that the printer is ready early.
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isAdmin && (
              <Link
                href={earlyOfferToast.magicLinkUrl.replace(
                  /^https?:\/\/[^/]+/,
                  ""
                )}
                className="px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-bold text-xs flex items-center gap-1.5 transition-colors shadow-sm"
              >
                <span>Preview Magic Link</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            )}
            <button
              onClick={() => setEarlyOfferToast(null)}
              className="text-xs text-emerald-300 hover:text-white px-2 py-1"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* User's Active / Scheduled Reservations */}
      {myActiveBookings.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 flex items-center justify-between text-xs text-zinc-600 shadow-2xs">
          <div className="flex items-center gap-2.5">
            <Clock className="w-4 h-4 text-zinc-400" />
            <span>
              You have no active reservations as{" "}
              <strong className="text-zinc-900">{user.email}</strong>. Click any
              empty 15-minute slot on the grid below to schedule a print.
            </span>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {myActiveBookings.map((b) => {
            const isInProgress = b.status === "in_progress";
            const startDate = new Date(b.start_time);
            const endDate = new Date(b.end_time);

            return (
              <div
                key={b.id}
                className={`rounded-xl border p-4 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4 transition-all ${
                  isInProgress
                    ? "bg-amber-50/90 border-amber-300"
                    : "bg-blue-50/70 border-blue-200"
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        isInProgress
                          ? "bg-amber-600 text-white"
                          : "bg-blue-600 text-white"
                      }`}
                    >
                      {isInProgress ? "Printing In Progress" : "Scheduled Slot"}
                    </span>
                    <span className="font-bold text-sm text-zinc-900">
                      {b.file_name}
                    </span>
                    <span className="text-xs text-zinc-500">
                      ({b.duration_minutes}m print + {b.buffer_minutes}m buffer)
                    </span>
                    {b.reminder_minutes_before ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 border border-orange-200 text-[11px] font-semibold">
                        <Bell className="w-3 h-3 text-orange-600" />
                        Reminder: {b.reminder_minutes_before}m before
                        {b.reminder_sent ? " (Sent)" : ""}
                      </span>
                    ) : null}
                  </div>

                  <div className="text-xs text-zinc-700 flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span>
                      <strong>Window:</strong>{" "}
                      {format(startDate, "EEE MMM d, h:mm a")} –{" "}
                      {format(endDate, "h:mm a")}
                    </span>
                    {!isInProgress && (
                      <span className="text-amber-800 flex items-center gap-1 font-medium">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                        Click &ldquo;Start Print&rdquo; on time to avoid
                        auto-cancellation if late!
                      </span>
                    )}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {b.status === "scheduled" && (
                    <>
                      {isAdmin && onTriggerBookingEmail && (
                        <>
                          <button
                            type="button"
                            disabled={busyId === b.id}
                            onClick={async () => {
                              setBusyId(b.id);
                              await onTriggerBookingEmail(
                                b.id,
                                "pre_booking_reminder"
                              );
                              setBusyId(null);
                            }}
                            title={`Send pre-booking reminder email to ${user.email} now`}
                            className="px-2.5 py-2 rounded-lg border border-orange-200 bg-white hover:bg-orange-50 text-orange-700 font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <Bell className="w-3.5 h-3.5" />
                            <span>Send Reminder Email</span>
                          </button>

                          <button
                            type="button"
                            disabled={busyId === b.id}
                            onClick={async () => {
                              setBusyId(b.id);
                              await onTriggerBookingEmail(
                                b.id,
                                "slot_starting"
                              );
                              setBusyId(null);
                            }}
                            title={`Send 'Slot Starting Now' email to ${user.email} now`}
                            className="px-2.5 py-2 rounded-lg border border-blue-200 bg-white hover:bg-blue-50 text-blue-700 font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <Mail className="w-3.5 h-3.5" />
                            <span>Send Slot Starting Email</span>
                          </button>
                        </>
                      )}

                      <button
                        disabled={busyId === b.id}
                        onClick={async () => {
                          setBusyId(b.id);
                          await onStartPrint(b.id);
                          setBusyId(null);
                        }}
                        className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        Start Print
                      </button>

                      <button
                        disabled={busyId === b.id}
                        onClick={async () => {
                          setBusyId(b.id);
                          await onCancelBooking(b.id);
                          setBusyId(null);
                        }}
                        className="px-3 py-2 rounded-lg border border-zinc-300 bg-white hover:bg-red-50 hover:text-red-700 hover:border-red-200 text-zinc-700 font-semibold text-xs flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Cancel
                      </button>
                    </>
                  )}

                  {b.status === "in_progress" && (
                    <button
                      disabled={busyId === b.id}
                      onClick={async () => {
                        setBusyId(b.id);
                        const res = await onCompleteBed(b.id);
                        setBusyId(null);
                        if (res.nextBookingNotified && res.magicLinkUrl) {
                          setEarlyOfferToast({
                            nextEmail: res.nextBookingNotified.user_email,
                            nextFile: res.nextBookingNotified.file_name,
                            magicLinkUrl: res.magicLinkUrl,
                          });
                        }
                      }}
                      className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Mark Complete &amp; Clear Bed
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
