/**
 * Bambu Cloud Guard - Slicer Normalizer & Fuzzy Matcher Engine
 *
 * Normalizes physical print job filenames and compares them against portal bookings
 * using a combination of Levenshtein string distance and token-overlap analysis.
 */

/**
 * Normalizes a 3D print file name by stripping extensions, slicer tags,
 * material identifiers, nozzle tags, plates, and version tags.
 *
 * Example: "Allison.Ayesha_v3_v4.gcode.3mf" -> "allison ayesha"
 * Example: "drone_motor_mount_0.4nozzle_PLA_Plate_1.gcode" -> "drone motor mount"
 */
export function normalizeFileName(rawName) {
  if (!rawName || typeof rawName !== 'string') return '';

  let name = rawName.trim().toLowerCase();

  // 1. Strip directory paths if present (e.g. /data/Metadata/plate_1.gcode)
  if (name.includes('/')) {
    name = name.split('/').pop();
  }
  if (name.includes('\\')) {
    name = name.split('\\').pop();
  }

  // 2. Strip multi-extensions (e.g., .gcode.3mf, .3mf, .gcode, .stl, .step, .obj)
  name = name.replace(/\.(gcode|3mf|stl|step|stp|obj)/gi, '');
  name = name.replace(/\.(gcode|3mf|stl|step|stp|obj)/gi, ''); // repeat for chained extensions

  // 3. Normalize common separators to single space
  name = name.replace(/[_\.\+\-]+/g, ' ');

  // 4. Strip slicer tags: nozzle diameters
  name = name.replace(/\b(0\s*4|0\s*2|0\s*6|0\s*8)\s*(mm)?\s*nozzle\b/gi, ' ');
  name = name.replace(/\b0\s*[2468]\s*nozzle\b/gi, ' ');

  // 5. Strip material tags (PLA, PETG, ABS, ASA, TPU, PAHT-CF, PC, etc.)
  name = name.replace(/\b(pla\s*matte|pla\s*basic|pla\s*silk|pla\s*s|pla|petg|abs|asa|tpu|paht\s*cf|pc|nylon|tough|support)\b/gi, ' ');

  // 6. Strip plate indicators (e.g. plate 1, plate 2, plate_1)
  name = name.replace(/\bplate\s*[0-9]+\b/gi, ' ');
  name = name.replace(/\(plate\s*[0-9]+\)/gi, ' ');

  // 7. Strip version / suffix indicators (v1, v2, v3, v4, final, fixed, test, copy)
  name = name.replace(/\bv[0-9]+\b/gi, ' ');
  name = name.replace(/\b(final|fixed|copy|new|reprint|edit)\b/gi, ' ');

  // 8. Collapse whitespace and trim
  name = name.replace(/[^a-z0-9\s]/g, ' ');
  name = name.replace(/\s+/g, ' ').trim();

  return name;
}

/**
 * Computes the Levenshtein distance between two strings
 */
export function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const row = new Array(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;

  for (let i = 1; i <= m; i++) {
    let prev = i;
    for (let j = 1; j <= n; j++) {
      let val;
      if (a[i - 1] === b[j - 1]) {
        val = row[j - 1];
      } else {
        val = Math.min(row[j - 1] + 1, prev + 1, row[j] + 1);
      }
      row[j - 1] = prev;
      prev = val;
    }
    row[n] = prev;
  }
  return row[n];
}

/**
 * Calculates string similarity between 0.0 and 1.0 using Levenshtein distance
 */
export function stringSimilarity(a, b) {
  if (a === b) return 1.0;
  if (!a || !b) return 0.0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshteinDistance(a, b);
  return (maxLen - dist) / maxLen;
}

/**
 * Calculates token-based Jaccard similarity (word overlap)
 */
export function tokenSimilarity(a, b) {
  const tokensA = new Set(a.split(' ').filter(Boolean));
  const tokensB = new Set(b.split(' ').filter(Boolean));
  if (tokensA.size === 0 && tokensB.size === 0) return 1.0;
  if (tokensA.size === 0 || tokensB.size === 0) return 0.0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union > 0 ? intersection / union : 0.0;
}

/**
 * Compares actual printer file name with reservation file name
 * Returns: { isMatch: boolean, score: number, normalizedActual: string, normalizedBooked: string }
 */
export function compareFileNames(actualFileName, bookedFileName, threshold = 0.65) {
  const normActual = normalizeFileName(actualFileName);
  const normBooked = normalizeFileName(bookedFileName);

  // Exact match after normalization
  if (normActual.length > 0 && normActual === normBooked) {
    return {
      isMatch: true,
      score: 1.0,
      normalizedActual: normActual,
      normalizedBooked: normBooked,
      details: 'Exact match after slicer normalization',
    };
  }

  // If one contains the other as a full substring (e.g. "quadcopter" vs "quadcopter frame")
  if (normActual.length >= 4 && normBooked.length >= 4) {
    if (normActual.includes(normBooked) || normBooked.includes(normActual)) {
      const minLen = Math.min(normActual.length, normBooked.length);
      const maxLen = Math.max(normActual.length, normBooked.length);
      const subScore = Math.max(0.75, minLen / maxLen);
      if (subScore >= threshold) {
        return {
          isMatch: true,
          score: subScore,
          normalizedActual: normActual,
          normalizedBooked: normBooked,
          details: 'Substring match',
        };
      }
    }
  }

  // Combined score: 60% Levenshtein ratio + 40% Token overlap
  const levScore = stringSimilarity(normActual, normBooked);
  const tokScore = tokenSimilarity(normActual, normBooked);
  const score = Number((0.6 * levScore + 0.4 * tokScore).toFixed(3));

  return {
    isMatch: score >= threshold,
    score: score,
    normalizedActual: normActual,
    normalizedBooked: normBooked,
    details: `${Math.round(score * 100)}% similarity (threshold: ${Math.round(threshold * 100)}%)`,
  };
}
