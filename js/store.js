// Persistent app state in localStorage.

const KEY = 'zipgrade-kz-v1';

const empty = () => ({
  classes: [],
  quizzes: [],
  papers: [],
  settings: { grade5: 85, grade4: 65, grade3: 40 },
});

function migrate(s) {
  const base = empty();
  return {
    ...base,
    ...s,
    settings: { ...base.settings, ...(s.settings || {}) },
  };
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s) return migrate(s);
  } catch {
    /* ignore corrupt storage */
  }
  return empty();
}

let state = load();

export const db = () => state;

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    alert('Деректерді сақтау мүмкін болмады: ' + e.message);
  }
}

export function replaceState(s) {
  state = migrate(s);
  save();
}

export function resetState() {
  state = empty();
  save();
}

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export const getQuiz = (id) => state.quizzes.find((q) => q.id === id);
export const getClass = (id) => state.classes.find((c) => c.id === id);
export const getPaper = (id) => state.papers.find((p) => p.id === id);
export const quizPapers = (quizId) => state.papers.filter((p) => p.quizId === quizId);

const normId = (s) => String(s ?? '').replace(/^0+(?=\d)/, '');

/** Find a student by sheet ID, preferring the quiz's class. */
export function findStudent(quiz, code) {
  if (!code || code.includes('?')) return null;
  const want = normId(code);
  const cls = quiz?.classId ? getClass(quiz.classId) : null;
  const pools = cls ? [cls, ...state.classes.filter((c) => c !== cls)] : state.classes;
  for (const c of pools) {
    const s = c.students.find((st) => normId(st.code) === want);
    if (s) return { ...s, className: c.name, classId: c.id };
  }
  return null;
}
