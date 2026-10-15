import { NextResponse } from "next/server";
import { setP1sChamberLight } from "@/app/p1s/status/route";

async function handleTurnLightOff() {
  // Forward to worker if configured
  try {
    await fetch("https://bambu-cloud-guard.anmolp5.workers.dev/p1s/light/off", {
      method: "POST",
      signal: AbortSignal.timeout(1500),
    }).catch(() => null);
  } catch {
    // ignore
  }

  const updated = setP1sChamberLight("OFF");
  return NextResponse.json({
    success: true,
    chamber_light: "OFF",
    message: "P1S chamber light turned OFF successfully.",
    telemetry: updated,
  });
}

export async function GET() {
  return handleTurnLightOff();
}

export async function POST() {
  return handleTurnLightOff();
}
