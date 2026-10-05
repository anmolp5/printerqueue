// supabase/functions/auto-cancel-late/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const now = new Date();
  const nowMs = now.getTime();

  // 1. Fetch all unstarted scheduled bookings where start_time <= now
  const { data: overdueBookings } = await supabase
    .from("bookings")
    .select("*, profiles(email)")
    .eq("status", "scheduled")
    .lte("start_time", now.toISOString());

  for (const booking of overdueBookings || []) {
    const startMs = new Date(booking.start_time).getTime();
    const endMs = new Date(booking.end_time).getTime();

    // 2. Find the immediate next active booking after this one
    const { data: nextBookings } = await supabase
      .from("bookings")
      .select("start_time")
      .in("status", ["scheduled", "in_progress"])
      .gt("start_time", booking.start_time)
      .order("start_time", { ascending: true })
      .limit(1);

    if (nextBookings && nextBookings.length > 0) {
      const nextStartTime = new Date(nextBookings[0].start_time).getTime();
      const requiredFinishTime = nowMs + (booking.duration_minutes + 10) * 60 * 1000;

      // If starting right now would overlap the next booking's slot
      if (requiredFinishTime > nextStartTime) {
        await supabase
          .from("bookings")
          .update({ status: "canceled_late", updated_at: now.toISOString() })
          .eq("id", booking.id);
      }
    } else {
      // No subsequent booking exists:
      // Cancel at original end_time if unstarted, or warn at start_time + 15 mins
      if (nowMs >= endMs) {
        await supabase
          .from("bookings")
          .update({ status: "canceled_late", updated_at: now.toISOString() })
          .eq("id", booking.id);
      } else if (nowMs >= startMs + 15 * 60 * 1000 && !booking.late_warned) {
        await supabase
          .from("bookings")
          .update({ late_warned: true, updated_at: now.toISOString() })
          .eq("id", booking.id);
      }
    }
  }

  return new Response("Cron execution complete", { status: 200 });
});
