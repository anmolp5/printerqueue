"use client";

import React, { useState, useEffect } from "react";
import { format } from "date-fns";
import {
  X,
  Clock,
  FileCode,
  ShieldAlert,
  Sparkles,
  Calendar as CalendarIcon,
  CheckCircle2,
  AlertCircle,
  Bell,
  Mail,
} from "lucide-react";
import {
  calculateEndTime,
  getActiveBufferMinutes,
  getActiveMaxDurationMinutes,
  getCurrentSlotFloor,
  isSlotBeforeCurrentPeriod,
  snapTo15MinSlot,
} from "@/lib/scheduling";
import { UserProfile } from "@/lib/types";
import { STRICT_RECIPIENT_EMAIL } from "@/lib/email";
import { IosWheelTimePicker } from "./IosWheelTimePicker";

interface BookingModalProps {
  isOpen: boolean;
  initialSlotTime: Date | null;
  user: UserProfile | null;
  onClose: () => void;
  onSubmitBooking: (params: {
    file_name: string;
    duration_minutes: number;
    start_time: Date;
    reminder_minutes_before?: number | null;
  }) => Promise<{ error?: string; code?: string }>;
}

const DURATION_PRESETS = [
  { label: "30m", mins: 30 },
  { label: "45m", mins: 45 },
  { label: "1h", mins: 60 },
  { label: "1.5h", mins: 90 },
  { label: "2h", mins: 120 },
  { label: "3h", mins: 180 },
  { label: "4h", mins: 240 },
  { label: "6h", mins: 360 },
];

const REMINDER_PRESETS: { label: string; mins: number | null }[] = [
  { label: "No reminder", mins: null },
  { label: "5m before", mins: 5 },
  { label: "10m before", mins: 10 },
  { label: "15m before", mins: 15 },
  { label: "30m before", mins: 30 },
  { label: "60m before", mins: 60 },
];

export const BookingModal: React.FC<BookingModalProps> = ({
  isOpen,
  initialSlotTime,
  user,
  onClose,
  onSubmitBooking,
}) => {
  // 1. Do NOT auto-populate file name
  const [fileName, setFileName] = useState("");
  // 2. Store duration as raw string so user can delete all digits freely
  const [durationInput, setDurationInput] = useState<string>("60");
  // 3. Optional reminder minutes before slot starts (default 15 minutes)
  const [reminderEnabled, setReminderEnabled] = useState<boolean>(true);
  const [reminderInput, setReminderInput] = useState<string>("15");
  const [selectedDate, setSelectedDate] = useState<Date>(
    initialSlotTime
      ? snapTo15MinSlot(initialSlotTime)
      : getCurrentSlotFloor()
  );
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const activeMaxDuration = getActiveMaxDurationMinutes();
  const activeBuffer = getActiveBufferMinutes();

  useEffect(() => {
    if (isOpen && initialSlotTime) {
      setFileName("");
      setDurationInput("60");
      setReminderEnabled(true);
      setReminderInput("15");
      const candidate = snapTo15MinSlot(initialSlotTime);
      const minAllowed = getCurrentSlotFloor();
      setSelectedDate(candidate.getTime() < minAllowed.getTime() ? candidate : candidate);
      setError(null);
      setErrorCode(null);
    }
  }, [initialSlotTime, isOpen]);

  if (!isOpen || !initialSlotTime) return null;

  const parsedDuration =
    durationInput.trim() === "" ? 0 : Number(durationInput);
  const isDurationValid =
    Number.isFinite(parsedDuration) &&
    parsedDuration > 0 &&
    parsedDuration <= activeMaxDuration;

  const parsedReminder =
    !reminderEnabled || reminderInput.trim() === ""
      ? null
      : Number(reminderInput);
  const isReminderValid =
    !reminderEnabled ||
    (parsedReminder !== null &&
      Number.isFinite(parsedReminder) &&
      parsedReminder >= 1 &&
      parsedReminder <= 1440);

  const isStartInPast = isSlotBeforeCurrentPeriod(selectedDate);
  const currentFloor = getCurrentSlotFloor();

  const previewDuration = isDurationValid ? parsedDuration : 0;

  const endTime = calculateEndTime(
    selectedDate,
    previewDuration,
    activeBuffer
  );
  const printFinishTime = new Date(
    selectedDate.getTime() + previewDuration * 60 * 1000
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setErrorCode(null);

    if (!fileName.trim()) {
      setError("Please enter your 3D print file name (.3mf or .gcode).");
      return;
    }

    if (isStartInPast) {
      setError(
        `Cannot start a booking before the current 15-minute time period (${format(
          currentFloor,
          "EEE MMM d, h:mm a"
        )}).`
      );
      return;
    }

    if (!isDurationValid) {
      setError(
        `Please enter a valid print duration between 1 and ${activeMaxDuration} minutes.`
      );
      return;
    }

    if (!isReminderValid) {
      setError(
        "Please enter a valid reminder time between 1 and 1440 minutes before your booking, or disable the reminder."
      );
      return;
    }

    setIsSubmitting(true);
    const res = await onSubmitBooking({
      file_name: fileName.trim(),
      duration_minutes: Math.round(parsedDuration),
      start_time: selectedDate,
      reminder_minutes_before:
        reminderEnabled && parsedReminder ? Math.round(parsedReminder) : null,
    });
    setIsSubmitting(false);

    if (res.error) {
      setError(res.error);
      setErrorCode(res.code || null);
    } else {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-zinc-200 shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-zinc-900 text-white px-6 py-4 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <CalendarIcon className="w-5 h-5 text-orange-400" />
              Reserve Bambu Lab X1C Slot
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              15-minute grid intervals • Mandatory {activeBuffer}-minute post-print buffer
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-6 space-y-4 overflow-y-auto flex-1 overscroll-contain"
        >
          {/* User Identity Badge */}
          <div className="flex items-center justify-between px-3.5 py-2 rounded-lg bg-zinc-50 border border-zinc-200 text-xs">
            <span className="text-zinc-500">Booking as UIUC Member:</span>
            <span className="font-semibold text-zinc-800">
              {user?.email || "Not signed in"}
            </span>
          </div>

          {/* File Name (Starts Empty) */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-600 mb-1.5">
              Print File Name (.3mf / .gcode)
            </label>
            <div className="relative">
              <FileCode className="w-4 h-4 text-zinc-400 absolute left-3.5 top-3" />
              <input
                type="text"
                required
                autoFocus
                value={fileName}
                onChange={(e) => {
                  setFileName(e.target.value);
                  setError(null);
                }}
                placeholder="Enter file name (e.g., chassis_mount_v3.3mf)"
                className="w-full pl-10 pr-4 py-2.5 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              />
            </div>
          </div>

          {/* Consolidated iOS-Alarm-Style Scroll Wheel Picker */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-600">
                Start Date &amp; Time (15-Min Increments)
              </label>
              <span
                className={`text-xs font-bold ${
                  isStartInPast ? "text-red-600" : "text-orange-600"
                }`}
              >
                {format(selectedDate, "EEE MMM d, h:mm a")}
              </span>
            </div>

            <IosWheelTimePicker
              value={selectedDate}
              onChange={(nextDate) => {
                setSelectedDate(nextDate);
                setError(null);
              }}
            />

            {isStartInPast && (
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-red-600 mt-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>
                  Invalid start time: Cannot start a booking before the current
                  time period ({format(currentFloor, "EEE MMM d, h:mm a")}).
                </span>
              </div>
            )}
          </div>

          {/* Print Duration (Minutes) - Allows deleting all numbers */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-600">
                Estimated Print Duration (Minutes)
              </label>
              <span className="text-xs text-zinc-400">
                Max {activeMaxDuration}m ({activeMaxDuration / 60}h)
              </span>
            </div>

            <div className="flex items-center gap-2 mb-2">
              <div className="relative flex-1">
                <Clock className="w-4 h-4 text-zinc-400 absolute left-3.5 top-2.5" />
                <input
                  type="text"
                  inputMode="numeric"
                  value={durationInput}
                  placeholder="e.g. 60"
                  onChange={(e) => {
                    // Allow empty string or digits only
                    const cleaned = e.target.value.replace(/[^0-9]/g, "");
                    setDurationInput(cleaned);
                    setError(null);
                  }}
                  className={`w-full pl-10 pr-4 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 ${
                    !isDurationValid
                      ? "border-red-400 bg-red-50/40 text-red-900 focus:ring-red-500"
                      : "border-zinc-300 focus:ring-orange-500"
                  }`}
                />
              </div>
              <span className="text-xs font-medium text-zinc-500 shrink-0">
                + {activeBuffer}m buffer ={" "}
                <strong className="text-zinc-900">
                  {previewDuration + activeBuffer}m total
                </strong>
              </span>
            </div>

            {!isDurationValid && (
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-red-600 mb-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {parsedDuration <= 0
                    ? "Duration must be greater than 0 minutes."
                    : `Duration cannot exceed ${activeMaxDuration} minutes.`}
                </span>
              </div>
            )}

            {/* Quick Presets */}
            <div className="flex flex-wrap gap-1.5">
              {DURATION_PRESETS.map((preset) => (
                <button
                  key={preset.mins}
                  type="button"
                  onClick={() => {
                    setDurationInput(String(preset.mins));
                    setError(null);
                  }}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                    parsedDuration === preset.mins
                      ? "bg-orange-600 text-white border-orange-600"
                      : "bg-zinc-50 text-zinc-600 border-zinc-200 hover:bg-zinc-100"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Pre-Booking Email Reminder Option */}
          <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-700 flex items-center gap-1.5">
                <Bell className="w-3.5 h-3.5 text-orange-600" />
                Email Reminder Before Booking
              </label>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                <Mail className="w-3 h-3" />
                Sent to {user?.email || STRICT_RECIPIENT_EMAIL}
              </span>
            </div>

            {/* Quick Presets for Reminder */}
            <div className="flex flex-wrap gap-1.5">
              {REMINDER_PRESETS.map((preset) => {
                const isSelected =
                  preset.mins === null
                    ? !reminderEnabled
                    : reminderEnabled && parsedReminder === preset.mins;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      if (preset.mins === null) {
                        setReminderEnabled(false);
                      } else {
                        setReminderEnabled(true);
                        setReminderInput(String(preset.mins));
                      }
                      setError(null);
                    }}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-orange-600 text-white border-orange-600"
                        : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-100"
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            {/* Custom Minutes Before Input */}
            {reminderEnabled && (
              <div className="flex items-center gap-2 pt-0.5">
                <span className="text-xs text-zinc-600">
                  Custom reminder:
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={reminderInput}
                  placeholder="15"
                  onChange={(e) => {
                    const cleaned = e.target.value.replace(/[^0-9]/g, "");
                    setReminderInput(cleaned);
                    setError(null);
                  }}
                  className={`w-20 px-2.5 py-1 text-xs font-semibold text-center border rounded-md bg-white focus:outline-none focus:ring-2 ${
                    !isReminderValid
                      ? "border-red-400 text-red-900 focus:ring-red-500"
                      : "border-zinc-300 text-zinc-900 focus:ring-orange-500"
                  }`}
                />
                <span className="text-xs text-zinc-600">
                  minutes before slot starts (+ automatic email at slot start &amp; completion)
                </span>
              </div>
            )}
          </div>

          {/* Slot Calculation Breakdown Box */}
          <div className="rounded-xl bg-blue-50/70 border border-blue-200 p-3.5 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-blue-900">
              <span className="font-medium">Active Print Window:</span>
              <span className="font-semibold">
                {format(selectedDate, "h:mm a")} –{" "}
                {format(printFinishTime, "h:mm a")} ({previewDuration} mins)
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-blue-800">
              <span className="flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                Mandatory Cooldown &amp; Bed Clear Buffer:
              </span>
              <span className="font-semibold">
                {format(printFinishTime, "h:mm a")} –{" "}
                {format(endTime, "h:mm a")} (+10 mins)
              </span>
            </div>
            <div className="pt-1.5 border-t border-blue-200/80 flex items-center justify-between text-xs font-bold text-blue-950">
              <span>Total Locked Schedule Block:</span>
              <span>
                {format(selectedDate, "EEE MMM d, h:mm a")} →{" "}
                {format(endTime, "h:mm a")}
              </span>
            </div>
          </div>

          {/* Overlap / Constraint Error Alert */}
          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-3.5 flex items-start gap-2.5 text-xs text-red-800">
              <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-bold">
                  {errorCode === "23P01"
                    ? "Schedule Overlap Blocked (GiST Constraint 23P01)"
                    : "Cannot Complete Reservation"}
                </div>
                <div>{error}</div>
              </div>
            </div>
          )}

          {/* Footer Buttons */}
          <div className="sticky bottom-0 bg-white pt-3 pb-1 border-t border-zinc-100 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-zinc-600 hover:text-zinc-900 rounded-lg border border-zinc-200 hover:bg-zinc-50 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                isSubmitting ||
                !isDurationValid ||
                !isReminderValid ||
                isStartInPast
              }
              className="px-5 py-2 text-xs font-bold text-white bg-orange-600 hover:bg-orange-700 disabled:opacity-40 rounded-lg shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              {isSubmitting ? "Reserving..." : "Confirm Reservation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
