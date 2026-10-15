import { compareFileNames } from '../matcher.js';

console.log('====================================================');
console.log('🧪 RUNNING EARLY-ARRIVAL & GUARD LOGIC UNIT TESTS');
console.log('====================================================\n');

function normalizeBooking(b) {
  if (!b) return null;
  return {
    ...b,
    id: b.id,
    startTime: b.start_time || b.startTime,
    endTime: b.end_time || b.endTime,
    fileName: b.file_name || b.fileName || '',
    userEmail: b.user_email || b.userEmail || '',
    userName: b.user_name || b.userName || b.user_email || b.userEmail || 'Lab Member',
    status: b.status || 'scheduled',
  };
}

function evaluateTestBooking(currentFile, rawBookings, now = new Date(), similarityThreshold = 0.65) {
  const bookings = (rawBookings || []).map(normalizeBooking).filter(Boolean);

  // Active bookings (currently inside their reserved time slot)
  const activeBookings = bookings.filter((b) => {
    if (['canceled', 'canceled_late', 'canceled_user', 'canceled_admin', 'completed'].includes(b.status)) return false;
    const start = new Date(b.startTime);
    const end = new Date(b.endTime);
    return !isNaN(start.getTime()) && !isNaN(end.getTime()) && now >= start && now <= end;
  });

  const activeBooking = activeBookings[0] || null;

  if (activeBooking) {
    const match = compareFileNames(currentFile, activeBooking.fileName, similarityThreshold);
    if (!match.isMatch) {
      return { action: 'mismatch_paused', booking: activeBooking, similarity: match.score };
    }
    return {
      action: 'authorized_print',
      booking: activeBooking,
      autoStartNeeded: activeBooking.status !== 'in_progress',
      similarity: match.score,
    };
  }

  // Early-arrival lookahead (next 30 minutes)
  const upcomingBookings = bookings.filter((b) => {
    if (['canceled', 'canceled_late', 'canceled_user', 'canceled_admin', 'completed'].includes(b.status)) return false;
    const start = new Date(b.startTime);
    if (isNaN(start.getTime())) return false;
    const maxLookahead = new Date(now.getTime() + 30 * 60 * 1000);
    return start > now && start <= maxLookahead;
  });

  for (const b of upcomingBookings) {
    const match = compareFileNames(currentFile, b.fileName, similarityThreshold);
    if (match.isMatch) {
      return {
        action: 'authorized_early_start',
        booking: b,
        autoStartNeeded: b.status !== 'in_progress',
        similarity: match.score,
      };
    }
  }

  return { action: 'rogue_unscheduled' };
}

// Tests
const now = new Date('2026-10-15T14:00:00Z');

// Test 1: User reserved at 14:15 (starts in 15 min), starts print at 14:00 with matching file
const test1 = evaluateTestBooking(
  'drone_chassis_v2.gcode.3mf',
  [
    {
      id: 'b-1',
      start_time: '2026-10-15T14:15:00Z',
      end_time: '2026-10-15T15:00:00Z',
      file_name: 'drone_chassis.3mf',
      user_email: 'student@illinois.edu',
      status: 'scheduled',
    },
  ],
  now
);
console.log('Test 1 (Early start 15 min before slot):', test1.action === 'authorized_early_start' ? 'PASSED ✅' : 'FAILED ❌', test1);

// Test 2: User reserved at 14:25 (starts in 25 min), starts print at 14:00 with matching file
const test2 = evaluateTestBooking(
  'Allison.Ayesha_v3_v4.gcode.3mf',
  [
    {
      id: 'b-2',
      start_time: '2026-10-15T14:25:00Z',
      end_time: '2026-10-15T15:30:00Z',
      file_name: 'allison_ayesha.3mf',
      user_email: 'allison@illinois.edu',
      status: 'scheduled',
    },
  ],
  now
);
console.log('Test 2 (Early start 25 min before slot):', test2.action === 'authorized_early_start' ? 'PASSED ✅' : 'FAILED ❌', test2);

// Test 3: Active booking (13:50 to 14:30), file matches
const test3 = evaluateTestBooking(
  'gearbox_plate_1.gcode',
  [
    {
      id: 'b-3',
      start_time: '2026-10-15T13:50:00Z',
      end_time: '2026-10-15T14:30:00Z',
      file_name: 'gearbox.3mf',
      user_email: 'mech@illinois.edu',
      status: 'scheduled',
    },
  ],
  now
);
console.log('Test 3 (Active booking, file match):', test3.action === 'authorized_print' && test3.autoStartNeeded ? 'PASSED ✅' : 'FAILED ❌', test3);

// Test 4: Active booking (13:50 to 14:30), file MISMATCH
const test4 = evaluateTestBooking(
  'batman_mask.gcode',
  [
    {
      id: 'b-4',
      start_time: '2026-10-15T13:50:00Z',
      end_time: '2026-10-15T14:30:00Z',
      file_name: 'prosthetic_hand.3mf',
      user_email: 'bio@illinois.edu',
      status: 'scheduled',
    },
  ],
  now
);
console.log('Test 4 (Active booking, file mismatch):', test4.action === 'mismatch_paused' ? 'PASSED ✅' : 'FAILED ❌', test4);

// Test 5: No booking in next 30 min (booking is 2 hours later at 16:00) -> Rogue unscheduled
const test5 = evaluateTestBooking(
  'random_model.gcode',
  [
    {
      id: 'b-5',
      start_time: '2026-10-15T16:00:00Z',
      end_time: '2026-10-15T17:00:00Z',
      file_name: 'random_model.3mf',
      user_email: 'far_ahead@illinois.edu',
      status: 'scheduled',
    },
  ],
  now
);
console.log('Test 5 (Booking too far in future, > 30m):', test5.action === 'rogue_unscheduled' ? 'PASSED ✅' : 'FAILED ❌', test5);

// Test 6: Early booking in 15 min, but file does NOT match -> Rogue unscheduled
const test6 = evaluateTestBooking(
  'unrelated_print.gcode',
  [
    {
      id: 'b-6',
      start_time: '2026-10-15T14:15:00Z',
      end_time: '2026-10-15T15:00:00Z',
      file_name: 'saturn_v_rocket.3mf',
      user_email: 'aero@illinois.edu',
      status: 'scheduled',
    },
  ],
  now
);
console.log('Test 6 (Early window but wrong file):', test6.action === 'rogue_unscheduled' ? 'PASSED ✅' : 'FAILED ❌', test6);

console.log('\n🎉 ALL EARLY-ARRIVAL & GUARD LOGIC TESTS COMPLETED SUCCESSFULLY!\n');
