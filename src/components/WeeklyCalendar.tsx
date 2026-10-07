"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  format,
  addDays,
  addMinutes,
  isToday,
  isSameDay,
} from "date-fns";
import { CalendarBooking } from "@/lib/types";
import { getDayBookingSegments } from "@/lib/scheduling";
import {
  Play,
  CheckCircle2,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
} from "lucide-react";

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

type CalendarViewMode = "1d" | "3d" | "7d";

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
  const [viewMode, setViewMode] = useState<CalendarViewMode>("7d");
  const [userChoseViewMode, setUserChoseViewMode] = useState(false);

  const weekDays = Array.from({ length: 7 }, (_, i) =>
    addDays(currentWeekStart, i)
  );

  // Default selected day to Today if Today is in current week, otherwise Monday (0)
  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(() => {
    const todayIdx = weekDays.findIndex((d) => isToday(d));
    return todayIdx >= 0 ? todayIdx : 0;
  });

  // Update selectedDayIndex when week changes
  useEffect(() => {
    const days = Array.from({ length: 7 }, (_, i) =>
      addDays(currentWeekStart, i)
    );
    const todayIdx = days.findIndex((d) => isToday(d));
    setSelectedDayIndex(todayIdx >= 0 ? todayIdx : 0);
  }, [currentWeekStart]);

  // Auto-select 1D on mobile (<640px), 3D on tablet (<1024px), 7D on desktop unless user manually toggled
  useEffect(() => {
    if (typeof window === "undefined" || userChoseViewMode) return;
    const handleResize = () => {
      const w = window.innerWidth;
      if (w < 640) {
        setViewMode("1d");
      } else if (w < 1024) {
        setViewMode("3d");
      } else {
        setViewMode("7d");
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [userChoseViewMode]);

  // Update current time indicator every minute
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const scrollToCurrentTime = () => {
    if (scrollContainerRef.current) {
      const currentHour = new Date().getHours();
      const targetHour = Math.max(0, currentHour - 1);
      scrollContainerRef.current.scrollTop = targetHour * 128;
    }
  };

  // Scroll to ~1 hour before current time on mount
  useEffect(() => {
    scrollToCurrentTime();
  }, []);

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

  // Compute which days are rendered in the columns
  let visibleDays = weekDays;
  if (viewMode === "1d") {
    visibleDays = [weekDays[selectedDayIndex] || weekDays[0]];
  } else if (viewMode === "3d") {
    const startIdx = Math.min(4, Math.max(0, selectedDayIndex));
    visibleDays = weekDays.slice(startIdx, startIdx + 3);
  }

  const gridColsStyle = {
    gridTemplateColumns:
      viewMode === "1d"
        ? "64px minmax(0, 1fr)"
        : viewMode === "3d"
        ? "64px repeat(3, minmax(0, 1fr))"
        : "68px repeat(7, minmax(92px, 1fr))",
  };

  const handleStepDay = (delta: number) => {
    setSelectedDayIndex((prev) => Math.max(0, Math.min(6, prev + delta)));
  };

  return (
    <div className="flex flex-col border border-zinc-200 rounded-xl bg-white overflow-hidden shadow-sm">
      {/* Top View Mode & Mobile Day Selector Strip */}
      <div className="bg-zinc-50 border-b border-zinc-200 px-3 py-2.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Active Day Label + Prev/Next Day Arrows (for 1D / 3D mode) */}
          <div className="flex items-center gap-1.5">
            {viewMode !== "7d" && (
              <>
                <button
                  type="button"
                  onClick={() => handleStepDay(-1)}
                  disabled={selectedDayIndex === 0}
                  className="p-1.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-100 text-zinc-700 disabled:opacity-40 cursor-pointer"
                  title="Previous Day"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleStepDay(1)}
                  disabled={
                    viewMode === "3d"
                      ? selectedDayIndex >= 4
                      : selectedDayIndex >= 6
                  }
                  className="p-1.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-100 text-zinc-700 disabled:opacity-40 cursor-pointer"
                  title="Next Day"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </>
            )}
            <span className="text-xs sm:text-sm font-bold text-zinc-900 flex items-center gap-1.5 ml-1">
              <CalendarIcon className="w-3.5 h-3.5 text-orange-600 shrink-0" />
              {viewMode === "1d"
                ? format(visibleDays[0], "EEEE, MMM d")
                : viewMode === "3d"
                ? `${format(visibleDays[0], "EEE MMM d")} – ${format(
                    visibleDays[visibleDays.length - 1],
                    "EEE MMM d"
                  )}`
                : "Full 7-Day Week Schedule"}
            </span>
          </div>

          {/* 1D / 3D / 7D View Switcher + Scroll to Now */}
          <div className="flex items-center gap-1.5 ml-auto">
            <button
              type="button"
              onClick={scrollToCurrentTime}
              className="px-2.5 py-1 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-100 text-[11px] font-semibold text-zinc-700 cursor-pointer"
            >
              Jump to Now
            </button>
            <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-200/60 p-0.5">
              {(
                [
                  { id: "1d", label: "1 Day" },
                  { id: "3d", label: "3 Days" },
                  { id: "7d", label: "7 Days" },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setUserChoseViewMode(true);
                    setViewMode(m.id);
                  }}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                    viewMode === m.id
                      ? "bg-[#13294B] text-white shadow-2xs"
                      : "text-zinc-600 hover:text-zinc-900"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Horizontal 7-Day Pill Strip (Always shown on mobile/tablet or when in 1D/3D mode) */}
        <div
          className={`grid grid-cols-7 gap-1 ${
            viewMode === "7d" ? "lg:hidden" : ""
          }`}
        >
          {weekDays.map((day, idx) => {
            const today = isToday(day);
            const isSelected =
              viewMode === "1d"
                ? idx === selectedDayIndex
                : viewMode === "3d"
                ? visibleDays.some((vd) => isSameDay(vd, day))
                : today;
            const dayBookingCount = getDayBookingSegments(
              day,
              bookings,
              visibleStatuses
            ).length;

            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => {
                  setSelectedDayIndex(idx);
                  if (viewMode === "7d" && window.innerWidth < 640) {
                    setUserChoseViewMode(true);
                    setViewMode("1d");
                  }
                }}
                className={`py-1.5 px-1 rounded-xl flex flex-col items-center justify-center transition-all cursor-pointer border ${
                  isSelected
                    ? "bg-[#13294B] text-white border-[#13294B] shadow-xs"
                    : today
                    ? "bg-orange-50 text-orange-700 border-orange-300"
                    : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-100"
                }`}
              >
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider ${
                    isSelected
                      ? "text-orange-300"
                      : today
                      ? "text-orange-600"
                      : "text-zinc-400"
                  }`}
                >
                  {format(day, "EEE")}
                </span>
                <span className="text-sm font-extrabold leading-tight mt-0.5">
                  {format(day, "d")}
                </span>
                <div className="h-1.5 mt-0.5 flex items-center justify-center gap-0.5">
                  {dayBookingCount > 0 && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isSelected ? "bg-[#FF5F05]" : "bg-blue-600"
                      }`}
                    />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Horizontal Scroll Wrapper (Enables clean horizontal swipe if 7D is chosen on a phone) */}
      <div className="overflow-x-auto">
        <div
          className={
            viewMode === "7d" ? "min-w-[680px] sm:min-w-0" : "min-w-full"
          }
        >
          {/* Column Header */}
          <div
            style={gridColsStyle}
            className="grid border-b border-zinc-200 bg-zinc-50"
          >
            <div className="p-2 sm:p-3 text-[11px] font-semibold text-zinc-500 border-r border-zinc-200 flex items-center justify-center sticky left-0 bg-zinc-50 z-20">
              <span>Time</span>
            </div>
            {visibleDays.map((day) => {
              const today = isToday(day);
              return (
                <div
                  key={day.toISOString()}
                  className={`p-2 text-center border-r border-zinc-200 last:border-r-0 transition-colors ${
                    today ? "bg-orange-50/70" : ""
                  }`}
                >
                  <div
                    className={`text-[11px] font-semibold uppercase tracking-wider ${
                      today ? "text-orange-600" : "text-zinc-500"
                    }`}
                  >
                    {format(day, "EEE")}
                  </div>
                  <div
                    className={`mt-0.5 inline-flex items-center justify-center text-sm font-bold ${
                      today
                        ? "bg-orange-600 text-white w-6 h-6 sm:w-7 sm:h-7 rounded-full shadow-sm"
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

          {/* Scrollable 24-Hour Grid Container */}
          <div
            ref={scrollContainerRef}
            style={gridColsStyle}
            className="relative grid h-[560px] sm:h-[680px] overflow-y-auto divide-x divide-zinc-200 scroll-smooth"
          >
            {/* Time Sidebar */}
            <div className="flex flex-col divide-y divide-zinc-100 bg-zinc-50/95 select-none h-[3072px] overflow-hidden sticky left-0 z-20 border-r border-zinc-200">
              {timeSlots.map((slot, idx) => {
                const isHour = idx % 4 === 0;
                return (
                  <div
                    key={slot}
                    className={`h-8 shrink-0 pr-2 flex items-center justify-end text-[11px] ${
                      isHour
                        ? "font-semibold text-zinc-600 bg-zinc-100/60"
                        : "text-zinc-400"
                    }`}
                  >
                    {isHour ? (
                      slot
                    ) : (
                      <span className="opacity-40 text-[9px]">{slot}</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Day Columns */}
            {visibleDays.map((day) => {
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
                        className={`group h-8 shrink-0 hover:bg-emerald-50/80 active:bg-emerald-100/80 transition-colors cursor-pointer flex items-center justify-center ${
                          isHour ? "border-t border-zinc-200/80" : ""
                        }`}
                      >
                        <span className="opacity-0 group-hover:opacity-100 text-[10px] font-medium text-emerald-700 transition-opacity select-none">
                          + Book {slot}
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
                              <span className="font-semibold truncate text-[11px] sm:text-xs leading-tight">
                                {continuesBefore
                                  ? `↳ ${b.file_name}`
                                  : b.file_name}
                              </span>
                              {b.status === "in_progress" && (
                                <span className="shrink-0 inline-flex items-center gap-0.5 px-1 py-0.2 rounded bg-amber-900/50 text-[9px] font-bold uppercase tracking-wider">
                                  <Play className="w-2.5 h-2.5 fill-current" />{" "}
                                  Live
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
                            <div className="text-[9px] sm:text-[10px] text-white/90 flex items-center justify-between pt-0.5">
                              <span className="font-medium truncate">
                                {continuesBefore
                                  ? `00:00–${format(
                                      endDate,
                                      "HH:mm"
                                    )} (from ${format(startDate, "EEE HH:mm")})`
                                  : continuesAfter
                                  ? `${format(
                                      startDate,
                                      "HH:mm"
                                    )}–24:00 (→ ${format(
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
                              Continues past midnight →{" "}
                              {format(endDate, "EEE HH:mm")}
                            </span>
                          </div>
                        ) : (
                          !continuesAfter &&
                          b.status !== "completed" &&
                          heightPx >= 44 && (
                            <div
                              style={{
                                height: `${Math.max(14, bufferHeightPx)}px`,
                              }}
                              className="bg-black/25 px-1.5 flex items-center justify-between text-[9px] text-white/90 border-t border-white/15 shrink-0"
                            >
                              <span className="truncate flex items-center gap-0.5">
                                <Sparkles className="w-2.5 h-2.5" /> +
                                {b.buffer_minutes}m cooldown buffer
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
      </div>
    </div>
  );
};
