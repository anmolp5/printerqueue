import { NextResponse } from "next/server";
import { setP1sChamberLight } from "@/app/p1s/status/route";

async function handleTurnLightOn() {
  // Forward to worker if configured
  try {
    await fetch("https://bambu-cloud-guard.anmolp5.workers.dev/p1s/light/on", {
      method: "POST",
      signal: AbortSignal.timeout(1500),
    }).catch(() => null);
  } catch {
    // ignore
  }

  const updated = setP1sChamberLight("ON");
  return NextResponse.json({
    success: true,
    chamber_light: "ON",
    message: "P1S chamber light turned ON successfully.",
    telemetry: updated,
  });
}

export async function GET() {
  return handleTurnLightOn();
}

export async function POST() {
  return handleTurnLightOn();
}
