"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  format,
  addDays,
  addMinutes,
  isToday,
} from "date-fns";
import { CalendarBooking } from "@/lib/types";
import { getDayBookingSegments } from "@/lib/scheduling";
import { Play, CheckCircle2, Sparkles } from "lucide-react";

interface WeeklyCalendarProps {
  bookings: CalendarBooking[];
  currentWeekStart: Date; // e.g., startOfWeek(new Date(), { weekStartsOn: 1 })
  currentUserId?: string;
  currentUserEmail?: string;
  isAdmin: boolean;
  showCompleted: boolean;
  onSelectSlot: (slotTime: Date) => void;
  onAdminClickBooking: (booking: CalendarBooking) => void;
}

export const WeeklyCalendar: React.FC<WeeklyCalendarProps> = ({
  bookings,
  currentWeekStart,
  currentUserId,
  currentUserEmail,
  isAdmin,
  showCompleted,
  onSelectSlot,
  onAdminClickBooking,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState<Date>(new Date());

  // Update current time indicator every minute
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Scroll to ~7:30 AM or 1 hour before current time on mount
  useEffect(() => {
    if (scrollContainerRef.current) {
      const currentHour = new Date().getHours();
      const targetHour = Math.max(0, currentHour - 1);
      // Each hour is 4 slots * 32px = 128px
      scrollContainerRef.current.scrollTop = targetHour * 128;
    }
  }, []);

  const weekDays = Array.from({ length: 7 }, (_, i) =>
    addDays(currentWeekStart, i)
  );
  const timeSlots = Array.from({ length: 96 }, (_, i) => {
    const totalMinutes = i * 15;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
      2,
      "0"
    )}`;
  });

  const visibleStatuses = showCompleted
    ? ["scheduled", "in_progress", "completed"]
    : ["scheduled", "in_progress"];

  return (
    <div className="flex flex-col border border-zinc-200 rounded-xl bg-white overflow-hidden shadow-sm">
      {/* Week Header */}
      <div className="grid grid-cols-8 border-b border-zinc-200 bg-zinc-50">
        <div className="p-3 text-xs font-semibold text-zinc-500 border-r border-zinc-200 flex items-center justify-center">
          <span>Time (24h)</span>
        </div>
        {weekDays.map((day) => {
          const today = isToday(day);
          return (
            <div
              key={day.toISOString()}
              className={`p-2.5 text-center border-r border-zinc-200 last:border-r-0 transition-colors ${
                today ? "bg-orange-50/70" : ""
              }`}
            >
              <div
                className={`text-xs font-semibold uppercase tracking-wider ${
                  today ? "text-orange-600" : "text-zinc-500"
                }`}
              >
                {format(day, "EEE")}
              </div>
              <div
                className={`mt-0.5 inline-flex items-center justify-center text-sm font-bold ${
                  today
                    ? "bg-orange-600 text-white w-7 h-7 rounded-full shadow-sm"
                    : "text-zinc-800"
                }`}
              >
                {format(day, "d")}
              </div>
              <div className="text-[10px] text-zinc-400">
                {format(day, "MMM")}
              </div>
            </div>
          );
        })}
      </div>

      {/* Grid Container */}
      <div
        ref={scrollContainerRef}
        className="relative grid grid-cols-8 h-[680px] overflow-y-auto divide-x divide-zinc-200 scroll-smooth"
      >
        {/* Time Sidebar */}
        <div className="flex flex-col divide-y divide-zinc-100 bg-zinc-50/70 select-none h-[3072px] overflow-hidden">
          {timeSlots.map((slot, idx) => {
            const isHour = idx % 4 === 0;
            return (
              <div
                key={slot}
                className={`h-8 shrink-0 pr-2.5 flex items-center justify-end text-[11px] ${
                  isHour
                    ? "font-semibold text-zinc-600 bg-zinc-100/50"
                    : "text-zinc-400"
                }`}
              >
                {isHour ? slot : <span className="opacity-40 text-[9px]">{slot}</span>}
              </div>
            );
          })}
        </div>

        {/* Day Columns */}
        {weekDays.map((day) => {
          const daySegments = getDayBookingSegments(
            day,
            bookings,
            visibleStatuses
          );
          const today = isToday(day);
          const nowMins = now.getHours() * 60 + now.getMinutes();
          const nowTopPx = (nowMins / 15) * 32;

          return (
            <div
              key={day.toISOString()}
              className={`relative flex flex-col divide-y divide-zinc-100 h-[3072px] overflow-hidden ${
                today ? "bg-orange-50/10" : ""
              }`}
            >
              {/* Current Time Red Line Indicator */}
              {today && (
                <div
                  style={{ top: `${nowTopPx}px` }}
                  className="absolute inset-x-0 z-20 pointer-events-none flex items-center"
                >
                  <div className="w-2 h-2 rounded-full bg-red-500 -ml-1 shadow" />
                  <div className="flex-1 border-t-2 border-red-500" />
                </div>
              )}

              {/* Empty Clickable Slots (15-min increments) */}
              {timeSlots.map((slot, idx) => {
                const [hrs, mins] = slot.split(":").map(Number);
                const slotDateTime = addMinutes(day, hrs * 60 + mins);
                const isHour = idx % 4 === 0;

                return (
                  <div
                    key={slot}
                    onClick={() => onSelectSlot(slotDateTime)}
                    title={`Book Bambu X1C at ${format(
                      slotDateTime,
                      "EEE MMM d, HH:mm"
                    )}`}
                    className={`group h-8 shrink-0 hover:bg-emerald-50/80 transition-colors cursor-pointer flex items-center justify-center ${
                      isHour ? "border-t border-zinc-200/80" : ""
                    }`}
                  >
                    <span className="opacity-0 group-hover:opacity-100 text-[10px] font-medium text-emerald-700 transition-opacity select-none">
                      + {slot}
                    </span>
                  </div>
                );
              })}

              {/* Absolute Overlay Booking Segments (Clamped cleanly at 00:00 and 24:00) */}
              {daySegments.map((seg) => {
                const {
                  booking: b,
                  startMinsFromMidnight,
                  segmentDurationMins,
                  continuesBefore,
                  continuesAfter,
                } = seg;

                const startDate = new Date(b.start_time);
                const endDate = new Date(b.end_time);

                // 32px height per 15 min, strictly clamped so topPx + heightPx <= 3072px
                const topPx = Math.max(
                  0,
                  Math.min(3048, (startMinsFromMidnight / 15) * 32)
                );
                const maxAvailablePx = Math.max(24, 3072 - topPx);
                const rawHeightPx = (segmentDurationMins / 15) * 32;
                const heightPx = Math.min(
                  maxAvailablePx,
                  Math.max(24, rawHeightPx)
                );

                const bufferHeightPx = Math.min(
                  heightPx * 0.35,
                  (b.buffer_minutes / 15) * 32
                );

                const isOwnBooking =
                  currentUserId === b.user_id ||
                  Boolean(
                    currentUserEmail &&
                      b.user_email.toLowerCase() ===
                        currentUserEmail.toLowerCase()
                  );
                const isClickable = isAdmin || isOwnBooking;

                let statusColor =
                  "bg-blue-600/95 border-blue-700 hover:ring-2 hover:ring-blue-400";
                if (b.status === "in_progress") {
                  statusColor =
                    "bg-amber-600/95 border-amber-700 hover:ring-2 hover:ring-amber-400";
                } else if (b.status === "completed") {
                  statusColor =
                    "bg-emerald-700/85 border-emerald-800 hover:ring-2 hover:ring-emerald-400";
                }

                const borderRadiusClass =
                  continuesBefore && continuesAfter
                    ? "rounded-none border-y-0"
                    : continuesBefore
                    ? "rounded-t-none rounded-b-md border-t-2 border-t-white/40"
                    : continuesAfter
                    ? "rounded-t-md rounded-b-none border-b-2 border-b-white/40"
                    : "rounded-md";

                return (
                  <div
                    key={`${b.id}-${day.toISOString()}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isAdmin || isOwnBooking) {
                        onAdminClickBooking(b);
                      }
                    }}
                    style={{ top: `${topPx}px`, height: `${heightPx}px` }}
                    className={`absolute inset-x-1 border text-xs text-white z-10 flex flex-col justify-between overflow-hidden shadow-sm transition-all ${borderRadiusClass} ${statusColor} ${
                      isClickable ? "cursor-pointer" : "cursor-default"
                    }`}
                  >
                    <div className="p-1.5 min-h-0 flex-1 flex flex-col justify-between overflow-hidden">
                      <div>
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-semibold truncate text-[11px] leading-tight">
                            {continuesBefore ? `↳ ${b.file_name}` : b.file_name}
                          </span>
                          {b.status === "in_progress" && (
                            <span className="shrink-0 inline-flex items-center gap-0.5 px-1 py-0.2 rounded bg-amber-900/50 text-[9px] font-bold uppercase tracking-wider">
                              <Play className="w-2.5 h-2.5 fill-current" /> Live
                            </span>
                          )}
                          {b.status === "completed" && (
                            <CheckCircle2 className="w-3 h-3 shrink-0 text-emerald-200" />
                          )}
                        </div>
                        {heightPx >= 42 && (
                          <div className="text-[10px] text-white/85 truncate flex items-center gap-1 mt-0.5">
                            <span>
                              {b.user_email.replace("@illinois.edu", "")}
                            </span>
                            {isOwnBooking && (
                              <span className="bg-white/20 px-1 rounded text-[9px] font-semibold">
                                YOU
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {heightPx >= 54 && (
                        <div className="text-[9px] text-white/90 flex items-center justify-between pt-0.5">
                          <span className="font-medium truncate">
                            {continuesBefore
                              ? `00:00–${format(endDate, "HH:mm")} (from ${format(
                                  startDate,
                                  "EEE HH:mm"
                                )})`
                              : continuesAfter
                              ? `${format(startDate, "HH:mm")}–24:00 (→ ${format(
                                  endDate,
                                  "EEE HH:mm"
                                )})`
                              : `${format(startDate, "HH:mm")}–${format(
                                  endDate,
                                  "HH:mm"
                                )}`}
                          </span>
                          <span className="shrink-0 ml-1">
                            {b.duration_minutes}m
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Visual footer strip: either "Continues next day" or "+10m cooldown buffer" */}
                    {continuesAfter && heightPx >= 44 ? (
                      <div className="bg-black/30 px-1.5 py-0.5 flex items-center justify-between text-[9px] text-white/95 border-t border-white/20 shrink-0 font-semibold">
                        <span className="truncate">
                          Continues past midnight → {format(endDate, "EEE HH:mm")}
                        </span>
                      </div>
                    ) : (
                      !continuesAfter &&
                      b.status !== "completed" &&
                      heightPx >= 44 && (
                        <div
                          style={{ height: `${Math.max(14, bufferHeightPx)}px` }}
                          className="bg-black/25 px-1.5 flex items-center justify-between text-[9px] text-white/90 border-t border-white/15 shrink-0"
                        >
                          <span className="truncate flex items-center gap-0.5">
                            <Sparkles className="w-2.5 h-2.5" /> +10m cooldown buffer
                          </span>
                        </div>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};
