// Answer sheet layout (all coordinates in millimetres on an A4 page).
// The same functions are used for printing and for scanning, so the
// scanner always knows exactly where every bubble is.

export const SHEET = {
  w: 210,
  h: 297,
  markerSize: 10,
  // Corner marker centres: TL, TR, BR, BL
  markers: [[15, 15], [195, 15], [195, 282], [15, 282]],
  // Solid bar next to the top-left marker – tells the scanner which way is up
  orient: { x: 24, y: 12, w: 14, h: 6 },
  r: 2.1,
  idDigits: 6,
  rowsPerCol: 25,
  maxQuestions: 100,
};

export const LETTERS = 'ABCDE';
export const VERSIONS = 'ABCD';

export function idBubble(col, digit) {
  return { x: 25 + col * 6, y: 52 + digit * 5.4 };
}

export function versionBubble(i) {
  return { x: 70, y: 52 + i * 5.4 };
}

export function answerBubble(q, c) {
  const col = Math.floor(q / SHEET.rowsPerCol);
  const row = q % SHEET.rowsPerCol;
  return { x: 31 + col * 45 + c * 6, y: 113 + row * 6.3 };
}

function questionLabel(q) {
  const col = Math.floor(q / SHEET.rowsPerCol);
  const row = q % SHEET.rowsPerCol;
  return { x: 27 + col * 45, y: 113 + row * 6.3 };
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function bubble(x, y, label, filled) {
  const { r } = SHEET;
  if (filled) return `<circle cx="${x}" cy="${y}" r="${r}" fill="#000"/>`;
  return (
    `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#222" stroke-width="0.25"/>` +
    `<text x="${x}" y="${(y + 0.85).toFixed(2)}" font-size="2.4" fill="#a0a0a0" text-anchor="middle">${label}</text>`
  );
}

/**
 * Build a printable SVG answer sheet.
 * @param {object} o
 * @param {number} o.numQuestions 1..100
 * @param {number} o.numChoices 4 or 5
 * @param {number} [o.versions] number of key versions (bubbles shown if > 1)
 * @param {string} [o.quizName]
 * @param {string} [o.className]
 * @param {string} [o.studentName] pre-printed name
 * @param {string} [o.studentId] pre-filled ID bubbles
 */
export function sheetSVG(o = {}) {
  const n = Math.max(1, Math.min(SHEET.maxQuestions, o.numQuestions | 0 || 20));
  const c = o.numChoices === 4 ? 4 : 5;
  const p = [];
  p.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297" width="210mm" height="297mm" class="sheet-svg" font-family="Arial, Helvetica, sans-serif">`,
    `<rect width="210" height="297" fill="#fff"/>`
  );

  // Corner markers and orientation bar
  const m = SHEET.markerSize;
  for (const [x, y] of SHEET.markers) p.push(`<rect x="${x - m / 2}" y="${y - m / 2}" width="${m}" height="${m}" fill="#000"/>`);
  const ob = SHEET.orient;
  p.push(`<rect x="${ob.x}" y="${ob.y}" width="${ob.w}" height="${ob.h}" fill="#000"/>`);

  p.push(`<text x="105" y="17" font-size="6" font-weight="bold" text-anchor="middle">ЖАУАП ПАРАҒЫ</text>`);
  p.push(`<text x="186" y="17" font-size="3" text-anchor="end" fill="#444">${n} сұрақ</text>`);

  // Student ID block
  const id = String(o.studentId ?? '').replace(/\D/g, '').slice(0, SHEET.idDigits);
  p.push(`<text x="40" y="39.5" font-size="3.2" font-weight="bold" text-anchor="middle">Оқушы ID</text>`);
  for (let col = 0; col < SHEET.idDigits; col++) {
    const { x } = idBubble(col, 0);
    p.push(`<rect x="${x - 2.5}" y="41.5" width="5" height="5" fill="none" stroke="#222" stroke-width="0.25"/>`);
    const digit = id[col];
    if (digit !== undefined) p.push(`<text x="${x}" y="45.4" font-size="3.6" text-anchor="middle">${digit}</text>`);
    for (let d = 0; d < 10; d++) {
      const b = idBubble(col, d);
      p.push(bubble(b.x, b.y, d, digit !== undefined && +digit === d));
    }
  }

  // Version block
  if ((o.versions | 0) > 1) {
    p.push(`<text x="70" y="39.5" font-size="3.2" font-weight="bold" text-anchor="middle">Нұсқа</text>`);
    for (let i = 0; i < Math.min(4, o.versions); i++) {
      const b = versionBubble(i);
      p.push(bubble(b.x, b.y, VERSIONS[i], false));
    }
  }

  // Info block
  p.push(`<text x="84" y="44" font-size="3.4">Аты-жөні:</text>`);
  p.push(`<line x1="102" y1="44.6" x2="192" y2="44.6" stroke="#222" stroke-width="0.25"/>`);
  if (o.studentName) p.push(`<text x="104" y="43.4" font-size="3.8">${esc(o.studentName)}</text>`);
  p.push(`<text x="84" y="54" font-size="3.4">Сынып:</text>`);
  p.push(`<line x1="97" y1="54.6" x2="140" y2="54.6" stroke="#222" stroke-width="0.25"/>`);
  if (o.className) p.push(`<text x="99" y="53.4" font-size="3.6">${esc(o.className)}</text>`);
  p.push(`<text x="144" y="54" font-size="3.4">Күні:</text>`);
  p.push(`<line x1="154" y1="54.6" x2="192" y2="54.6" stroke="#222" stroke-width="0.25"/>`);
  p.push(`<text x="84" y="64" font-size="3.4">Тест:</text>`);
  p.push(`<line x1="95" y1="64.6" x2="192" y2="64.6" stroke="#222" stroke-width="0.25"/>`);
  if (o.quizName) p.push(`<text x="97" y="63.4" font-size="3.6">${esc(o.quizName)}</text>`);

  // Instructions
  p.push(`<rect x="84" y="72" width="108" height="28" rx="1.5" fill="none" stroke="#999" stroke-width="0.25"/>`);
  p.push(`<text x="88" y="78.5" font-size="3">Дөңгелекті қара немесе көк қаламмен толық бояңыз.</text>`);
  p.push(`<text x="88" y="83.5" font-size="3">Жауапты өзгерту үшін бұрынғысын мұқият өшіріңіз.</text>`);
  p.push(`<text x="88" y="93" font-size="3">Дұрыс:</text>`);
  p.push(`<circle cx="102" cy="92" r="2.1" fill="#000"/>`);
  p.push(`<text x="120" y="93" font-size="3">Қате:</text>`);
  const wrong = [[134, '✓'], [142, '✗'], [150, '•']];
  for (const [x, s] of wrong) {
    p.push(`<circle cx="${x}" cy="92" r="2.1" fill="none" stroke="#222" stroke-width="0.25"/>`);
    p.push(`<text x="${x}" y="93.2" font-size="3.4" text-anchor="middle">${s}</text>`);
  }
  p.push(`<path d="M156 92 m-2.1 0 a2.1 2.1 0 0 1 4.2 0 z" fill="#000"/><circle cx="156" cy="92" r="2.1" fill="none" stroke="#222" stroke-width="0.25"/>`);

  p.push(`<line x1="20" y1="106" x2="190" y2="106" stroke="#bbb" stroke-width="0.3"/>`);

  // Answers
  for (let q = 0; q < n; q++) {
    const l = questionLabel(q);
    p.push(`<text x="${l.x}" y="${(l.y + 1.1).toFixed(2)}" font-size="3.1" font-weight="bold" text-anchor="end">${q + 1}</text>`);
    for (let k = 0; k < c; k++) {
      const b = answerBubble(q, k);
      p.push(bubble(b.x, b.y, LETTERS[k], false));
    }
  }

  p.push(`<text x="105" y="290" font-size="2.4" fill="#888" text-anchor="middle">Бұрыштардағы қара шаршыларды бүктемеңіз және боямаңыз</text>`);
  p.push(`</svg>`);
  return p.join('');
}
