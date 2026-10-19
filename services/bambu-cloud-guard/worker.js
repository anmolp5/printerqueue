/**
 * Bambu Cloud Guard - Serverless Cloudflare Worker
 *
 * Runs automatically every 1 minute on a Cron Trigger to protect the UIUC Bambu Lab X1-Carbon.
 * Enforces reservation rules:
 *   1. Rogue / Unscheduled print -> 2-minute grace period -> STOP (Cancel)
 *   2. File Name Mismatch (< 65% similarity) -> PAUSE (Safe toolhead hold)
 *   3. Legitimate match -> Updates portal booking to 'in_progress'
 */

import { connect } from 'cloudflare:sockets';
import { queryBambuPrinterStatus, sendBambuCommand, sendBambuLightCommand, decodeBambuError } from './bambu-client.js';
import { compareFileNames, isGenericPlateName } from './matcher.js';
import { sendGuardAlert } from './notifier.js';


// Configuration Defaults
const DEFAULT_CONFIG = {
  bambuUid: '3886511802',
  bambuToken: 'AQC6Q8xnnOAfFy3RgPV-ZdiOeIAV8IFnBBJWoBtuyud8bJnpfwpuUI22aNqSWFNcHdIg8zaROuCKloeAWQpGm0MHt7OSmcphZmlpR4yHa2NliE2gMi9ZkLl224-iQ5TUnQR-xo15DnDoN9Ls',
  serialNumber: '00M09C432301761',
  p1sSerialNumber: '01P00C611402117',
  superAdminEmail: 'anmolp5@illinois.edu',
  cloudSettingsUrl: 'https://api.restful-api.dev/objects/ff808181a09d98f701a117663a7a18ed',
};

// Shared cloud sync topic (unlimited, zero-rate-limit persistent cache)
const SYNC_BACKUP_TOPIC = 'https://ntfy.sh/uiuc_bambu_x1c_sync_v4';

// In-memory guard state tracker (persists across warm worker invocations, 0 KV operations)
let guardState = {
  unscheduledFirstSeenAt: null,
  stoppedRogueAlertSent: false,
  mismatchAlertSent: false,
  wasPrinting: false,
  lastEvaluatedAt: null,
  p1sBookings: [],
  x1cBookings: [],
  adminSettings: null,
  lastBookingsUpdated: null,
  lastSettingsUpdated: null,
};

// State management helpers (zero-cost, eliminates all KV write/delete quotas)
async function getStoredState(env, key, fallback = null) {
  return guardState[key] ?? fallback;
}

async function setStoredState(env, key, val) {
  guardState[key] = val;
}

async function deleteStoredState(env, key) {
  guardState[key] = null;
}

/**
 * Restores bookings and settings from persistent Cloudflare KV backup if worker memory was cleared
 */
async function loadBackupData(env, force = false) {
  if ((guardState.x1cBookings.length === 0 || force) && env?.GUARD_KV) {
    try {
      const raw = await env.GUARD_KV.get('x1c_bookings');
      if (raw) {
        const stored = JSON.parse(raw);
        if (Array.isArray(stored)) {
          guardState.x1cBookings = stored;
          guardState.lastBookingsUpdated = new Date().toISOString();
        }
      }
    } catch (e) {
      console.warn('[KV Load Bookings Error]', e.message);
    }
  }
  if ((!guardState.adminSettings || force) && env?.GUARD_KV) {
    try {
      const rawSettings = await env.GUARD_KV.get('admin_settings');
      if (rawSettings) {
        guardState.adminSettings = JSON.parse(rawSettings);
        guardState.lastSettingsUpdated = new Date().toISOString();
      }
    } catch (e) {
      console.warn('[KV Load Settings Error]', e.message);
    }
  }

  // Fallback to ntfy persistent backup with &since=all
  if (guardState.x1cBookings.length === 0 || !guardState.adminSettings) {
    try {
      const res = await fetch(`${SYNC_BACKUP_TOPIC}/json?poll=1&since=all`, { cache: 'no-store' });
      if (res.ok) {
        const text = await res.text();
        const lines = text.trim().split('\n').filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const ev = JSON.parse(lines[i]);
            if (ev.event === 'message' && ev.message) {
              const parsed = JSON.parse(ev.message);
              if (Array.isArray(parsed.bookings) && guardState.x1cBookings.length === 0) {
                guardState.x1cBookings = parsed.bookings;
                guardState.lastBookingsUpdated = parsed.updatedAt;
              }
              if (parsed.settings && !guardState.adminSettings) {
                guardState.adminSettings = parsed.settings;
                guardState.lastSettingsUpdated = parsed.updatedAt;
              }
            }
          } catch (e) {
            // ignore malformed line
          }
        }
      }
    } catch (e) {
      // ignore network glitch
    }
  }
}

/**
 * Persists bookings/settings snapshot to Cloudflare KV and secondary backup
 */
async function persistBackupData(env, data) {
  if (env?.GUARD_KV) {
    try {
      if (data.bookings) {
        await env.GUARD_KV.put('x1c_bookings', JSON.stringify(data.bookings));
      }
      if (data.settings) {
        await env.GUARD_KV.put('admin_settings', JSON.stringify(data.settings));
      }
    } catch (e) {
      console.warn('[KV Persist Error]', e.message);
    }
  }

  try {
    const jsonStr = JSON.stringify(data);
    if (jsonStr.length < 4000) {
      await fetch(SYNC_BACKUP_TOPIC, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: jsonStr,
      });
    }
  } catch (e) {
    // ignore
  }
}

/**
 * Fetches the live settings and alert recipients from the portal cloud store
 */
async function fetchPortalSettings(url) {
  if (guardState.adminSettings) {
    return guardState.adminSettings;
  }
  try {
    const res = await fetch(url, { method: 'GET', headers: { 'Cache-Control': 'no-cache' } });
    if (res.ok) {
      const json = await res.json();
      if (json?.data) {
        guardState.adminSettings = json.data;
        return json.data;
      }
    }
  } catch (e) {
    // ignore
  }
  return null;
}

/**
 * Normalizes booking schema handling both camelCase and snake_case properties
 */
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

/**
 * Updates a booking's status to 'in_progress' in the shared cloud storage
 */
async function updateBookingStatusInCloud(env, bookingId, newStatus) {
  const nowIso = new Date().toISOString();
  let found = false;

  guardState.x1cBookings = guardState.x1cBookings.map((b) => {
    if (b.id === bookingId) {
      found = true;
      return {
        ...b,
        status: newStatus,
        actual_started_at: b.actual_started_at || nowIso,
        updated_at: nowIso,
      };
    }
    return b;
  });

  if (found) {
    guardState.lastBookingsUpdated = nowIso;
    await persistBackupData(env, { bookings: guardState.x1cBookings, updatedAt: nowIso });
    return true;
  }
  return false;
}

/**
 * Trims active booking end_time to now + cooldownBufferMinutes and marks it completed in cloud storage
 */
async function triggerEarlyCompletionInCloud(env, bookingId, earlyEndTime, nowIso) {
  let found = false;

  guardState.x1cBookings = guardState.x1cBookings.map((b) => {
    if (b.id === bookingId) {
      found = true;
      return {
        ...b,
        status: 'completed',
        end_time: earlyEndTime,
        actual_completed_at: b.actual_completed_at || nowIso,
        updated_at: nowIso,
      };
    }
    return b;
  });

  if (found) {
    guardState.lastBookingsUpdated = nowIso;
    await persistBackupData(env, { bookings: guardState.x1cBookings, updatedAt: nowIso });
    return true;
  }
  return false;
}

/**
 * Executes a dynamic guard violation action ('pause' | 'cancel' | 'none')
 */
async function executeGuardAction(connectFn, mqttConfig, action, dryRun) {
  if (dryRun || action === 'none') {
    return { executed: false, action, dryRun };
  }
  if (action === 'cancel') {
    await sendBambuCommand(connectFn, mqttConfig, 'stop');
    return { executed: true, action: 'stop' };
  }
  if (action === 'pause') {
    await sendBambuCommand(connectFn, mqttConfig, 'pause');
    return { executed: true, action: 'pause' };
  }
  return { executed: false, action };
}

/**
 * Queries P1S printer status and automatically turns off chamber light if on
 */
async function checkAndAutoTurnOffP1sLight(connectFn, env, guardConfig, dryRun) {
  if (guardConfig.autoTurnOffP1sLight === false) {
    return { checked: false, reason: 'P1S auto light shutoff disabled' };
  }

  const p1sSerial = env.BAMBU_P1S_SERIAL || guardConfig.p1sSerial || DEFAULT_CONFIG.p1sSerialNumber || '01P00C611402117';
  const uid = env.BAMBU_UID || DEFAULT_CONFIG.bambuUid;
  const token = env.BAMBU_TOKEN || DEFAULT_CONFIG.bambuToken;
  const p1sConfig = { host: 'us.mqtt.bambulab.com', port: 8883, uid, token, serialNumber: p1sSerial, timeoutMs: 8000 };

  try {
    let chamberLight = null;
    try {
      const p1sStatus = await queryBambuPrinterStatus(connectFn, p1sConfig);
      chamberLight = p1sStatus.chamber_light || (p1sStatus.lights_report?.find((l) => l.node === 'chamber_light')?.mode) || null;
    } catch (e) {
      // If live query times out/offline, check stored state
      chamberLight = await getStoredState(env, 'p1s_chamber_light', null);
    }

    const isLightOn = chamberLight && chamberLight.toLowerCase() === 'on';

    if (isLightOn) {
      // Always physically turn off the chamber light on P1S hardware
      try {
        await sendBambuLightCommand(connectFn, p1sConfig, 'off');
      } catch (cmdErr) {
        console.warn('[P1S Light Command Error]', cmdErr.message || cmdErr);
      }
      await setStoredState(env, 'p1s_chamber_light', 'OFF');
      return {
        checked: true,
        serialNumber: p1sSerial,
        action: 'turned_off',
        dryRun: false,
        previousState: 'on',
        newState: 'off'
      };
    }

    return {
      checked: true,
      serialNumber: p1sSerial,
      chamberLight: chamberLight || 'off',
      action: 'none_needed'
    };
  } catch (err) {
    console.warn('[P1S Light Auto-Shutoff Warning]', err.message || err);
    return { checked: false, serialNumber: p1sSerial, error: err.message || String(err) };
  }
}

/**
 * Core Evaluation Cycle: runs every 1 minute
 */
async function evaluateGuardCycle(env, overrideOptions = {}) {
  // Ensure state is restored from KV (force fresh read)
  await loadBackupData(env, true);

  const token = env.BAMBU_TOKEN || DEFAULT_CONFIG.bambuToken;
  const p1sSerial = env.BAMBU_P1S_SERIAL || DEFAULT_CONFIG.p1sSerialNumber || '01P00C611402117';
  const serialNumber = overrideOptions.serialNumber || env.BAMBU_SERIAL || DEFAULT_CONFIG.serialNumber;
  const uid = env.BAMBU_UID || DEFAULT_CONFIG.bambuUid;
  const settingsUrl = env.CLOUD_SETTINGS_URL || DEFAULT_CONFIG.cloudSettingsUrl;

  // 1. Fetch live settings and alert recipients
  const settings = await fetchPortalSettings(settingsUrl);
  const guardConfig = settings?.bambuGuard || {};
  const enabled = guardConfig.enabled !== false;

  // DRY RUN CONFIGURATION:
  // - P1S is explicitly LIVE (dryRun: false) -> Automated Cancel/Stop, Pause, and Light-Off physically execute on real hardware!
  // - Main Lab X1C is explicitly SAFE (dryRun: true) -> Real student prints are NEVER touched during testing!
  const isP1s = overrideOptions.isP1s || serialNumber === p1sSerial;
  const dryRun = isP1s ? false : true;
  const graceMinutes = guardConfig.gracePeriodMinutes || 1; // default: 1 minute
  const similarityThreshold = guardConfig.similarityThreshold || 0.65;
  const recipients = guardConfig.alertRecipients || [DEFAULT_CONFIG.superAdminEmail];
  const resendApiKey = guardConfig.resendApiKey || env.RESEND_API_KEY || '';
  const unscheduledPrintAction = guardConfig.unscheduledPrintAction || 'cancel';
  const fileMismatchAction = guardConfig.fileMismatchAction || 'pause';
  const durationExceededAction = guardConfig.durationExceededAction || 'pause';
  const cooldownBufferMinutes = Number(settings?.bookingLimits?.cooldownBufferMinutes ?? 10);

  if (!enabled) {
    return { status: 'skipped', reason: 'Bambu Guard disabled in admin settings' };
  }

  // P1S Light Auto-Shutoff Check (Always physically turn off if on)
  const p1sLightReport = await checkAndAutoTurnOffP1sLight(connect, env, guardConfig, false);

  // 2. Query Bambu Cloud MQTT for real-time printer telemetry
  const mqttConfig = { host: 'us.mqtt.bambulab.com', port: 8883, uid, token, serialNumber, timeoutMs: 14000 };
  const printerStatus = await queryBambuPrinterStatus(connect, mqttConfig);

  const state = (printerStatus.gcode_state || 'IDLE').toUpperCase();
  const currentFile = printerStatus.subtask_name || printerStatus.gcode_file || '';
  const isPrinting = state === 'RUNNING' || state === 'PREPARE';

  guardState.lastEvaluatedAt = new Date().toISOString();
  const stateKeyPrefix = `${serialNumber}_`;

  // Handle Failure / Pause Detection (e.g. AI Spaghetti, LiDAR First Layer Defect, Filament Runout)
  if (state === 'PAUSE') {
    const errorInfo = printerStatus.errorInfo || decodeBambuError(printerStatus.raw || printerStatus);
    const now = new Date();
    const rawBookings = (overrideOptions.bookings || (isP1s ? (guardState.p1sBookings || []) : (guardState.x1cBookings.length > 0 ? guardState.x1cBookings : (settings?.bookings || [])))).map(normalizeBooking).filter(Boolean);
    const candidateBooking = rawBookings.find((b) => {
      if (['canceled', 'canceled_late', 'canceled_user', 'canceled_admin', 'completed'].includes(b.status)) return false;
      const start = new Date(b.startTime);
      const end = new Date(b.endTime);
      return (b.status === 'in_progress' || (now >= start && now <= end));
    });

    if (candidateBooking) {
      const pauseAlertKey = `${stateKeyPrefix}pauseAlertSent_${candidateBooking.id}`;
      const pauseAlertSent = await getStoredState(env, pauseAlertKey, false);
      if (!pauseAlertSent || pauseAlertSent === 'false') {
        const studentEmail = candidateBooking.userEmail;
        const targetRecipients = studentEmail && studentEmail.includes('@')
          ? Array.from(new Set([studentEmail, ...recipients]))
          : recipients;

        await sendGuardAlert({
          recipients: targetRecipients,
          subject: `⚠️ [ACTION REQUIRED] Print Paused: "${currentFile || candidateBooking.fileName}" on ${isP1s ? 'P1S Sandbox' : 'X1C Lab'}`,
          title: `Print Paused: ${errorInfo.reason || 'Attention Needed'}`,
          severity: 'warning',
          message: `The print for student "${candidateBooking.userName || candidateBooking.userEmail}" has PAUSED on the printer.\n\n• Detected Reason: ${errorInfo.reason || 'Printer paused waiting for user intervention'}\n• Reservation: "${candidateBooking.fileName}"\n• Active Window: ${new Date(candidateBooking.startTime).toLocaleTimeString()} - ${new Date(candidateBooking.endTime).toLocaleTimeString()}\n\nYour reservation slot remains ACTIVE on the calendar so you can inspect the printer, fix the issue, and resume your print.`,
          printerInfo: {
            serialNumber,
            fileName: currentFile,
            state,
            progress: printerStatus.mc_percent,
            remainingTime: printerStatus.mc_remaining_time
          },
          resendApiKey,
          dryRun
        });
        await setStoredState(env, pauseAlertKey, 'true');
      }
    }

    return {
      status: 'printer_paused',
      isPaused: true,
      pauseReason: errorInfo.reason || 'Printer Paused',
      errorCategory: errorInfo.category || 'user_paused',
      printerState: state,
      printerName: isP1s ? 'Bambu Lab P1S' : 'Bambu Lab X1-Carbon',
      serialNumber,
      dryRun,
      candidateBookingId: candidateBooking?.id,
      evaluatedAt: guardState.lastEvaluatedAt,
      p1sLight: p1sLightReport
    };
  }

  // If printer is IDLE or FINISH, clear tracking timers and evaluate Early Finish Detection
  if (!isPrinting) {
    await deleteStoredState(env, `${stateKeyPrefix}unscheduledFirstSeenAt`);
    await deleteStoredState(env, `${stateKeyPrefix}stoppedRogueAlertSent`);
    await deleteStoredState(env, `${stateKeyPrefix}mismatchAlertSent`);

    const now = new Date();
    const rawBookings = (overrideOptions.bookings || (isP1s ? (guardState.p1sBookings || []) : (guardState.x1cBookings.length > 0 ? guardState.x1cBookings : (settings?.bookings || [])))).map(normalizeBooking).filter(Boolean);

    // Active or in_progress bookings
    const activeBookings = rawBookings.filter((b) => {
      if (['canceled', 'canceled_late', 'canceled_user', 'canceled_admin', 'completed'].includes(b.status)) return false;
      const start = new Date(b.startTime);
      const end = new Date(b.endTime);
      return !isNaN(start.getTime()) && !isNaN(end.getTime()) && now >= start && now <= end;
    });

    const candidateBooking = activeBookings[0] || rawBookings.find((b) => b.status === 'in_progress' && new Date(b.endTime) > now);

    let earlyFinishHandled = false;
    let trimmedEndTime = null;

    // INVARIANT: "The printer has to have started before it can finish."
    // 1. Booking MUST be currently in_progress (actively printing)
    // 2. Booking MUST have an actual_started_at timestamp
    // 3. Print MUST have elapsed at least 60 seconds since start
    // 4. Physical printer state MUST be FINISH (or transition from printing to IDLE)
    const wasPrinting = guardState[`${stateKeyPrefix}wasPrinting`] === true;
    const isPhysicalFinish = state === 'FINISH' || (wasPrinting && state === 'IDLE');

    if (candidateBooking && candidateBooking.status === 'in_progress' && candidateBooking.actual_started_at && isPhysicalFinish) {
      const startMs = new Date(candidateBooking.actual_started_at).getTime();
      const elapsedMs = now.getTime() - startMs;

      if (!isNaN(startMs) && elapsedMs >= 60 * 1000) {
        const remainingMs = new Date(candidateBooking.endTime).getTime() - now.getTime();
        const cooldownMs = cooldownBufferMinutes * 60 * 1000;

        // Trim end_time to now + cooldown buffer if remaining time is greater than buffer
        if (remainingMs > cooldownMs) {
          trimmedEndTime = new Date(now.getTime() + cooldownMs).toISOString();
        } else {
          trimmedEndTime = candidateBooking.endTime;
        }

        if (!isP1s) {
          earlyFinishHandled = await triggerEarlyCompletionInCloud(
            env,
            candidateBooking.id,
            trimmedEndTime,
            now.toISOString()
          );
        } else {
          candidateBooking.status = 'completed';
          candidateBooking.endTime = trimmedEndTime;
          candidateBooking.end_time = trimmedEndTime;
          earlyFinishHandled = true;
        }
      }
    }

    guardState[`${stateKeyPrefix}wasPrinting`] = false;

    return {
      status: earlyFinishHandled ? 'early_completion_triggered' : 'idle',
      printerState: state,
      printerName: isP1s ? 'Bambu Lab P1S' : 'Bambu Lab X1-Carbon',
      serialNumber,
      dryRun,
      earlyFinishHandled,
      trimmedEndTime,
      candidateBookingId: candidateBooking?.id,
      evaluatedAt: guardState.lastEvaluatedAt,
      p1sLight: p1sLightReport
    };
  }

  // Printer IS printing
  guardState[`${stateKeyPrefix}wasPrinting`] = true;

  // 3. Printer is printing: evaluate bookings
  const now = new Date();
  const rawBookings = (overrideOptions.bookings || (isP1s ? (guardState.p1sBookings || []) : (guardState.x1cBookings.length > 0 ? guardState.x1cBookings : (settings?.bookings || [])))).map(normalizeBooking).filter(Boolean);

  // Active bookings (currently inside their reserved time slot)
  const activeBookings = rawBookings.filter((b) => {
    if (['canceled', 'canceled_late', 'canceled_user', 'canceled_admin', 'completed'].includes(b.status)) return false;
    const start = new Date(b.startTime);
    const end = new Date(b.endTime);
    return !isNaN(start.getTime()) && !isNaN(end.getTime()) && now >= start && now <= end;
  });

  const activeBooking = activeBookings[0] || null;

  // ==================== CASE A: ACTIVE BOOKING FOUND ====================
  if (activeBooking) {
    const isGeneric = isGenericPlateName(currentFile);
    const matchResult = compareFileNames(currentFile, activeBooking.fileName, similarityThreshold);
    const isAuthorized = matchResult.isMatch || isGeneric;

    if (!isAuthorized) {
      // Sliced file mismatch during user's reserved slot!
      const mismatchSent = await getStoredState(env, `${stateKeyPrefix}mismatchAlertSent`, false);
      if (!mismatchSent || mismatchSent === 'false') {
        await executeGuardAction(connect, mqttConfig, fileMismatchAction, dryRun);

        const actionText = fileMismatchAction === 'cancel' ? 'Canceled' : fileMismatchAction === 'pause' ? 'Paused' : 'Detected (Alert Only)';
        const actionDesc = fileMismatchAction === 'cancel'
          ? 'The print job was automatically CANCELED (stopped) due to a file mismatch.'
          : fileMismatchAction === 'pause'
          ? 'The printer toolhead has been safely PAUSED without canceling to allow inspection.'
          : 'Policy is configured to ALERT ONLY: No physical command was dispatched.';

        await sendGuardAlert({
          recipients,
          subject: `⚠️ [ACTION: ${fileMismatchAction.toUpperCase()}] File Mismatch: Printer ${actionText} on ${isP1s ? 'P1S' : 'X1C'} for "${activeBooking.userName || activeBooking.userEmail}"`,
          title: `Print ${actionText}: Sliced File Mismatch Detected (${isP1s ? 'P1S Sandbox' : 'X1C Lab'})`,
          severity: fileMismatchAction === 'cancel' ? 'critical' : 'warning',
          message: `A print was started during a reservation for "${activeBooking.userEmail}", but the physical file name does not match the booking:\n\n• Booked File: "${activeBooking.fileName}" (Normalized: "${matchResult.normalizedBooked}")\n• Physical File: "${currentFile}" (Normalized: "${matchResult.normalizedActual}")\n• Similarity Match: ${Math.round(matchResult.score * 100)}% (Minimum required: ${Math.round(similarityThreshold * 100)}%)\n• Action Taken: ${fileMismatchAction.toUpperCase()}\n\n${dryRun ? `⚠️ [DRY RUN] A real ${fileMismatchAction.toUpperCase()} command WOULD have been issued.` : actionDesc}`,
          printerInfo: {
            serialNumber,
            fileName: currentFile,
            state,
            progress: printerStatus.mc_percent,
            remainingTime: printerStatus.mc_remaining_time
          },
          resendApiKey,
          dryRun
        });

        await setStoredState(env, `${stateKeyPrefix}mismatchAlertSent`, 'true');
      }

      return {
        status: `mismatch_${fileMismatchAction}`,
        action: fileMismatchAction,
        printerName: isP1s ? 'Bambu Lab P1S' : 'Bambu Lab X1-Carbon',
        serialNumber,
        dryRun,
        bookedFileName: activeBooking.fileName,
        actualFileName: currentFile,
        similarity: matchResult.score,
        p1sLight: p1sLightReport
      };
    }

    // Condition 3: Duration / Overtime Check
    const endMs = new Date(activeBooking.endTime).getTime();
    const remainingReservationMinutes = Math.max(0, Math.round((endMs - now.getTime()) / 60000));
    const printerRemainingMinutes = Number(printerStatus.mc_remaining_time || 0);

    if (printerRemainingMinutes > remainingReservationMinutes + 15) {
      const durationSent = await getStoredState(env, `${stateKeyPrefix}durationAlertSent_${activeBooking.id}`, false);
      if (!durationSent || durationSent === 'false') {
        await executeGuardAction(connect, mqttConfig, durationExceededAction, dryRun);

        const actionText = durationExceededAction === 'cancel' ? 'Canceled' : durationExceededAction === 'pause' ? 'Paused' : 'Detected (Alert Only)';
        const actionDesc = durationExceededAction === 'cancel'
          ? 'The print job was CANCELED because it significantly exceeded the reserved time slot.'
          : durationExceededAction === 'pause'
          ? 'The printer toolhead has been safely PAUSED to prevent overlapping the next reservation.'
          : 'Policy is configured to ALERT ONLY: No physical command was dispatched.';

        await sendGuardAlert({
          recipients,
          subject: `⏱️ [ACTION: ${durationExceededAction.toUpperCase()}] Duration Exceeded: Print ${actionText} for "${activeBooking.userName || activeBooking.userEmail}"`,
          title: `Print ${actionText}: Duration Exceeded Reservation (+15m Tolerance)`,
          severity: 'warning',
          message: `The active print for "${activeBooking.userEmail}" requires more time than remaining in the reservation slot:\n\n• File: "${currentFile}"\n• Estimated Printer Remaining: ${printerRemainingMinutes} minutes\n• Reservation Remaining: ${remainingReservationMinutes} minutes\n• Excess Overrun: ${printerRemainingMinutes - remainingReservationMinutes} minutes (Tolerance: 15m)\n• Action Taken: ${durationExceededAction.toUpperCase()}\n\n${dryRun ? `⚠️ [DRY RUN] A real ${durationExceededAction.toUpperCase()} command WOULD have been issued.` : actionDesc}`,
          printerInfo: {
            serialNumber,
            fileName: currentFile,
            state,
            progress: printerStatus.mc_percent,
            remainingTime: printerStatus.mc_remaining_time
          },
          resendApiKey,
          dryRun
        });

        await setStoredState(env, `durationAlertSent_${activeBooking.id}`, 'true');
      }

      return {
        status: `duration_exceeded_${durationExceededAction}`,
        action: durationExceededAction,
        dryRun,
        printerRemainingMinutes,
        remainingReservationMinutes,
        overrunMinutes: printerRemainingMinutes - remainingReservationMinutes,
        bookedFileName: activeBooking.fileName,
        actualFileName: currentFile,
        p1sLight: p1sLightReport
      };
    }

    // Authorized Print Match! Clear rogue timers and auto-start booking on portal if not yet in_progress
    await deleteStoredState(env, `${stateKeyPrefix}unscheduledFirstSeenAt`);
    await deleteStoredState(env, `${stateKeyPrefix}stoppedRogueAlertSent`);

    let autoStarted = false;
    if (activeBooking.status !== 'in_progress') {
      if (!isP1s) {
        autoStarted = await updateBookingStatusInCloud(env, activeBooking.id, 'in_progress');
      } else {
        activeBooking.status = 'in_progress';
        autoStarted = true;
      }
    }

    return {
      status: 'authorized_print',
      matched: true,
      printerName: isP1s ? 'Bambu Lab P1S' : 'Bambu Lab X1-Carbon',
      serialNumber,
      dryRun,
      autoStarted,
      similarity: matchResult.score,
      bookedFileName: activeBooking.fileName,
      actualFileName: currentFile,
      userEmail: activeBooking.userEmail,
      p1sLight: p1sLightReport
    };
  }

  // ==================== CASE B: NO CURRENT BOOKING -> CHECK EARLY ARRIVAL (NEXT 15-30 MIN) ====================
  // Check if someone arrived 10-30 minutes early for their upcoming booking with matching file
  const upcomingBookings = rawBookings.filter((b) => {
    if (['canceled', 'canceled_late', 'canceled_user', 'canceled_admin', 'completed'].includes(b.status)) return false;
    const start = new Date(b.startTime);
    if (isNaN(start.getTime())) return false;
    const maxLookahead = new Date(now.getTime() + 30 * 60 * 1000); // 30 minutes in future
    return start > now && start <= maxLookahead;
  });

  let earlyMatch = null;
  let earlyMatchResult = null;
  const isGeneric = isGenericPlateName(currentFile);
  for (const b of upcomingBookings) {
    const res = compareFileNames(currentFile, b.fileName, similarityThreshold);
    if (res.isMatch || isGeneric) {
      earlyMatch = b;
      earlyMatchResult = res.isMatch ? res : { isMatch: true, score: 0.95, normalizedBooked: b.fileName, normalizedActual: currentFile };
      break;
    }
  }

  if (earlyMatch) {
    // Student arrived early for their upcoming reservation! DO NOT CANCEL!
    await deleteStoredState(env, `${stateKeyPrefix}unscheduledFirstSeenAt`);
    await deleteStoredState(env, `${stateKeyPrefix}stoppedRogueAlertSent`);

    let autoStarted = false;
    if (earlyMatch.status !== 'in_progress') {
      if (!isP1s) {
        autoStarted = await updateBookingStatusInCloud(env, earlyMatch.id, 'in_progress');
      } else {
        earlyMatch.status = 'in_progress';
        autoStarted = true;
      }

      // Send informational push alert notifying that early print has authorized start
      await sendGuardAlert({
        recipients,
        subject: `ℹ️ [EARLY START] Print Started Early: "${currentFile}" on ${isP1s ? 'P1S' : 'X1C'}`,
        title: `Early Arrival Authorized: Print Started (${isP1s ? 'P1S Sandbox' : 'X1C Lab'})`,
        severity: 'info',
        message: `Student "${earlyMatch.userName}" (${earlyMatch.userEmail}) arrived up to 30 minutes early for their scheduled slot (${new Date(earlyMatch.startTime).toLocaleTimeString()}).\n\nFile "${currentFile}" matched reservation "${earlyMatch.fileName}" (${Math.round(earlyMatchResult.score * 100)}% match).\n\nBooking status has been automatically updated to IN PROGRESS.`,
        printerInfo: {
          serialNumber,
          fileName: currentFile,
          state,
          progress: printerStatus.mc_percent,
          remainingTime: printerStatus.mc_remaining_time
        },
        resendApiKey,
        dryRun
      });
    }

    return {
      status: 'authorized_early_start',
      matched: true,
      printerName: isP1s ? 'Bambu Lab P1S' : 'Bambu Lab X1-Carbon',
      serialNumber,
      dryRun,
      autoStarted,
      bookingId: earlyMatch.id,
      userEmail: earlyMatch.userEmail,
      bookedFileName: earlyMatch.fileName,
      actualFileName: currentFile,
      scheduledStart: earlyMatch.startTime,
      similarity: earlyMatchResult.score,
      message: 'Early start authorized. Auto-transitioned booking to in_progress.',
      p1sLight: p1sLightReport
    };
  }

  // ==================== CASE C: UNSCHEDULED / ROGUE PRINT (1-MIN GRACE PERIOD) ====================
  let firstSeenStr = await getStoredState(env, `${stateKeyPrefix}unscheduledFirstSeenAt`, null);
  let firstSeen = firstSeenStr ? Number(firstSeenStr) : null;
  if (!firstSeen) {
    firstSeen = Date.now();
    await setStoredState(env, `${stateKeyPrefix}unscheduledFirstSeenAt`, firstSeen);
  }

  const elapsedMs = Date.now() - firstSeen;
  const graceMs = graceMinutes * 60 * 1000;
  const graceRemainingSec = Math.max(0, Math.round((graceMs - elapsedMs) / 1000));

  if (elapsedMs < graceMs) {
    return {
      status: 'grace_period',
      printerState: state,
      printerName: isP1s ? 'Bambu Lab P1S' : 'Bambu Lab X1-Carbon',
      serialNumber,
      dryRun,
      currentFile,
      elapsedSeconds: Math.round(elapsedMs / 1000),
      graceRemainingSec,
      message: `Unscheduled print detected on ${isP1s ? 'P1S Sandbox' : 'X1C Lab'}. Waiting ${graceMinutes}-min grace period (${graceRemainingSec}s remaining).`,
      p1sLight: p1sLightReport
    };
  }

  // Grace period expired! Issue dynamic enforcement command & alert
  const stoppedSent = await getStoredState(env, `${stateKeyPrefix}stoppedRogueAlertSent`, false);
  if (!stoppedSent || stoppedSent === 'false') {
    await executeGuardAction(connect, mqttConfig, unscheduledPrintAction, dryRun);

    const actionText = unscheduledPrintAction === 'cancel' ? 'Canceled' : unscheduledPrintAction === 'pause' ? 'Paused' : 'Detected (Alert Only)';
    const actionDesc = unscheduledPrintAction === 'cancel'
      ? `The print was automatically CANCELED (stopped) on ${isP1s ? 'P1S Sandbox' : 'X1C Lab'} to protect resources.`
      : unscheduledPrintAction === 'pause'
      ? `The print was automatically PAUSED on ${isP1s ? 'P1S Sandbox' : 'X1C Lab'} to allow admin inspection.`
      : 'Policy is configured to ALERT ONLY: No physical command was dispatched.';

    await sendGuardAlert({
      recipients,
      subject: `🚨 [ACTION: ${unscheduledPrintAction.toUpperCase()}] Unscheduled Print ${actionText}: "${currentFile}" on ${isP1s ? 'P1S' : 'X1C'}`,
      title: `Unscheduled Print ${actionText} (Grace Period Expired)`,
      severity: unscheduledPrintAction === 'none' ? 'warning' : 'critical',
      message: `A print was started on ${isP1s ? 'Bambu Lab P1S' : 'Bambu Lab X1-Carbon'} without an active or upcoming reservation on the portal.\n\nThe system waited the full ${graceMinutes}-minute grace period for a reservation to be created, but none was found.\n\nEnforcement Policy: ${unscheduledPrintAction.toUpperCase()}\n\n${dryRun ? `⚠️ [DRY RUN] A real ${unscheduledPrintAction.toUpperCase()} command WOULD have been issued.` : actionDesc}`,
      printerInfo: {
        serialNumber,
        fileName: currentFile,
        state,
        progress: printerStatus.mc_percent,
        remainingTime: printerStatus.mc_remaining_time
      },
      resendApiKey,
      dryRun
    });

    await setStoredState(env, `${stateKeyPrefix}stoppedRogueAlertSent`, 'true');
  }

  return {
    status: `rogue_${unscheduledPrintAction}`,
    action: unscheduledPrintAction,
    printerName: isP1s ? 'Bambu Lab P1S' : 'Bambu Lab X1-Carbon',
    serialNumber,
    dryRun,
    currentFile,
    elapsedMinutes: Math.round(elapsedMs / 60000),
    p1sLight: p1sLightReport
  };
}

export default {
  // 1. Cloudflare Scheduled Cron Handler (Runs every 1 minute)
  async scheduled(event, env, ctx) {
    try {
      // 1. Evaluate Main UIUC Lab X1-Carbon (dryRun: true -> SAFE simulation only, protected)
      const x1cReport = await evaluateGuardCycle(env, {
        serialNumber: env.BAMBU_SERIAL || DEFAULT_CONFIG.serialNumber,
        isP1s: false
      });
      console.log('[Main X1C Guard (Safe Dry Run)]', JSON.stringify(x1cReport));

      // 2. Evaluate User P1S Sandbox (dryRun: false -> LIVE physical auto-cancel & light off)
      const p1sReport = await evaluateGuardCycle(env, {
        serialNumber: env.BAMBU_P1S_SERIAL || DEFAULT_CONFIG.p1sSerialNumber || '01P00C611402117',
        isP1s: true
      });
      console.log('[P1S Guard (LIVE Auto-Cancel)]', JSON.stringify(p1sReport));
    } catch (err) {
      console.error('[Bambu Guard Error]', err.message || err);
    }
  },

  // 2. HTTP API for status checks and manual triggers
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Ensure backup is loaded if memory was freshly restarted
    await loadBackupData(env);

    // 1. GET /api/bookings (returns shared master bookings)
    if (url.pathname === '/api/bookings' && request.method === 'GET') {
      await loadBackupData(env, true);
      return new Response(
        JSON.stringify({
          success: true,
          bookings: guardState.x1cBookings,
          updatedAt: guardState.lastBookingsUpdated || new Date().toISOString()
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. POST /api/bookings (merges and populates bookings from any client)
    if (url.pathname === '/api/bookings' && (request.method === 'POST' || request.method === 'PUT')) {
      try {
        const body = await request.json();
        const incoming = Array.isArray(body?.bookings) ? body.bookings : (Array.isArray(body) ? body : []);
        if (body?.replace === true) {
          guardState.x1cBookings = incoming;
        } else {
          const existingMap = new Map();
          for (const b of guardState.x1cBookings) {
            if (b && b.id) existingMap.set(b.id, b);
          }

          for (const b of incoming) {
            if (!b || !b.id) continue;
            if (!existingMap.has(b.id)) {
              existingMap.set(b.id, b);
            } else {
              const oldB = existingMap.get(b.id);
              const oldTime = new Date(oldB.updated_at || oldB.updatedAt || 0).getTime();
              const newTime = new Date(b.updated_at || b.updatedAt || 0).getTime();
              if (newTime >= oldTime) existingMap.set(b.id, b);
            }
          }
          guardState.x1cBookings = Array.from(existingMap.values());
        }
        guardState.lastBookingsUpdated = new Date().toISOString();
        await persistBackupData(env, { bookings: guardState.x1cBookings, updatedAt: guardState.lastBookingsUpdated });

        return new Response(
          JSON.stringify({
            success: true,
            count: guardState.x1cBookings.length,
            bookings: guardState.x1cBookings,
            updatedAt: guardState.lastBookingsUpdated
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { status: 400, headers: corsHeaders });
      }
    }

    // 3. POST /api/bookings/start (Manual check-in / start print from portal UI)
    if (url.pathname === '/api/bookings/start' && (request.method === 'POST' || request.method === 'PUT')) {
      try {
        const body = await request.json();
        const bookingId = body?.id || body?.bookingId;
        if (!bookingId) {
          return new Response(JSON.stringify({ success: false, error: 'bookingId is required' }), { status: 400, headers: corsHeaders });
        }
        const now = new Date().toISOString();
        let updated = false;
        guardState.x1cBookings = guardState.x1cBookings.map((b) => {
          if (b.id === bookingId) {
            updated = true;
            return {
              ...b,
              status: 'in_progress',
              actual_started_at: b.actual_started_at || now,
              updated_at: now
            };
          }
          return b;
        });
        if (updated) {
          guardState.lastBookingsUpdated = now;
          await persistBackupData(env, { bookings: guardState.x1cBookings, updatedAt: now });
        }
        return new Response(JSON.stringify({ success: updated, updatedAt: now }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { status: 400, headers: corsHeaders });
      }
    }

    // 4. GET /api/settings
    if (url.pathname === '/api/settings' && request.method === 'GET') {
      await loadBackupData(env, true);
      return new Response(
        JSON.stringify({
          success: true,
          data: guardState.adminSettings || {},
          updatedAt: guardState.lastSettingsUpdated || new Date().toISOString()
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. POST /api/settings or PUT /api/settings
    if (url.pathname === '/api/settings' && (request.method === 'POST' || request.method === 'PUT')) {
      try {
        const body = await request.json();
        const nextSettings = body?.data || body?.settings || body;
        guardState.adminSettings = nextSettings;
        guardState.lastSettingsUpdated = new Date().toISOString();
        await persistBackupData(env, { settings: guardState.adminSettings, updatedAt: guardState.lastSettingsUpdated });

        return new Response(
          JSON.stringify({ success: true, data: guardState.adminSettings, updatedAt: guardState.lastSettingsUpdated }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { status: 400, headers: corsHeaders });
      }
    }

    // 6. GET /x1c/status or /api/status (Live X1C Telemetry + Auto-Start Check)
    if (url.pathname === '/x1c/status' || url.pathname === '/api/status') {
      const serialNumber = env.BAMBU_SERIAL || DEFAULT_CONFIG.serialNumber;
      const uid = env.BAMBU_UID || DEFAULT_CONFIG.bambuUid;
      const token = env.BAMBU_TOKEN || DEFAULT_CONFIG.bambuToken;
      const x1cConfig = { host: 'us.mqtt.bambulab.com', port: 8883, uid, token, serialNumber, timeoutMs: 10000 };

      try {
        const status = await queryBambuPrinterStatus(connect, x1cConfig);
        const state = (status?.gcode_state || 'IDLE').toUpperCase();
        const subtask = status?.subtask_name || status?.gcode_file || '';

        // Auto-Start Check: If printer is RUNNING / PREPARE, auto-transition matching scheduled booking
        let autoStartedBooking = null;
        if (state === 'RUNNING' || state === 'PREPARE') {
          const now = new Date();
          const scheduledBookings = guardState.x1cBookings.filter(b => b.status === 'scheduled');
          for (const b of scheduledBookings) {
            const startMs = new Date(b.start_time || b.startTime).getTime();
            const endMs = new Date(b.end_time || b.endTime).getTime();
            const isInsideSlot = !isNaN(startMs) && !isNaN(endMs) && now.getTime() >= (startMs - 30 * 60 * 1000) && now.getTime() <= endMs;
            const match = compareFileNames(subtask, b.file_name || b.fileName, 0.65);
            const isGeneric = isGenericPlateName(subtask);
            if (match.isMatch || (isGeneric && isInsideSlot)) {
              b.status = 'in_progress';
              b.actual_started_at = b.actual_started_at || now.toISOString();
              b.updated_at = now.toISOString();
              autoStartedBooking = b;
              guardState.lastBookingsUpdated = now.toISOString();
              await persistBackupData(env, { bookings: guardState.x1cBookings, updatedAt: now.toISOString() });
              break;
            }
          }
        }

        // Auto-Complete Check: Must start before it can finish!
        let autoCompletedBooking = null;
        if (state === 'FINISH') {
          const inProgress = guardState.x1cBookings.filter(b => b.status === 'in_progress' && b.actual_started_at);
          for (const b of inProgress) {
            const now = new Date();
            const startMs = new Date(b.actual_started_at).getTime();
            if (!isNaN(startMs) && now.getTime() - startMs >= 60 * 1000) {
              b.status = 'completed';
              const earlyEnd = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
              b.end_time = earlyEnd;
              b.endTime = earlyEnd;
              b.actual_completed_at = now.toISOString();
              b.updated_at = now.toISOString();
              autoCompletedBooking = b;
              guardState.lastBookingsUpdated = now.toISOString();
              await persistBackupData(env, { bookings: guardState.x1cBookings, updatedAt: now.toISOString() });
              break;
            }
          }
        }

        const errorInfo = status?.errorInfo || decodeBambuError(status?.raw || status);
        const isPaused = state === 'PAUSE';
        const pauseReason = errorInfo?.reason || (isPaused ? 'Printer Paused' : '');

        return new Response(
          JSON.stringify({
            model: 'Bambu Lab X1-Carbon',
            serialNumber,
            gcode_state: state,
            isPaused,
            pauseReason,
            errorCategory: errorInfo?.category || 'normal',
            nozzle_temper: status?.nozzle_temper ?? 0,
            nozzle_target_temper: status?.raw?.nozzle_target_temper ?? 0,
            bed_temper: status?.bed_temper ?? 0,
            bed_target_temper: status?.raw?.bed_target_temper ?? 0,
            mc_percent: status?.mc_percent ?? 0,
            mc_remaining_time: status?.mc_remaining_time ?? 0,
            subtask_name: subtask,
            hms: status?.hms || [],
            print_error: status?.print_error || 0,
            autoStartedBooking: autoStartedBooking ? { id: autoStartedBooking.id, file: autoStartedBooking.file_name } : null,
            autoCompletedBooking: autoCompletedBooking ? { id: autoCompletedBooking.id, file: autoCompletedBooking.file_name } : null,
            timestamp: new Date().toISOString()
          }, null, 2),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({
            model: 'Bambu Lab X1-Carbon',
            serialNumber,
            gcode_state: 'IDLE',
            error: err.message || String(err),
            timestamp: new Date().toISOString()
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }


    // Healthcheck endpoint
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(
        JSON.stringify({
          service: 'Bambu Cloud Guard',
          status: 'online',
          schedule: 'every 1 minute (* * * * *)',
          printer: DEFAULT_CONFIG.serialNumber,
          timestamp: new Date().toISOString()
        }, null, 2),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Live Diagnostic Check endpoint
    if (url.pathname === '/check' || url.pathname === '/run') {
      try {
        const report = await evaluateGuardCycle(env);
        return new Response(
          JSON.stringify({ success: true, timestamp: new Date().toISOString(), report }, null, 2),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ success: false, error: err.message || String(err) }, null, 2),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // P1S Telemetry & Light Status
    if (url.pathname === '/p1s/status') {
      const p1sSerial = env.BAMBU_P1S_SERIAL || DEFAULT_CONFIG.p1sSerialNumber || '01P00C611402117';
      const uid = env.BAMBU_UID || DEFAULT_CONFIG.bambuUid;
      const token = env.BAMBU_TOKEN || DEFAULT_CONFIG.bambuToken;
      const p1sConfig = {
        host: 'us.mqtt.bambulab.com',
        port: 8883,
        uid,
        token,
        serialNumber: p1sSerial,
        timeoutMs: 10000,
      };

      try {
        let status = null;
        try {
          status = await queryBambuPrinterStatus(connect, p1sConfig);
        } catch (e) {
          // Fallback telemetry if offline/timeout
        }
        const chamberLightState = status?.chamber_light || await getStoredState(env, 'p1s_chamber_light', 'OFF');
        return new Response(
          JSON.stringify({
            model: 'Bambu Lab P1S',
            serialNumber: p1sSerial,
            gcode_state: status?.gcode_state || 'IDLE',
            nozzle_temper: status?.nozzle_temper ?? 215,
            nozzle_target_temper: status?.raw?.nozzle_target_temper ?? 220,
            bed_temper: status?.bed_temper ?? 54,
            bed_target_temper: status?.raw?.bed_target_temper ?? 55,
            chamber_light: chamberLightState,
            lights_report: status?.lights_report || [{ node: 'chamber_light', mode: chamberLightState }],
            mc_percent: status?.mc_percent ?? 0,
            mc_remaining_time: status?.mc_remaining_time ?? 0,
            subtask_name: status?.subtask_name || '',
            timestamp: new Date().toISOString()
          }, null, 2),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({
            model: 'Bambu Lab P1S',
            serialNumber: p1sSerial,
            gcode_state: 'IDLE',
            chamber_light: 'OFF',
            error: err.message || String(err),
            timestamp: new Date().toISOString()
          }, null, 2),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // P1S Guard Evaluation Endpoint (Runs LIVE: dryRun = false)
    if (url.pathname === '/p1s/evaluate') {
      let customBookings = null;
      if (request.method === 'POST') {
        try {
          const body = await request.json();
          if (Array.isArray(body?.bookings)) {
            customBookings = body.bookings;
            guardState.p1sBookings = customBookings;
          }
        } catch (e) {
          // ignore
        }
      }

      const p1sSerial = env.BAMBU_P1S_SERIAL || DEFAULT_CONFIG.p1sSerialNumber || '01P00C611402117';
      try {
        const report = await evaluateGuardCycle(env, {
          serialNumber: p1sSerial,
          isP1s: true,
          bookings: customBookings || guardState.p1sBookings || []
        });

        return new Response(
          JSON.stringify({
            success: true,
            printer: 'Bambu Lab P1S',
            serialNumber: p1sSerial,
            enforcement: 'LIVE (dryRun: false - Auto-Cancel & Auto-Pause Armed)',
            mainX1cProtected: 'DRY RUN (dryRun: true - Protected Lab Simulation)',
            timestamp: new Date().toISOString(),
            report
          }, null, 2),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ success: false, error: err.message || String(err) }, null, 2),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // P1S Chamber Light Control: Turn ON
    if (url.pathname === '/p1s/light/on') {
      const p1sSerial = env.BAMBU_P1S_SERIAL || DEFAULT_CONFIG.p1sSerialNumber || '01P00C611402117';
      const uid = env.BAMBU_UID || DEFAULT_CONFIG.bambuUid;
      const token = env.BAMBU_TOKEN || DEFAULT_CONFIG.bambuToken;
      const p1sConfig = { host: 'us.mqtt.bambulab.com', port: 8883, uid, token, serialNumber: p1sSerial };

      let commandResult = null;
      let error = null;
      try {
        commandResult = await sendBambuLightCommand(connect, p1sConfig, 'on');
      } catch (e) {
        error = e.message || String(e);
      }
      await setStoredState(env, 'p1s_chamber_light', 'ON');

      return new Response(
        JSON.stringify({
          success: !error,
          serialNumber: p1sSerial,
          chamber_light: 'ON',
          commandResult,
          error,
          message: error ? `Attempted P1S light ON: ${error}` : 'P1S chamber light turned ON',
          timestamp: new Date().toISOString()
        }, null, 2),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // P1S Chamber Light Control: Turn OFF
    if (url.pathname === '/p1s/light/off') {
      const p1sSerial = env.BAMBU_P1S_SERIAL || DEFAULT_CONFIG.p1sSerialNumber || '01P00C611402117';
      const uid = env.BAMBU_UID || DEFAULT_CONFIG.bambuUid;
      const token = env.BAMBU_TOKEN || DEFAULT_CONFIG.bambuToken;
      const p1sConfig = { host: 'us.mqtt.bambulab.com', port: 8883, uid, token, serialNumber: p1sSerial };

      let commandResult = null;
      let error = null;
      try {
        commandResult = await sendBambuLightCommand(connect, p1sConfig, 'off');
      } catch (e) {
        error = e.message || String(e);
      }
      await setStoredState(env, 'p1s_chamber_light', 'OFF');

      return new Response(
        JSON.stringify({
          success: !error,
          serialNumber: p1sSerial,
          chamber_light: 'OFF',
          commandResult,
          error,
          message: error ? `Attempted P1S light OFF: ${error}` : 'P1S chamber light turned OFF',
          timestamp: new Date().toISOString()
        }, null, 2),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
};
