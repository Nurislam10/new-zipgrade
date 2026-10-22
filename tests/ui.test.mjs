// UI smoke test: class → quiz → key → scan uploaded photo → results/analysis.
// Usage: node tests/ui.test.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'tests/out');
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => {
  let p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (p.endsWith('/')) p += 'index.html';
  if (!p.startsWith(root) || !fs.existsSync(p)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('dialog', async (d) => (d.type() === 'prompt' ? d.accept(d.defaultValue() || '9 «А»') : d.accept()));

await page.goto(base + '/');
await page.screenshot({ path: `${out}/ui-01-empty.png` });

// Class with students
await page.click('text=Сыныптар');
await page.click('#add');
await page.waitForSelector('#addf');
await page.click('summary:has-text("жаппай")');
await page.fill('#bulk', 'Әлиев Нұрлан, 1001\nСерікова Айгерім\t1002\nҚасымов Ерлан; 1003');
await page.click('#import');
await page.fill('#addf [name=name]', 'Төлеуова Дана');
await page.click('#addf button[type=submit]');
assert.equal(await page.locator('tbody tr').count(), 4);
await page.screenshot({ path: `${out}/ui-02-class.png`, fullPage: true });

// Quiz
await page.click('nav >> text=Тесттер');
await page.click('text=+ Алғашқы тестті құру');
await page.fill('[name=name]', 'Алгебра, 3-тоқсан');
await page.selectOption('[name=classId]', { label: '9 «А»' });
await page.click('[data-n="20"]');
await page.selectOption('[name=numChoices]', '4');
await page.click('button[type=submit]');
await page.waitForSelector('.key-grid');
const KEY = 'ABCDABCDABCDABCDABCD';
await page.click('summary:has-text("Мәтінмен")');
await page.fill('#keytext', KEY);
await page.click('#applytext');
await page.click('.key-row[data-q="19"] .bub[data-l="A"]'); // q20: D -> A via click
await page.screenshot({ path: `${out}/ui-03-key.png`, fullPage: true });

// Print page renders preview
const quizUrl = page.url();
const quizId = quizUrl.match(/quiz\/(\w+)/)[1];
await page.goto(`${base}/#/sheets?quiz=${quizId}`);
await page.waitForSelector('#preview svg');
await page.screenshot({ path: `${out}/ui-04-sheets.png`, fullPage: true });

// Make a "photo" of a filled sheet for student 1002
const photo = await browser.newPage({ viewport: { width: 900, height: 1200 } });
await photo.goto(base + '/tests/blank.html');
const student = '1002';
const answers = 'ABCDABCDAACDABCDBBCA'; // q10 wrong (A), q17 wrong (B), q20 = A (key A)
await photo.evaluate(
  async ({ answers, student }) => {
    const { sheetSVG, answerBubble, idBubble } = await import('/js/sheet.js');
    document.body.style.cssText = 'margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#6b5a45';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'width:600px;height:849px;transform:perspective(1400px) rotateX(12deg) rotateZ(-3deg)';
    wrap.innerHTML = sheetSVG({ numQuestions: 20, numChoices: 4, quizName: 'Алгебра' });
    const svg = wrap.firstChild;
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    const pen = (b) => {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      Object.entries({ cx: b.x, cy: b.y, r: 1.9, fill: '#14215a' }).forEach(([k, v]) => c.setAttribute(k, v));
      svg.appendChild(c);
    };
    [...answers].forEach((l, q) => pen(answerBubble(q, 'ABCD'.indexOf(l))));
    [...student].forEach((d, col) => pen(idBubble(col, +d)));
    document.body.appendChild(wrap);
  },
  { answers, student }
);
await photo.screenshot({ path: `${out}/ui-photo.jpg`, type: 'jpeg', quality: 85 });
await photo.close();

// Scan via upload
await page.goto(`${base}/#/scan/${quizId}`);
await page.waitForSelector('.scan-status');
await page.setInputFiles('.scan input[type=file]', `${out}/ui-photo.jpg`);
await page.waitForSelector('.scan-result:not([hidden])', { timeout: 15000 });
const head = await page.textContent('.res-head');
assert.match(head, /Серікова Айгерім/);
const score = await page.textContent('.res-score');
assert.match(score, /18\/20/);
await page.screenshot({ path: `${out}/ui-05-scan.png` });
await page.click('[data-act=save]');
await page.click('text=‹ Артқа');

await page.waitForSelector('.table');
assert.equal(await page.locator('tbody tr').count(), 1);
assert.match(await page.textContent('tbody'), /90%/);
await page.screenshot({ path: `${out}/ui-06-results.png`, fullPage: true });

await page.click('.tabs >> text=Талдау');
await page.waitForSelector('.hist');
await page.screenshot({ path: `${out}/ui-07-analysis.png`, fullPage: true });

// Paper editing: fix q10 to B -> 19/20
await page.click('.tabs >> text=Нәтижелер');
await page.click('tbody tr');
await page.click('.key-row[data-q="9"] .bub[data-l="A"]');
await page.click('.key-row[data-q="9"] .bub[data-l="B"]');
assert.match(await page.textContent('.stats'), /19\/20/);
await page.screenshot({ path: `${out}/ui-08-paper.png`, fullPage: true });

// Live camera view opens without errors (fake device)
await page.goto(`${base}/#/scan/${quizId}`);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/ui-09-camera.png` });
await page.goto(`${base}/#/settings`);
await page.screenshot({ path: `${out}/ui-10-settings.png`, fullPage: true });

assert.deepEqual(errors, []);
console.log('UI test ok');
await browser.close();
server.close();
