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
import { queryBambuPrinterStatus, sendBambuCommand } from './bambu-client.js';
import { compareFileNames } from './matcher.js';
import { sendGuardAlert } from './notifier.js';

// Configuration Defaults
const DEFAULT_CONFIG = {
  bambuUid: '3886511802',
  bambuToken: 'AQC6Q8xnnOAfFy3RgPV-ZdiOeIAV8IFnBBJWoBtuyud8bJnpfwpuUI22aNqSWFNcHdIg8zaROuCKloeAWQpGm0MHt7OSmcphZmlpR4yHa2NliE2gMi9ZkLl224-iQ5TUnQR-xo15DnDoN9Ls',
  serialNumber: '00M09C432301761',
  superAdminEmail: 'anmolp5@illinois.edu',
  cloudSettingsUrl: 'https://api.restful-api.dev/objects/ff808181a09d98f701a117663a7a18ed',
};

// In-memory guard state tracker (persists across warm worker invocations, 0 KV operations)
let guardState = {
  unscheduledFirstSeenAt: null,
  stoppedRogueAlertSent: false,
  mismatchAlertSent: false,
  lastEvaluatedAt: null,
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
 * Fetches the live settings and alert recipients from the portal cloud store
 */
async function fetchPortalSettings(url) {
  try {
    const res = await fetch(url, { method: 'GET', headers: { 'Cache-Control': 'no-cache' } });
    if (res.ok) {
      const json = await res.json();
      return json?.data || null;
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
async function updateBookingStatusInCloud(settingsUrl, bookingId, newStatus) {
  try {
    const res = await fetch(settingsUrl, { method: 'GET', headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) return false;
    const json = await res.json();
    const currentData = json?.data || {};
    const rawBookings = currentData.bookings || [];
    let found = false;
    const nowIso = new Date().toISOString();
    const updatedBookings = rawBookings.map((b) => {
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
      const putRes = await fetch(settingsUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'bambu_x1c_admin_settings_v1',
          data: {
            ...currentData,
            bookings: updatedBookings,
            bookingsUpdatedAt: nowIso,
          },
        }),
      });
      return putRes.ok;
    }
  } catch (e) {
    console.error('Failed to update booking status in cloud:', e);
  }
  return false;
}

/**
 * Core Evaluation Cycle: runs every 1 minute
 */
async function evaluateGuardCycle(env) {
  const token = env.BAMBU_TOKEN || DEFAULT_CONFIG.bambuToken;
  const serialNumber = env.BAMBU_SERIAL || DEFAULT_CONFIG.serialNumber;
  const uid = env.BAMBU_UID || DEFAULT_CONFIG.bambuUid;
  const settingsUrl = env.CLOUD_SETTINGS_URL || DEFAULT_CONFIG.cloudSettingsUrl;

  // 1. Fetch live settings and alert recipients
  const settings = await fetchPortalSettings(settingsUrl);
  const guardConfig = settings?.bambuGuard || {};
  const enabled = guardConfig.enabled !== false;
  const dryRun = guardConfig.dryRun !== false; // Default safe: dry-run true
  const graceMinutes = guardConfig.gracePeriodMinutes || 2;
  const similarityThreshold = guardConfig.similarityThreshold || 0.65;
  const recipients = guardConfig.alertRecipients || [DEFAULT_CONFIG.superAdminEmail];
  const resendApiKey = guardConfig.resendApiKey || env.RESEND_API_KEY || '';

  if (!enabled) {
    return { status: 'skipped', reason: 'Bambu Guard disabled in admin settings' };
  }

  // 2. Query Bambu Cloud MQTT for real-time printer telemetry
  const mqttConfig = { host: 'us.mqtt.bambulab.com', port: 8883, uid, token, serialNumber, timeoutMs: 14000 };
  const printerStatus = await queryBambuPrinterStatus(connect, mqttConfig);

  const state = (printerStatus.gcode_state || 'IDLE').toUpperCase();
  const currentFile = printerStatus.subtask_name || printerStatus.gcode_file || '';
  const isPrinting = state === 'RUNNING' || state === 'PREPARE';

  guardState.lastEvaluatedAt = new Date().toISOString();

  // If printer is IDLE or FINISH, clear tracking timers
  if (!isPrinting) {
    await deleteStoredState(env, 'unscheduledFirstSeenAt');
    await deleteStoredState(env, 'stoppedRogueAlertSent');
    await deleteStoredState(env, 'mismatchAlertSent');
    return {
      status: 'idle',
      printerState: state,
      evaluatedAt: guardState.lastEvaluatedAt
    };
  }

  // 3. Printer is printing: evaluate bookings
  const now = new Date();
  const rawBookings = (settings?.bookings || []).map(normalizeBooking).filter(Boolean);

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
    const matchResult = compareFileNames(currentFile, activeBooking.fileName, similarityThreshold);

    if (!matchResult.isMatch) {
      // Sliced file mismatch during user's reserved slot!
      const mismatchSent = await getStoredState(env, 'mismatchAlertSent', false);
      if (!mismatchSent || mismatchSent === 'false') {
        if (!dryRun) {
          await sendBambuCommand(connect, mqttConfig, 'pause');
        }

        await sendGuardAlert({
          recipients,
          subject: `⚠️ [ACTION TAKEN] File Mismatch: Printer Paused for "${activeBooking.userName || activeBooking.userEmail}"`,
          title: 'Print Paused: Sliced File Mismatch Detected',
          severity: 'warning',
          message: `A print was started during a reservation for "${activeBooking.userEmail}", but the physical file name does not match the booking:\n\n• Booked File: "${activeBooking.fileName}" (Normalized: "${matchResult.normalizedBooked}")\n• Physical File: "${currentFile}" (Normalized: "${matchResult.normalizedActual}")\n• Similarity Match: ${Math.round(matchResult.score * 100)}% (Minimum required: ${Math.round(similarityThreshold * 100)}%)\n\n${dryRun ? '⚠️ [DRY RUN] A real PAUSE command WOULD have been issued.' : 'The printer toolhead has been safely PAUSED without canceling to allow inspection.'}`,
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

        await setStoredState(env, 'mismatchAlertSent', 'true');
      }

      return {
        status: 'mismatch_paused',
        dryRun,
        bookedFileName: activeBooking.fileName,
        actualFileName: currentFile,
        similarity: matchResult.score
      };
    }

    // Authorized Print Match! Clear rogue timers and auto-start booking on portal if not yet in_progress
    await deleteStoredState(env, 'unscheduledFirstSeenAt');
    await deleteStoredState(env, 'stoppedRogueAlertSent');

    let autoStarted = false;
    if (activeBooking.status !== 'in_progress') {
      autoStarted = await updateBookingStatusInCloud(settingsUrl, activeBooking.id, 'in_progress');
    }

    return {
      status: 'authorized_print',
      matched: true,
      autoStarted,
      similarity: matchResult.score,
      bookedFileName: activeBooking.fileName,
      actualFileName: currentFile,
      userEmail: activeBooking.userEmail
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
  for (const b of upcomingBookings) {
    const res = compareFileNames(currentFile, b.fileName, similarityThreshold);
    if (res.isMatch) {
      earlyMatch = b;
      earlyMatchResult = res;
      break;
    }
  }

  if (earlyMatch) {
    // Student arrived early for their upcoming reservation! DO NOT CANCEL!
    await deleteStoredState(env, 'unscheduledFirstSeenAt');
    await deleteStoredState(env, 'stoppedRogueAlertSent');

    let autoStarted = false;
    if (earlyMatch.status !== 'in_progress') {
      autoStarted = await updateBookingStatusInCloud(settingsUrl, earlyMatch.id, 'in_progress');

      // Send informational push alert notifying that early print has authorized start
      await sendGuardAlert({
        recipients,
        subject: `ℹ️ [EARLY START] Print Started Early: "${currentFile}"`,
        title: 'Early Arrival Authorized: Print Started',
        severity: 'info',
        message: `Student "${earlyMatch.userName}" (${earlyMatch.userEmail}) arrived up to 30 minutes early for their scheduled slot (${new Date(earlyMatch.startTime).toLocaleTimeString()}).\n\nFile "${currentFile}" matched reservation "${earlyMatch.fileName}" (${Math.round(earlyMatchResult.score * 100)}% match).\n\nBooking status has been automatically updated to IN PROGRESS on the queue portal.`,
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
      autoStarted,
      bookingId: earlyMatch.id,
      userEmail: earlyMatch.userEmail,
      bookedFileName: earlyMatch.fileName,
      actualFileName: currentFile,
      scheduledStart: earlyMatch.startTime,
      similarity: earlyMatchResult.score,
      message: 'Early start authorized. Auto-transitioned booking to in_progress.'
    };
  }

  // ==================== CASE C: UNSCHEDULED / ROGUE PRINT (2-MIN GRACE PERIOD) ====================
  let firstSeenStr = await getStoredState(env, 'unscheduledFirstSeenAt', null);
  let firstSeen = firstSeenStr ? Number(firstSeenStr) : null;
  if (!firstSeen) {
    firstSeen = Date.now();
    await setStoredState(env, 'unscheduledFirstSeenAt', firstSeen);
  }

  const elapsedMs = Date.now() - firstSeen;
  const graceMs = graceMinutes * 60 * 1000;
  const graceRemainingSec = Math.max(0, Math.round((graceMs - elapsedMs) / 1000));

  if (elapsedMs < graceMs) {
    return {
      status: 'grace_period',
      printerState: state,
      currentFile,
      elapsedSeconds: Math.round(elapsedMs / 1000),
      graceRemainingSec,
      message: `Unscheduled print detected. Waiting ${graceMinutes}-min grace period (${graceRemainingSec}s remaining).`
    };
  }

  // Grace period expired! Issue STOP command & alert
  const stoppedSent = await getStoredState(env, 'stoppedRogueAlertSent', false);
  if (!stoppedSent || stoppedSent === 'false') {
    if (!dryRun) {
      await sendBambuCommand(connect, mqttConfig, 'stop');
    }

    await sendGuardAlert({
      recipients,
      subject: `🚨 [ACTION TAKEN] Unscheduled Print Canceled: "${currentFile}"`,
      title: 'Unscheduled Print Canceled (Grace Period Expired)',
      severity: 'critical',
      message: `A print was started on the Bambu Lab X1-Carbon without an active or upcoming reservation on the portal.\n\nThe system waited the full ${graceMinutes}-minute grace period for a reservation to be created, but none was found.\n\n${dryRun ? '⚠️ [DRY RUN] A real STOP command WOULD have been issued.' : 'The print was automatically CANCELED (stopped) to protect lab resources.'}`,
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

    await setStoredState(env, 'stoppedRogueAlertSent', 'true');
  }

  return {
    status: 'rogue_stopped',
    dryRun,
    currentFile,
    elapsedMinutes: Math.round(elapsedMs / 60000)
  };
}

export default {
  // 1. Cloudflare Scheduled Cron Handler (Runs every 1 minute)
  async scheduled(event, env, ctx) {
    try {
      const result = await evaluateGuardCycle(env);
      console.log('[Bambu Guard Cron]', JSON.stringify(result));
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

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
};
