import assert from 'node:assert';
import { createPublishPacket, sendBambuLightCommand } from '../bambu-client.js';

console.log('====================================================');
console.log('🧪 RUNNING P1S CHAMBER LIGHT CONTROL UNIT TESTS');
console.log('====================================================\n');

// Helper to decode an MQTT PUBLISH packet created by createPublishPacket
function parsePublishPacket(packet) {
  assert.strictEqual(packet[0], 0x30, 'Packet header must be 0x30 (MQTT PUBLISH)');

  // Decode variable length remaining length
  let multiplier = 1;
  let remLen = 0;
  let offset = 1;
  while (offset < packet.length) {
    const byte = packet[offset++];
    remLen += (byte & 0x7f) * multiplier;
    multiplier *= 128;
    if ((byte & 0x80) === 0) break;
  }

  // Topic length (2 bytes MSB/LSB)
  const topicLen = (packet[offset] << 8) | packet[offset + 1];
  offset += 2;

  // Topic
  const topicBytes = packet.subarray(offset, offset + topicLen);
  const topic = new TextDecoder().decode(topicBytes);
  offset += topicLen;

  // Payload
  const payloadBytes = packet.subarray(offset);
  const payloadStr = new TextDecoder().decode(payloadBytes);
  const payload = JSON.parse(payloadStr);

  return { topic, payload, remLen };
}

// ---------------------------------------------------------
// Test 1: Direct createPublishPacket ledctrl structure
// ---------------------------------------------------------
console.log('Test 1: Verifying createPublishPacket with ledctrl payload structure...');

const testSerial = '01P00C611402117';
const testTopic = `device/${testSerial}/request`;
const testPayloadObj = {
  system: {
    sequence_id: '0',
    command: 'ledctrl',
    led_node: 'chamber_light',
    led_mode: 'off',
    led_on_time: 500,
    led_off_time: 500,
    loop_times: 0,
    interval_time: 0,
  },
};
const testPayloadStr = JSON.stringify(testPayloadObj);

const packet = createPublishPacket(testTopic, testPayloadStr);
assert(packet instanceof Uint8Array, 'Packet must be a Uint8Array');

const parsed = parsePublishPacket(packet);
assert.strictEqual(parsed.topic, `device/${testSerial}/request`, 'Topic must match device serial request topic');
assert.strictEqual(parsed.payload.system.command, 'ledctrl', 'Command must be ledctrl');
assert.strictEqual(parsed.payload.system.led_node, 'chamber_light', 'led_node must be chamber_light');
assert.strictEqual(parsed.payload.system.led_mode, 'off', 'led_mode must be off');
assert.strictEqual(parsed.payload.system.sequence_id, '0', 'sequence_id must be 0');
assert.strictEqual(parsed.payload.system.led_on_time, 500, 'led_on_time must be 500');
assert.strictEqual(parsed.payload.system.led_off_time, 500, 'led_off_time must be 500');
assert.strictEqual(parsed.payload.system.loop_times, 0, 'loop_times must be 0');
assert.strictEqual(parsed.payload.system.interval_time, 0, 'interval_time must be 0');

console.log('  ✅ createPublishPacket produces valid MQTT PUBLISH packet with correct ledctrl schema.\n');

// ---------------------------------------------------------
// Test 2: sendBambuLightCommand with mock TLS socket (mode: 'off')
// ---------------------------------------------------------
console.log('Test 2: Verifying sendBambuLightCommand (mode: "off")...');

function createMockSocket() {
  const writtenPackets = [];
  let closed = false;

  return {
    socket: {
      writable: {
        getWriter: () => ({
          write: async (data) => {
            writtenPackets.push(data);
          },
          close: async () => {
            closed = true;
          },
        }),
      },
      readable: {
        getReader: () => ({
          read: async () => {
            // Return CONNACK: 0x20, 0x02, 0x00, 0x00 (connection accepted)
            return {
              value: new Uint8Array([0x20, 0x02, 0x00, 0x00]),
              done: false,
            };
          },
          cancel: async () => {},
        }),
      },
      close: async () => {
        closed = true;
      },
    },
    writtenPackets,
    isClosed: () => closed,
  };
}

let mock = createMockSocket();
let mockConnectFn = (target, opts) => {
  assert.strictEqual(target.hostname, 'us.mqtt.bambulab.com');
  assert.strictEqual(target.port, 8883);
  assert.strictEqual(opts.secureTransport, 'on');
  return mock.socket;
};

const config = {
  host: 'us.mqtt.bambulab.com',
  port: 8883,
  uid: '3886511802',
  token: 'mock-token-xyz',
  serialNumber: '01P00C611402117',
};

(async () => {
  const resOff = await sendBambuLightCommand(mockConnectFn, config, 'off');
  assert.deepStrictEqual(resOff, {
    success: true,
    mode: 'off',
    serialNumber: '01P00C611402117',
  });

  // Verify written packets: [0] CONNECT, [1] PUBLISH
  assert.strictEqual(mock.writtenPackets.length, 2, 'Should write CONNECT and PUBLISH packets');
  assert.strictEqual(mock.writtenPackets[0][0], 0x10, 'Packet 0 must be MQTT CONNECT');

  const pubParsedOff = parsePublishPacket(mock.writtenPackets[1]);
  assert.strictEqual(pubParsedOff.topic, 'device/01P00C611402117/request');
  assert.strictEqual(pubParsedOff.payload.system.command, 'ledctrl');
  assert.strictEqual(pubParsedOff.payload.system.led_node, 'chamber_light');
  assert.strictEqual(pubParsedOff.payload.system.led_mode, 'off');

  console.log('  ✅ sendBambuLightCommand correctly sent led_mode: "off" packet.\n');

  // ---------------------------------------------------------
  // Test 3: sendBambuLightCommand (mode: 'on')
  // ---------------------------------------------------------
  console.log('Test 3: Verifying sendBambuLightCommand (mode: "on")...');
  mock = createMockSocket();
  const resOn = await sendBambuLightCommand(mockConnectFn, config, 'on');
  assert.deepStrictEqual(resOn, {
    success: true,
    mode: 'on',
    serialNumber: '01P00C611402117',
  });

  assert.strictEqual(mock.writtenPackets.length, 2);
  const pubParsedOn = parsePublishPacket(mock.writtenPackets[1]);
  assert.strictEqual(pubParsedOn.topic, 'device/01P00C611402117/request');
  assert.strictEqual(pubParsedOn.payload.system.command, 'ledctrl');
  assert.strictEqual(pubParsedOn.payload.system.led_node, 'chamber_light');
  assert.strictEqual(pubParsedOn.payload.system.led_mode, 'on');

  console.log('  ✅ sendBambuLightCommand correctly sent led_mode: "on" packet.\n');

  console.log('🎉 ALL P1S LIGHT CONTROL TESTS PASSED SUCCESSFULLY!\n');
})().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
