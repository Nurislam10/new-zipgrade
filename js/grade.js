import { db } from './store.js';

export function keyFor(quiz, version) {
  return quiz.keys[version] || quiz.keys.A || [];
}

/**
 * Grade a paper. Key entries are strings of accepted letters ('' = not graded).
 * A student answer is correct when exactly one bubble is marked and it is accepted.
 */
export function gradePaper(quiz, paper) {
  const key = keyFor(quiz, paper.version);
  const status = [];
  let correct = 0;
  let total = 0;
  for (let q = 0; q < quiz.numQuestions; q++) {
    const k = key[q] || '';
    const a = paper.answers[q] || '';
    if (!k) {
      status.push('skip');
      continue;
    }
    total++;
    if (!a) status.push('blank');
    else if (a.length > 1) status.push('multi');
    else if (k.includes(a)) {
      status.push('correct');
      correct++;
    } else status.push('wrong');
  }
  const percent = total ? (correct / total) * 100 : 0;
  return { correct, total, percent, mark: mark5(percent), status };
}

/** Kazakhstan 5-point school mark from percent. */
export function mark5(percent) {
  const s = db().settings;
  if (percent >= s.grade5) return 5;
  if (percent >= s.grade4) return 4;
  if (percent >= s.grade3) return 3;
  return 2;
}

export function quizStats(quiz, papers) {
  if (!papers.length) return null;
  const pct = papers.map((p) => gradePaper(quiz, p).percent);
  return {
    count: pct.length,
    avg: pct.reduce((s, v) => s + v, 0) / pct.length,
    max: Math.max(...pct),
    min: Math.min(...pct),
  };
}

/** Per-question statistics for item analysis. */
export function itemAnalysis(quiz, papers) {
  const rows = [];
  for (let q = 0; q < quiz.numQuestions; q++) {
    const counts = { blank: 0, multi: 0 };
    for (const l of 'ABCDE'.slice(0, quiz.numChoices)) counts[l] = 0;
    let correct = 0;
    let graded = 0;
    for (const p of papers) {
      const a = p.answers[q] || '';
      if (!a) counts.blank++;
      else if (a.length > 1) counts.multi++;
      else counts[a] = (counts[a] || 0) + 1;
      const k = keyFor(quiz, p.version)[q] || '';
      if (k) {
        graded++;
        if (a.length === 1 && k.includes(a)) correct++;
      }
    }
    rows.push({ q, counts, correct, graded, pct: graded ? (correct / graded) * 100 : null });
  }
  return rows;
}
