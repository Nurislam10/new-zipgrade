// Camera scanning screen.
import { scanSheet, applyH } from './omr.js';
import { answerBubble, SHEET, LETTERS } from './sheet.js';
import { db, save, uid, getQuiz, quizPapers, findStudent } from './store.js';
import { gradePaper, keyFor } from './grade.js';
import { esc, toast } from './ui.js';

const LIVE_SIDE = 1400;
const PHOTO_SIDE = 1800;

export function scanView(root, quizId, query) {
  const quiz = getQuiz(quizId);
  if (!quiz) {
    location.hash = '#/';
    return;
  }
  const keyMode = query.get('mode') === 'key';
  const keyVersion = query.get('v') || 'A';
  const opts = { numQuestions: quiz.numQuestions, numChoices: quiz.numChoices, versions: quiz.versions };

  root.innerHTML = `
    <div class="scan">
      <div class="scan-bar">
        <a class="btn ghost" href="#/quiz/${quiz.id}/${keyMode ? 'key' : 'results'}">‹ Артқа</a>
        <div class="scan-title">${keyMode ? `Кілтті сканерлеу (${keyVersion})` : esc(quiz.name)}</div>
        <label class="btn ghost">🖼 Сурет<input type="file" accept="image/*" hidden></label>
      </div>
      <div class="scan-stage">
        <video playsinline muted autoplay></video>
        <canvas class="frozen" hidden></canvas>
        <div class="scan-guide"><span></span><span></span><span></span><span></span></div>
      </div>
      <div class="scan-status">Камера қосылуда…</div>
      <div class="scan-result" hidden></div>
    </div>`;

  const video = root.querySelector('video');
  const frozen = root.querySelector('canvas.frozen');
  const guide = root.querySelector('.scan-guide');
  const statusEl = root.querySelector('.scan-status');
  const resultEl = root.querySelector('.scan-result');
  const work = document.createElement('canvas');
  const wctx = work.getContext('2d', { willReadFrequently: true });

  let stream = null;
  let stopped = false;
  let paused = false;
  let busy = false;
  let lastCorners = null;
  let lastSavedSig = null;
  let timer = 0;

  const setStatus = (t, cls = '') => {
    statusEl.textContent = t;
    statusEl.className = 'scan-status ' + cls;
  };

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('Камера қолжетімсіз (HTTPS қажет). «Сурет» батырмасы арқылы жүктеңіз.', 'warn');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      if (stopped) return stream.getTracks().forEach((t) => t.stop());
      video.srcObject = stream;
      await video.play().catch(() => {});
      setStatus('Парақты төрт бұрышы көрінетіндей рамкаға орналастырыңыз');
      loop();
    } catch (e) {
      setStatus('Камераға рұқсат жоқ: ' + e.message + '. «Сурет» арқылы жүктеуге болады.', 'warn');
    }
  }

  function grab(source, sw, sh, maxSide) {
    const s = Math.min(1, maxSide / Math.max(sw, sh));
    work.width = Math.round(sw * s);
    work.height = Math.round(sh * s);
    wctx.drawImage(source, 0, 0, work.width, work.height);
    return wctx.getImageData(0, 0, work.width, work.height);
  }

  function loop() {
    if (stopped) return;
    timer = setTimeout(loop, 220);
    if (paused || busy || video.readyState < 2 || !video.videoWidth) return;
    busy = true;
    try {
      const img = grab(video, video.videoWidth, video.videoHeight, LIVE_SIDE);
      const r = scanSheet(img, opts);
      if (!r.ok) {
        lastCorners = null;
        lastSavedSig = null; // sheet left the view – the same sheet may be scanned again
        guide.classList.remove('found');
        return;
      }
      guide.classList.add('found');
      const diag = Math.hypot(work.width, work.height);
      const stable =
        lastCorners && r.corners.every((c, i) => Math.hypot(c[0] - lastCorners[i][0], c[1] - lastCorners[i][1]) < diag * 0.012);
      lastCorners = r.corners;
      if (!stable) return;
      const sig = r.studentId + '|' + r.version + '|' + r.answers.join(',');
      if (sig === lastSavedSig) {
        setStatus('Бұл парақ сақталды. Келесі парақты қойыңыз.', 'ok');
        return;
      }
      showResult(r);
    } finally {
      busy = false;
    }
  }

  function drawOverlay(r) {
    frozen.width = work.width;
    frozen.height = work.height;
    const ctx = frozen.getContext('2d');
    ctx.drawImage(work, 0, 0);
    const H = r.H;
    ctx.lineWidth = Math.max(2, work.width / 400);
    ctx.strokeStyle = '#2563eb';
    ctx.beginPath();
    r.corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    const [ax, ay] = applyH(H, 0, 0);
    const [bx, by] = applyH(H, SHEET.r, 0);
    const rad = Math.hypot(bx - ax, by - ay) * 1.15;
    const key = keyMode ? [] : keyFor(quiz, r.version || 'A');
    const ring = (q, c, color) => {
      const b = answerBubble(q, c);
      const [x, y] = applyH(H, b.x, b.y);
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.stroke();
    };
    for (let q = 0; q < quiz.numQuestions; q++) {
      const a = r.answers[q] || '';
      const k = key[q] || '';
      for (let c = 0; c < quiz.numChoices; c++) {
        const l = LETTERS[c];
        const marked = a.includes(l);
        if (keyMode) {
          if (marked) ring(q, c, '#2563eb');
        } else if (k) {
          if (marked && a.length === 1 && k.includes(l)) ring(q, c, '#16a34a');
          else if (marked) ring(q, c, '#dc2626');
          else if (k.includes(l)) ring(q, c, '#f59e0b');
        }
      }
    }
  }

  function showResult(r) {
    paused = true;
    drawOverlay(r);
    frozen.hidden = false;
    video.hidden = true;
    guide.hidden = true;

    if (keyMode) {
      const marked = r.answers.filter(Boolean).length;
      resultEl.innerHTML = `
        <div class="res-head">Кілт оқылды: ${marked}/${quiz.numQuestions} жауап</div>
        <div class="res-key">${r.answers.map((a, i) => `<span><b>${i + 1}</b>${a || '–'}</span>`).join('')}</div>
        <div class="row">
          <button class="btn" data-act="retry">Қайталау</button>
          <button class="btn primary" data-act="savekey">Кілт ретінде сақтау</button>
        </div>`;
    } else {
      const paper = { answers: r.answers, version: r.version || 'A' };
      const g = gradePaper(quiz, paper);
      const st = findStudent(quiz, r.studentId);
      const who = st
        ? `<b>${esc(st.name)}</b> <span class="muted">ID ${esc(r.studentId)}</span>`
        : r.studentId
          ? `<span class="warn">Белгісіз ID: ${esc(r.studentId)}</span>`
          : `<span class="warn">ID белгіленбеген</span>`;
      resultEl.innerHTML = `
        <div class="res-head">${who}</div>
        <div class="res-score">
          <div><span class="big">${g.correct}/${g.total}</span><small>ұпай</small></div>
          <div><span class="big">${Math.round(g.percent)}%</span><small>пайыз</small></div>
          <div><span class="big mark m${g.mark}">${g.mark}</span><small>баға</small></div>
          ${quiz.versions > 1 ? `<div><span class="big">${r.version || '?'}</span><small>нұсқа</small></div>` : ''}
        </div>
        <div class="legend"><i class="g"></i>дұрыс <i class="r"></i>қате <i class="y"></i>дұрыс жауап</div>
        <div class="row">
          <button class="btn" data-act="retry">Қайталау</button>
          <button class="btn primary" data-act="save">Сақтау</button>
        </div>`;
    }
    resultEl.hidden = false;
    setStatus('Нәтижені тексеріңіз');

    resultEl.onclick = (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'retry') resume();
      if (act === 'savekey') {
        quiz.keys[keyVersion] = Array.from({ length: quiz.numQuestions }, (_, i) => r.answers[i] || '');
        save();
        toast('Кілт сақталды');
        location.hash = `#/quiz/${quiz.id}/key`;
      }
      if (act === 'save') {
        if (!savePaper(r)) return;
        lastSavedSig = r.studentId + '|' + r.version + '|' + r.answers.join(',');
        resume();
        setStatus('Сақталды ✓ Келесі парақты қойыңыз', 'ok');
      }
    };
  }

  function savePaper(r) {
    const state = db();
    const existing = r.studentId && !r.studentId.includes('?') ? quizPapers(quiz.id).find((p) => p.studentId === r.studentId) : null;
    if (existing && !confirm(`ID ${r.studentId} үшін нәтиже бар. Ауыстыру керек пе?`)) return false;
    const paper = {
      id: existing?.id || uid(),
      quizId: quiz.id,
      studentId: r.studentId,
      version: r.version || 'A',
      answers: Array.from({ length: quiz.numQuestions }, (_, i) => r.answers[i] || ''),
      scannedAt: new Date().toISOString(),
    };
    if (existing) Object.assign(existing, paper);
    else state.papers.push(paper);
    save();
    toast('Сақталды');
    return true;
  }

  function resume() {
    paused = false;
    lastCorners = null;
    frozen.hidden = true;
    video.hidden = false;
    guide.hidden = false;
    guide.classList.remove('found');
    resultEl.hidden = true;
    setStatus(stream ? 'Парақты рамкаға орналастырыңыз' : '«Сурет» арқылы парақ суретін жүктеңіз');
  }

  root.querySelector('input[type=file]').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setStatus('Өңделуде…');
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
      const img = grab(bmp, bmp.width, bmp.height, PHOTO_SIDE);
      const r = scanSheet(img, opts);
      if (!r.ok) {
        setStatus(
          r.reason === 'orientation'
            ? 'Парақ табылды, бірақ бағдарын анықтау мүмкін болмады. Қайта түсіріңіз.'
            : 'Бұрыштағы 4 қара шаршы табылмады. Парақ толық көрінетін анық сурет түсіріңіз.',
          'warn'
        );
        return;
      }
      showResult(r);
    } catch (err) {
      setStatus('Суретті оқу мүмкін болмады: ' + err.message, 'warn');
    }
  };

  startCamera();

  return () => {
    stopped = true;
    clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
  };
}
