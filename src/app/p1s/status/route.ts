import { NextResponse } from "next/server";

// In-memory telemetry state for local dev & sandbox testing
let p1sTelemetry = {
  model: "Bambu Lab P1S",
  serialNumber: "01P00C611402117",
  gcode_state: "IDLE",
  subtask_name: "",
  gcode_file: "",
  mc_percent: 0,
  mc_remaining_time: 0,
  nozzle_temper: 215,
  nozzle_target_temper: 220,
  bed_temper: 54,
  bed_target_temper: 55,
  chamber_light: "ON",
  updatedAt: new Date().toISOString(),
};

export function getP1sTelemetry() {
  return p1sTelemetry;
}

export function setP1sChamberLight(state: "ON" | "OFF") {
  p1sTelemetry = {
    ...p1sTelemetry,
    chamber_light: state,
    updatedAt: new Date().toISOString(),
  };
  return p1sTelemetry;
}

export function setP1sTelemetry(newValues: Partial<typeof p1sTelemetry>) {
  p1sTelemetry = {
    ...p1sTelemetry,
    ...newValues,
    updatedAt: new Date().toISOString(),
  };
  return p1sTelemetry;
}

export async function GET() {
  // If Cloudflare worker is reachable for P1S, we can attempt to query it, or return local telemetry
  try {
    const workerRes = await fetch("https://bambu-cloud-guard.anmolp5.workers.dev/p1s/status", {
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(1500),
    }).catch(() => null);

    if (workerRes && workerRes.ok) {
      const data = await workerRes.json();
      return NextResponse.json({
        ...p1sTelemetry,
        ...data,
        model: "Bambu Lab P1S",
        serialNumber: "01P00C611402117",
      });
    }
  } catch {
    // ignore
  }

  return NextResponse.json(p1sTelemetry);
}
