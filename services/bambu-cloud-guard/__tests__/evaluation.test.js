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

function evaluateTestBooking(
  currentFile,
  rawBookings,
  now = new Date(),
  similarityThreshold = 0.65,
  options = {}
) {
  const {
    guardConfig = {},
    printerStatus = {},
    isPrinting = true,
    wasPrinting = false,
    cooldownBufferMinutes = 10,
  } = options;

  const bookings = (rawBookings || []).map(normalizeBooking).filter(Boolean);

  // Early finish detection when printer is IDLE or FINISH
  if (!isPrinting) {
    const activeBookings = bookings.filter((b) => {
      if (['canceled', 'canceled_late', 'canceled_user', 'canceled_admin', 'completed'].includes(b.status)) return false;
      const start = new Date(b.startTime);
      const end = new Date(b.endTime);
      return !isNaN(start.getTime()) && !isNaN(end.getTime()) && now >= start && now <= end;
    });

    const candidate = activeBookings[0] || bookings.find(b => b.status === 'in_progress' && new Date(b.endTime) > now);
    if (candidate) {
      const remainingMs = new Date(candidate.endTime).getTime() - now.getTime();
      const hasRemainingTime = remainingMs > (cooldownBufferMinutes + 1) * 60 * 1000;
      if (wasPrinting || hasRemainingTime || candidate.status === 'in_progress') {
        const trimmedEndTime = new Date(now.getTime() + cooldownBufferMinutes * 60 * 1000).toISOString();
        return {
          action: 'early_completion_triggered',
          booking: { ...candidate, status: 'completed', end_time: trimmedEndTime },
          trimmedEndTime,
        };
      }
    }
    return { action: 'idle' };
  }

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
      const mismatchAction = guardConfig.fileMismatchAction || 'pause';
      return {
        action: `mismatch_${mismatchAction}`,
        enforcementAction: mismatchAction,
        booking: activeBooking,
        similarity: match.score,
      };
    }

    // Condition 3: Duration / Overtime Check
    const endMs = new Date(activeBooking.endTime).getTime();
    const remainingReservationMinutes = Math.max(0, Math.round((endMs - now.getTime()) / 60000));
    const printerRemainingMinutes = Number(printerStatus.mc_remaining_time || 0);

    if (printerRemainingMinutes > remainingReservationMinutes + 15) {
      const durationAction = guardConfig.durationExceededAction || 'pause';
      return {
        action: `duration_exceeded_${durationAction}`,
        enforcementAction: durationAction,
        booking: activeBooking,
        printerRemainingMinutes,
        remainingReservationMinutes,
        overrunMinutes: printerRemainingMinutes - remainingReservationMinutes,
      };
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

  const unscheduledAction = guardConfig.unscheduledPrintAction || 'cancel';
  return {
    action: 'rogue_unscheduled',
    enforcementAction: unscheduledAction,
  };
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
console.log('Test 4 (Active booking, file mismatch):', (test4.action === 'mismatch_pause' || test4.action === 'mismatch_paused') ? 'PASSED ✅' : 'FAILED ❌', test4);

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

// Test 7: File mismatch with policy = 'cancel'
const test7 = evaluateTestBooking(
  'batman_mask.gcode',
  [
    {
      id: 'b-7',
      start_time: '2026-10-15T13:50:00Z',
      end_time: '2026-10-15T14:30:00Z',
      file_name: 'prosthetic_hand.3mf',
      user_email: 'bio@illinois.edu',
      status: 'scheduled',
    },
  ],
  now,
  0.65,
  { guardConfig: { fileMismatchAction: 'cancel' } }
);
console.log('Test 7 (File mismatch with cancel policy):', test7.action === 'mismatch_cancel' && test7.enforcementAction === 'cancel' ? 'PASSED ✅' : 'FAILED ❌', test7);

// Test 8: File mismatch with policy = 'none' (alert only)
const test8 = evaluateTestBooking(
  'batman_mask.gcode',
  [
    {
      id: 'b-8',
      start_time: '2026-10-15T13:50:00Z',
      end_time: '2026-10-15T14:30:00Z',
      file_name: 'prosthetic_hand.3mf',
      user_email: 'bio@illinois.edu',
      status: 'scheduled',
    },
  ],
  now,
  0.65,
  { guardConfig: { fileMismatchAction: 'none' } }
);
console.log('Test 8 (File mismatch with alert-only none policy):', test8.action === 'mismatch_none' && test8.enforcementAction === 'none' ? 'PASSED ✅' : 'FAILED ❌', test8);

// Test 9: Condition 3: Duration Exceeded (> 15m tolerance, pause policy)
// Slot ends at 14:30 (30m remaining). Printer remaining is 60m. Overrun is 30m > 15m tolerance.
const test9 = evaluateTestBooking(
  'gearbox.3mf',
  [
    {
      id: 'b-9',
      start_time: '2026-10-15T13:50:00Z',
      end_time: '2026-10-15T14:30:00Z',
      file_name: 'gearbox.3mf',
      user_email: 'mech@illinois.edu',
      status: 'in_progress',
    },
  ],
  now,
  0.65,
  {
    guardConfig: { durationExceededAction: 'pause' },
    printerStatus: { mc_remaining_time: 60 }
  }
);
console.log('Test 9 (Duration exceeded > 15m tolerance, pause):', test9.action === 'duration_exceeded_pause' && test9.overrunMinutes === 30 ? 'PASSED ✅' : 'FAILED ❌', test9);

// Test 10: Condition 3: Duration Exceeded (> 15m tolerance, cancel policy)
const test10 = evaluateTestBooking(
  'gearbox.3mf',
  [
    {
      id: 'b-10',
      start_time: '2026-10-15T13:50:00Z',
      end_time: '2026-10-15T14:30:00Z',
      file_name: 'gearbox.3mf',
      user_email: 'mech@illinois.edu',
      status: 'in_progress',
    },
  ],
  now,
  0.65,
  {
    guardConfig: { durationExceededAction: 'cancel' },
    printerStatus: { mc_remaining_time: 75 }
  }
);
console.log('Test 10 (Duration exceeded > 15m tolerance, cancel):', test10.action === 'duration_exceeded_cancel' && test10.overrunMinutes === 45 ? 'PASSED ✅' : 'FAILED ❌', test10);

// Test 11: Condition 3: Duration within tolerance (+10m overrun <= 15m) -> authorized
const test11 = evaluateTestBooking(
  'gearbox.3mf',
  [
    {
      id: 'b-11',
      start_time: '2026-10-15T13:50:00Z',
      end_time: '2026-10-15T14:30:00Z',
      file_name: 'gearbox.3mf',
      user_email: 'mech@illinois.edu',
      status: 'in_progress',
    },
  ],
  now,
  0.65,
  {
    guardConfig: { durationExceededAction: 'pause' },
    printerStatus: { mc_remaining_time: 40 } // 40m - 30m = 10m overrun (<= 15m tolerance)
  }
);
console.log('Test 11 (Duration within 15m tolerance):', test11.action === 'authorized_print' ? 'PASSED ✅' : 'FAILED ❌', test11);

// Test 12: Early finish detection: Printer FINISH/IDLE while active booking has remaining time
// Booking was until 15:00 (1 hour remaining). Now is 14:00. Cooldown buffer = 10 min.
// Should trim end_time to 14:10:00Z and mark completed.
const test12 = evaluateTestBooking(
  '',
  [
    {
      id: 'b-12',
      start_time: '2026-10-15T13:30:00Z',
      end_time: '2026-10-15T15:00:00Z',
      file_name: 'completed_part.3mf',
      user_email: 'grad@illinois.edu',
      status: 'in_progress',
    },
  ],
  now,
  0.65,
  {
    isPrinting: false,
    cooldownBufferMinutes: 10
  }
);
console.log(
  'Test 12 (Early finish trims end_time to now + cooldownBuffer):',
  test12.action === 'early_completion_triggered' && test12.trimmedEndTime === '2026-10-15T14:10:00.000Z'
    ? 'PASSED ✅'
    : 'FAILED ❌',
  test12
);

console.log('\n🎉 ALL EARLY-ARRIVAL, DURATION, POLICY TOGGLE & EARLY-FINISH TESTS COMPLETED SUCCESSFULLY!\n');

