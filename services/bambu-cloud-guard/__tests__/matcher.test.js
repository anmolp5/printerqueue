import { normalizeFileName, compareFileNames } from '../matcher.js';

console.log('====================================================');
console.log('🧪 RUNNING BAMBU CLOUD GUARD MATCHER TEST SUITE');
console.log('====================================================\n');

const testCases = [
  // 1. Current real-world print running on the UIUC X1-Carbon right now!
  {
    actual: 'Allison.Ayesha_v3_v4.gcode.3mf',
    booked: 'allison_ayesha.3mf',
    expectedMatch: true,
    description: 'Current UIUC live print: Allison.Ayesha with chained extensions and v3_v4 tags',
  },
  {
    actual: 'Allison.Ayesha_v3_v4.gcode.3mf',
    booked: 'Allison Ayesha Final',
    expectedMatch: true,
    description: 'Live print compared with booking containing spaces and Final suffix',
  },
  // 2. Standard slicer suffix variants (Plate, nozzle, material)
  {
    actual: 'quadcopter_frame_0.4nozzle_PLA_Plate_1.gcode',
    booked: 'quadcopter_frame.3mf',
    expectedMatch: true,
    description: 'Slicer tags stripped (0.4nozzle, PLA, Plate 1)',
  },
  {
    actual: 'robot_arm_gripper_v2_PETG.gcode',
    booked: 'robot_arm_gripper_v1.3mf',
    expectedMatch: true,
    description: 'Version bump from v1 to v2 with material tag',
  },
  {
    actual: 'iPhone_15_stand_fixed_0.4nozzle.gcode.3mf',
    booked: 'iPhone 15 Stand',
    expectedMatch: true,
    description: 'Case differences, fixed tag, and double extension',
  },
  {
    actual: 'planetary_gearbox_core.3mf',
    booked: 'planetary_gearbox_core_plate_2.gcode',
    expectedMatch: true,
    description: 'Multi-plate print match',
  },
  // 3. Clear Mismatches (Should FAIL < 65% and trigger PAUSE)
  {
    actual: 'Allison.Ayesha_v3_v4.gcode.3mf',
    booked: 'minecraft_diamond_sword.3mf',
    expectedMatch: false,
    description: 'Totally different model (Allison.Ayesha vs Minecraft Sword) -> MUST PAUSE',
  },
  {
    actual: 'drone_motor_mount.3mf',
    booked: 'chess_pawn_set.gcode',
    expectedMatch: false,
    description: 'Drone mount vs Chess pawn -> MUST PAUSE',
  },
  {
    actual: 'sensor_housing_bracket.3mf',
    booked: 'cosplay_helmet_horn.3mf',
    expectedMatch: false,
    description: 'Lab engineering sensor vs Cosplay helmet -> MUST PAUSE',
  },
];

let passed = 0;
let failed = 0;

for (let i = 0; i < testCases.length; i++) {
  const tc = testCases[i];
  const res = compareFileNames(tc.actual, tc.booked, 0.65);
  const ok = res.isMatch === tc.expectedMatch;

  if (ok) {
    passed++;
    console.log(`✅ TEST ${i + 1} PASSED: ${tc.description}`);
    console.log(`   Actual: "${tc.actual}" -> Norm: "${res.normalizedActual}"`);
    console.log(`   Booked: "${tc.booked}" -> Norm: "${res.normalizedBooked}"`);
    console.log(`   Score: ${Math.round(res.score * 100)}% | Match: ${res.isMatch} (${res.details})\n`);
  } else {
    failed++;
    console.error(`❌ TEST ${i + 1} FAILED: ${tc.description}`);
    console.error(`   Actual: "${tc.actual}" -> Norm: "${res.normalizedActual}"`);
    console.error(`   Booked: "${tc.booked}" -> Norm: "${res.normalizedBooked}"`);
    console.error(`   Expected isMatch: ${tc.expectedMatch}, Got: ${res.isMatch} (Score: ${res.score})\n`);
  }
}

console.log('====================================================');
console.log(`📊 RESULTS: ${passed} passed, ${failed} failed (${testCases.length} total)`);
console.log('====================================================');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('🎉 ALL MATCHER TESTS PASSED 100% ACCURATELY!\n');
}
