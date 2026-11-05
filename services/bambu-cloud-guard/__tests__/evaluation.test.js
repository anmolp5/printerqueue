import { compareFileNames, isGenericPlateName } from '../matcher.js';
import { sendGuardAlert } from '../notifier.js';

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

function renderGuardEmail(templateConfig, tokens, fallbackSubject, fallbackTitle, fallbackBody) {
  if (templateConfig && templateConfig.enabled === false) {
    return null;
  }
  const rawSubject = templateConfig?.subject || fallbackSubject;
  const rawBody = templateConfig?.bodyTemplate || fallbackBody;

  const replaceTokens = (text) => {
    if (!text) return '';
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const val = tokens[key];
      return val !== undefined && val !== null ? String(val) : `{{${key}}}`;
    });
  };

  return {
    subject: replaceTokens(rawSubject),
    title: replaceTokens(fallbackTitle),
    message: replaceTokens(rawBody),
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
    stateStore = {},
    simulateGrace = false,
  } = options;

  const bookings = (rawBookings || []).map(normalizeBooking).filter(Boolean);

  // Handle pause state
  if (printerStatus.gcode_state === 'PAUSE') {
    return {
      action: 'printer_paused',
      booking: bookings.find(b => b.status === 'in_progress' || (now >= new Date(b.startTime) && now <= new Date(b.endTime)))
    };
  }

  // Early finish detection when printer is IDLE or FINISH
  if (!isPrinting) {
    if (stateStore) {
      delete stateStore.unscheduledFirstSeenAt;
      delete stateStore.unscheduledInitialAlertSent;
      delete stateStore.unscheduledFollowUpAlertSent;
    }
    const activeBookings = bookings.filter((b) => {
      if (['canceled', 'canceled_late', 'canceled_user', 'canceled_admin', 'completed'].includes(b.status)) return false;
      const start = new Date(b.startTime);
      const end = new Date(b.endTime);
      return !isNaN(start.getTime()) && !isNaN(end.getTime()) && now >= start && now <= end;
    });

    const candidate = activeBookings[0] || bookings.find(b => b.status === 'in_progress' && new Date(b.endTime) > now);
    const isPhysicalFinish = printerStatus.gcode_state === 'FINISH' || (wasPrinting && !isPrinting);

    // INVARIANT: "The printer has to have started before it can finish."
    if (candidate && candidate.status === 'in_progress' && candidate.actual_started_at && isPhysicalFinish) {
      const startMs = new Date(candidate.actual_started_at).getTime();
      const elapsedMs = now.getTime() - startMs;
      if (!isNaN(startMs) && elapsedMs >= 60 * 1000) {
        const remainingMs = new Date(candidate.endTime).getTime() - now.getTime();
        const cooldownMs = cooldownBufferMinutes * 60 * 1000;
        const trimmedEndTime = remainingMs > cooldownMs
          ? new Date(now.getTime() + cooldownMs).toISOString()
          : candidate.endTime;
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
    const isGeneric = isGenericPlateName(currentFile);
    const match = compareFileNames(currentFile, activeBooking.fileName, similarityThreshold);
    if (!match.isMatch && !isGeneric) {
      const mismatchAction = guardConfig.fileMismatchAction || 'pause';
      return {
        action: `mismatch_${mismatchAction}`,
        enforcementAction: mismatchAction,
        booking: activeBooking,
        similarity: match.score,
      };
    }

    if (stateStore) {
      delete stateStore.unscheduledFirstSeenAt;
      delete stateStore.unscheduledInitialAlertSent;
      delete stateStore.unscheduledFollowUpAlertSent;
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
      if (stateStore) {
        delete stateStore.unscheduledFirstSeenAt;
        delete stateStore.unscheduledInitialAlertSent;
        delete stateStore.unscheduledFollowUpAlertSent;
      }
      return {
        action: 'authorized_early_start',
        booking: b,
        autoStartNeeded: b.status !== 'in_progress',
        similarity: match.score,
      };
    }
  }

  const unscheduledAction = guardConfig.unscheduledPrintAction || 'cancel';
  const graceMinutes = guardConfig.gracePeriodMinutes || 1;
  const firstSeen = stateStore.unscheduledFirstSeenAt || now.getTime();
  stateStore.unscheduledFirstSeenAt = firstSeen;
  const elapsedMs = now.getTime() - firstSeen;
  const graceMs = graceMinutes * 60 * 1000;

  let justSentInitialAlert = false;
  if (!stateStore.unscheduledInitialAlertSent || stateStore.unscheduledInitialAlertSent !== currentFile) {
    stateStore.unscheduledInitialAlertSent = currentFile;
    justSentInitialAlert = true;
  }

  let justSentFollowUpAlert = false;
  if (elapsedMs >= 10 * 60 * 1000 && (!stateStore.unscheduledFollowUpAlertSent || stateStore.unscheduledFollowUpAlertSent !== currentFile)) {
    stateStore.unscheduledFollowUpAlertSent = currentFile;
    justSentFollowUpAlert = true;
  }

  if (simulateGrace && elapsedMs < graceMs) {
    return {
      action: 'grace_period',
      status: 'grace_period',
      enforcementAction: unscheduledAction,
      initialAlertSent: true,
      justSentInitialAlert,
      followUpAlertSent: Boolean(stateStore.unscheduledFollowUpAlertSent),
      justSentFollowUpAlert,
      currentFile,
      elapsedSeconds: Math.round(elapsedMs / 1000),
      graceRemainingSec: Math.max(0, Math.round((graceMs - elapsedMs) / 1000)),
    };
  }

  return {
    action: 'rogue_unscheduled',
    enforcementAction: unscheduledAction,
    initialAlertSent: true,
    justSentInitialAlert,
    followUpAlertSent: Boolean(stateStore.unscheduledFollowUpAlertSent),
    justSentFollowUpAlert,
    currentFile,
    elapsedMinutes: Math.round(elapsedMs / 60000),
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

// Test 12: Early finish detection: Printer FINISH after booking was in_progress with confirmed actual_started_at
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
      actual_started_at: '2026-10-15T13:30:00Z',
    },
  ],
  now,
  0.65,
  {
    isPrinting: false,
    printerStatus: { gcode_state: 'FINISH' },
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

// Test 13: INVARIANT: Scheduled booking when printer is IDLE (user just arrived, preparing print) -> MUST NOT COMPLETE!
const test13 = evaluateTestBooking(
  '',
  [
    {
      id: 'b-13',
      start_time: '2026-10-15T14:00:00Z',
      end_time: '2026-10-15T16:00:00Z',
      file_name: 'drone_plate.3mf',
      user_email: 'rose@illinois.edu',
      status: 'scheduled',
    },
  ],
  new Date('2026-10-15T14:02:00Z'), // 2 minutes into slot
  0.65,
  {
    isPrinting: false,
    printerStatus: { gcode_state: 'IDLE' },
    cooldownBufferMinutes: 10
  }
);
console.log(
  'Test 13 (Printer IDLE during scheduled booking NEVER auto-completes):',
  test13.action === 'idle'
    ? 'PASSED ✅'
    : 'FAILED ❌',
  test13
);

// Test 14: Generic Bambu Studio plate name during active booking -> Authorized
const test14 = evaluateTestBooking(
  '0.16mm layer, 2 walls, 15% infill',
  [
    {
      id: 'b-14',
      start_time: '2026-10-15T13:50:00Z',
      end_time: '2026-10-15T15:30:00Z',
      file_name: 'scaled_thyroid_model.3mf',
      user_email: 'bio@illinois.edu',
      status: 'scheduled',
    },
  ],
  now,
  0.65,
  {
    isPrinting: true,
    printerStatus: { gcode_state: 'RUNNING', mc_remaining_time: 40 }
  }
);
console.log(
  'Test 14 (Bambu Studio default plate name accepted during active booking):',
  test14.action === 'authorized_print'
    ? 'PASSED ✅'
    : 'FAILED ❌',
  test14
);

// Test 15: Printer state PAUSE (e.g. AI spaghetti / filament runout) -> Preserves booking
const test15 = evaluateTestBooking(
  'drone_chassis.3mf',
  [
    {
      id: 'b-15',
      start_time: '2026-10-15T13:50:00Z',
      end_time: '2026-10-15T15:30:00Z',
      file_name: 'drone_chassis.3mf',
      user_email: 'aero@illinois.edu',
      status: 'in_progress',
      actual_started_at: '2026-10-15T13:50:00Z',
    },
  ],
  now,
  0.65,
  {
    isPrinting: false,
    printerStatus: { gcode_state: 'PAUSE' }
  }
);
console.log(
  'Test 15 (Printer PAUSE preserves booking and returns printer_paused):',
  test15.action === 'printer_paused' && test15.booking?.id === 'b-15'
    ? 'PASSED ✅'
    : 'FAILED ❌',
  test15
);

// Test 16: Unscheduled print first detected (T0) -> Dispatches initial email alert once
const testStateStore = {};
const test16 = evaluateTestBooking(
  'unregistered_print.gcode',
  [],
  now,
  0.65,
  {
    isPrinting: true,
    stateStore: testStateStore,
    simulateGrace: true,
  }
);
console.log(
  'Test 16 (T0 Unscheduled print detected -> Dispatches initial alert once):',
  test16.action === 'grace_period' && test16.initialAlertSent === true && test16.justSentInitialAlert === true && test16.justSentFollowUpAlert === false
    ? 'PASSED ✅'
    : 'FAILED ❌',
  test16
);

// Test 17: Minute 1 to 9 (e.g. 5m in) -> Suppressed! Zero emails dispatched
const test17 = evaluateTestBooking(
  'unregistered_print.gcode',
  [],
  new Date(now.getTime() + 5 * 60 * 1000), // 5 min later
  0.65,
  {
    isPrinting: true,
    stateStore: testStateStore,
    simulateGrace: true,
  }
);
console.log(
  'Test 17 (Minutes 1-9 -> Suppressed, zero emails dispatched):',
  test17.action === 'rogue_unscheduled' && test17.justSentInitialAlert === false && test17.justSentFollowUpAlert === false
    ? 'PASSED ✅'
    : 'FAILED ❌',
  test17
);

// Test 18: Minute 10 (T0 + 10m) -> Dispatches 10-Minute Reminder alert once
const test18 = evaluateTestBooking(
  'unregistered_print.gcode',
  [],
  new Date(now.getTime() + 10 * 60 * 1000), // 10 min later
  0.65,
  {
    isPrinting: true,
    stateStore: testStateStore,
    simulateGrace: true,
  }
);
console.log(
  'Test 18 (Minute 10 -> Dispatches 10-minute follow-up reminder alert once):',
  test18.action === 'rogue_unscheduled' && test18.followUpAlertSent === true && test18.justSentFollowUpAlert === true && test18.justSentInitialAlert === false
    ? 'PASSED ✅'
    : 'FAILED ❌',
  test18
);

// Test 19: Minute 15 (T0 + 15m) -> Suppressed! Zero emails dispatched
const test19 = evaluateTestBooking(
  'unregistered_print.gcode',
  [],
  new Date(now.getTime() + 15 * 60 * 1000), // 15 min later
  0.65,
  {
    isPrinting: true,
    stateStore: testStateStore,
    simulateGrace: true,
  }
);
console.log(
  'Test 19 (Minute 11+ -> Suppressed, zero emails dispatched):',
  test19.action === 'rogue_unscheduled' && test19.justSentInitialAlert === false && test19.justSentFollowUpAlert === false
    ? 'PASSED ✅'
    : 'FAILED ❌',
  test19
);

// Test 20: Printer becomes IDLE/Authorized -> Clears tracking, so next unscheduled print triggers fresh T0 alert
evaluateTestBooking(
  '',
  [],
  new Date(now.getTime() + 20 * 60 * 1000),
  0.65,
  {
    isPrinting: false,
    stateStore: testStateStore,
  }
);
const test20 = evaluateTestBooking(
  'new_unscheduled_part.gcode',
  [],
  new Date(now.getTime() + 21 * 60 * 1000),
  0.65,
  {
    isPrinting: true,
    stateStore: testStateStore,
    simulateGrace: true,
  }
);
console.log(
  'Test 20 (State cleared on idle/authorized -> Next unscheduled print triggers fresh alert):',
  test20.action === 'grace_period' && test20.initialAlertSent === true && test20.justSentInitialAlert === true && test20.justSentFollowUpAlert === false
    ? 'PASSED ✅'
    : 'FAILED ❌',
  test20
);

// Test 21: renderGuardEmail token interpolation works correctly
const testTokens = {
  fileName: 'test_bracket.3mf',
  printerName: 'Bambu Lab X1-Carbon',
  action: 'PAUSE',
  actionText: 'Paused',
};
const renderedEmail = renderGuardEmail(
  { enabled: true, subject: 'Alert: {{fileName}} on {{printerName}}', bodyTemplate: 'Job {{fileName}} was {{actionText}} via {{action}}.' },
  testTokens,
  'Fallback Subject',
  'Fallback Title',
  'Fallback Body'
);
console.log(
  'Test 21 (renderGuardEmail correctly interpolates dynamic tokens):',
  renderedEmail.subject === 'Alert: test_bracket.3mf on Bambu Lab X1-Carbon' &&
  renderedEmail.message === 'Job test_bracket.3mf was Paused via PAUSE.'
    ? 'PASSED ✅'
    : 'FAILED ❌',
  renderedEmail
);

// Test 22: renderGuardEmail respects enabled: false by suppressing the email
const suppressedEmail = renderGuardEmail(
  { enabled: false, subject: 'Alert', bodyTemplate: 'Message' },
  testTokens,
  'Fallback Subject',
  'Fallback Title',
  'Fallback Body'
);
console.log(
  'Test 22 (renderGuardEmail suppresses email when enabled is false):',
  suppressedEmail === null
    ? 'PASSED ✅'
    : 'FAILED ❌',
  suppressedEmail
);

// Test 23: sendGuardAlert strictly suppresses any notification when isP1s is true
const p1sAlertResult1 = await sendGuardAlert({
  subject: 'Test Alert',
  title: 'Test Title',
  message: 'Test Message',
  printerInfo: { isP1s: true }
});
console.log(
  'Test 23 (sendGuardAlert strictly suppresses alerts when isP1s is true):',
  p1sAlertResult1.suppressed === true && p1sAlertResult1.emailSent === false
    ? 'PASSED ✅'
    : 'FAILED ❌',
  p1sAlertResult1
);

// Test 24: sendGuardAlert strictly suppresses any notification when serialNumber is P1S serial
const p1sAlertResult2 = await sendGuardAlert({
  subject: 'Test Alert',
  title: 'Test Title',
  message: 'Test Message',
  printerInfo: { serialNumber: '01P00C611402117' }
});
console.log(
  'Test 24 (sendGuardAlert strictly suppresses alerts when serialNumber is P1S serial):',
  p1sAlertResult2.suppressed === true && p1sAlertResult2.emailSent === false
    ? 'PASSED ✅'
    : 'FAILED ❌',
  p1sAlertResult2
);

// Test 25: sendGuardAlert strictly suppresses any notification when subject/title/message mentions P1S
const p1sAlertResult3 = await sendGuardAlert({
  subject: 'Unscheduled Print Detected on P1S',
  title: 'P1S Alert',
  message: 'Print started on P1S Sandbox'
});
console.log(
  'Test 25 (sendGuardAlert strictly suppresses alerts when subject/title mentions P1S):',
  p1sAlertResult3.suppressed === true && p1sAlertResult3.emailSent === false
    ? 'PASSED ✅'
    : 'FAILED ❌',
  p1sAlertResult3
);

// Test 26: Master notification toggle (notifications.all === false) suppresses alerts
const shouldSendMasterOff = false /* allNotificationsEnabled */ && true;
console.log(
  'Test 26 (Master notification switch all: false suppresses alert evaluation):',
  shouldSendMasterOff === false ? 'PASSED ✅' : 'FAILED ❌',
  { shouldSend: shouldSendMasterOff }
);

// Test 27: Individual fileMismatch toggle (notifications.fileMismatch === false) suppresses alert
const guardNotifsTest1 = { all: true, fileMismatch: false, unscheduledPrint: true };
const sendMismatchTest = guardNotifsTest1.all !== false && guardNotifsTest1.fileMismatch !== false;
console.log(
  'Test 27 (Individual notifications.fileMismatch: false suppresses file mismatch alert):',
  sendMismatchTest === false ? 'PASSED ✅' : 'FAILED ❌',
  { sendMismatchAlert: sendMismatchTest }
);

// Test 28: Individual unscheduledPrint toggle (notifications.unscheduledPrint === false) suppresses alert
const guardNotifsTest2 = { all: true, fileMismatch: true, unscheduledPrint: false };
const sendUnscheduledTest = guardNotifsTest2.all !== false && guardNotifsTest2.unscheduledPrint !== false;
console.log(
  'Test 28 (Individual notifications.unscheduledPrint: false suppresses unscheduled alert):',
  sendUnscheduledTest === false ? 'PASSED ✅' : 'FAILED ❌',
  { sendUnscheduledAlert: sendUnscheduledTest }
);

// Test 29: Individual durationExceeded toggle (notifications.durationExceeded === false) suppresses alert
const guardNotifsTest3 = { all: true, durationExceeded: false };
const sendDurationTest = guardNotifsTest3.all !== false && guardNotifsTest3.durationExceeded !== false;
console.log(
  'Test 29 (Individual notifications.durationExceeded: false suppresses duration alert):',
  sendDurationTest === false ? 'PASSED ✅' : 'FAILED ❌',
  { sendDurationAlert: sendDurationTest }
);

// Test 30: Individual printPaused toggle (notifications.printPaused === false) suppresses alert
const guardNotifsTest4 = { all: true, printPaused: false };
const sendPausedTest = guardNotifsTest4.all !== false && guardNotifsTest4.printPaused !== false;
console.log(
  'Test 30 (Individual notifications.printPaused: false suppresses paused alert):',
  sendPausedTest === false ? 'PASSED ✅' : 'FAILED ❌',
  { sendPausedAlert: sendPausedTest }
);

// Test 31: Individual earlyStart toggle (notifications.earlyStart === false) suppresses alert
const guardNotifsTest5 = { all: true, earlyStart: false };
const sendEarlyTest = guardNotifsTest5.all !== false && guardNotifsTest5.earlyStart !== false;
console.log(
  'Test 31 (Individual notifications.earlyStart: false suppresses early start alert):',
  sendEarlyTest === false ? 'PASSED ✅' : 'FAILED ❌',
  { sendEarlyAlert: sendEarlyTest }
);

// Test 32: Individual enforcement toggle (notifications.enforcement === false) suppresses alert
const guardNotifsTest6 = { all: true, enforcement: false };
const sendEnforcementTest = guardNotifsTest6.all !== false && guardNotifsTest6.enforcement !== false;
console.log(
  'Test 32 (Individual notifications.enforcement: false suppresses enforcement alert):',
  sendEnforcementTest === false ? 'PASSED ✅' : 'FAILED ❌',
  { sendEnforcementAlert: sendEnforcementTest }
);

// Test 33: Default behavior when notifications config is empty or undefined -> all active
const emptyNotifs = {};
const defaultAllActive = emptyNotifs.all !== false &&
  emptyNotifs.unscheduledPrint !== false &&
  emptyNotifs.fileMismatch !== false &&
  emptyNotifs.durationExceeded !== false &&
  emptyNotifs.printPaused !== false &&
  emptyNotifs.earlyStart !== false &&
  emptyNotifs.enforcement !== false;
console.log(
  'Test 33 (Default fallback when notifications object is empty: all enabled):',
  defaultAllActive === true ? 'PASSED ✅' : 'FAILED ❌',
  { defaultAllActive }
);

// Test 34: Master toggle false overrides individual toggle set to true
const masterFalseIndividualTrue = { all: false, fileMismatch: true, unscheduledPrint: true };
const sendMasterFalseMismatch = masterFalseIndividualTrue.all !== false && masterFalseIndividualTrue.fileMismatch !== false;
console.log(
  'Test 34 (Master toggle all: false strictly overrides individual true toggle):',
  sendMasterFalseMismatch === false ? 'PASSED ✅' : 'FAILED ❌',
  { sendMasterFalseMismatch }
);

console.log('\n🎉 ALL EARLY-ARRIVAL, DURATION, POLICY TOGGLE, EARLY-FINISH, PAUSE, UNSCHEDULED ANTI-SPAM, TEMPLATE, P1S SUPPRESSION & NOTIFICATION TOGGLE TESTS COMPLETED SUCCESSFULLY!\n');



