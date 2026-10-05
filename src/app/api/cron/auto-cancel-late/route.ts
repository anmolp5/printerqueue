import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { evaluateLateArrival } from "@/lib/scheduling";
import { CalendarBooking } from "@/lib/types";

export async function GET() {
  const now = new Date();

  if (isSupabaseConfigured && supabase) {
    const { data: overdueBookings } = await supabase
      .from("bookings")
      .select("*")
      .eq("status", "scheduled")
      .lte("start_time", now.toISOString());

    const canceledIds: string[] = [];
    const warnedIds: string[] = [];

    for (const booking of (overdueBookings || []) as CalendarBooking[]) {
      const { data: nextBookings } = await supabase
        .from("bookings")
        .select("start_time")
        .in("status", ["scheduled", "in_progress"])
        .gt("start_time", booking.start_time)
        .order("start_time", { ascending: true })
        .limit(1);

      const nextStart =
        nextBookings && nextBookings.length > 0
          ? new Date(nextBookings[0].start_time)
          : null;

      const evalResult = evaluateLateArrival(booking, now, nextStart);

      if (
        evalResult.action === "cancel_overlap" ||
        evalResult.action === "cancel_expired"
      ) {
        await supabase
          .from("bookings")
          .update({
            status: "canceled_late",
            updated_at: now.toISOString(),
          })
          .eq("id", booking.id);
        canceledIds.push(booking.id);
      } else if (evalResult.action === "warn_15m") {
        await supabase
          .from("bookings")
          .update({
            late_warned: true,
            updated_at: now.toISOString(),
          })
          .eq("id", booking.id);
        warnedIds.push(booking.id);
      }
    }

    return NextResponse.json({
      executedAt: now.toISOString(),
      canceledIds,
      warnedIds,
    });
  }

  return NextResponse.json({
    executedAt: now.toISOString(),
    message: "Auto-cancel late check endpoint active",
  });
}
