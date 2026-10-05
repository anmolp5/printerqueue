import { NextRequest, NextResponse } from "next/server";
import { addMinutes } from "date-fns";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { MANDATORY_BUFFER_MINUTES, snapTo15MinSlot } from "@/lib/scheduling";

export async function POST(req: NextRequest) {
  try {
    const { bookingId } = await req.json();
    if (!bookingId) {
      return NextResponse.json(
        { error: "Missing bookingId" },
        { status: 400 }
      );
    }

    const now = new Date();
    const newEndTime = addMinutes(now, MANDATORY_BUFFER_MINUTES);

    if (isSupabaseConfigured && supabase) {
      // 1. Mark current booking completed and truncate end_time = now() + 10 mins
      const { data: completedBooking, error } = await supabase
        .from("bookings")
        .update({
          status: "completed",
          actual_completed_at: now.toISOString(),
          end_time: newEndTime.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("id", bookingId)
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      // 2. Find immediate next scheduled booking
      const { data: nextBookings } = await supabase
        .from("bookings")
        .select("*")
        .eq("status", "scheduled")
        .gt("start_time", completedBooking.start_time)
        .order("start_time", { ascending: true })
        .limit(1);

      let magicLinkUrl: string | null = null;
      if (nextBookings && nextBookings.length > 0) {
        const nextJob = nextBookings[0];
        const earliestStart = snapTo15MinSlot(newEndTime, true);
        const baseUrl =
          process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
        magicLinkUrl = `${baseUrl}/portal/reschedule?booking_id=${
          nextJob.id
        }&new_start=${encodeURIComponent(earliestStart.toISOString())}`;
      }

      return NextResponse.json({
        booking: completedBooking,
        magicLinkUrl,
      });
    }

    return NextResponse.json({
      status: "ok",
      completedAt: now.toISOString(),
      newEndTime: newEndTime.toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
