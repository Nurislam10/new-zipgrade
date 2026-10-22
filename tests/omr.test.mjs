// End-to-end OMR test: renders filled answer sheets in Chromium under various
// photo-like distortions, screenshots them and runs the scanner on the image.
// Usage: node tests/omr.test.mjs   (needs playwright; serves the repo itself)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch(
  fs.existsSync('/opt/pw-browsers/chromium') ? {} : {}
);
const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
await page.goto(`${base}/tests/blank.html`);

const cases = [
  { name: 'flat', transform: 'none', scale: 0.95 },
  { name: 'tilted', transform: 'perspective(1400px) rotateX(18deg) rotateZ(4deg)', scale: 0.85 },
  { name: 'rotated-180', transform: 'rotateZ(181deg)', scale: 0.85 },
  { name: 'skew-shadow', transform: 'perspective(1200px) rotateY(-14deg) rotateZ(-6deg)', scale: 0.8, shadow: true },
  { name: 'landscape-90', transform: 'rotateZ(90deg)', scale: 0.62, vw: 1200, vh: 900 },
  { name: 'small-dark', transform: 'perspective(1500px) rotateX(-10deg)', scale: 0.6, dark: true },
];

const rand = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
let failures = 0;

for (const [ci, tc] of cases.entries()) {
  const rnd = rand(ci * 97 + 13);
  const numQuestions = [20, 50, 100, 30, 50, 100][ci];
  const numChoices = ci % 2 ? 4 : 5;
  const versions = 2;
  const answers = [];
  for (let q = 0; q < numQuestions; q++) {
    const x = rnd();
    if (x < 0.08) answers.push('');
    else if (x < 0.12) answers.push('AC'.slice(0, 2));
    else answers.push('ABCDE'[Math.floor(rnd() * numChoices)]);
  }
  const studentId = String(100000 + Math.floor(rnd() * 899999)).slice(0, 4 + (ci % 3));
  const version = 'AB'[ci % 2];
  await page.setViewportSize({ width: tc.vw || 900, height: tc.vh || 1200 });
  const result = await page.evaluate(
    async ({ tc, numQuestions, numChoices, versions, answers, studentId, version }) => {
      const { sheetSVG, answerBubble, idBubble, versionBubble, SHEET } = await import('/js/sheet.js');
      document.body.innerHTML = '';
      document.body.style.cssText = `margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:${
        tc.dark ? '#3b2a1a' : 'repeating-linear-gradient(45deg,#8a6d4b 0 14px,#7a5f40 14px 28px)'
      };overflow:hidden`;
      const wrap = document.createElement('div');
      const sizeH = innerHeight * tc.scale;
      wrap.style.cssText = `width:${(sizeH * 210) / 297}px;height:${sizeH}px;transform:${tc.transform};position:relative;filter:${
        tc.dark ? 'brightness(0.55)' : 'none'
      }`;
      wrap.innerHTML = sheetSVG({ numQuestions, numChoices, versions, quizName: 'Тест', studentName: '' });
      const svg = wrap.firstChild;
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      // Pen marks: dark blue, slightly irregular, slightly off-centre
      const pen = (x, y) => {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
        c.setAttribute('cx', x + (Math.random() - 0.5) * 0.5);
        c.setAttribute('cy', y + (Math.random() - 0.5) * 0.5);
        c.setAttribute('rx', 1.8 + Math.random() * 0.4);
        c.setAttribute('ry', 1.7 + Math.random() * 0.4);
        c.setAttribute('fill', '#1a2a6c');
        c.setAttribute('opacity', 0.85 + Math.random() * 0.15);
        svg.appendChild(c);
      };
      answers.forEach((a, q) => [...a].forEach((l) => { const b = answerBubble(q, 'ABCDE'.indexOf(l)); pen(b.x, b.y); }));
      [...studentId].forEach((d, col) => { const b = idBubble(col, +d); pen(b.x, b.y); });
      { const b = versionBubble('ABCD'.indexOf(version)); pen(b.x, b.y); }
      // A light stray pencil smudge that must not count
      const sm = answerBubble(0, 1);
      const s = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      s.setAttribute('cx', sm.x); s.setAttribute('cy', sm.y); s.setAttribute('r', 1.5); s.setAttribute('fill', '#ccc');
      if (!answers[0].includes('B')) svg.appendChild(s);
      if (tc.shadow) {
        const sh = document.createElement('div');
        sh.style.cssText = 'position:absolute;inset:0;background:linear-gradient(120deg,rgba(0,0,0,0.45),rgba(0,0,0,0) 60%);pointer-events:none';
        wrap.appendChild(sh);
      }
      document.body.appendChild(wrap);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return true;
    },
    { tc, numQuestions, numChoices, versions, answers, studentId, version }
  );
  const png = await page.screenshot({ type: 'png' });
  fs.mkdirSync(path.join(root, 'tests/out'), { recursive: true });
  fs.writeFileSync(path.join(root, `tests/out/${tc.name}.png`), png);
  const scan = await page.evaluate(
    async ({ b64, numQuestions, numChoices, versions }) => {
      const { scanSheet } = await import('/js/omr.js');
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const s = Math.min(1, 1400 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const t0 = performance.now();
      const r = scanSheet(ctx.getImageData(0, 0, c.width, c.height), { numQuestions, numChoices, versions });
      return { ...r, ms: Math.round(performance.now() - t0), fills: undefined, H: undefined };
    },
    { b64: png.toString('base64'), numQuestions, numChoices, versions }
  );
  const errs = [];
  if (!scan.ok) errs.push('scan failed: ' + scan.reason);
  else {
    answers.forEach((a, q) => { if (scan.answers[q] !== a) errs.push(`q${q + 1}: want "${a}" got "${scan.answers[q]}"`); });
    if (scan.studentId !== studentId) errs.push(`id: want ${studentId} got ${scan.studentId}`);
    if (scan.version !== version) errs.push(`version: want ${version} got ${scan.version}`);
  }
  failures += errs.length ? 1 : 0;
  console.log(`${errs.length ? 'FAIL' : 'ok  '} ${tc.name} (${numQuestions}q, ${scan.ms ?? '-'}ms)${errs.length ? '\n   ' + errs.slice(0, 8).join('\n   ') : ''}`);
}

await browser.close();
server.close();
process.exit(failures ? 1 : 0);
