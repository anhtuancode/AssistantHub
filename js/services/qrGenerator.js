/**
 * Pure JS Offline QR Code Generator (ISO/IEC 18004, Byte mode, Versions 1–10, EC Level L)
 * Zero external dependencies, 100% CSP Manifest V3 compatible.
 */

// GF(256) log/antilog tables with primitive polynomial 0x11D
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    EXP[i] = EXP[i - 255];
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function rsGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const factor = EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecCount) {
  const gen = rsGeneratorPoly(ecCount);
  const res = new Uint8Array(data.length + ecCount);
  res.set(data, 0);
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        res[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return res.slice(data.length);
}

// Version specs for EC Level L: [totalDataCodewords, ecPerBlock, [group1Blocks, group1Data, group2Blocks, group2Data], alignmentPositions]
const VERSION_SPECS_L = {
  1:  [19,  7,  [1, 19, 0, 0],  []],
  2:  [34,  10, [1, 34, 0, 0],  [6, 18]],
  3:  [55,  15, [1, 55, 0, 0],  [6, 22]],
  4:  [80,  20, [1, 80, 0, 0],  [6, 26]],
  5:  [108, 26, [1, 108, 0, 0], [6, 30]],
  6:  [136, 18, [2, 68, 0, 0],  [6, 34]],
  7:  [156, 20, [2, 78, 0, 0],  [6, 22, 38]],
  8:  [194, 24, [2, 97, 0, 0],  [6, 24, 42]],
  9:  [232, 30, [2, 116, 0, 0], [6, 26, 46]],
  10: [274, 18, [2, 68, 2, 69], [6, 28, 50]]
};

function getUtf8Bytes(text) {
  if (typeof TextEncoder !== 'undefined') {
    return Array.from(new TextEncoder().encode(text));
  }
  const bytes = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return bytes;
}

function chooseVersion(byteLen) {
  for (let v = 1; v <= 10; v++) {
    const totalData = VERSION_SPECS_L[v][0];
    const ccBits = v < 10 ? 8 : 16;
    const overheadBits = 4 + ccBits;
    const maxBytes = Math.floor((totalData * 8 - overheadBits) / 8);
    if (byteLen <= maxBytes) return v;
  }
  throw new Error('URL quá dài cho mã QR (tối đa 271 bytes).');
}

function buildCodewords(bytes, version) {
  const [totalData, ecPerBlock, [g1Blocks, g1Data, g2Blocks, g2Data]] = VERSION_SPECS_L[version];
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >> i) & 1);
    }
  };

  // Mode: Byte (0100)
  pushBits(0b0100, 4);
  pushBits(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) pushBits(b, 8);

  // Terminator (up to 4 zeros)
  const maxBits = totalData * 8;
  const termLen = Math.min(4, maxBits - bits.length);
  pushBits(0, termLen);

  // Pad to byte boundary
  while (bits.length % 8 !== 0) bits.push(0);

  // Pad codewords 0xEC, 0x11
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (bits.length < maxBits) {
    pushBits(padBytes[padIdx % 2], 8);
    padIdx++;
  }

  const dataBytes = new Uint8Array(totalData);
  for (let i = 0; i < totalData; i++) {
    let val = 0;
    for (let b = 0; b < 8; b++) {
      val = (val << 1) | bits[i * 8 + b];
    }
    dataBytes[i] = val;
  }

  // Split into blocks and compute RS EC
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (let i = 0; i < g1Blocks; i++) {
    const blk = dataBytes.slice(offset, offset + g1Data);
    offset += g1Data;
    dataBlocks.push(blk);
    ecBlocks.push(rsEncode(blk, ecPerBlock));
  }
  for (let i = 0; i < g2Blocks; i++) {
    const blk = dataBytes.slice(offset, offset + g2Data);
    offset += g2Data;
    dataBlocks.push(blk);
    ecBlocks.push(rsEncode(blk, ecPerBlock));
  }

  // Interleave data codewords then EC codewords
  const result = [];
  const maxDataLen = Math.max(g1Data, g2Data);
  for (let i = 0; i < maxDataLen; i++) {
    for (const blk of dataBlocks) {
      if (i < blk.length) result.push(blk[i]);
    }
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const ec of ecBlocks) {
      if (i < ec.length) result.push(ec[i]);
    }
  }
  return result;
}

function createMatrix(version) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Int8Array(size).fill(-1));
  const isFunc = Array.from({ length: size }, () => new Uint8Array(size));

  const setFunc = (r, c, val) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      modules[r][c] = val ? 1 : 0;
      isFunc[r][c] = 1;
    }
  };

  const drawFinder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const isBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const isInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunc(r, c, inOuter && (isBorder || isInner));
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Alignment patterns
  const alignPos = VERSION_SPECS_L[version][3];
  for (const rCenter of alignPos) {
    for (const cCenter of alignPos) {
      if (isFunc[rCenter][cCenter]) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const isDark = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
          setFunc(rCenter + dr, cCenter + dc, isDark);
        }
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (!isFunc[6][i]) setFunc(6, i, i % 2 === 0);
    if (!isFunc[i][6]) setFunc(i, 6, i % 2 === 0);
  }

  // Dark module
  setFunc(size - 8, 8, true);

  // Reserve format info areas
  for (let i = 0; i < 9; i++) {
    if (!isFunc[8][i]) setFunc(8, i, false);
    if (!isFunc[i][8]) setFunc(i, 8, false);
  }
  for (let i = size - 8; i < size; i++) {
    if (!isFunc[8][i]) setFunc(8, i, false);
    if (!isFunc[i][8]) setFunc(i, 8, false);
  }

  // Reserve & write version info for version >= 7
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) {
      rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
    }
    const verBits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((verBits >> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunc(a, b, bit);
      setFunc(b, a, bit);
    }
  }

  return { size, modules, isFunc };
}

function placeData(matrix, codewords) {
  const { size, modules, isFunc } = matrix;
  const bits = [];
  for (const cw of codewords) {
    for (let b = 7; b >= 0; b--) {
      bits.push((cw >> b) & 1);
    }
  }

  let bitIdx = 0;
  let upward = true;
  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) col--;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (!isFunc[row][c]) {
          modules[row][c] = bitIdx < bits.length ? bits[bitIdx++] : 0;
        }
      }
    }
    upward = !upward;
  }
}

function applyMaskAndFormat(matrix, maskId) {
  const { size, modules, isFunc } = matrix;
  const cloned = modules.map(row => new Int8Array(row));

  const maskFn = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (_r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
  ][maskId];

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!isFunc[r][c] && maskFn(r, c)) {
        cloned[r][c] ^= 1;
      }
    }
  }

  // Format info: EC Level L (01) + maskId (3 bits)
  const data = (0b01 << 3) | maskId;
  let rem = data;
  for (let i = 0; i < 10; i++) {
    rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  }
  const formatBits = ((data << 10) | rem) ^ 0x5412;

  for (let i = 0; i <= 5; i++) cloned[8][i] = (formatBits >> i) & 1;
  cloned[8][7] = (formatBits >> 6) & 1;
  cloned[8][8] = (formatBits >> 7) & 1;
  cloned[7][8] = (formatBits >> 8) & 1;
  for (let i = 9; i < 15; i++) cloned[14 - i][8] = (formatBits >> i) & 1;

  for (let i = 0; i < 8; i++) cloned[8][size - 1 - i] = (formatBits >> i) & 1;
  for (let i = 8; i < 15; i++) cloned[size - 15 + i][8] = (formatBits >> i) & 1;

  return cloned;
}

function scorePenalty(grid) {
  const size = grid.length;
  let penalty = 0;

  // Rule 1: 5+ consecutive same-color modules in row/col
  for (let r = 0; r < size; r++) {
    let runRow = 1;
    let runCol = 1;
    for (let c = 1; c < size; c++) {
      if (grid[r][c] === grid[r][c - 1]) {
        runRow++;
        if (runRow === 5) penalty += 3;
        else if (runRow > 5) penalty += 1;
      } else runRow = 1;

      if (grid[c][r] === grid[c - 1][r]) {
        runCol++;
        if (runCol === 5) penalty += 3;
        else if (runCol > 5) penalty += 1;
      } else runCol = 1;
    }
  }

  // Rule 2: 2x2 blocks
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = grid[r][c];
      if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) {
        penalty += 3;
      }
    }
  }

  return penalty;
}

export function generateQrMatrix(text) {
  const bytes = getUtf8Bytes(String(text || ''));
  const version = chooseVersion(bytes.length);
  const codewords = buildCodewords(bytes, version);
  const matrix = createMatrix(version);
  placeData(matrix, codewords);

  let bestGrid = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = applyMaskAndFormat(matrix, mask);
    const score = scorePenalty(candidate);
    if (score < bestScore) {
      bestScore = score;
      bestGrid = candidate;
    }
  }
  return bestGrid;
}

export function generateQrSvg(text, pixelSize = 240) {
  const grid = generateQrMatrix(text);
  const size = grid.length;
  const quiet = 4;
  const fullSize = size + quiet * 2;
  const paths = [];

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c] === 1) {
        paths.push(`M${c + quiet},${r + quiet}h1v1h-1z`);
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelSize}" height="${pixelSize}" viewBox="0 0 ${fullSize} ${fullSize}" shape-rendering="crispEdges" role="img" aria-label="QR Code"><rect width="${fullSize}" height="${fullSize}" fill="#ffffff"/><path d="${paths.join('')}" fill="#0f172a"/></svg>`;
}
