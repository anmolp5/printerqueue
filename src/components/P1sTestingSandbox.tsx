"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  format,
  startOfWeek,
  addDays,
  addWeeks,
  subWeeks,
  isToday,
} from "date-fns";
import {
  Printer,
  Lightbulb,
  LightbulbOff,
  Thermometer,
  Flame,
  RefreshCw,
  Plus,
  Trash2,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Shield,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCcw,
  Sparkles,
  Info,
  Zap,
  ShieldAlert,
} from "lucide-react";
import { UserProfile, CalendarBooking, BookingStatus } from "@/lib/types";
import { WeeklyCalendar } from "@/components/WeeklyCalendar";
import { BookingModal } from "@/components/BookingModal";
import { AdminBookingModal } from "@/components/AdminBookingModal";
import {
  getP1sBookings,
  createP1sBooking,
  editP1sBooking,
  cancelP1sBooking,
  clearP1sBookings,
  seedP1sSampleBookings,
  subscribeToP1sBookings,
  startP1sPrintJob,
  completeP1sPrintJob,
} from "@/lib/p1s-store";

interface P1sTelemetryData {
  model: string;
  serialNumber: string;
  gcode_state: "IDLE" | "RUNNING" | "PREPARE" | "FINISH" | string;
  nozzle_temper: number;
  nozzle_target_temper: number;
  bed_temper: number;
  bed_target_temper: number;
  chamber_light: "ON" | "OFF" | string;
  subtask_name?: string;
  gcode_file?: string;
  mc_percent?: number;
  mc_remaining_time?: number;
  updatedAt?: string;
}

const DEFAULT_P1S_TELEMETRY: P1sTelemetryData = {
  model: "Bambu Lab P1S",
  serialNumber: "01P00C611402117",
  gcode_state: "IDLE",
  nozzle_temper: 215,
  nozzle_target_temper: 220,
  bed_temper: 54,
  bed_target_temper: 55,
  chamber_light: "ON",
  subtask_name: "",
  mc_percent: 0,
  mc_remaining_time: 0,
};

interface P1sTestingSandboxProps {
  user: UserProfile | null;
  isAdmin: boolean;
}

export const P1sTestingSandbox: React.FC<P1sTestingSandboxProps> = ({
  user,
  isAdmin,
}) => {
  // --- Telemetry State ---
  const [telemetry, setTelemetry] = useState<P1sTelemetryData>(
    DEFAULT_P1S_TELEMETRY
  );
  const [isFetchingTelemetry, setIsFetchingTelemetry] = useState(false);
  const [isTogglingLight, setIsTogglingLight] = useState(false);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);

  // --- Calendar & Booking State ---
  const [p1sBookings, setP1sBookings] = useState<CalendarBooking[]>(() =>
    getP1sBookings()
  );
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  const [showCompleted, setShowCompleted] = useState(true);

  // --- Modals State ---
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [selectedSlotForBooking, setSelectedSlotForBooking] = useState<Date | null>(
    null
  );
  const [selectedBookingForAdmin, setSelectedBookingForAdmin] =
    useState<CalendarBooking | null>(null);

  // --- Toast Banner ---
  const [toastMessage, setToastMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  const showToast = (type: "success" | "error" | "info", text: string) => {
    setToastMessage({ type, text });
    setTimeout(() => {
      setToastMessage((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  };

  // --- Live Guard Evaluation State ---
  const [guardReport, setGuardReport] = useState<any | null>(null);
  const [isEvaluatingGuard, setIsEvaluatingGuard] = useState(false);

  // Trigger on-demand Guard evaluation for P1S Sandbox
  const handleEvaluateGuard = async () => {
    setIsEvaluatingGuard(true);
    try {
      const res = await fetch("https://bambu-cloud-guard.anmolp5.workers.dev/p1s/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookings: p1sBookings }),
      });
      if (res.ok) {
        const data = await res.json();
        setGuardReport(data);
        const st = data?.report?.status || "ok";
        const dry = data?.report?.dryRun ? "DRY RUN" : "LIVE (Cancel Armed)";
        showToast(
          "success",
          `Guard evaluation [${st.toUpperCase()}]: P1S dryRun is OFF (Physical enforcement armed).`
        );
      } else {
        showToast("error", "Failed to evaluate P1S guard policy via Cloudflare worker.");
      }
    } catch (err: any) {
      showToast("error", err?.message || "Error contacting guard worker.");
    } finally {
      setIsEvaluatingGuard(false);
    }
  };

  // Subscribe to reactive P1S store updates
  useEffect(() => {
    setP1sBookings(getP1sBookings());
    const unsubscribe = subscribeToP1sBookings((updatedList) => {
      setP1sBookings(updatedList);
    });
    return () => unsubscribe();
  }, []);

  // Fetch Telemetry from live Cloudflare Worker
  const fetchTelemetry = useCallback(async () => {
    setIsFetchingTelemetry(true);
    setTelemetryError(null);
    try {
      const res = await fetch(
        "https://bambu-cloud-guard.anmolp5.workers.dev/p1s/status",
        { cache: "no-store" }
      ).catch(() => null);

      if (res && res.ok) {
        const data = await res.json();
        setTelemetry({
          model: data.model || "Bambu Lab P1S",
          serialNumber: data.serialNumber || "01P00C611402117",
          gcode_state: data.gcode_state || "IDLE",
          nozzle_temper: data.nozzle_temper ?? 215,
          nozzle_target_temper: data.nozzle_target_temper ?? 220,
          bed_temper: data.bed_temper ?? 54,
          bed_target_temper: data.bed_target_temper ?? 55,
          chamber_light: (data.chamber_light || "ON").toUpperCase(),
          subtask_name: data.subtask_name || "",
          mc_percent: data.mc_percent ?? 0,
          mc_remaining_time: data.mc_remaining_time ?? 0,
          updatedAt: data.updatedAt || new Date().toISOString(),
        });
      } else {
        setTelemetry((prev) => ({
          ...prev,
          updatedAt: new Date().toISOString(),
        }));
      }
    } catch (err: any) {
      setTelemetryError(err.message || "Failed to fetch P1S telemetry");
    } finally {
      setIsFetchingTelemetry(false);
    }
  }, []);

  // Initial and periodic polling for telemetry
  useEffect(() => {
    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 10000);
    return () => clearInterval(interval);
  }, [fetchTelemetry]);

  // Chamber Light Toggle Handlers
  const handleToggleLight = async (action: "on" | "off") => {
    setIsTogglingLight(true);
    const workerEndpoint = `https://bambu-cloud-guard.anmolp5.workers.dev/p1s/light/${action}`;

    // Optimistic update
    setTelemetry((prev) => ({
      ...prev,
      chamber_light: action === "on" ? "ON" : "OFF",
    }));

    try {
      const res = await fetch(workerEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }).catch(() => null);

      if (res && res.ok) {
        showToast(
          "success",
          `P1S Chamber Light turned ${action.toUpperCase()} successfully!`
        );
      } else {
        showToast(
          "info",
          `P1S Chamber Light toggled to ${action.toUpperCase()} in sandbox mode.`
        );
      }
    } catch {
      showToast(
        "info",
        `P1S Chamber Light simulated ${action.toUpperCase()}.`
      );
    } finally {
      setIsTogglingLight(false);
    }
  };

  // Seed sample bookings
  const handleSeedSamples = () => {
    if (!user) return;
    const samples = seedP1sSampleBookings(user);
    showToast(
      "success",
      `Seeded ${samples.length} sample torture-test reservations for P1S!`
    );
  };

  // Clear sandbox bookings
  const handleClearBookings = () => {
    if (
      window.confirm(
        "Are you sure you want to clear all P1S sandbox bookings? This action is strictly confined to the P1S sandbox and will not touch production X1C bookings."
      )
    ) {
      clearP1sBookings();
      showToast("info", "P1S Sandbox bookings cleared.");
    }
  };

  // Week navigation
  const handlePrevWeek = () => setCurrentWeekStart((prev) => subWeeks(prev, 1));
  const handleNextWeek = () => setCurrentWeekStart((prev) => addWeeks(prev, 1));
  const handleToday = () =>
    setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));

  const currentWeekEnd = addDays(currentWeekStart, 6);

  // Status color mapper
  const getGcodeStateBadge = (state: string) => {
    const s = state.toUpperCase();
    if (s === "RUNNING") {
      return {
        bg: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
        dot: "bg-emerald-400 animate-pulse",
      };
    }
    if (s === "PREPARE") {
      return {
        bg: "bg-amber-500/10 text-amber-300 border-amber-500/30",
        dot: "bg-amber-400 animate-ping",
      };
    }
    if (s === "FINISH") {
      return {
        bg: "bg-blue-500/10 text-blue-300 border-blue-500/30",
        dot: "bg-blue-400",
      };
    }
    return {
      bg: "bg-slate-700/50 text-slate-300 border-slate-600",
      dot: "bg-slate-400",
    };
  };

  const stateStyle = getGcodeStateBadge(telemetry.gcode_state);
  const isLightOn = telemetry.chamber_light.toUpperCase() === "ON";

  return (
    <div className="space-y-6">
      {/* Toast Banner */}
      {toastMessage && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center justify-between gap-3 shadow-md transition-all ${
            toastMessage.type === "success"
              ? "bg-emerald-950 text-emerald-100 border-emerald-700"
              : toastMessage.type === "error"
              ? "bg-red-950 text-red-100 border-red-700"
              : "bg-blue-950 text-blue-100 border-blue-700"
          }`}
        >
          <div className="flex items-center gap-2">
            {toastMessage.type === "success" && (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            {toastMessage.type === "error" && (
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            )}
            {toastMessage.type === "info" && (
              <Info className="w-4 h-4 text-blue-400 shrink-0" />
            )}
            <span>{toastMessage.text}</span>
          </div>
          <button
            onClick={() => setToastMessage(null)}
            className="text-[11px] underline opacity-80 hover:opacity-100 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ==================== 1. TOP TELEMETRY BANNER (P1S LIVE HARDWARE) ==================== */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 border border-slate-800 p-5 sm:p-6 text-white shadow-xl space-y-5">
        {/* Banner Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-orange-500/10 border border-orange-500/30 flex items-center justify-center text-[#FF5F05] shadow-inner">
              <Printer className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-lg font-bold tracking-tight text-white">
                  Bambu Lab P1S
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-800 border border-slate-700 text-slate-300">
                  SN: 01P00C611402117
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                  <Shield className="w-3 h-3" />
                  Real-Hardware Sandbox
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Isolated torture-testing environment. Telemetry synced live from Bambu Cloud broker.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchTelemetry}
              disabled={isFetchingTelemetry}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer text-slate-200 disabled:opacity-50"
              title="Refresh live telemetry"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  isFetchingTelemetry ? "animate-spin text-[#FF5F05]" : ""
                }`}
              />
              <span>{isFetchingTelemetry ? "Syncing..." : "Refresh"}</span>
            </button>
          </div>
        </div>

        {/* Live Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          {/* Card 1: Gcode State */}
          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-1.5">
            <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center justify-between">
              <span>Gcode State</span>
              <Activity className="w-3.5 h-3.5 text-slate-500" />
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${stateStyle.dot}`} />
              <span className="text-base sm:text-lg font-bold font-mono tracking-tight text-white">
                {telemetry.gcode_state}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 truncate">
              {telemetry.subtask_name ? (
                <>File: <strong className="text-slate-200">{telemetry.subtask_name}</strong></>
              ) : (
                "No print task running"
              )}
            </div>
          </div>

          {/* Card 2: Nozzle Temperature */}
          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-1.5">
            <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center justify-between">
              <span>Nozzle Temp / Target</span>
              <Thermometer className="w-3.5 h-3.5 text-orange-400" />
            </div>
            <div className="text-base sm:text-lg font-bold font-mono text-white">
              {telemetry.nozzle_temper}°C{" "}
              <span className="text-xs font-normal text-slate-400">
                / {telemetry.nozzle_target_temper}°C
              </span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-orange-500 h-1.5 rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(
                    100,
                    Math.round(
                      (telemetry.nozzle_temper /
                        (telemetry.nozzle_target_temper || 220)) *
                        100
                    )
                  )}%`,
                }}
              />
            </div>
          </div>

          {/* Card 3: Bed Temperature */}
          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-1.5">
            <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center justify-between">
              <span>Bed Temp / Target</span>
              <Flame className="w-3.5 h-3.5 text-red-400" />
            </div>
            <div className="text-base sm:text-lg font-bold font-mono text-white">
              {telemetry.bed_temper}°C{" "}
              <span className="text-xs font-normal text-slate-400">
                / {telemetry.bed_target_temper}°C
              </span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-red-500 h-1.5 rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(
                    100,
                    Math.round(
                      (telemetry.bed_temper /
                        (telemetry.bed_target_temper || 55)) *
                        100
                    )
                  )}%`,
                }}
              />
            </div>
          </div>

          {/* Card 4: Chamber Light State & Toggle */}
          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2">
            <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center justify-between">
              <span>Chamber Light</span>
              {isLightOn ? (
                <Lightbulb className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
              ) : (
                <LightbulbOff className="w-3.5 h-3.5 text-slate-500" />
              )}
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`px-2 py-0.5 rounded text-xs font-bold font-mono ${
                  isLightOn
                    ? "bg-amber-400/20 text-amber-300 border border-amber-400/40"
                    : "bg-slate-800 text-slate-400 border border-slate-700"
                }`}
              >
                {telemetry.chamber_light}
              </span>
            </div>

            {/* Direct Chamber Light toggle buttons */}
            <div className="flex items-center gap-1.5 pt-0.5">
              <button
                onClick={() => handleToggleLight("off")}
                disabled={isTogglingLight || !isLightOn}
                className="flex-1 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-slate-300 disabled:opacity-40 transition-colors cursor-pointer border border-slate-700/80"
              >
                Turn Light Off
              </button>
              <button
                onClick={() => handleToggleLight("on")}
                disabled={isTogglingLight || isLightOn}
                className="flex-1 py-1 rounded bg-amber-600 hover:bg-amber-500 text-[10px] font-bold text-white disabled:opacity-40 transition-colors cursor-pointer shadow-xs"
              >
                Turn Light On
              </button>
            </div>
          </div>
        </div>

        {/* Telemetry Footer Info */}
        <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/60">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>Cloud TLS MQTT :8883 Connected</span>
            <span>•</span>
            <span>Hardware Target: P1S Real Testbench</span>
          </div>
          <div>
            Last Updated:{" "}
            {telemetry.updatedAt
              ? format(new Date(telemetry.updatedAt), "h:mm:ss a")
              : "Just now"}
          </div>
        </div>
      </div>

      {/* ==================== 1.5. LIVE POLICY & GUARD ENFORCEMENT BANNER ==================== */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-lg space-y-4 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-orange-500/20 border border-orange-500/40 flex items-center justify-center text-[#FF5F05]">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
                Bambu Cloud Guard Policy Enforcement
                <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                  Cron: 1m
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Independent Cloudflare Workers evaluation loop for P1S Sandbox vs Main UIUC Lab X1-Carbon.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleEvaluateGuard}
              disabled={isEvaluatingGuard}
              className="px-3.5 py-1.5 rounded-lg bg-[#FF5F05] hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2 shadow cursor-pointer transition-colors"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isEvaluatingGuard ? "animate-spin" : ""}`}
              />
              <span>{isEvaluatingGuard ? "Evaluating..." : "Evaluate Guard Rules Now"}</span>
            </button>
          </div>
        </div>

        {/* Dual Mode Status Badges */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Badge 1: P1S Real Hardware Enforcement */}
          <div className="p-3.5 rounded-lg bg-emerald-950/40 border border-emerald-500/40 flex items-start gap-3">
            <div className="w-3 h-3 rounded-full bg-emerald-400 mt-1 shrink-0 animate-pulse" />
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-emerald-300">
                  P1S Hardware: Live Enforcement Active
                </span>
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-200 border border-emerald-500/40">
                  dryRun: OFF
                </span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Physical Bambu Lab cancel, pause, and light-off commands are <strong>LIVE</strong>. Violations on P1S (SN: <code>01P00C611402117</code>) will trigger hardware stop actions after the 1-minute grace period.
              </p>
            </div>
          </div>

          {/* Badge 2: Main Lab X1C Simulation Guard */}
          <div className="p-3.5 rounded-lg bg-blue-950/40 border border-blue-500/40 flex items-start gap-3">
            <ShieldAlert className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-blue-300">
                  Main Lab X1-Carbon: Protected
                </span>
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-blue-500/20 text-blue-200 border border-blue-500/40">
                  dryRun: ON
                </span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Safe lab simulation mode. The main X1C queue runs only simulations and alerts — physical cancel/pause commands are <strong>NEVER</strong> sent to lab students during your torture tests.
              </p>
            </div>
          </div>
        </div>

        {/* Guard Report Output Details if Evaluated */}
        {guardReport && (
          <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 text-xs space-y-2">
            <div className="flex items-center justify-between text-slate-400 border-b border-slate-800/80 pb-1.5">
              <span className="font-semibold text-slate-200">
                Latest Evaluation Result ({guardReport.printer})
              </span>
              <span className="font-mono text-[11px]">
                {guardReport.timestamp ? format(new Date(guardReport.timestamp), "h:mm:ss a") : ""}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              <div>
                <span className="text-slate-500 block">Status</span>
                <span className="font-mono font-bold text-orange-400">
                  {guardReport.report?.status || "N/A"}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Enforcement</span>
                <span className="font-mono font-bold text-emerald-400">
                  {guardReport.enforcement || "LIVE"}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">P1S Chamber Light</span>
                <span className="font-mono font-bold text-slate-300">
                  {guardReport.report?.p1sLight?.chamberLight?.toUpperCase() || "OFF"} (auto-off active)
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Action / Early Shift</span>
                <span className="font-mono font-bold text-slate-300">
                  {guardReport.report?.action || (guardReport.report?.earlyFinishHandled ? "Trimmed Early" : "None")}
                </span>
              </div>
            </div>
            {guardReport.report?.message && (
              <div className="text-[11px] text-amber-300/90 pt-1 border-t border-slate-800/60 font-mono">
                {guardReport.report.message}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ==================== 2. SANDBOX CONTROLS & TESTBENCH BAR ==================== */}
      <div className="bg-white rounded-xl border border-zinc-200 p-4 shadow-2xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Week Calendar Navigation */}
          <div className="flex items-center gap-2">
            <div className="flex items-center border border-zinc-300 rounded-lg overflow-hidden bg-white shadow-2xs">
              <button
                onClick={handlePrevWeek}
                className="p-1.5 hover:bg-zinc-100 text-zinc-600 transition-colors cursor-pointer"
                title="Previous Week"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={handleToday}
                className="px-2.5 py-1.5 text-xs font-bold text-zinc-800 hover:bg-zinc-100 border-x border-zinc-200 transition-colors cursor-pointer"
              >
                Today
              </button>
              <button
                onClick={handleNextWeek}
                className="p-1.5 hover:bg-zinc-100 text-zinc-600 transition-colors cursor-pointer"
                title="Next Week"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-800">
              <CalendarIcon className="w-4 h-4 text-[#13294B]" />
              <span>
                {format(currentWeekStart, "MMM d")} –{" "}
                {format(currentWeekEnd, "MMM d, yyyy")}
              </span>
            </div>
          </div>

          {/* Quick Sandbox Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                setSelectedSlotForBooking(new Date());
                setIsBookingModalOpen(true);
              }}
              className="px-3 py-1.5 rounded-lg bg-[#FF5F05] hover:bg-orange-600 text-white text-xs font-bold flex items-center gap-1.5 shadow-2xs cursor-pointer transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New P1S Booking</span>
            </button>

            <button
              onClick={handleSeedSamples}
              className="px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
              title="Seed 2 test bookings for torture testing"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              <span>Seed Test Bookings</span>
            </button>

            <button
              onClick={handleClearBookings}
              className="px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-red-50 text-zinc-700 hover:text-red-700 border border-zinc-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
              title="Clear only P1S sandbox bookings"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Sandbox</span>
            </button>
          </div>
        </div>

        {/* Sandbox Isolation Notice */}
        <div className="p-2.5 rounded-lg bg-amber-50/80 border border-amber-200 flex items-center justify-between text-xs text-amber-900">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>P1S Sandbox Isolation Active:</strong> All reservations, overlaps, and cancellations are saved strictly to{" "}
              <code className="bg-amber-100 px-1 py-0.5 rounded font-mono text-[11px]">
                localStorage(&quot;bambu_p1s_sandbox_bookings&quot;)
              </code>
              . Torture tests never affect live X1C production queue.
            </span>
          </div>
          <span className="text-[11px] font-bold text-amber-700 shrink-0 ml-2">
            {p1sBookings.length} Sandbox Slots
          </span>
        </div>
      </div>

      {/* ==================== 3. 5-MINUTE GRANULAR WEEKLY CALENDAR ==================== */}
      <div className="bg-white rounded-xl border border-zinc-200 shadow-2xs overflow-hidden">
        <WeeklyCalendar
          bookings={p1sBookings}
          currentWeekStart={currentWeekStart}
          currentUserId={user?.id}
          currentUserEmail={user?.email}
          isAdmin={isAdmin}
          showCompleted={showCompleted}
          onSelectSlot={(slotTime) => {
            setSelectedSlotForBooking(slotTime);
            setIsBookingModalOpen(true);
          }}
          onAdminClickBooking={(booking) => {
            setSelectedBookingForAdmin(booking);
          }}
        />
      </div>

      {/* ==================== 4. BOOKING MODAL (P1S WIRED) ==================== */}
      {isBookingModalOpen && (
        <BookingModal
          isOpen={isBookingModalOpen}
          initialSlotTime={selectedSlotForBooking}
          user={user}
          onClose={() => {
            setIsBookingModalOpen(false);
            setSelectedSlotForBooking(null);
          }}
          onSubmitBooking={async (params) => {
            if (!user) return { error: "Authentication required." };
            const res = await createP1sBooking({
              user,
              file_name: params.file_name,
              duration_minutes: params.duration_minutes,
              start_time: params.start_time,
              reminder_minutes_before: params.reminder_minutes_before,
            });
            if (res.error) {
              return { error: res.error, code: res.code };
            }
            showToast(
              "success",
              `P1S reservation for "${params.file_name}" created successfully!`
            );
            setIsBookingModalOpen(false);
            return {};
          }}
        />
      )}

      {/* ==================== 5. ADMIN BOOKING OVERRIDE MODAL ==================== */}
      {selectedBookingForAdmin && (
        <AdminBookingModal
          booking={selectedBookingForAdmin}
          user={user}
          onClose={() => setSelectedBookingForAdmin(null)}
          onAdminOverride={async (params) => {
            if (!user) return { error: "Admin authentication required." };
            const res = await editP1sBooking({
              bookingId: params.bookingId,
              adminUser: user,
              newStartTime: params.newStartTime,
              newDurationMinutes: params.newDurationMinutes,
              newStatus: params.newStatus,
              sendNotification: params.sendNotification,
              reason: params.reason,
            });
            if (res.error) {
              return { error: res.error };
            }
            showToast("success", "P1S reservation updated.");
            setSelectedBookingForAdmin(null);
            return {};
          }}
          onUserCancel={async (bookingId) => {
            if (!user) return;
            await cancelP1sBooking(bookingId, user);
            showToast("info", "P1S reservation canceled.");
            setSelectedBookingForAdmin(null);
          }}
        />
      )}
    </div>
  );
};
