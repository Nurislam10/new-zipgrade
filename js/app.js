import { db, save, uid, getQuiz, getClass, getPaper, quizPapers, findStudent, replaceState, resetState } from './store.js';
import { gradePaper, quizStats, itemAnalysis, keyFor } from './grade.js';
import { sheetSVG, SHEET, LETTERS, VERSIONS } from './sheet.js';
import { scanView } from './scanner.js';
import { esc, toast, download, toCSV, fmtDate, today } from './ui.js';

const app = document.getElementById('app');
const nav = document.getElementById('nav');
let cleanup = null;

// ---------- router ----------

const routes = [
  [/^\/?$/, quizzesView, 'quizzes'],
  [/^\/quiz\/new$/, (r, m, q) => quizFormView(r, null, q), 'quizzes'],
  [/^\/quiz\/(\w+)\/edit$/, (r, m, q) => quizFormView(r, m[1], q), 'quizzes'],
  [/^\/quiz\/(\w+)(?:\/(\w+))?$/, (r, m, q) => quizView(r, m[1], m[2] || 'results', q), 'quizzes'],
  [/^\/scan\/(\w+)$/, (r, m, q) => scanView(r, m[1], q), null],
  [/^\/paper\/(\w+)$/, (r, m) => paperView(r, m[1]), 'quizzes'],
  [/^\/classes$/, classesView, 'classes'],
  [/^\/class\/(\w+)$/, (r, m) => classView(r, m[1]), 'classes'],
  [/^\/sheets$/, (r, m, q) => sheetsView(r, q), 'sheets'],
  [/^\/settings$/, settingsView, 'settings'],
];

function route() {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = hash.split('?');
  const query = new URLSearchParams(qs || '');
  for (const [re, view, tab] of routes) {
    const m = path.match(re);
    if (!m) continue;
    document.body.classList.toggle('fullscreen', tab === null);
    nav.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
    app.scrollTop = 0;
    window.scrollTo(0, 0);
    cleanup = view(app, m, query) || null;
    return;
  }
  location.hash = '#/';
}

window.addEventListener('hashchange', route);

// ---------- helpers ----------

const pct = (v) => (v == null ? '–' : Math.round(v) + '%');

function header(title, { back, actions = '' } = {}) {
  return `<header class="top">
    ${back ? `<a class="back" href="${back}" aria-label="Артқа">‹</a>` : ''}
    <h1>${title}</h1>
    <div class="actions">${actions}</div>
  </header>`;
}

function emptyBox(text, action = '') {
  return `<div class="empty"><p>${text}</p>${action}</div>`;
}

function printSheets(svgs) {
  const pr = document.getElementById('print-root');
  pr.innerHTML = svgs.map((s) => `<div class="print-page">${s}</div>`).join('');
  setTimeout(() => window.print(), 50);
}

function blankKey(n) {
  return Array.from({ length: n }, () => '');
}

// Parse "ABCDA", "1A 2B 3C", "A,B,-,(AC)" into key entries
export function parseKeyText(text, n, numChoices) {
  const allowed = LETTERS.slice(0, numChoices);
  const map = { А: 'A', В: 'B', С: 'C', Д: 'D', Е: 'E', Ә: 'A' };
  const src = text.toUpperCase().replace(/[АВСДЕӘ]/g, (c) => map[c]).replace(/\d+\s*[.)]?/g, ' ');
  const out = [];
  for (const m of src.matchAll(/\(([A-E]+)\)|([A-E])|([-_?*])/g)) {
    const v = m[1] || m[2] || '';
    out.push([...new Set(v)].filter((l) => allowed.includes(l)).sort().join(''));
  }
  return Array.from({ length: n }, (_, i) => out[i] || '');
}

// ---------- quizzes list ----------

function quizzesView(root) {
  const { quizzes } = db();
  const list = [...quizzes].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt?.localeCompare(a.createdAt));
  root.innerHTML = `
    ${header('Тесттер', { actions: `<a class="btn primary" href="#/quiz/new">+ Жаңа тест</a>` })}
    <main>
      ${
        list.length
          ? `<div class="cards">${list
              .map((q) => {
                const papers = quizPapers(q.id);
                const st = quizStats(q, papers);
                const cls = getClass(q.classId);
                const hasKey = keyFor(q, 'A').some(Boolean);
                return `<a class="card" href="#/quiz/${q.id}">
                  <div class="card-main">
                    <div class="card-title">${esc(q.name)}</div>
                    <div class="card-sub">${fmtDate(q.date)}${cls ? ' · ' + esc(cls.name) : ''} · ${q.numQuestions} сұрақ</div>
                    ${hasKey ? '' : '<div class="card-warn">Кілт енгізілмеген</div>'}
                  </div>
                  <div class="card-stat"><b>${papers.length}</b><small>парақ</small></div>
                  <div class="card-stat"><b>${st ? pct(st.avg) : '–'}</b><small>орташа</small></div>
                </a>`;
              })
              .join('')}</div>`
          : emptyBox(
              'Әзірге тест жоқ. Жаңа тест құрып, жауап кілтін енгізіңіз, жауап парақтарын басып шығарып, телефон камерасымен тексеріңіз.',
              `<a class="btn primary" href="#/quiz/new">+ Алғашқы тестті құру</a>`
            )
      }
    </main>`;
}

// ---------- quiz create / edit ----------

function quizFormView(root, id) {
  const quiz = id ? getQuiz(id) : null;
  if (id && !quiz) return void (location.hash = '#/');
  const { classes } = db();
  const v = quiz || { name: '', date: today(), classId: '', numQuestions: 20, numChoices: 5, versions: 1 };
  const locked = quiz && quizPapers(quiz.id).length > 0;
  root.innerHTML = `
    ${header(quiz ? 'Тестті өңдеу' : 'Жаңа тест', { back: quiz ? `#/quiz/${quiz.id}/settings` : '#/' })}
    <main>
      <form class="form" id="qf">
        <label>Атауы<input name="name" required maxlength="80" value="${esc(v.name)}" placeholder="Мысалы: Алгебра, 3-тоқсан"></label>
        <label>Күні<input name="date" type="date" value="${esc(v.date)}"></label>
        <label>Сынып
          <select name="classId"><option value="">— Таңдалмаған —</option>
            ${classes.map((c) => `<option value="${c.id}" ${c.id === v.classId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
        </label>
        <label>Сұрақ саны
          <div class="seg-input">
            ${[20, 50, 100].map((n) => `<button type="button" class="chip" data-n="${n}">${n}</button>`).join('')}
            <input name="numQuestions" type="number" min="1" max="${SHEET.maxQuestions}" value="${v.numQuestions}" required>
          </div>
        </label>
        <label>Жауап нұсқалары
          <select name="numChoices">
            <option value="4" ${v.numChoices === 4 ? 'selected' : ''}>4 (A–D)</option>
            <option value="5" ${v.numChoices === 5 ? 'selected' : ''}>5 (A–E)</option>
          </select>
        </label>
        <label>Тест нұсқалары (әр нұсқаға бөлек кілт)
          <select name="versions">
            ${[1, 2, 3, 4].map((n) => `<option value="${n}" ${v.versions === n ? 'selected' : ''}>${n === 1 ? '1 нұсқа' : n + ' нұсқа (' + VERSIONS.slice(0, n).split('').join(', ') + ')'}</option>`).join('')}
          </select>
        </label>
        ${locked ? '<p class="hint">Бұл тестте сканерленген парақтар бар. Сұрақ санын өзгертсеңіз, артық жауаптар қиылады.</p>' : ''}
        <div class="row end">
          <a class="btn" href="${quiz ? `#/quiz/${quiz.id}/settings` : '#/'}">Болдырмау</a>
          <button class="btn primary" type="submit">${quiz ? 'Сақтау' : 'Құру'}</button>
        </div>
      </form>
    </main>`;
  const form = root.querySelector('#qf');
  form.querySelectorAll('[data-n]').forEach((b) => (b.onclick = () => (form.numQuestions.value = b.dataset.n)));
  form.onsubmit = (e) => {
    e.preventDefault();
    const n = Math.max(1, Math.min(SHEET.maxQuestions, parseInt(form.numQuestions.value, 10) || 20));
    const data = {
      name: form.name.value.trim(),
      date: form.date.value,
      classId: form.classId.value,
      numQuestions: n,
      numChoices: +form.numChoices.value,
      versions: +form.versions.value,
    };
    if (quiz) {
      Object.assign(quiz, data);
      for (const k of Object.keys(quiz.keys)) quiz.keys[k] = Array.from({ length: n }, (_, i) => (quiz.keys[k][i] || '').replace(data.numChoices === 4 ? /E/g : /$^/, ''));
      for (const p of quizPapers(quiz.id)) p.answers = Array.from({ length: n }, (_, i) => p.answers[i] || '');
      save();
      toast('Сақталды');
      location.hash = `#/quiz/${quiz.id}/settings`;
    } else {
      const q = { id: uid(), createdAt: new Date().toISOString(), ...data, keys: { A: blankKey(n) } };
      db().quizzes.push(q);
      save();
      location.hash = `#/quiz/${q.id}/key`;
    }
  };
}

// ---------- quiz page ----------

const TABS = [
  ['results', 'Нәтижелер'],
  ['key', 'Кілт'],
  ['analysis', 'Талдау'],
  ['settings', 'Баптау'],
];

function quizView(root, id, tab, query) {
  const quiz = getQuiz(id);
  if (!quiz) return void (location.hash = '#/');
  const cls = getClass(quiz.classId);
  root.innerHTML = `
    ${header(esc(quiz.name), {
      back: '#/',
      actions: `<a class="btn" href="#/sheets?quiz=${quiz.id}" title="Жауап парақтарын басып шығару">🖨<span class="hide-sm"> Парақтар</span></a>
                <a class="btn primary" href="#/scan/${quiz.id}">📷 Сканерлеу</a>`,
    })}
    <div class="subhead">${fmtDate(quiz.date)}${cls ? ' · ' + esc(cls.name) : ''} · ${quiz.numQuestions} сұрақ · ${LETTERS.slice(0, quiz.numChoices).split('').join('')}${
      quiz.versions > 1 ? ' · ' + quiz.versions + ' нұсқа' : ''
    }</div>
    <nav class="tabs">${TABS.map(([t, label]) => `<a href="#/quiz/${quiz.id}/${t}" class="${t === tab ? 'active' : ''}">${label}</a>`).join('')}</nav>
    <main id="tab"></main>`;
  const el = root.querySelector('#tab');
  if (tab === 'key') keyTab(el, quiz, query);
  else if (tab === 'analysis') analysisTab(el, quiz);
  else if (tab === 'settings') quizSettingsTab(el, quiz);
  else resultsTab(el, quiz);
}

function keyTab(el, quiz, query) {
  let version = VERSIONS.slice(0, quiz.versions).includes(query.get('v')) ? query.get('v') : 'A';
  let multi = false;
  const letters = LETTERS.slice(0, quiz.numChoices);

  function render() {
    if (!quiz.keys[version]) quiz.keys[version] = blankKey(quiz.numQuestions);
    const key = quiz.keys[version];
    const filled = key.filter(Boolean).length;
    el.innerHTML = `
      ${
        quiz.versions > 1
          ? `<div class="seg">${VERSIONS.slice(0, quiz.versions)
              .split('')
              .map((v) => `<button class="${v === version ? 'active' : ''}" data-v="${v}">Нұсқа ${v}</button>`)
              .join('')}</div>`
          : ''
      }
      <div class="toolbar">
        <span class="muted">${filled}/${quiz.numQuestions} енгізілді</span>
        <label class="check"><input type="checkbox" id="multi" ${multi ? 'checked' : ''}> Бірнеше дұрыс жауап</label>
      </div>
      <div class="key-grid">
        ${key
          .map(
            (k, q) => `<div class="key-row" data-q="${q}"><b>${q + 1}</b>${letters
              .split('')
              .map((l) => `<button class="bub ${k.includes(l) ? 'on' : ''}" data-l="${l}">${l}</button>`)
              .join('')}</div>`
          )
          .join('')}
      </div>
      <details class="panel">
        <summary>Мәтінмен енгізу</summary>
        <p class="hint">Жауаптарды қатарынан жазыңыз: <code>ABCDA…</code> немесе <code>1A 2C 3B</code>. Бос сұрақ үшін <code>-</code>, бірнеше дұрыс жауап үшін <code>(AC)</code>.</p>
        <textarea id="keytext" rows="3" placeholder="ABCDABCD…">${key.map((k) => (k.length > 1 ? `(${k})` : k || '-')).join('')}</textarea>
        <div class="row end"><button class="btn primary" id="applytext">Қолдану</button></div>
      </details>
      <div class="row">
        <a class="btn" href="#/scan/${quiz.id}?mode=key&v=${version}">📷 Кілтті парақтан сканерлеу</a>
        <button class="btn danger-ghost" id="clearkey">Кілтті тазарту</button>
      </div>`;
  }
  render();

  el.addEventListener('click', (e) => {
    const vb = e.target.closest('[data-v]');
    if (vb) {
      version = vb.dataset.v;
      return render();
    }
    const b = e.target.closest('.bub');
    if (b) {
      const q = +b.closest('[data-q]').dataset.q;
      const l = b.dataset.l;
      const key = quiz.keys[version];
      const cur = key[q] || '';
      if (multi) key[q] = cur.includes(l) ? cur.replace(l, '') : [...cur + l].sort().join('');
      else key[q] = cur === l ? '' : l;
      save();
      const row = b.closest('.key-row');
      row.querySelectorAll('.bub').forEach((x) => x.classList.toggle('on', key[q].includes(x.dataset.l)));
      el.querySelector('.toolbar .muted').textContent = `${key.filter(Boolean).length}/${quiz.numQuestions} енгізілді`;
      // jump focus to the next question on mobile
      if (!multi && key[q]) row.nextElementSibling?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    if (e.target.id === 'applytext') {
      quiz.keys[version] = parseKeyText(el.querySelector('#keytext').value, quiz.numQuestions, quiz.numChoices);
      save();
      toast('Кілт жаңартылды');
      render();
    }
    if (e.target.id === 'clearkey' && confirm('Осы нұсқаның кілтін толығымен тазарту керек пе?')) {
      quiz.keys[version] = blankKey(quiz.numQuestions);
      save();
      render();
    }
  });
  el.addEventListener('change', (e) => {
    if (e.target.id === 'multi') multi = e.target.checked;
  });
}

function paperRows(quiz) {
  return quizPapers(quiz.id)
    .map((p) => {
      const st = findStudent(quiz, p.studentId);
      return { p, st, g: gradePaper(quiz, p), name: st?.name || '' };
    })
    .sort((a, b) => (a.name || '￿' + a.p.studentId).localeCompare(b.name || '￿' + b.p.studentId, 'kk'));
}

function resultsTab(el, quiz) {
  const rows = paperRows(quiz);
  const st = quizStats(quiz, rows.map((r) => r.p));
  const cls = getClass(quiz.classId);
  const missing = cls ? cls.students.filter((s) => !rows.some((r) => r.st?.id === s.id)) : [];
  if (!keyFor(quiz, 'A').some(Boolean)) {
    el.innerHTML = emptyBox('Алдымен жауап кілтін енгізіңіз.', `<a class="btn primary" href="#/quiz/${quiz.id}/key">Кілтті енгізу</a>`);
    return;
  }
  if (!rows.length) {
    el.innerHTML = emptyBox(
      'Әлі парақ сканерленбеген.',
      `<a class="btn primary" href="#/scan/${quiz.id}">📷 Сканерлеуді бастау</a> <a class="btn" href="#/sheets?quiz=${quiz.id}">🖨 Парақтарды басу</a>`
    );
    return;
  }
  el.innerHTML = `
    <div class="stats">
      <div><b>${st.count}</b><small>парақ</small></div>
      <div><b>${pct(st.avg)}</b><small>орташа</small></div>
      <div><b>${pct(st.max)}</b><small>ең жоғары</small></div>
      <div><b>${pct(st.min)}</b><small>ең төмен</small></div>
    </div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Оқушы</th><th>ID</th>${quiz.versions > 1 ? '<th>Нұсқа</th>' : ''}<th>Ұпай</th><th>%</th><th>Баға</th></tr></thead>
      <tbody>${rows
        .map(
          ({ p, st, g }) => `<tr data-href="#/paper/${p.id}">
            <td>${st ? esc(st.name) : '<span class="warn">Белгісіз</span>'}</td>
            <td class="mono">${esc(p.studentId) || '–'}</td>
            ${quiz.versions > 1 ? `<td>${p.version}</td>` : ''}
            <td>${g.correct}/${g.total}</td><td>${pct(g.percent)}</td>
            <td><span class="mark m${g.mark}">${g.mark}</span></td></tr>`
        )
        .join('')}</tbody>
    </table></div>
    ${
      missing.length
        ? `<details class="panel"><summary>Тапсырмағандар (${missing.length})</summary><p>${missing.map((s) => esc(s.name)).join(', ')}</p></details>`
        : ''
    }
    <div class="row">
      <button class="btn" id="csv">⬇ CSV (Excel)</button>
      <a class="btn" href="#/paper/new?quiz=${quiz.id}" id="manual">+ Қолмен қосу</a>
    </div>`;
  el.querySelector('tbody').onclick = (e) => {
    const tr = e.target.closest('tr[data-href]');
    if (tr) location.hash = tr.dataset.href;
  };
  el.querySelector('#manual').onclick = (e) => {
    e.preventDefault();
    const p = { id: uid(), quizId: quiz.id, studentId: '', version: 'A', answers: blankKey(quiz.numQuestions), scannedAt: new Date().toISOString() };
    db().papers.push(p);
    save();
    location.hash = `#/paper/${p.id}`;
  };
  el.querySelector('#csv').onclick = () => {
    const head = ['Аты-жөні', 'ID', 'Сынып', 'Нұсқа', 'Дұрыс', 'Барлығы', 'Пайыз', 'Баға'];
    for (let i = 1; i <= quiz.numQuestions; i++) head.push('С' + i);
    const data = rows.map(({ p, st, g }) => [
      st?.name || '',
      p.studentId,
      st?.className || '',
      p.version,
      g.correct,
      g.total,
      Math.round(g.percent * 10) / 10,
      g.mark,
      ...p.answers.map((a) => a || '-'),
    ]);
    const keyRows = VERSIONS.slice(0, quiz.versions)
      .split('')
      .map((v) => [`Кілт ${v}`, '', '', v, '', '', '', '', ...keyFor(quiz, v).map((k) => k || '-')]);
    download(`${quiz.name.replace(/[\\/:*?"<>|]/g, '_')}.csv`, toCSV([head, ...data, [], ...keyRows]), 'text/csv;charset=utf-8');
  };
}

function analysisTab(el, quiz) {
  const papers = quizPapers(quiz.id);
  if (!papers.length) {
    el.innerHTML = emptyBox('Талдау үшін алдымен парақтарды сканерлеңіз.');
    return;
  }
  const items = itemAnalysis(quiz, papers);
  const marks = { 5: 0, 4: 0, 3: 0, 2: 0 };
  for (const p of papers) marks[gradePaper(quiz, p).mark]++;
  const maxM = Math.max(...Object.values(marks), 1);
  const letters = LETTERS.slice(0, quiz.numChoices).split('');
  const keyA = keyFor(quiz, 'A');
  el.innerHTML = `
    <section class="panel">
      <h3>Бағалар бөлінісі</h3>
      <div class="hist">${[5, 4, 3, 2]
        .map(
          (m) => `<div class="hist-row"><span class="mark m${m}">${m}</span><div class="bar"><i style="width:${(marks[m] / maxM) * 100}%"></i></div><b>${marks[m]}</b><small>${pct(
            (marks[m] / papers.length) * 100
          )}</small></div>`
        )
        .join('')}</div>
    </section>
    <section class="panel">
      <h3>Сұрақтар бойынша талдау</h3>
      <p class="hint">Дұрыс жауап берген оқушылар үлесі. Қызыл — 40%-дан төмен (қиын сұрақ).${quiz.versions > 1 ? ' Жауап таңдаулары нұсқа A кілтімен белгіленген.' : ''}</p>
      <div class="table-wrap"><table class="table item">
        <thead><tr><th>№</th><th>Дұрыс</th>${letters.map((l) => `<th>${l}</th>`).join('')}<th>Бос</th><th>Көп</th></tr></thead>
        <tbody>${items
          .map(
            (r) => `<tr class="${r.pct != null && r.pct < 40 ? 'hard' : ''}">
              <td><b>${r.q + 1}</b></td>
              <td class="pbar"><div class="bar"><i style="width:${r.pct ?? 0}%"></i></div><span>${pct(r.pct)}</span></td>
              ${letters.map((l) => `<td class="${(keyA[r.q] || '').includes(l) ? 'keycell' : ''}">${r.counts[l]}</td>`).join('')}
              <td>${r.counts.blank}</td><td>${r.counts.multi}</td></tr>`
          )
          .join('')}</tbody>
      </table></div>
    </section>`;
}

function quizSettingsTab(el, quiz) {
  el.innerHTML = `
    <div class="list">
      <a class="list-item" href="#/quiz/${quiz.id}/edit">✏️ Тест параметрлерін өзгерту</a>
      <a class="list-item" href="#/sheets?quiz=${quiz.id}">🖨 Жауап парақтарын басып шығару</a>
      <button class="list-item" id="dup">📄 Тестті көшіру (кілтімен)</button>
      <button class="list-item danger" id="delpapers">🗑 Барлық сканерленген парақтарды жою</button>
      <button class="list-item danger" id="delquiz">🗑 Тестті жою</button>
    </div>`;
  el.querySelector('#dup').onclick = () => {
    const copy = { ...structuredClone(quiz), id: uid(), name: quiz.name + ' (көшірме)', createdAt: new Date().toISOString(), date: today() };
    db().quizzes.push(copy);
    save();
    location.hash = `#/quiz/${copy.id}/key`;
  };
  el.querySelector('#delpapers').onclick = () => {
    if (!confirm('Осы тесттің барлық нәтижелерін жою керек пе?')) return;
    const s = db();
    s.papers = s.papers.filter((p) => p.quizId !== quiz.id);
    save();
    toast('Жойылды');
  };
  el.querySelector('#delquiz').onclick = () => {
    if (!confirm(`«${quiz.name}» тесті және оның барлық нәтижелері жойылады. Жалғастыру керек пе?`)) return;
    const s = db();
    s.quizzes = s.quizzes.filter((q) => q.id !== quiz.id);
    s.papers = s.papers.filter((p) => p.quizId !== quiz.id);
    save();
    location.hash = '#/';
  };
}

// ---------- single paper ----------

function paperView(root, id) {
  const paper = getPaper(id);
  const quiz = paper && getQuiz(paper.quizId);
  if (!quiz) return void (location.hash = '#/');
  const letters = LETTERS.slice(0, quiz.numChoices).split('');
  const cls = getClass(quiz.classId);
  const students = (cls ? [cls] : db().classes).flatMap((c) => c.students);

  function render() {
    const g = gradePaper(quiz, paper);
    const st = findStudent(quiz, paper.studentId);
    const key = keyFor(quiz, paper.version);
    root.innerHTML = `
      ${header(st ? esc(st.name) : 'Парақ', { back: `#/quiz/${quiz.id}/results` })}
      <main>
        <div class="stats">
          <div><b>${g.correct}/${g.total}</b><small>ұпай</small></div>
          <div><b>${pct(g.percent)}</b><small>пайыз</small></div>
          <div><b class="mark m${g.mark}">${g.mark}</b><small>баға</small></div>
        </div>
        <div class="form inline">
          <label>Оқушы ID<input id="sid" inputmode="numeric" maxlength="${SHEET.idDigits}" value="${esc(paper.studentId)}"></label>
          ${
            students.length
              ? `<label>немесе тізімнен<select id="spick"><option value="">—</option>${students
                  .map((s) => `<option value="${esc(s.code)}" ${st?.id === s.id ? 'selected' : ''}>${esc(s.name)} (${esc(s.code)})</option>`)
                  .join('')}</select></label>`
              : ''
          }
          ${
            quiz.versions > 1
              ? `<label>Нұсқа<select id="ver">${VERSIONS.slice(0, quiz.versions)
                  .split('')
                  .map((v) => `<option ${v === paper.version ? 'selected' : ''}>${v}</option>`)
                  .join('')}</select></label>`
              : ''
          }
        </div>
        <p class="hint">Жауапты түзету үшін әріпті басыңыз. <span class="legend"><i class="g"></i>дұрыс <i class="r"></i>қате <i class="y"></i>кілт</span></p>
        <div class="key-grid paper">
          ${paper.answers
            .map((a, q) => {
              const s = g.status[q];
              return `<div class="key-row ${s}" data-q="${q}"><b>${q + 1}</b>${letters
                .map((l) => {
                  const on = a.includes(l);
                  const isKey = (key[q] || '').includes(l);
                  const cls = on ? (s === 'correct' ? 'on ok' : 'on bad') : isKey ? 'key' : '';
                  return `<button class="bub ${cls}" data-l="${l}">${l}</button>`;
                })
                .join('')}</div>`;
            })
            .join('')}
        </div>
        <div class="row">
          <span class="muted">Сканерленді: ${fmtDate(paper.scannedAt)}</span>
          <button class="btn danger-ghost" id="del">🗑 Парақты жою</button>
        </div>
      </main>`;
  }
  render();

  root.onclick = (e) => {
    const b = e.target.closest('.bub');
    if (b) {
      const q = +b.closest('[data-q]').dataset.q;
      const l = b.dataset.l;
      const cur = paper.answers[q] || '';
      paper.answers[q] = cur.includes(l) ? cur.replace(l, '') : [...cur + l].sort().join('');
      save();
      const y = window.scrollY;
      render();
      window.scrollTo(0, y);
    }
    if (e.target.id === 'del' && confirm('Бұл парақты жою керек пе?')) {
      db().papers = db().papers.filter((p) => p.id !== paper.id);
      save();
      location.hash = `#/quiz/${quiz.id}/results`;
    }
  };
  root.onchange = (e) => {
    if (e.target.id === 'sid' || e.target.id === 'spick') {
      paper.studentId = e.target.value.replace(/\D/g, '').slice(0, SHEET.idDigits);
    }
    if (e.target.id === 'ver') paper.version = e.target.value;
    save();
    render();
  };
  return () => {
    root.onclick = null;
    root.onchange = null;
  };
}

// ---------- classes ----------

function classesView(root) {
  const { classes } = db();
  root.innerHTML = `
    ${header('Сыныптар', { actions: `<button class="btn primary" id="add">+ Жаңа сынып</button>` })}
    <main>
      ${
        classes.length
          ? `<div class="cards">${classes
              .map(
                (c) => `<a class="card" href="#/class/${c.id}">
                  <div class="card-main"><div class="card-title">${esc(c.name)}</div></div>
                  <div class="card-stat"><b>${c.students.length}</b><small>оқушы</small></div></a>`
              )
              .join('')}</div>`
          : emptyBox('Сынып құрып, оқушыларды ID нөмірімен қосыңыз. Сонда сканерлегенде нәтиже оқушы атымен шығады.')
      }
    </main>`;
  root.querySelector('#add').onclick = () => {
    const name = prompt('Сынып атауы (мысалы: 9 «А»)');
    if (!name?.trim()) return;
    const c = { id: uid(), name: name.trim(), students: [] };
    db().classes.push(c);
    save();
    location.hash = `#/class/${c.id}`;
  };
}

function nextCode(cls) {
  const all = db().classes.flatMap((c) => c.students.map((s) => parseInt(s.code, 10) || 0));
  const max = Math.max(1000, ...all);
  return String(max + 1);
}

function classView(root, id) {
  const cls = getClass(id);
  if (!cls) return void (location.hash = '#/classes');

  function codeTaken(code, exceptId) {
    const n = code.replace(/^0+(?=\d)/, '');
    return db().classes.some((c) => c.students.some((s) => s.id !== exceptId && s.code.replace(/^0+(?=\d)/, '') === n));
  }

  function render() {
    const list = [...cls.students].sort((a, b) => a.name.localeCompare(b.name, 'kk'));
    root.innerHTML = `
      ${header(esc(cls.name), {
        back: '#/classes',
        actions: `<a class="btn" href="#/sheets?class=${cls.id}">🖨<span class="hide-sm"> Атаулы парақтар</span></a>`,
      })}
      <main>
        <form class="form inline" id="addf">
          <label class="grow">Аты-жөні<input name="name" required placeholder="Әлиев Нұрлан"></label>
          <label>ID<input name="code" required inputmode="numeric" pattern="\\d{1,${SHEET.idDigits}}" maxlength="${SHEET.idDigits}" value="${nextCode(cls)}"></label>
          <button class="btn primary" type="submit">Қосу</button>
        </form>
        ${
          list.length
            ? `<div class="table-wrap"><table class="table">
                <thead><tr><th>Аты-жөні</th><th>ID</th><th></th></tr></thead>
                <tbody>${list
                  .map(
                    (s) => `<tr data-id="${s.id}"><td>${esc(s.name)}</td><td class="mono">${esc(s.code)}</td>
                      <td class="nowrap"><button class="icon" data-act="edit" title="Өңдеу">✏️</button><button class="icon" data-act="del" title="Жою">🗑</button></td></tr>`
                  )
                  .join('')}</tbody></table></div>`
            : emptyBox('Сыныпта оқушы жоқ.')
        }
        <details class="panel">
          <summary>Тізімді жаппай қосу</summary>
          <p class="hint">Әр жолға бір оқушы: <code>Аты-жөні, ID</code>. ID жазылмаса, автоматты түрде беріледі. Excel-ден екі бағанды көшіріп қоюға болады.</p>
          <textarea id="bulk" rows="6" placeholder="Әлиев Нұрлан, 1001&#10;Серікова Айгерім, 1002"></textarea>
          <div class="row end"><button class="btn primary" id="import">Қосу</button></div>
        </details>
        <div class="row">
          <button class="btn" id="rename">Атауын өзгерту</button>
          <button class="btn danger-ghost" id="delcls">Сыныпты жою</button>
        </div>
      </main>`;
  }
  render();

  root.onsubmit = (e) => {
    if (e.target.id !== 'addf') return;
    e.preventDefault();
    const f = e.target;
    const code = f.code.value.trim();
    if (codeTaken(code)) return alert(`ID ${code} бос емес — басқа нөмір таңдаңыз.`);
    cls.students.push({ id: uid(), name: f.name.value.trim(), code });
    save();
    render();
    root.querySelector('#addf [name=name]').focus();
  };
  root.onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const sid = e.target.closest('tr[data-id]')?.dataset.id;
    const st = cls.students.find((s) => s.id === sid);
    if (act === 'del' && st && confirm(`${st.name} тізімнен жойылсын ба?`)) {
      cls.students = cls.students.filter((s) => s !== st);
      save();
      render();
    }
    if (act === 'edit' && st) {
      const name = prompt('Аты-жөні', st.name);
      if (name == null) return;
      const code = prompt('ID (тек сандар)', st.code);
      if (code == null) return;
      const c = code.replace(/\D/g, '').slice(0, SHEET.idDigits);
      if (!c) return alert('ID бос болмауы керек');
      if (codeTaken(c, st.id)) return alert(`ID ${c} бос емес.`);
      st.name = name.trim() || st.name;
      st.code = c;
      save();
      render();
    }
    if (e.target.id === 'import') {
      const lines = root.querySelector('#bulk').value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      let added = 0;
      const skipped = [];
      for (const line of lines) {
        const parts = line.split(/\t|;|,/).map((s) => s.trim()).filter(Boolean);
        let code = parts.find((p) => /^\d{1,6}$/.test(p));
        const name = parts.filter((p) => p !== code).join(' ');
        if (!name) continue;
        if (!code) code = nextCode(cls);
        if (codeTaken(code)) {
          skipped.push(`${name} (${code})`);
          continue;
        }
        cls.students.push({ id: uid(), name, code });
        added++;
      }
      save();
      render();
      toast(`${added} оқушы қосылды`);
      if (skipped.length) alert('ID қайталанғандықтан өткізіліп кетті:\n' + skipped.join('\n'));
    }
    if (e.target.id === 'rename') {
      const name = prompt('Сынып атауы', cls.name);
      if (name?.trim()) {
        cls.name = name.trim();
        save();
        render();
      }
    }
    if (e.target.id === 'delcls' && confirm(`«${cls.name}» сыныбы жойылсын ба? (Тест нәтижелері сақталады)`)) {
      const s = db();
      s.classes = s.classes.filter((c) => c !== cls);
      s.quizzes.forEach((q) => q.classId === cls.id && (q.classId = ''));
      save();
      location.hash = '#/classes';
    }
  };
  return () => {
    root.onclick = null;
    root.onsubmit = null;
  };
}

// ---------- printable sheets ----------

function sheetsView(root, query) {
  const { quizzes, classes } = db();
  const quiz = getQuiz(query.get('quiz'));
  const o = {
    quizId: quiz?.id || '',
    numQuestions: quiz?.numQuestions || 20,
    numChoices: quiz?.numChoices || 5,
    versions: quiz?.versions || 1,
    classId: query.get('class') || '',
    copies: 1,
  };

  root.innerHTML = `
    ${header('Жауап парақтары', quiz ? { back: `#/quiz/${quiz.id}` } : {})}
    <main class="sheets">
      <form class="form" id="sf">
        <label>Тест
          <select name="quizId"><option value="">— Жалпы парақ (тестсіз) —</option>
            ${quizzes.map((q) => `<option value="${q.id}" ${q.id === o.quizId ? 'selected' : ''}>${esc(q.name)}</option>`).join('')}
          </select>
        </label>
        <div class="grid2">
          <label>Сұрақ саны<input name="numQuestions" type="number" min="1" max="100" value="${o.numQuestions}"></label>
          <label>Жауаптар<select name="numChoices"><option value="4">A–D</option><option value="5">A–E</option></select></label>
          <label>Нұсқалар<select name="versions">${[1, 2, 3, 4].map((n) => `<option>${n}</option>`).join('')}</select></label>
          <label>Көшірме саны<input name="copies" type="number" min="1" max="200" value="${o.copies}"></label>
        </div>
        <label>Оқушылардың аты мен ID-і басылған парақтар
          <select name="classId"><option value="">— Жоқ (бос парақ) —</option>
            ${classes.map((c) => `<option value="${c.id}">${esc(c.name)} (${c.students.length})</option>`).join('')}
          </select>
        </label>
        <p class="hint">A4 қағазына 100% масштабпен басыңыз («Беттерге сыйдыру» өшірулі болсын). Сканер бұрыштардағы 4 қара шаршы мен жоғарғы сол жақтағы жолақ бойынша парақты табады.</p>
        <button class="btn primary big" type="submit">🖨 Басып шығару</button>
      </form>
      <div class="preview" id="preview"></div>
    </main>`;

  const f = root.querySelector('#sf');
  f.numChoices.value = o.numChoices;
  f.versions.value = o.versions;
  f.classId.value = o.classId;
  const preview = root.querySelector('#preview');

  function opts() {
    const q = getQuiz(f.quizId.value);
    const cls = getClass(f.classId.value);
    return {
      q,
      cls,
      base: {
        numQuestions: Math.max(1, Math.min(100, +f.numQuestions.value || 20)),
        numChoices: +f.numChoices.value,
        versions: +f.versions.value,
        quizName: q?.name || '',
        className: cls?.name || '',
      },
      copies: Math.max(1, Math.min(200, +f.copies.value || 1)),
    };
  }
  function update() {
    const { base, cls } = opts();
    const first = cls?.students[0];
    preview.innerHTML = sheetSVG(first ? { ...base, studentName: first.name, studentId: first.code } : base);
    f.copies.closest('label').hidden = !!cls;
  }
  f.quizId.onchange = () => {
    const q = getQuiz(f.quizId.value);
    if (q) {
      f.numQuestions.value = q.numQuestions;
      f.numChoices.value = q.numChoices;
      f.versions.value = q.versions;
      if (q.classId && !f.classId.value) f.classId.value = q.classId;
    }
    f.numQuestions.disabled = f.numChoices.disabled = f.versions.disabled = !!q;
    update();
  };
  f.oninput = update;
  f.onsubmit = (e) => {
    e.preventDefault();
    const { base, cls, copies } = opts();
    const svgs = cls
      ? [...cls.students].sort((a, b) => a.name.localeCompare(b.name, 'kk')).map((s) => sheetSVG({ ...base, studentName: s.name, studentId: s.code }))
      : Array.from({ length: copies }, () => sheetSVG(base));
    if (!svgs.length) return alert('Сыныпта оқушы жоқ');
    printSheets(svgs);
  };
  f.quizId.onchange();
}

// ---------- settings ----------

function settingsView(root) {
  const s = db().settings;
  root.innerHTML = `
    ${header('Баптаулар')}
    <main>
      <section class="panel">
        <h3>Бағалау шкаласы</h3>
        <form class="form" id="gf">
          <div class="grid3">
            <label>«5» — кемінде, %<input name="grade5" type="number" min="0" max="100" value="${s.grade5}"></label>
            <label>«4» — кемінде, %<input name="grade4" type="number" min="0" max="100" value="${s.grade4}"></label>
            <label>«3» — кемінде, %<input name="grade3" type="number" min="0" max="100" value="${s.grade3}"></label>
          </div>
          <div class="row end"><button class="btn primary">Сақтау</button></div>
        </form>
      </section>
      <section class="panel">
        <h3>Деректер</h3>
        <p class="hint">Барлық деректер тек осы құрылғыдағы браузерде сақталады. Басқа құрылғыға көшіру немесе сақтық көшірме жасау үшін файлға экспорттаңыз.</p>
        <div class="row">
          <button class="btn" id="exp">⬇ Сақтық көшірме (JSON)</button>
          <label class="btn">⬆ Көшірмеден қалпына келтіру<input type="file" id="imp" accept="application/json,.json" hidden></label>
          <button class="btn danger-ghost" id="wipe">Барлығын жою</button>
        </div>
      </section>
      <section class="panel">
        <h3>Қалай пайдалану керек</h3>
        <ol class="howto">
          <li><b>Сынып</b> құрып, оқушыларды ID нөмірімен қосыңыз (міндетті емес).</li>
          <li><b>Тест</b> құрып, жауап кілтін енгізіңіз.</li>
          <li><b>Жауап парақтарын</b> A4-ке басып шығарып, оқушыларға таратыңыз.</li>
          <li>Оқушылар ID нөмірін және жауаптарын дөңгелектерді толық бояу арқылы белгілейді.</li>
          <li>«📷 Сканерлеу» батырмасын басып, телефон камерасын параққа бағыттаңыз — баға бірден шығады.</li>
          <li>Нәтижелер мен сұрақтар талдауын қараңыз, CSV арқылы Excel-ге жүктеп алыңыз.</li>
        </ol>
      </section>
    </main>`;
  root.querySelector('#gf').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    const g5 = +f.grade5.value, g4 = +f.grade4.value, g3 = +f.grade3.value;
    if (!(g5 > g4 && g4 > g3)) return alert('Шекаралар кему ретімен болуы керек: «5» > «4» > «3»');
    Object.assign(s, { grade5: g5, grade4: g4, grade3: g3 });
    save();
    toast('Сақталды');
  };
  root.querySelector('#exp').onclick = () => download(`zipgrade-backup-${today()}.json`, JSON.stringify(db(), null, 1), 'application/json');
  root.querySelector('#imp').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.quizzes) || !Array.isArray(data.classes)) throw new Error('файл форматы дұрыс емес');
      if (!confirm('Қазіргі деректер файлдағы деректермен ауыстырылады. Жалғастыру керек пе?')) return;
      replaceState(data);
      toast('Қалпына келтірілді');
      location.hash = '#/';
    } catch (err) {
      alert('Қате: ' + err.message);
    }
  };
  root.querySelector('#wipe').onclick = () => {
    if (!confirm('Барлық тесттер, сыныптар мен нәтижелер жойылады. Сенімдісіз бе?')) return;
    resetState();
    location.hash = '#/';
  };
}

route();
