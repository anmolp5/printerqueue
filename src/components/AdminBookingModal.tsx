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
  Lock,
} from "lucide-react";
import { BookingStatus, CalendarBooking, UserProfile } from "@/lib/types";
import {
  MANDATORY_BUFFER_MINUTES,
  calculateEndTime,
  snapTo15MinSlot,
} from "@/lib/scheduling";
import { isBookingOwnedByUser, editBooking } from "@/lib/store";
import { IosWheelTimePicker } from "./IosWheelTimePicker";

interface AdminBookingModalProps {
  booking: CalendarBooking | null;
  user: UserProfile | null;
  onClose: () => void;
  onEditBooking?: (params: {
    bookingId: string;
    user: UserProfile;
    file_name: string;
    start_time: Date;
    duration_minutes: number;
  }) => Promise<{ data?: CalendarBooking; error?: string }>;
  onAdminOverride?: (params: {
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
  onEditBooking,
  onAdminOverride,
  onUserCancel,
}) => {
  const [fileName, setFileName] = useState<string>("");
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
      setFileName(booking.file_name);
      setStartTime(snapTo15MinSlot(new Date(booking.start_time)));
      setDurationInput(String(booking.duration_minutes));
      setStatus(booking.status);
      setSendNotice(true);
      setError(null);
    }
  }, [booking]);

  if (!booking || !user) return null;

  const isAdmin = user.role === "admin";
  const isOwner = isBookingOwnedByUser(booking, user);
  const canEdit = isOwner || isAdmin;
  const isLocked =
    booking.status === "in_progress" || booking.status === "completed";

  const parsedDuration =
    durationInput.trim() === "" ? 0 : Number(durationInput);
  const isDurationValid =
    Number.isFinite(parsedDuration) &&
    parsedDuration >= 1 &&
    parsedDuration <= 720;
  const isFileNameValid = fileName.trim().length > 0;

  const calculatedEnd = calculateEndTime(
    startTime,
    isDurationValid ? parsedDuration : 0,
    MANDATORY_BUFFER_MINUTES
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isLocked) {
      setError("This reservation has already started and cannot be edited.");
      return;
    }

    if (!isFileNameValid) {
      setError("File name cannot be empty.");
      return;
    }

    if (!isDurationValid) {
      setError("Duration must be between 1 and 720 minutes.");
      return;
    }

    setIsSaving(true);
    const editFn = onEditBooking || editBooking;
    const res = await editFn({
      bookingId: booking.id,
      user,
      file_name: fileName.trim(),
      start_time: startTime,
      duration_minutes: Math.round(parsedDuration),
    });

    if (res.error) {
      setIsSaving(false);
      setError(res.error);
      return;
    }

    // If admin also updated status or override notice
    if (isAdmin && onAdminOverride && status !== "scheduled") {
      const overrideRes = await onAdminOverride({
        bookingId: booking.id,
        newStartTime: startTime,
        newDurationMinutes: Math.round(parsedDuration),
        newStatus: status,
        sendNotification: sendNotice,
        reason,
      });
      if (overrideRes.error) {
        setIsSaving(false);
        setError(overrideRes.error);
        return;
      }
    }

    setIsSaving(false);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs p-0 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl border border-zinc-200 shadow-2xl max-w-lg w-full max-h-[92dvh] sm:max-h-[90vh] flex flex-col overflow-hidden sm:my-auto"
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
              {canEdit ? "Edit Reservation" : "Reservation Details"}
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

        {canEdit ? (
          <form
            onSubmit={handleSave}
            className="p-6 space-y-4 overflow-y-auto flex-1 overscroll-contain"
          >
            {/* Locked Badge if in_progress or completed */}
            {isLocked && (
              <div
                className="rounded-xl bg-amber-50 border border-amber-300 p-3.5 text-xs text-amber-900 flex items-center gap-2 font-bold shadow-xs"
                role="status"
              >
                <Lock className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Print In Progress — Editing Locked</span>
              </div>
            )}

            {/* Red Alert Conflict / Validation Banner */}
            {error && (
              <div
                className="rounded-xl bg-red-50 border border-red-300 p-3.5 text-xs text-red-800 flex items-start gap-2.5 shadow-xs"
                role="alert"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5 flex-1">
                  <div className="font-bold text-red-900">
                    Conflicts with existing booking
                  </div>
                  <p className="text-red-800">{error}</p>
                </div>
              </div>
            )}

            {/* File Name */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600 mb-1">
                File Name
              </label>
              <input
                type="text"
                value={fileName}
                disabled={isLocked}
                onChange={(e) => {
                  setFileName(e.target.value);
                  setError(null);
                }}
                placeholder="e.g. chassis_v2.gcode"
                className={`w-full px-3 py-2 text-xs border rounded-lg focus:outline-none focus:ring-2 ${
                  isLocked
                    ? "bg-zinc-100 text-zinc-500 border-zinc-200 cursor-not-allowed"
                    : !isFileNameValid
                    ? "border-red-400 bg-red-50/40 text-red-900 focus:ring-red-500"
                    : "border-zinc-300 bg-white focus:ring-indigo-500"
                }`}
              />
            </div>

            {/* Unified iOS Drum Wheel Picker for Start Time */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-zinc-600">
                  Start Date &amp; Time
                </label>
                <span className="text-xs font-bold text-indigo-600">
                  {format(startTime, "EEE MMM d, h:mm a")}
                </span>
              </div>

              <div
                className={
                  isLocked ? "pointer-events-none opacity-50 select-none cursor-not-allowed" : ""
                }
              >
                <IosWheelTimePicker
                  value={startTime}
                  onChange={(nextDate) => {
                    if (isLocked) return;
                    setStartTime(nextDate);
                    setError(null);
                  }}
                />
              </div>
            </div>

            {/* Duration (Minutes) */}
            <div className={isAdmin ? "grid grid-cols-2 gap-3" : ""}>
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
                    disabled={isLocked}
                    onChange={(e) => {
                      setDurationInput(e.target.value.replace(/[^0-9]/g, ""));
                      setError(null);
                    }}
                    className={`w-full pl-8 pr-3 py-2 text-xs border rounded-lg focus:outline-none focus:ring-2 ${
                      isLocked
                        ? "bg-zinc-100 text-zinc-500 border-zinc-200 cursor-not-allowed"
                        : !isDurationValid
                        ? "border-red-400 bg-red-50/40 text-red-900 focus:ring-red-500"
                        : "border-zinc-300 focus:ring-indigo-500"
                    }`}
                  />
                </div>
                {!isDurationValid ? (
                  <div className="text-[11px] text-red-600 font-medium mt-1">
                    Invalid duration (must be between 1 and 720)
                  </div>
                ) : (
                  <div className="text-[11px] text-zinc-500 mt-1">
                    New End: <strong>{format(calculatedEnd, "h:mm a")}</strong>{" "}
                    (incl. +10m buf)
                  </div>
                )}
              </div>

              {isAdmin && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600 mb-1">
                    Override Status
                  </label>
                  <select
                    value={status}
                    disabled={isLocked}
                    onChange={(e) => setStatus(e.target.value as BookingStatus)}
                    className="w-full px-3 py-2 text-xs border border-zinc-300 rounded-lg bg-white font-semibold disabled:bg-zinc-100 disabled:text-zinc-500"
                  >
                    <option value="scheduled">scheduled</option>
                    <option value="in_progress">in_progress</option>
                    <option value="completed">completed</option>
                    <option value="canceled_admin">canceled_admin</option>
                    <option value="canceled_late">canceled_late</option>
                  </select>
                </div>
              )}
            </div>

            {/* Admin Notification Toggle */}
            {isAdmin && !isLocked && (
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
                    Send automated notice to user about this adjustment
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
            )}

            {/* Footer Buttons */}
            <div className="sticky bottom-0 bg-white pt-3 pb-1 border-t border-zinc-100 flex flex-wrap items-center justify-between gap-2">
              <div>
                {booking.status === "scheduled" && (
                  <button
                    type="button"
                    onClick={async () => {
                      await onUserCancel(booking.id);
                      onClose();
                    }}
                    className="px-3.5 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Cancel Reservation
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 rounded-lg border border-zinc-200 cursor-pointer"
                >
                  Close
                </button>
                {!isLocked && (
                  <button
                    type="submit"
                    disabled={isSaving || !isDurationValid || !isFileNameValid}
                    className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 rounded-lg shadow-sm flex items-center gap-1.5 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {isSaving ? "Saving..." : "Save Changes"}
                  </button>
                )}
              </div>
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
