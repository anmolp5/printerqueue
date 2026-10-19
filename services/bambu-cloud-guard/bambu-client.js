/**
 * Bambu Lab Cloud MQTT Client for Cloudflare Workers & Node.js
 *
 * Connects securely to us.mqtt.bambulab.com:8883 over TLS
 * to query telemetry and dispatch stop/pause enforcement commands.
 */

// MQTT Packet Helpers
function encodeString(str) {
  const enc = new TextEncoder().encode(str);
  const buf = new Uint8Array(2 + enc.length);
  buf[0] = (enc.length >> 8) & 0xff;
  buf[1] = enc.length & 0xff;
  buf.set(enc, 2);
  return buf;
}

function encodeVariableLength(len) {
  const bytes = [];
  do {
    let encodedByte = len % 128;
    len = Math.floor(len / 128);
    if (len > 0) {
      encodedByte |= 128;
    }
    bytes.push(encodedByte);
  } while (len > 0);
  return bytes;
}

function createConnectPacket(clientId, user, pass) {
  let flags = 0x02; // Clean session
  if (user) flags |= 0x80;
  if (pass) flags |= 0x40;

  const protoName = encodeString('MQTT');
  const clientPayload = encodeString(clientId);
  const userPayload = user ? encodeString(user) : new Uint8Array(0);
  const passPayload = pass ? encodeString(pass) : new Uint8Array(0);

  const varHeader = [
    ...protoName,
    0x04, // MQTT 3.1.1
    flags,
    0x00, 0x3c // Keepalive 60s
  ];

  const payload = [
    ...clientPayload,
    ...userPayload,
    ...passPayload
  ];

  const remBytes = encodeVariableLength(varHeader.length + payload.length);
  return new Uint8Array([0x10, ...remBytes, ...varHeader, ...payload]);
}

function createSubscribePacket(packetId, topic, qos = 0) {
  const topicEnc = encodeString(topic);
  const varHeader = [(packetId >> 8) & 0xff, packetId & 0xff];
  const payload = [...topicEnc, qos];
  const remBytes = encodeVariableLength(varHeader.length + payload.length);
  return new Uint8Array([0x82, ...remBytes, ...varHeader, ...payload]);
}

export function createPublishPacket(topic, payloadStr) {
  const topicEnc = encodeString(topic);
  const payloadEnc = new TextEncoder().encode(payloadStr);
  const remBytes = encodeVariableLength(topicEnc.length + payloadEnc.length);
  return new Uint8Array([0x30, ...remBytes, ...topicEnc, ...payloadEnc]);
}

/**
 * Extracts and parses the {"print": {...}} JSON payload from a stream of MQTT chunks
 */
function extractPrintStatusFromStream(text) {
  const printIdx = text.lastIndexOf('"print":');
  if (printIdx === -1) return null;
  const startIdx = text.lastIndexOf('{', printIdx);
  if (startIdx === -1) return null;

  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        const jsonStr = text.substring(startIdx, i + 1);
        try {
          return JSON.parse(jsonStr);
        } catch (e) {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Connects to Bambu Cloud MQTT and queries printer status (pushall)
 */
export async function queryBambuPrinterStatus(connectFn, config) {
  const {
    host = 'us.mqtt.bambulab.com',
    port = 8883,
    uid = '3886511802',
    token,
    serialNumber = '00M09C432301761',
    timeoutMs = 15000
  } = config;

  const username = `u_${uid}`;
  const clientId = `bambu_guard_${Math.random().toString(16).slice(2, 8)}`;

  const socket = connectFn({ hostname: host, port }, { secureTransport: 'on' });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Timeout (${timeoutMs}ms) waiting for printer telemetry`));
    }, timeoutMs);
  });

  try {
    const runQuery = async () => {
      // 1. Send CONNECT
      const connPacket = createConnectPacket(clientId, username, token);
      await writer.write(connPacket);

      // 2. Read CONNACK
      const { value: connack, done: connDone } = await reader.read();
      if (connDone || !connack || connack.length < 4 || connack[0] !== 0x20 || connack[3] !== 0x00) {
        throw new Error('MQTT Connection refused by Bambu Cloud broker');
      }

      // 3. Subscribe to report topic
      const reportTopic = `device/${serialNumber}/report`;
      const subPacket = createSubscribePacket(1, reportTopic, 0);
      await writer.write(subPacket);

      // 4. Publish pushall request
      const reqTopic = `device/${serialNumber}/request`;
      const reqPayload = JSON.stringify({
        pushing: {
          sequence_id: '0',
          command: 'pushall',
          version: 1,
          push_target: 1
        }
      });
      const pubPacket = createPublishPacket(reqTopic, reqPayload);
      await writer.write(pubPacket);

      // 5. Read incoming packets until push_status report is received
      let accumulatedText = '';
      while (true) {
        const { value: chunk, done } = await reader.read();
        if (done) break;
        if (chunk) {
          const chunkText = new TextDecoder('utf-8', { fatal: false }).decode(chunk);
          accumulatedText += chunkText;

          const parsed = extractPrintStatusFromStream(accumulatedText);
          if (parsed && parsed.print) {
            clearTimeout(timeoutHandle);
            const lights = parsed.print.lights_report || [];
            const chamberLightObj = lights.find((l) => l.node === 'chamber_light');
            const hms = parsed.print.hms || [];
            const printError = parsed.print.print_error ?? 0;
            const failReason = parsed.print.fail_reason ?? '';
            const errorInfo = decodeBambuError(parsed.print);
            return {
              gcode_state: parsed.print.gcode_state || 'IDLE',
              subtask_name: parsed.print.subtask_name || '',
              gcode_file: parsed.print.gcode_file || '',
              mc_percent: parsed.print.mc_percent ?? 0,
              mc_remaining_time: parsed.print.mc_remaining_time ?? 0,
              nozzle_temper: parsed.print.nozzle_temper ?? 0,
              bed_temper: parsed.print.bed_temper ?? 0,
              lights_report: lights,
              chamber_light: chamberLightObj ? chamberLightObj.mode : 'off',
              hms,
              print_error: printError,
              fail_reason: failReason,
              errorInfo,
              raw: parsed.print
            };
          }
        }
      }
      throw new Error('Stream ended without receiving printer status');
    };

    return await Promise.race([runQuery(), timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
    try { await writer.close(); } catch(e){}
    try { await reader.cancel(); } catch(e){}
    try { await socket.close(); } catch(e){}
  }
}

/**
 * Sends a command to the Bambu printer (e.g. "stop" or "pause")
 */
export async function sendBambuCommand(connectFn, config, command) {
  const {
    host = 'us.mqtt.bambulab.com',
    port = 8883,
    uid = '3886511802',
    token,
    serialNumber = '00M09C432301761'
  } = config;

  const username = `u_${uid}`;
  const clientId = `bambu_cmd_${Math.random().toString(16).slice(2, 8)}`;

  const socket = connectFn({ hostname: host, port }, { secureTransport: 'on' });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  try {
    // 1. Send CONNECT
    const connPacket = createConnectPacket(clientId, username, token);
    await writer.write(connPacket);

    // 2. Read CONNACK
    const { value: connack, done: connDone } = await reader.read();
    if (connDone || !connack || connack.length < 4 || connack[0] !== 0x20 || connack[3] !== 0x00) {
      throw new Error('MQTT Connection refused');
    }

    // 3. Publish command
    const reqTopic = `device/${serialNumber}/request`;
    const payload = JSON.stringify({
      print: {
        command: command, // "stop", "pause", "resume"
        sequence_id: '0'
      }
    });
    const pubPacket = createPublishPacket(reqTopic, payload);
    await writer.write(pubPacket);

    return { success: true, command, serialNumber };
  } finally {
    try { await writer.close(); } catch(e){}
    try { await reader.cancel(); } catch(e){}
    try { await socket.close(); } catch(e){}
  }
}

/**
 * Sends a chamber light command to the Bambu printer ("on" or "off")
 */
export async function sendBambuLightCommand(connectFn, config, mode = 'off') {
  const {
    host = 'us.mqtt.bambulab.com',
    port = 8883,
    uid = '3886511802',
    token,
    serialNumber = '01P00C611402117'
  } = config;

  const username = `u_${uid}`;
  const clientId = `bambu_light_${Math.random().toString(16).slice(2, 8)}`;

  const socket = connectFn({ hostname: host, port }, { secureTransport: 'on' });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  try {
    // 1. Send CONNECT
    const connPacket = createConnectPacket(clientId, username, token);
    await writer.write(connPacket);

    // 2. Read CONNACK
    const { value: connack, done: connDone } = await reader.read();
    if (connDone || !connack || connack.length < 4 || connack[0] !== 0x20 || connack[3] !== 0x00) {
      throw new Error('MQTT Connection refused');
    }

    // 3. Publish light command
    const reqTopic = `device/${serialNumber}/request`;
    const payload = JSON.stringify({
      system: {
        sequence_id: '0',
        command: 'ledctrl',
        led_node: 'chamber_light',
        led_mode: mode,
        led_on_time: 500,
        led_off_time: 500,
        loop_times: 0,
        interval_time: 0
      }
    });
    const pubPacket = createPublishPacket(reqTopic, payload);
    await writer.write(pubPacket);

    return { success: true, mode, serialNumber };
  } finally {
    try { await writer.close(); } catch(e){}
    try { await reader.cancel(); } catch(e){}
    try { await socket.close(); } catch(e){}
  }
}

/**
 * Decodes Bambu Lab HMS (Health Management System) error codes and error states.
 * Formats codes into standardized hex strings and classifies failure modes:
 * AI Spaghetti, First-layer defect, Filament runout, Nozzle clumping, etc.
 */
export function decodeBambuError(printObj = {}) {
  const hms = Array.isArray(printObj.hms) ? printObj.hms : [];
  const printError = Number(printObj.print_error ?? 0);
  const failReason = String(printObj.fail_reason ?? '');
  const state = (printObj.gcode_state || '').toUpperCase();

  const formattedCodes = [];
  let isSpaghetti = false;
  let isFirstLayer = false;
  let isFilamentIssue = false;
  let isNozzleIssue = false;
  let isBuildPlateIssue = false;
  let isCoverDetached = false;

  for (const item of hms) {
    if (item && (item.attr !== undefined || item.code !== undefined)) {
      const attrHex = ((item.attr >>> 0) || 0).toString(16).padStart(8, '0').toUpperCase();
      const codeHex = ((item.code >>> 0) || 0).toString(16).padStart(8, '0').toUpperCase();
      const fullHex = `${attrHex.slice(0, 4)}_${attrHex.slice(4)}_${codeHex.slice(0, 4)}_${codeHex.slice(4)}`;
      formattedCodes.push(fullHex);

      // AI Spaghetti detection code patterns
      if (fullHex.includes('0001_0007') || attrHex.startsWith('03008011') || fullHex.includes('SPAGHETTI')) {
        isSpaghetti = true;
      }
      // Micro-LiDAR / First layer defect
      else if (fullHex.includes('0001_0004') || fullHex.includes('0001_0005') || fullHex.includes('0001_0008')) {
        isFirstLayer = true;
      }
      // Build plate position / marker missing
      else if (fullHex.includes('0001_0001') || fullHex.includes('0001_0002')) {
        isBuildPlateIssue = true;
      }
      // Nozzle clumping
      else if (fullHex.includes('0001_0009')) {
        isNozzleIssue = true;
      }
      // Filament runout / AMS jam
      else if (attrHex.startsWith('03008001') || attrHex.startsWith('07008003') || attrHex.startsWith('07008004') || attrHex.startsWith('07008006')) {
        isFilamentIssue = true;
      }
      // Toolhead front cover detached
      else if (attrHex.startsWith('03008007') || attrHex.startsWith('05008007')) {
        isCoverDetached = true;
      }
    } else if (typeof item === 'string') {
      formattedCodes.push(item);
      if (item.toLowerCase().includes('spaghetti')) isSpaghetti = true;
      if (item.toLowerCase().includes('filament')) isFilamentIssue = true;
    }
  }

  // Also check fail_reason string
  const failLower = failReason.toLowerCase();
  if (failLower.includes('spaghetti')) isSpaghetti = true;
  if (failLower.includes('filament') || failLower.includes('runout') || failLower.includes('ams')) isFilamentIssue = true;
  if (failLower.includes('first layer') || failLower.includes('lidar')) isFirstLayer = true;

  // Determine category and human-readable reason
  let category = 'normal';
  let reason = '';

  if (isSpaghetti) {
    category = 'ai_spaghetti';
    reason = 'AI Spaghetti Detection (Possible Print Detachment)';
  } else if (isFirstLayer) {
    category = 'first_layer_defect';
    reason = 'First-Layer Inspection Defect (Micro-LiDAR Anomaly)';
  } else if (isFilamentIssue) {
    category = 'filament_runout';
    reason = 'Filament Runout or AMS Feed Failure';
  } else if (isNozzleIssue) {
    category = 'nozzle_clumping';
    reason = 'Nozzle Clumping Detected';
  } else if (isBuildPlateIssue) {
    category = 'build_plate_missing';
    reason = 'Build Plate Localization Marker Missing or Misaligned';
  } else if (isCoverDetached) {
    category = 'toolhead_cover_detached';
    reason = 'Toolhead Front Cover Detached';
  } else if (formattedCodes.length > 0) {
    category = 'hms_warning';
    reason = `Printer Warning (${formattedCodes[0]})`;
  } else if (printError !== 0) {
    category = 'hardware_error';
    reason = `Hardware Error Code #${printError}`;
  } else if (state === 'PAUSE') {
    category = 'user_paused';
    reason = 'Print Paused (Waiting for User Intervention)';
  } else if (state === 'FAILED') {
    category = 'print_failed';
    reason = 'Print Job Aborted or Failed';
  }

  return {
    isPaused: state === 'PAUSE',
    isFailed: state === 'FAILED',
    hasError: category !== 'normal' && category !== 'user_paused',
    category,
    reason,
    formattedCodes,
    printError,
    failReason
  };
}


