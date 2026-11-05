import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { sql, run, rows } from './db.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const wrap = (f) => (req, res, next) => f(req, res).catch(next);
const isDup = (e) => e?.number === 2601 || e?.number === 2627;
const message = (p) => p >= 90 ? 'Outstanding! You have a strong grasp of these concepts.'
  : p >= 70 ? 'Solid work! Review the missed questions to close the gaps.'
  : p >= 50 ? 'Getting there. Revisit the explanations and try again.'
  : 'Keep practicing: review the explanations and retake the quiz.';

export const app = express();
app.use(express.json({ limit: '10kb' }));

// Anonymous identity: client-generated id sent in a header (no auth in scope).
app.use('/api', (req, _res, next) => {
  const u = req.get('x-user-id');
  if (!u || !/^[A-Za-z0-9-]{8,64}$/.test(u)) return next(new HttpError(400, 'Missing or invalid X-User-Id header.'));
  req.userId = u; next();
});

async function owned(req) {
  if (!UUID.test(req.params.id)) throw new HttpError(404, 'Attempt not found.');
  const [a] = await rows('SELECT * FROM Attempts WHERE id=@id AND user_id=@u', { id: [sql.UniqueIdentifier, req.params.id], u: [sql.NVarChar, req.userId] });
  if (!a) throw new HttpError(404, 'Attempt not found.');
  return a;
}

// Full attempt state. Correct answers are revealed ONLY for questions already answered.
async function state(att) {
  const [quiz] = await rows('SELECT id,title FROM Quizzes WHERE id=@q', { q: [sql.Int, att.quiz_id] });
  const qs = await rows('SELECT id,text,options,correct_index,explanation FROM Questions WHERE quiz_id=@q ORDER BY position', { q: [sql.Int, att.quiz_id] });
  const ans = await rows('SELECT question_id,selected_index,is_correct FROM AttemptAnswers WHERE attempt_id=@a', { a: [sql.UniqueIdentifier, att.id] });
  const byId = Object.fromEntries(qs.map((q) => [q.id, q]));
  const answers = {};
  for (const a of ans) {
    const q = byId[a.question_id];
    answers[q.id] = { questionId: q.id, selectedIndex: a.selected_index, isCorrect: !!a.is_correct, correctIndex: q.correct_index, explanation: q.explanation };
  }
  const out = { attemptId: att.id, quiz, status: att.status, answers,
    questions: qs.map((q) => ({ id: q.id, text: q.text, options: JSON.parse(q.options) })) };
  if (att.status === 'completed') {
    const pct = Math.round((att.score * 100) / att.total);
    out.result = { score: att.score, total: att.total, percentage: pct, message: message(pct), completedAt: att.completed_at,
      missed: qs.filter((q) => answers[q.id] && !answers[q.id].isCorrect)
        .map((q) => ({ questionId: q.id, text: q.text, options: JSON.parse(q.options), ...answers[q.id] })) };
  }
  return out;
}

app.get('/api/quizzes', wrap(async (req, res) => {
  const p = { u: [sql.NVarChar, req.userId] };
  res.json(await rows(`SELECT z.id,z.slug,z.title,z.category,z.description,
    (SELECT COUNT(*) FROM Questions WHERE quiz_id=z.id) AS questionCount,
    (SELECT TOP 1 id FROM Attempts WHERE quiz_id=z.id AND user_id=@u AND status='in_progress') AS openAttemptId,
    (SELECT MAX(score*100.0/NULLIF(total,0)) FROM Attempts WHERE quiz_id=z.id AND user_id=@u AND status='completed') AS bestPct
    FROM Quizzes z ORDER BY z.category, z.title`, p));
}));

// Start (or resume) an attempt. The unique filtered index guarantees one open attempt per user+quiz.
app.post('/api/quizzes/:id/attempts', wrap(async (req, res) => {
  const quizId = Number(req.params.id);
  if (!Number.isInteger(quizId)) throw new HttpError(400, 'Invalid quiz id.');
  const [quiz] = await rows('SELECT id FROM Quizzes WHERE id=@q', { q: [sql.Int, quizId] });
  if (!quiz) throw new HttpError(404, 'Quiz not found.');
  const p = { q: [sql.Int, quizId], u: [sql.NVarChar, req.userId] };
  const findOpen = () => rows("SELECT * FROM Attempts WHERE quiz_id=@q AND user_id=@u AND status='in_progress'", p);
  let [att] = await findOpen(), created = false;
  if (!att) {
    try {
      [att] = await rows('INSERT INTO Attempts(user_id,quiz_id) OUTPUT inserted.* VALUES(@u,@q)', p); created = true;
    } catch (e) { if (!isDup(e)) throw e; [att] = await findOpen(); }
  }
  res.status(created ? 201 : 200).json(await state(att));
}));

app.get('/api/attempts/:id', wrap(async (req, res) => res.json(await state(await owned(req)))));

// Idempotent: first answer per question wins; repeats/double-clicks return the stored verdict.
app.post('/api/attempts/:id/answers', wrap(async (req, res) => {
  const att = await owned(req);
  const { questionId, selectedIndex } = req.body || {};
  if (!Number.isInteger(questionId) || !Number.isInteger(selectedIndex)) throw new HttpError(400, 'questionId and selectedIndex must be integers.');
  const [q] = await rows('SELECT id,options,correct_index,explanation FROM Questions WHERE id=@q AND quiz_id=@z', { q: [sql.Int, questionId], z: [sql.Int, att.quiz_id] });
  if (!q) throw new HttpError(404, 'Question not found in this quiz.');
  if (selectedIndex < 0 || selectedIndex >= JSON.parse(q.options).length) throw new HttpError(400, 'selectedIndex out of range.');
  const read = () => rows('SELECT selected_index,is_correct FROM AttemptAnswers WHERE attempt_id=@a AND question_id=@q', { a: [sql.UniqueIdentifier, att.id], q: [sql.Int, q.id] });
  let inserted = 0;
  try {
    const r = await run(`INSERT INTO AttemptAnswers(attempt_id,question_id,selected_index,is_correct)
      SELECT @a,@q,@s,@c WHERE EXISTS(SELECT 1 FROM Attempts WHERE id=@a AND status='in_progress')`,
      { a: [sql.UniqueIdentifier, att.id], q: [sql.Int, q.id], s: [sql.Int, selectedIndex], c: [sql.Bit, selectedIndex === q.correct_index] });
    inserted = r.rowsAffected[0];
  } catch (e) { if (!isDup(e)) throw e; }
  const [stored] = await read();
  if (!stored) throw new HttpError(409, 'This attempt is already completed.');
  res.status(inserted ? 201 : 200).json({ questionId: q.id, selectedIndex: stored.selected_index, isCorrect: !!stored.is_correct, correctIndex: q.correct_index, explanation: q.explanation });
}));

// Idempotent: the score is computed from stored answers; only the first call transitions the status.
app.post('/api/attempts/:id/complete', wrap(async (req, res) => {
  let att = await owned(req);
  if (att.status === 'in_progress') {
    const [c] = await rows(`SELECT (SELECT COUNT(*) FROM Questions WHERE quiz_id=@z) total,
      (SELECT COUNT(*) FROM AttemptAnswers WHERE attempt_id=@a) answered,
      (SELECT COALESCE(SUM(CAST(is_correct AS INT)),0) FROM AttemptAnswers WHERE attempt_id=@a) score`,
      { z: [sql.Int, att.quiz_id], a: [sql.UniqueIdentifier, att.id] });
    if (c.answered < c.total) throw new HttpError(409, `Answer all questions first (${c.answered}/${c.total}).`);
    await run(`UPDATE Attempts SET status='completed', completed_at=SYSUTCDATETIME(), score=@s, total=@t WHERE id=@a AND status='in_progress'`,
      { s: [sql.Int, c.score], t: [sql.Int, c.total], a: [sql.UniqueIdentifier, att.id] });
    [att] = await rows('SELECT * FROM Attempts WHERE id=@a', { a: [sql.UniqueIdentifier, att.id] });
  }
  res.json(await state(att));
}));

app.get('/api/progress', wrap(async (req, res) => {
  const history = await rows(`SELECT a.id, a.quiz_id AS quizId, z.title AS quizTitle, a.score, a.total,
    CAST(ROUND(a.score*100.0/a.total,0) AS INT) AS percentage, a.completed_at AS completedAt
    FROM Attempts a JOIN Quizzes z ON z.id=a.quiz_id WHERE a.user_id=@u AND a.status='completed'
    ORDER BY a.completed_at ASC`, { u: [sql.NVarChar, req.userId] });
  const pcts = history.map((h) => h.percentage);
  res.json({ stats: { attempts: pcts.length, avgPct: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0, bestPct: pcts.length ? Math.max(...pcts) : 0 }, history });
}));

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found.')));
app.use((err, _req, res, _next) => {
  if (!(err instanceof HttpError)) console.error(err);
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  res.status(status).json({ error: status === 500 ? 'Internal server error.' : err.message });
});

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (fs.existsSync(dist)) { app.use(express.static(dist)); app.get('*', (_q, r) => r.sendFile(path.join(dist, 'index.html'))); }
