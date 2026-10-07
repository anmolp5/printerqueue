"use client";

import React, { useState, useEffect } from "react";
import { format } from "date-fns";
import {
  X,
  Shield,
  Clock,
  Mail,
  AlertCircle,
  CheckCircle2,
  Trash2,
} from "lucide-react";
import { BookingStatus, CalendarBooking, UserProfile } from "@/lib/types";
import {
  MANDATORY_BUFFER_MINUTES,
  calculateEndTime,
  snapTo15MinSlot,
} from "@/lib/scheduling";
import { IosWheelTimePicker } from "./IosWheelTimePicker";

interface AdminBookingModalProps {
  booking: CalendarBooking | null;
  user: UserProfile | null;
  onClose: () => void;
  onAdminOverride: (params: {
    bookingId: string;
    newStartTime: Date;
    newDurationMinutes: number;
    newStatus: BookingStatus;
    sendNotification: boolean;
    reason?: string;
  }) => Promise<{ error?: string }>;
  onUserCancel: (bookingId: string) => Promise<void>;
}

export const AdminBookingModal: React.FC<AdminBookingModalProps> = ({
  booking,
  user,
  onClose,
  onAdminOverride,
  onUserCancel,
}) => {
  const [startTime, setStartTime] = useState<Date>(new Date());
  const [durationInput, setDurationInput] = useState<string>("60");
  const [status, setStatus] = useState<BookingStatus>("scheduled");
  const [sendNotice, setSendNotice] = useState<boolean>(true);
  const [reason, setReason] = useState<string>(
    "Lab maintenance / queue optimization adjustment."
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (booking) {
      setStartTime(snapTo15MinSlot(new Date(booking.start_time)));
      setDurationInput(String(booking.duration_minutes));
      setStatus(booking.status);
      setSendNotice(true);
      setError(null);
    }
  }, [booking]);

  if (!booking || !user) return null;

  const isAdmin = user.role === "admin";
  const parsedDuration =
    durationInput.trim() === "" ? 0 : Number(durationInput);
  const isDurationValid =
    Number.isFinite(parsedDuration) &&
    parsedDuration > 0 &&
    parsedDuration <= 720;

  const calculatedEnd = calculateEndTime(
    startTime,
    isDurationValid ? parsedDuration : 0,
    MANDATORY_BUFFER_MINUTES
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isDurationValid) {
      setError("Duration must be greater than 0 minutes.");
      return;
    }

    setIsSaving(true);
    const res = await onAdminOverride({
      bookingId: booking.id,
      newStartTime: startTime,
      newDurationMinutes: Math.round(parsedDuration),
      newStatus: status,
      sendNotification: sendNotice,
      reason,
    });
    setIsSaving(false);

    if (res.error) {
      setError(res.error);
    } else {
      onClose();
    }
  };

  const isOwnBooking =
    booking.user_id === user.id ||
    booking.user_email.toLowerCase() === user.email.toLowerCase();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-zinc-200 shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`px-6 py-4 text-white flex items-center justify-between shrink-0 ${
            isAdmin ? "bg-indigo-950" : "bg-zinc-900"
          }`}
        >
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              {isAdmin ? (
                <Shield className="w-5 h-5 text-indigo-400" />
              ) : (
                <Clock className="w-5 h-5 text-orange-400" />
              )}
              {isAdmin ? "Lab Admin Booking Override" : "Reservation Details"}
            </h2>
            <p className="text-xs text-zinc-300 mt-0.5">
              {booking.file_name} • {booking.user_email}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1 rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isAdmin ? (
          <form
            onSubmit={handleSave}
            className="p-6 space-y-4 overflow-y-auto flex-1 overscroll-contain"
          >
            {/* Unified iOS Drum Wheel Picker for Start Time Override */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-zinc-600">
                  Shift Start Date &amp; Time
                </label>
                <span className="text-xs font-bold text-indigo-600">
                  {format(startTime, "EEE MMM d, h:mm a")}
                </span>
              </div>

              <IosWheelTimePicker
                value={startTime}
                onChange={(nextDate) => {
                  setStartTime(nextDate);
                  setError(null);
                }}
              />
            </div>

            {/* Duration & Status */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600 mb-1">
                  Duration (Minutes)
                </label>
                <div className="relative">
                  <Clock className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    inputMode="numeric"
                    value={durationInput}
                    placeholder="e.g. 60"
                    onChange={(e) => {
                      setDurationInput(e.target.value.replace(/[^0-9]/g, ""));
                      setError(null);
                    }}
                    className={`w-full pl-8 pr-3 py-2 text-xs border rounded-lg focus:outline-none focus:ring-2 ${
                      !isDurationValid
                        ? "border-red-400 bg-red-50/40 text-red-900 focus:ring-red-500"
                        : "border-zinc-300 focus:ring-indigo-500"
                    }`}
                  />
                </div>
                {!isDurationValid ? (
                  <div className="text-[11px] text-red-600 font-medium mt-1">
                    Invalid duration (must be &gt; 0)
                  </div>
                ) : (
                  <div className="text-[11px] text-zinc-500 mt-1">
                    New End: <strong>{format(calculatedEnd, "h:mm a")}</strong>{" "}
                    (incl. +10m buf)
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600 mb-1">
                  Override Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as BookingStatus)}
                  className="w-full px-3 py-2 text-xs border border-zinc-300 rounded-lg bg-white font-semibold"
                >
                  <option value="scheduled">scheduled</option>
                  <option value="in_progress">in_progress</option>
                  <option value="completed">completed</option>
                  <option value="canceled_admin">canceled_admin</option>
                  <option value="canceled_late">canceled_late</option>
                </select>
              </div>
            </div>

            {/* Notification Toggle */}
            <div className="rounded-xl bg-indigo-50/70 border border-indigo-200 p-3.5 space-y-2.5">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={sendNotice}
                  onChange={(e) => setSendNotice(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-xs font-semibold text-indigo-950 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-indigo-600" />
                  Send automated notice to user about this schedule adjustment
                </span>
              </label>

              {sendNotice && (
                <div>
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason for schedule adjustment..."
                    className="w-full px-3 py-1.5 text-xs bg-white border border-indigo-200 rounded-lg text-zinc-800"
                  />
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="sticky bottom-0 bg-white pt-3 pb-1 border-t border-zinc-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 rounded-lg border border-zinc-200 cursor-pointer"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={isSaving || !isDurationValid}
                className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 rounded-lg shadow-sm flex items-center gap-1.5 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                {isSaving ? "Applying..." : "Apply Admin Override"}
              </button>
            </div>
          </form>
        ) : (
          <div className="p-6 space-y-4 text-xs overflow-y-auto flex-1">
            <div className="space-y-2 bg-zinc-50 p-4 rounded-xl border border-zinc-200">
              <div className="flex justify-between">
                <span className="text-zinc-500">File Name:</span>
                <span className="font-bold text-zinc-900">
                  {booking.file_name}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Reserved By:</span>
                <span className="font-semibold text-zinc-800">
                  {booking.user_email}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Window:</span>
                <span className="font-semibold text-zinc-800">
                  {format(new Date(booking.start_time), "EEE MMM d, h:mm a")} –{" "}
                  {format(new Date(booking.end_time), "h:mm a")}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Status:</span>
                <span className="font-bold uppercase text-blue-700">
                  {booking.status}
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              {isOwnBooking && booking.status === "scheduled" && (
                <button
                  onClick={async () => {
                    await onUserCancel(booking.id);
                    onClose();
                  }}
                  className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Cancel My Reservation
                </button>
              )}
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-zinc-200 font-semibold text-zinc-700"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
