"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  Sparkles,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  ArrowLeft,
  UserCheck,
} from "lucide-react";
import Link from "next/link";
import { useUserSession } from "@/hooks/useUserSession";
import {
  fetchBookings,
  acceptEarlyReschedule,
  DEV_PERSONAS,
} from "@/lib/store";
import { calculateEndTime, snapTo15MinSlot } from "@/lib/scheduling";
import { CalendarBooking } from "@/lib/types";

function ReschedulePortalContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, switchDevPersona } = useUserSession();

  const bookingId = searchParams.get("booking_id");
  const newStartRaw = searchParams.get("new_start");

  const [booking, setBooking] = useState<CalendarBooking | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    fetchBookings().then((all) => {
      const found = all.find((b) => b.id === bookingId);
      setBooking(found || null);
    });
  }, [bookingId]);

  if (!bookingId || !newStartRaw) {
    return (
      <div className="max-w-lg mx-auto mt-16 bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm text-center space-y-4">
        <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
        <h1 className="text-lg font-bold text-zinc-900">
          Invalid Reschedule Link
        </h1>
        <p className="text-xs text-zinc-600">
          Missing <code className="bg-zinc-100 px-1 py-0.5 rounded">booking_id</code> or{" "}
          <code className="bg-zinc-100 px-1 py-0.5 rounded">new_start</code> parameters.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-zinc-900 text-white text-xs font-semibold"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Return to Booking Portal
        </Link>
      </div>
    );
  }

  const proposedStart = snapTo15MinSlot(new Date(newStartRaw));
  const proposedEnd = booking
    ? calculateEndTime(
        proposedStart,
        booking.duration_minutes,
        booking.buffer_minutes
      )
    : null;

  const isOwnerOrAdmin =
    user &&
    booking &&
    (user.id === booking.user_id || user.role === "admin");

  const handleConfirmShift = async () => {
    if (!user || !booking) return;
    setErrorMessage(null);
    setIsConfirming(true);

    const res = await acceptEarlyReschedule({
      bookingId: booking.id,
      newStartTime: proposedStart,
      user,
    });

    setIsConfirming(false);
    if (res.error) {
      setErrorMessage(res.error);
    } else if (res.data) {
      setBooking(res.data);
      setStatusMessage(
        "Success! Your print slot has been shifted earlier. Redirecting to calendar..."
      );
      setTimeout(() => {
        router.push("/");
      }, 1800);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="max-w-xl mx-auto space-y-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-600 hover:text-zinc-900"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Bambu X1C Calendar
        </Link>

        <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl overflow-hidden">
          <div className="bg-[#13294B] text-white px-6 py-5 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[#FF5F05] text-white">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold">
                Early Slot Available — Shift Your Print Up?
              </h1>
              <p className="text-xs text-slate-300">
                The previous Bambu Lab X1C job completed early and the build
                plate is clear.
              </p>
            </div>
          </div>

          <div className="p-6 space-y-5">
            {!booking ? (
              <div className="text-xs text-zinc-500 py-6 text-center">
                Loading reservation details...
              </div>
            ) : (
              <>
                {/* Reservation Summary */}
                <div className="rounded-xl bg-zinc-50 border border-zinc-200 p-4 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Print File:</span>
                    <span className="font-bold text-zinc-900">
                      {booking.file_name}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Reservation Owner:</span>
                    <span className="font-semibold text-blue-700">
                      {booking.user_email}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Duration:</span>
                    <span className="font-medium text-zinc-800">
                      {booking.duration_minutes} mins (+{booking.buffer_minutes}
                      m mandatory cooldown buffer)
                    </span>
                  </div>
                </div>

                {/* Time Shift Comparison */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                  <div className="rounded-xl border border-zinc-200 p-4 bg-zinc-50/60">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      Current Scheduled Slot
                    </div>
                    <div className="text-sm font-bold text-zinc-700 mt-1">
                      {format(new Date(booking.start_time), "HH:mm")} –{" "}
                      {format(new Date(booking.end_time), "HH:mm")}
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      {format(new Date(booking.start_time), "EEE, MMM d")}
                    </div>
                  </div>

                  <div className="rounded-xl border-2 border-emerald-500 p-4 bg-emerald-50/50">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 flex items-center gap-1">
                      <Sparkles className="w-3 h-3" /> New Earlier Slot
                    </div>
                    <div className="text-sm font-bold text-emerald-950 mt-1">
                      {format(proposedStart, "HH:mm")} –{" "}
                      {proposedEnd ? format(proposedEnd, "HH:mm") : ""}
                    </div>
                    <div className="text-[11px] text-emerald-700">
                      {format(proposedStart, "EEE, MMM d")} (Ready after 10m
                      cooldown)
                    </div>
                  </div>
                </div>

                {/* Auth Check Prompt if signed in as a different user */}
                {!isOwnerOrAdmin && (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 space-y-3 text-xs text-amber-900">
                    <div className="font-bold flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                      Authenticated UIUC Verification Required
                    </div>
                    <p>
                      You are currently signed in as{" "}
                      <strong>{user?.email || "Guest"}</strong>, whereas this
                      reservation belongs to{" "}
                      <strong>{booking.user_email}</strong>.
                    </p>
                    <button
                      onClick={() => {
                        const targetPersona = DEV_PERSONAS.find(
                          (p) => p.email === booking.user_email
                        );
                        if (targetPersona) {
                          switchDevPersona(targetPersona.id);
                        }
                      }}
                      className="px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      Switch Dev Persona to {booking.user_email}
                    </button>
                  </div>
                )}

                {errorMessage && (
                  <div className="rounded-xl bg-red-50 border border-red-200 p-3.5 text-xs text-red-800 font-medium">
                    {errorMessage}
                  </div>
                )}

                {statusMessage && (
                  <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3.5 text-xs text-emerald-900 font-bold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>{statusMessage}</span>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex items-center justify-end gap-3 pt-2">
                  <Link
                    href="/"
                    className="px-4 py-2.5 rounded-lg border border-zinc-200 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
                  >
                    Keep Original Time
                  </Link>
                  <button
                    disabled={!isOwnerOrAdmin || isConfirming || Boolean(statusMessage)}
                    onClick={handleConfirmShift}
                    className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                  >
                    <span>
                      {isConfirming
                        ? "Shifting Reservation..."
                        : "Accept & Shift Print Earlier"}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ReschedulePortalPage() {
  return (
    <Suspense
      fallback={
        <div className="p-12 text-center text-xs text-zinc-500">
          Loading reschedule portal...
        </div>
      }
    >
      <ReschedulePortalContent />
    </Suspense>
  );
}
