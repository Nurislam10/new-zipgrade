// Optical mark recognition for the answer sheet defined in sheet.js.
// Input is an ImageData-like object ({ width, height, data: RGBA }).

import { SHEET, idBubble, versionBubble, answerBubble, LETTERS, VERSIONS } from './sheet.js';

const MARK = 0.45; // normalised fill above which a bubble counts as marked
const ERASE_GAP = 0.3; // darkest wins over a second mark when it is this much darker

// ---------- linear algebra ----------

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Homography mapping 4 src points to 4 dst points. */
export function computeHomography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(A, b);
  return h ? [...h, 1] : null;
}

export function applyH(H, x, y) {
  const d = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / d, (H[3] * x + H[4] * y + H[5]) / d];
}

// ---------- image preprocessing ----------

/** Grayscale image divided by its local mean – removes shadows and uneven light. */
export function preprocess(img) {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const gray = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) gray[i] = (data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114) / 255;

  const W = w + 1;
  const S = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x];
      S[(y + 1) * W + x + 1] = S[y * W + x + 1] + row;
    }
  }
  const R = Math.max(10, Math.round(Math.min(w, h) / 10));
  const norm = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - R);
    const y1 = Math.min(h, y + R + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - R);
      const x1 = Math.min(w, x + R + 1);
      const sum = S[y1 * W + x1] - S[y0 * W + x1] - S[y1 * W + x0] + S[y0 * W + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      norm[y * w + x] = gray[y * w + x] / Math.max(mean, 0.04);
    }
  }
  return { w, h, norm };
}

function components(mask, w, h, minArea) {
  const n = w * h;
  const labels = new Int32Array(n);
  const stack = new Int32Array(n);
  const out = [];
  let next = 1;
  for (let start = 0; start < n; start++) {
    if (!mask[start] || labels[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = next;
    let area = 0, sx = 0, sy = 0;
    let minx = w, maxx = 0, miny = h, maxy = 0;
    while (sp) {
      const p = stack[--sp];
      const x = p % w;
      const y = (p - x) / w;
      area++;
      sx += x;
      sy += y;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
      if (x > 0 && mask[p - 1] && !labels[p - 1]) { labels[p - 1] = next; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !labels[p + 1]) { labels[p + 1] = next; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && !labels[p - w]) { labels[p - w] = next; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && !labels[p + w]) { labels[p + w] = next; stack[sp++] = p + w; }
    }
    if (area >= minArea) out.push({ area, x: sx / area, y: sy / area, minx, maxx, miny, maxy });
    next++;
  }
  return out;
}

// A marker must be surrounded by paper; checks a square ring around the blob.
function ringIsWhite(pre, c) {
  const { w, h, norm } = pre;
  const bw = c.maxx - c.minx + 1;
  const bh = c.maxy - c.miny + 1;
  const pad = Math.max(2, Math.round(Math.max(bw, bh) * 0.35));
  const x0 = c.minx - pad, x1 = c.maxx + pad, y0 = c.miny - pad, y1 = c.maxy + pad;
  if (x0 < 0 || y0 < 0 || x1 >= w || y1 >= h) return false;
  let total = 0, white = 0;
  const step = Math.max(1, Math.round((x1 - x0) / 24));
  for (let x = x0; x <= x1; x += step) {
    for (const y of [y0, y1]) { total++; if (norm[y * w + x] > 0.75) white++; }
  }
  for (let y = y0; y <= y1; y += step) {
    for (const x of [x0, x1]) { total++; if (norm[y * w + x] > 0.75) white++; }
  }
  return white / total >= 0.85;
}

function findMarkerCandidates(pre) {
  const { w, h, norm } = pre;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = norm[i] < 0.55 ? 1 : 0;
  const minDim = Math.min(w, h);
  const minA = (minDim * 0.01) ** 2;
  const maxA = (minDim * 0.12) ** 2;
  return components(mask, w, h, minA).filter((c) => {
    if (c.area > maxA) return false;
    const bw = c.maxx - c.minx + 1;
    const bh = c.maxy - c.miny + 1;
    const aspect = bw / bh;
    if (aspect < 0.5 || aspect > 2) return false;
    if (c.area / (bw * bh) < 0.55) return false;
    return ringIsWhite(pre, c);
  });
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Choose the 4 blobs that best form the sheet's marker rectangle.
// Returns the points in clockwise (visual) order.
function pickQuad(cands) {
  const top = [...cands].sort((a, b) => b.area - a.area).slice(0, 10);
  const expectedRatio = SHEET.markerSize / Math.sqrt(180 * 267);
  let best = null;
  const n = top.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++) {
          const pts = [top[a], top[b], top[c], top[d]];
          const areas = pts.map((p) => p.area);
          const sim = Math.min(...areas) / Math.max(...areas);
          if (sim < 0.3) continue;
          const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
          const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
          pts.sort((p, q) => Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx));
          let sign = 0, convex = true, area2 = 0;
          for (let i = 0; i < 4; i++) {
            const p0 = pts[i], p1 = pts[(i + 1) % 4], p2 = pts[(i + 2) % 4];
            const cr = (p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x);
            const s = Math.sign(cr);
            if (sign === 0) sign = s;
            else if (s !== sign) convex = false;
            area2 += p0.x * p1.y - p1.x * p0.y;
          }
          if (!convex) continue;
          const quadArea = Math.abs(area2) / 2;
          const meanMarker = Math.sqrt(areas.reduce((s, v) => s + v, 0) / 4);
          const ratio = meanMarker / Math.sqrt(quadArea);
          if (ratio < expectedRatio * 0.5 || ratio > expectedRatio * 1.8) continue;
          const e = [0, 1, 2, 3].map((i) => dist(pts[i], pts[(i + 1) % 4]));
          const pairA = (e[0] + e[2]) / 2;
          const pairB = (e[1] + e[3]) / 2;
          const aspect = Math.min(pairA, pairB) / Math.max(pairA, pairB);
          if (aspect < 0.45 || aspect > 0.92) continue;
          // opposite sides should be roughly equal (limited perspective)
          if (Math.min(e[0], e[2]) / Math.max(e[0], e[2]) < 0.6) continue;
          if (Math.min(e[1], e[3]) / Math.max(e[1], e[3]) < 0.6) continue;
          const score = quadArea * sim;
          if (!best || score > best.score) best = { score, pts, shortFirst: pairA < pairB };
        }
  return best;
}

// ---------- sampling ----------

function bilinear(pre, x, y) {
  const { w, h, norm } = pre;
  if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return 1;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const i = y0 * w + x0;
  return (
    norm[i] * (1 - fx) * (1 - fy) + norm[i + 1] * fx * (1 - fy) + norm[i + w] * (1 - fx) * fy + norm[i + w + 1] * fx * fy
  );
}

function sampleDisk(pre, H, cx, cy, rad) {
  let sum = 0, cnt = 0;
  const step = rad / 3;
  for (let dy = -rad; dy <= rad + 1e-9; dy += step)
    for (let dx = -rad; dx <= rad + 1e-9; dx += step) {
      if (dx * dx + dy * dy > rad * rad + 1e-9) continue;
      const [u, v] = applyH(H, cx + dx, cy + dy);
      sum += Math.min(1.2, bilinear(pre, u, v));
      cnt++;
    }
  return sum / cnt;
}

function sampleRect(pre, H, r) {
  let sum = 0, cnt = 0;
  for (let y = r.y + 1; y <= r.y + r.h - 1; y += 1)
    for (let x = r.x + 1; x <= r.x + r.w - 1; x += 1) {
      const [u, v] = applyH(H, x, y);
      sum += Math.min(1.2, bilinear(pre, u, v));
      cnt++;
    }
  return sum / cnt;
}

function rotated(r) {
  return { x: SHEET.w - r.x - r.w, y: SHEET.h - r.y - r.h, w: r.w, h: r.h };
}

function decide(fills, letters) {
  const idx = fills.map((f, i) => i).filter((i) => fills[i] >= MARK);
  if (idx.length <= 1) return idx.length ? letters[idx[0]] : '';
  idx.sort((a, b) => fills[b] - fills[a]);
  if (fills[idx[0]] - fills[idx[1]] >= ERASE_GAP) return letters[idx[0]];
  return idx.sort((a, b) => a - b).map((i) => letters[i]).join('');
}

/**
 * Scan an image of an answer sheet.
 * @returns {{ok:false, reason:string} | {ok:true, H:number[], corners:number[][], answers:string[], studentId:string, version:string, fills:number[][]}}
 */
export function scanSheet(img, { numQuestions = 20, numChoices = 5, versions = 1 } = {}) {
  const pre = preprocess(img);
  const cands = findMarkerCandidates(pre);
  if (cands.length < 4) return { ok: false, reason: 'markers' };
  const quad = pickQuad(cands);
  if (!quad) return { ok: false, reason: 'markers' };

  // Two possible orientations remain (0° / 180°); the orientation bar decides.
  const start = quad.shortFirst ? [0, 2] : [1, 3];
  let best = null;
  for (const k of start) {
    const corners = [0, 1, 2, 3].map((i) => {
      const p = quad.pts[(k + i) % 4];
      return [p.x, p.y];
    });
    const H = computeHomography(SHEET.markers, corners);
    if (!H) continue;
    const bar = sampleRect(pre, H, SHEET.orient);
    const anti = sampleRect(pre, H, rotated(SHEET.orient));
    if (!best || bar < best.bar) best = { H, corners, bar, anti };
  }
  if (!best || best.bar > 0.55 || best.anti < 0.75) return { ok: false, reason: 'orientation' };
  const { H, corners } = best;

  const r = SHEET.r * 0.6;
  const black = SHEET.markers.reduce((s, [x, y]) => s + sampleDisk(pre, H, x, y, 3), 0) / 4;

  const raw = { answers: [], id: [], version: [] };
  const all = [];
  for (let q = 0; q < numQuestions; q++) {
    const row = [];
    for (let c = 0; c < numChoices; c++) {
      const b = answerBubble(q, c);
      row.push(sampleDisk(pre, H, b.x, b.y, r));
    }
    raw.answers.push(row);
    all.push(...row);
  }
  for (let col = 0; col < SHEET.idDigits; col++) {
    const row = [];
    for (let d = 0; d < 10; d++) {
      const b = idBubble(col, d);
      row.push(sampleDisk(pre, H, b.x, b.y, r));
    }
    raw.id.push(row);
    all.push(...row);
  }
  if (versions > 1) {
    for (let i = 0; i < Math.min(4, versions); i++) {
      const b = versionBubble(i);
      raw.version.push(sampleDisk(pre, H, b.x, b.y, r));
    }
  }
  all.sort((a, b) => a - b);
  const white = Math.max(all[Math.floor(all.length * 0.9)], 0.7);
  const span = Math.max(0.2, white - black);
  const fill = (v) => Math.max(0, Math.min(1, (white - v) / span));

  const fills = raw.answers.map((row) => row.map(fill));
  const answers = fills.map((f) => decide(f, LETTERS));
  let studentId = '';
  for (const row of raw.id) {
    const d = decide(row.map(fill), '0123456789');
    studentId += d.length === 1 ? d : d.length > 1 ? '?' : '';
  }
  const version = raw.version.length ? decide(raw.version.map(fill), VERSIONS) : '';

  return { ok: true, H, corners, answers, fills, studentId, version: version.length === 1 ? version : '' };
}
