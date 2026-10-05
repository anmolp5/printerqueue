"use client";

import React, {
  useEffect,
  useRef,
  useMemo,
  useCallback,
  useState,
} from "react";
import {
  addDays,
  format,
  isSameDay,
  isToday,
  startOfDay,
  startOfWeek,
} from "date-fns";
import { Keyboard } from "lucide-react";

interface IosWheelTimePickerProps {
  value: Date;
  onChange: (newDate: Date) => void;
}

const ITEM_HEIGHT = 38; // px per wheel row
const VISIBLE_ITEMS = 5; // 2 above, 1 center active, 2 below
const CONTAINER_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS; // 190px
const PADDING_Y = ITEM_HEIGHT * 2; // 76px top & bottom so center item aligns

const HOURS_12 = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES_15 = [0, 15, 30, 45];
const MERIDIEMS: Array<"AM" | "PM"> = ["AM", "PM"];

const LOOP_CYCLES = 31;
const MIDDLE_CYCLE = Math.floor(LOOP_CYCLES / 2); // 15

interface InfiniteWheelColumnProps<T> {
  items: T[];
  selectedIndex: number;
  onSelectIndex: (idx: number) => void;
  renderItem: (item: T, isSelected: boolean) => React.ReactNode;
  widthClass: string;
  loop?: boolean;
  onCenterClick?: () => void;
}

function InfiniteWheelColumn<T>({
  items,
  selectedIndex,
  onSelectIndex,
  renderItem,
  widthClass,
  loop = true,
  onCenterClick,
}: InfiniteWheelColumnProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isProgrammaticScroll = useRef(false);
  const initializedRef = useRef(false);

  const baseLen = items.length;
  const totalItems = loop ? baseLen * LOOP_CYCLES : baseLen;

  const getCenterCycleFlatIndex = useCallback(
    (modIdx: number) => {
      const safeMod = ((modIdx % baseLen) + baseLen) % baseLen;
      return loop ? MIDDLE_CYCLE * baseLen + safeMod : safeMod;
    },
    [baseLen, loop]
  );

  // Initial position in middle cycle (instant, no animation)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || initializedRef.current) return;
    initializedRef.current = true;
    const flatIdx = getCenterCycleFlatIndex(selectedIndex);
    el.scrollTop = flatIdx * ITEM_HEIGHT;
  }, [getCenterCycleFlatIndex, selectedIndex]);

  // Sync scroll position when selectedIndex changes externally (e.g. typed input)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !initializedRef.current) return;

    const currentFlatIdx = Math.round(el.scrollTop / ITEM_HEIGHT);
    const currentMod = ((currentFlatIdx % baseLen) + baseLen) % baseLen;

    if (currentMod !== selectedIndex) {
      let targetFlatIdx = getCenterCycleFlatIndex(selectedIndex);
      if (loop) {
        const currentCycle = Math.floor(currentFlatIdx / baseLen);
        const candidates = [
          (currentCycle - 1) * baseLen + selectedIndex,
          currentCycle * baseLen + selectedIndex,
          (currentCycle + 1) * baseLen + selectedIndex,
        ];
        targetFlatIdx = candidates.reduce((best, cand) =>
          Math.abs(cand - currentFlatIdx) < Math.abs(best - currentFlatIdx)
            ? cand
            : best
        );
      }

      isProgrammaticScroll.current = true;
      el.scrollTo({ top: targetFlatIdx * ITEM_HEIGHT, behavior: "smooth" });
      const t = setTimeout(() => {
        if (loop && scrollRef.current) {
          const recentered = getCenterCycleFlatIndex(selectedIndex);
          scrollRef.current.scrollTop = recentered * ITEM_HEIGHT;
        }
        isProgrammaticScroll.current = false;
      }, 240);
      return () => clearTimeout(t);
    }
  }, [baseLen, getCenterCycleFlatIndex, loop, selectedIndex]);

  const handleScroll = useCallback(() => {
    if (isProgrammaticScroll.current) return;
    const el = scrollRef.current;
    if (!el) return;

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      const rawFlatIdx = Math.round(el.scrollTop / ITEM_HEIGHT);
      const clampedFlatIdx = Math.max(
        0,
        Math.min(totalItems - 1, rawFlatIdx)
      );
      const modIdx = ((clampedFlatIdx % baseLen) + baseLen) % baseLen;

      if (modIdx !== selectedIndex) {
        onSelectIndex(modIdx);
      }

      if (loop) {
        const currentCycle = Math.floor(clampedFlatIdx / baseLen);
        if (Math.abs(currentCycle - MIDDLE_CYCLE) > 4) {
          const recenteredFlatIdx = getCenterCycleFlatIndex(modIdx);
          el.scrollTop = recenteredFlatIdx * ITEM_HEIGHT;
        }
      }
    }, 60);
  }, [
    baseLen,
    getCenterCycleFlatIndex,
    loop,
    onSelectIndex,
    selectedIndex,
    totalItems,
  ]);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      style={{
        height: `${CONTAINER_HEIGHT}px`,
        paddingTop: `${PADDING_Y}px`,
        paddingBottom: `${PADDING_Y}px`,
        scrollbarWidth: "none",
        msOverflowStyle: "none",
      }}
      className={`relative z-10 overflow-y-scroll snap-y snap-mandatory select-none [&::-webkit-scrollbar]:hidden ${widthClass}`}
    >
      {Array.from({ length: totalItems }, (_, flatIdx) => {
        const modIdx = flatIdx % baseLen;
        const item = items[modIdx];
        const isSelected = modIdx === selectedIndex;

        return (
          <div
            key={flatIdx}
            onClick={() => {
              if (isSelected && onCenterClick) {
                onCenterClick();
                return;
              }
              isProgrammaticScroll.current = true;
              if (scrollRef.current) {
                scrollRef.current.scrollTo({
                  top: flatIdx * ITEM_HEIGHT,
                  behavior: "smooth",
                });
              }
              onSelectIndex(modIdx);
              setTimeout(() => {
                if (loop && scrollRef.current) {
                  const recentered = getCenterCycleFlatIndex(modIdx);
                  scrollRef.current.scrollTop = recentered * ITEM_HEIGHT;
                }
                isProgrammaticScroll.current = false;
              }, 240);
            }}
            style={{ height: `${ITEM_HEIGHT}px` }}
            className={`snap-center flex items-center justify-center px-1.5 cursor-pointer transition-all duration-150 ${
              isSelected
                ? "opacity-100 scale-100 font-bold text-[#13294B]"
                : "opacity-45 scale-95 text-zinc-500 hover:opacity-75"
            }`}
          >
            {renderItem(item, isSelected)}
          </div>
        );
      })}
    </div>
  );
}

export const IosWheelTimePicker: React.FC<IosWheelTimePickerProps> = ({
  value,
  onChange,
}) => {
  const hourInputRef = useRef<HTMLInputElement>(null);
  const minuteInputRef = useRef<HTMLInputElement>(null);

  // Build a 14-day list starting from the Monday of the selected date's week
  const daysList = useMemo(() => {
    const weekMonday = startOfWeek(value, { weekStartsOn: 1 });
    return Array.from({ length: 14 }, (_, i) =>
      startOfDay(addDays(weekMonday, i))
    );
  }, [value]);

  const selectedDayIndex = useMemo(() => {
    const idx = daysList.findIndex((d) => isSameDay(d, value));
    return idx >= 0 ? idx : 0;
  }, [daysList, value]);

  const hour24 = value.getHours();
  const meridiem: "AM" | "PM" = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;

  const selectedHourIndex = HOURS_12.indexOf(hour12);
  const snappedMinute = MINUTES_15.reduce((prev, curr) =>
    Math.abs(curr - value.getMinutes()) < Math.abs(prev - value.getMinutes())
      ? curr
      : prev
  );
  const selectedMinuteIndex = MINUTES_15.indexOf(snappedMinute);
  const selectedMeridiemIndex = MERIDIEMS.indexOf(meridiem);

  // Stable typing state in top bar (never overwritten while focused)
  const [isHourFocused, setIsHourFocused] = useState(false);
  const [isMinuteFocused, setIsMinuteFocused] = useState(false);
  const [hourDraft, setHourDraft] = useState<string>(String(hour12));
  const [minuteDraft, setMinuteDraft] = useState<string>(
    String(snappedMinute).padStart(2, "0")
  );

  // Sync draft texts only when the user is NOT actively typing in that box
  useEffect(() => {
    if (!isHourFocused) {
      setHourDraft(String(hour12));
    }
  }, [hour12, isHourFocused]);

  useEffect(() => {
    if (!isMinuteFocused) {
      setMinuteDraft(String(snappedMinute).padStart(2, "0"));
    }
  }, [snappedMinute, isMinuteFocused]);

  const emitUpdatedDate = useCallback(
    (dayIdx: number, hrIdx: number, minIdx: number, merIdx: number) => {
      const safeDayIdx =
        ((dayIdx % daysList.length) + daysList.length) % daysList.length;
      const safeHrIdx =
        ((hrIdx % HOURS_12.length) + HOURS_12.length) % HOURS_12.length;
      const safeMinIdx =
        ((minIdx % MINUTES_15.length) + MINUTES_15.length) % MINUTES_15.length;
      const safeMerIdx =
        ((merIdx % MERIDIEMS.length) + MERIDIEMS.length) % MERIDIEMS.length;

      const baseDay = daysList[safeDayIdx] || daysList[0];
      const h12 = HOURS_12[safeHrIdx] ?? 12;
      const min = MINUTES_15[safeMinIdx] ?? 0;
      const mer = MERIDIEMS[safeMerIdx] ?? "AM";

      let h24 = h12 % 12;
      if (mer === "PM") h24 += 12;

      const next = new Date(baseDay);
      next.setHours(h24, min, 0, 0);
      onChange(next);
    },
    [daysList, onChange]
  );

  const commitTypedHour = (raw: string) => {
    setIsHourFocused(false);
    const num = parseInt(raw, 10);
    if (!Number.isNaN(num)) {
      if (num >= 1 && num <= 12) {
        const hrIdx = HOURS_12.indexOf(num);
        emitUpdatedDate(
          selectedDayIndex,
          hrIdx,
          selectedMinuteIndex,
          selectedMeridiemIndex
        );
        setHourDraft(String(num));
        return;
      } else if (num >= 13 && num <= 23) {
        const h12 = num - 12;
        const hrIdx = HOURS_12.indexOf(h12);
        emitUpdatedDate(selectedDayIndex, hrIdx, selectedMinuteIndex, 1);
        setHourDraft(String(h12));
        return;
      } else if (num === 0) {
        emitUpdatedDate(selectedDayIndex, 0, selectedMinuteIndex, 0);
        setHourDraft("12");
        return;
      }
    }
    setHourDraft(String(hour12));
  };

  const commitTypedMinute = (raw: string) => {
    setIsMinuteFocused(false);
    const num = parseInt(raw, 10);
    if (!Number.isNaN(num)) {
      const nearest = MINUTES_15.reduce((prev, curr) =>
        Math.abs(curr - num) < Math.abs(prev - num) ? curr : prev
      );
      const minIdx = MINUTES_15.indexOf(nearest);
      emitUpdatedDate(
        selectedDayIndex,
        selectedHourIndex,
        minIdx,
        selectedMeridiemIndex
      );
      setMinuteDraft(String(nearest).padStart(2, "0"));
      return;
    }
    setMinuteDraft(String(snappedMinute).padStart(2, "0"));
  };

  return (
    <div className="rounded-xl bg-zinc-50 border border-zinc-200 shadow-2xs overflow-hidden">
      {/* Top Interactive Typeable Bar */}
      <div className="px-3.5 py-2.5 bg-white border-b border-zinc-200 flex items-center justify-between gap-2 text-xs">
        <span className="text-zinc-600 flex items-center gap-1.5 font-medium">
          <Keyboard className="w-3.5 h-3.5 text-orange-500" />
          <span>Type time or scroll wheel:</span>
        </span>

        {/* Typeable HH : MM + AM/PM Input Box */}
        <div className="flex items-center gap-1.5 bg-zinc-50 border border-zinc-300 rounded-lg px-2.5 py-1 shadow-2xs">
          <input
            ref={hourInputRef}
            type="text"
            inputMode="numeric"
            aria-label="Hour (1-12)"
            value={hourDraft}
            onFocus={(e) => {
              setIsHourFocused(true);
              e.target.select();
            }}
            onChange={(e) => {
              const cleaned = e.target.value.replace(/[^0-9]/g, "").slice(0, 2);
              setHourDraft(cleaned);
            }}
            onBlur={() => commitTypedHour(hourDraft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitTypedHour(hourDraft);
                minuteInputRef.current?.focus();
              }
            }}
            className="w-8 text-center font-mono text-sm font-bold text-[#13294B] bg-white border border-zinc-300 rounded px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
          />
          <span className="font-bold text-zinc-500 text-sm">:</span>
          <input
            ref={minuteInputRef}
            type="text"
            inputMode="numeric"
            aria-label="Minute (00, 15, 30, 45)"
            value={minuteDraft}
            onFocus={(e) => {
              setIsMinuteFocused(true);
              e.target.select();
            }}
            onChange={(e) => {
              const cleaned = e.target.value.replace(/[^0-9]/g, "").slice(0, 2);
              setMinuteDraft(cleaned);
            }}
            onBlur={() => commitTypedMinute(minuteDraft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitTypedMinute(minuteDraft);
                minuteInputRef.current?.blur();
              }
            }}
            className="w-8 text-center font-mono text-sm font-bold text-[#13294B] bg-white border border-zinc-300 rounded px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
          />
          <button
            type="button"
            onClick={() =>
              emitUpdatedDate(
                selectedDayIndex,
                selectedHourIndex,
                selectedMinuteIndex,
                selectedMeridiemIndex === 0 ? 1 : 0
              )
            }
            className="ml-0.5 px-2 py-1 rounded bg-[#13294B] text-white font-bold text-xs hover:bg-slate-800 transition-colors cursor-pointer"
          >
            {meridiem}
          </button>
        </div>
      </div>

      {/* Drum Wheel Area */}
      <div className="relative select-none">
        {/* Top & Bottom Light Fade Masks Matching Site Theme */}
        <div
          style={{ height: `${PADDING_Y}px` }}
          className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-zinc-50 via-zinc-50/85 to-transparent"
        />
        <div
          style={{ height: `${PADDING_Y}px` }}
          className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-zinc-50 via-zinc-50/85 to-transparent"
        />

        {/* Center Highlight Selection Pill */}
        <div
          style={{
            top: `${PADDING_Y}px`,
            height: `${ITEM_HEIGHT}px`,
          }}
          className="pointer-events-none absolute inset-x-3 z-0 rounded-xl bg-white border border-orange-300 ring-2 ring-orange-500/10 shadow-xs flex items-center"
        />

        {/* 4 Drum Columns: Day (Loop) | Hour (Loop) | : | Minute (Loop) | AM/PM (Non-loop) */}
        <div className="relative flex items-center justify-center px-3 text-sm">
          {/* Column 1: Continuous Day Drum */}
          <InfiniteWheelColumn
            items={daysList}
            selectedIndex={selectedDayIndex}
            loop={true}
            onSelectIndex={(newDayIdx) =>
              emitUpdatedDate(
                newDayIdx,
                selectedHourIndex,
                selectedMinuteIndex,
                selectedMeridiemIndex
              )
            }
            widthClass="w-36"
            renderItem={(day, isSelected) => (
              <span
                className={`truncate text-xs sm:text-sm tracking-tight ${
                  isSelected ? "text-[#13294B] font-bold" : ""
                }`}
              >
                {isToday(day) ? "Today" : format(day, "EEE MMM d")}
              </span>
            )}
          />

          {/* Column 2: Continuous Hour Drum (1..12) — clicking center focuses Hour input */}
          <InfiniteWheelColumn
            items={HOURS_12}
            selectedIndex={selectedHourIndex}
            loop={true}
            onCenterClick={() => {
              hourInputRef.current?.focus();
              hourInputRef.current?.select();
            }}
            onSelectIndex={(newHrIdx) =>
              emitUpdatedDate(
                selectedDayIndex,
                newHrIdx,
                selectedMinuteIndex,
                selectedMeridiemIndex
              )
            }
            widthClass="w-14"
            renderItem={(h) => (
              <span className="font-mono text-base">{h}</span>
            )}
          />

          {/* Colon Divider */}
          <div className="z-20 text-[#13294B] font-bold text-base pb-0.5 select-none">
            :
          </div>

          {/* Column 3: Continuous 15-Min Drum (00, 15, 30, 45) — clicking center focuses Minute input */}
          <InfiniteWheelColumn
            items={MINUTES_15}
            selectedIndex={selectedMinuteIndex}
            loop={true}
            onCenterClick={() => {
              minuteInputRef.current?.focus();
              minuteInputRef.current?.select();
            }}
            onSelectIndex={(newMinIdx) =>
              emitUpdatedDate(
                selectedDayIndex,
                selectedHourIndex,
                newMinIdx,
                selectedMeridiemIndex
              )
            }
            widthClass="w-14"
            renderItem={(m) => (
              <span className="font-mono text-base">
                {String(m).padStart(2, "0")}
              </span>
            )}
          />

          {/* Column 4: Non-Continuous AM / PM Drum (only 2 items: AM and PM) */}
          <InfiniteWheelColumn
            items={MERIDIEMS}
            selectedIndex={selectedMeridiemIndex}
            loop={false}
            onSelectIndex={(newMerIdx) =>
              emitUpdatedDate(
                selectedDayIndex,
                selectedHourIndex,
                selectedMinuteIndex,
                newMerIdx
              )
            }
            widthClass="w-16"
            renderItem={(mer, isSelected) => (
              <span
                className={`text-xs font-bold tracking-wider px-2 py-0.5 rounded ${
                  isSelected
                    ? "bg-[#FF5F05] text-white shadow-2xs"
                    : "text-zinc-500"
                }`}
              >
                {mer}
              </span>
            )}
          />
        </div>
      </div>
    </div>
  );
};
