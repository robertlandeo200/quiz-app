import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

function useHash() {
  const [h, setH] = useState(location.hash || '#/');
  useEffect(() => { const f = () => setH(location.hash || '#/'); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return h;
}
function useLoad(fn, deps) {
  const [s, setS] = useState({ loading: true });
  const load = useCallback(() => { setS({ loading: true }); fn().then((data) => setS({ data }), (e) => setS({ error: e.message })); }, deps); // eslint-disable-line
  useEffect(load, [load]);
  return [s, load];
}
function Status({ s, retry, children }) {
  if (s.loading) return <p className="muted center" role="status">Loading…</p>;
  if (s.error) return <div className="card error" role="alert"><p>{s.error}</p><button onClick={retry}>Retry</button></div>;
  return children(s.data);
}
const go = (h) => { location.hash = h; };

export default function App() {
  const h = useHash();
  const m = h.match(/^#\/attempt\/([\w-]+)/);
  return (
    <>
      <header><a href="#/" className="brand">🧠 AI Dev Quiz</a><nav><a href="#/">Quizzes</a><a href="#/progress">Progress</a></nav></header>
      <main>{m ? <Attempt key={m[1]} id={m[1]} /> : h === '#/progress' ? <Progress /> : <Home />}</main>
    </>
  );
}

function Home() {
  const [s, load] = useLoad(() => api('/quizzes'), []);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const lock = useRef(false);
  async function start(q) {
    if (lock.current) return;
    lock.current = true; setBusy(q.id); setErr(null);
    try { const a = await api(`/quizzes/${q.id}/attempts`, { method: 'POST' }); go(`#/attempt/${a.attemptId}`); }
    catch (e) { setErr(e.message); } finally { lock.current = false; setBusy(null); }
  }
  return (
    <>
      <section className="hero"><h1>Test your AI software development knowledge</h1>
        <p className="muted">Pick a category, answer 5 questions, get instant feedback and track your progress over time.</p></section>
      {err && <p className="error" role="alert">{err}</p>}
      <Status s={s} retry={load}>{(quizzes) => {
        const cats = [...new Set(quizzes.map((q) => q.category))];
        return cats.map((c) => (
          <section key={c}><h2>{c}</h2><div className="grid">
            {quizzes.filter((q) => q.category === c).map((q) => (
              <article className="card" key={q.id}>
                <h3>{q.title}</h3><p className="muted">{q.description}</p>
                <p className="small">{q.questionCount} questions{q.bestPct != null && ` · best ${Math.round(q.bestPct)}%`}</p>
                <button disabled={busy === q.id} onClick={() => start(q)}>
                  {busy === q.id ? 'Starting…' : q.openAttemptId ? 'Resume' : q.bestPct != null ? 'Retake' : 'Start'}
                </button>
              </article>))}
          </div></section>));
      }}</Status>
    </>
  );
}

function Attempt({ id }) {
  const [s, load] = useLoad(() => api(`/attempts/${id}`), [id]);
  return <Status s={s} retry={load}>{(a) => <AttemptBody initial={a} />}</Status>;
}

function AttemptBody({ initial }) {
  const [att, setAtt] = useState(initial);
  const firstOpen = initial.questions.findIndex((q) => !initial.answers[q.id]);
  const [idx, setIdx] = useState(firstOpen === -1 ? initial.questions.length : firstOpen);
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const lock = useRef(false);
  if (att.status === 'completed') return <Results att={att} />;

  const total = att.questions.length, q = att.questions[idx], ans = q && att.answers[q.id];
  async function guarded(fn) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setErr(null);
    try { await fn(); } catch (e) { setErr(e.message); } finally { lock.current = false; setBusy(false); }
  }
  const check = () => {
    if (sel == null) return setErr('Select an answer first.');
    guarded(async () => {
      const r = await api(`/attempts/${att.attemptId}/answers`, { method: 'POST', body: { questionId: q.id, selectedIndex: sel } });
      setAtt((a) => ({ ...a, answers: { ...a.answers, [q.id]: r } })); // server verdict is the source of truth
    });
  };
  const finish = () => guarded(async () => setAtt(await api(`/attempts/${att.attemptId}/complete`, { method: 'POST' })));
  const next = () => { setSel(null); setErr(null); setIdx(idx + 1); };

  return (
    <section className="card quiz">
      <p className="small muted">{att.quiz.title} · Question {Math.min(idx + 1, total)} of {total}</p>
      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Object.keys(att.answers).length}>
        <div style={{ width: `${(Object.keys(att.answers).length / total) * 100}%` }} /></div>
      {q ? (<>
        <h2>{q.text}</h2>
        <div className="options">{q.options.map((o, i) => {
          const picked = ans ? ans.selectedIndex === i : sel === i;
          const cls = ans ? (i === ans.correctIndex ? 'opt right' : picked ? 'opt wrong' : 'opt') : picked ? 'opt picked' : 'opt';
          return <button key={i} className={cls} disabled={!!ans || busy} aria-pressed={picked} onClick={() => { setSel(i); setErr(null); }}>{o}</button>;
        })}</div>
        {ans && <div className={`feedback ${ans.isCorrect ? 'right' : 'wrong'}`} role="status">
          <strong>{ans.isCorrect ? '✓ Correct' : '✗ Incorrect'}</strong> — {ans.explanation}</div>}
        {err && <p className="error" role="alert">{err}</p>}
        <div className="row">{!ans
          ? <button disabled={busy} onClick={check}>{busy ? 'Checking…' : 'Check answer'}</button>
          : idx < total - 1 ? <button onClick={next}>Next question</button>
          : <button disabled={busy} onClick={finish}>{busy ? 'Saving…' : 'Finish quiz'}</button>}</div>
      </>) : (<>
        <h2>All questions answered</h2>
        {err && <p className="error" role="alert">{err}</p>}
        <button disabled={busy} onClick={finish}>{busy ? 'Saving…' : 'Finish quiz'}</button></>)}
    </section>
  );
}

function Results({ att }) {
  const r = att.result;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const lock = useRef(false);
  async function retake() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setErr(null);
    try { const a = await api(`/quizzes/${att.quiz.id}/attempts`, { method: 'POST' }); go(`#/attempt/${a.attemptId}`); }
    catch (e) { setErr(e.message); lock.current = false; setBusy(false); }
  }
  return (
    <section className="card">
      <h2>{att.quiz.title} — Results</h2>
      <p className="score">{r.score}/{r.total} <span>({r.percentage}%)</span></p>
      <p>{r.message}</p>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="row"><button disabled={busy} onClick={retake}>{busy ? 'Starting…' : 'Retake quiz'}</button>
        <a className="btn secondary" href="#/">All quizzes</a><a className="btn secondary" href="#/progress">My progress</a></div>
      <h3>Review missed questions</h3>
      {r.missed.length === 0 ? <p className="muted">Perfect score — nothing to review. 🎉</p> :
        r.missed.map((m) => (
          <div className="review" key={m.questionId}>
            <p><strong>{m.text}</strong></p>
            <p className="wrong-t">Your answer: {m.options[m.selectedIndex]}</p>
            <p className="right-t">Correct: {m.options[m.correctIndex]}</p>
            <p className="muted small">{m.explanation}</p>
          </div>))}
    </section>
  );
}

function Progress() {
  const [s, load] = useLoad(() => api('/progress'), []);
  return <Status s={s} retry={load}>{({ stats, history }) => (
    <section>
      <h1>Your progress</h1>
      <div className="grid stats">
        <div className="card"><p className="small muted">Attempts</p><p className="score">{stats.attempts}</p></div>
        <div className="card"><p className="small muted">Average</p><p className="score">{stats.avgPct}%</p></div>
        <div className="card"><p className="small muted">Best</p><p className="score">{stats.bestPct}%</p></div>
      </div>
      {history.length === 0 ? <p className="card muted">No completed attempts yet. <a href="#/">Take a quiz</a> to start tracking.</p> : (<>
        <Chart data={history} />
        <div className="card scroll"><table><thead><tr><th>Date</th><th>Quiz</th><th>Score</th><th>%</th></tr></thead><tbody>
          {[...history].reverse().map((h) => <tr key={h.id}><td>{new Date(h.completedAt + 'Z').toLocaleString()}</td><td>{h.quizTitle}</td><td>{h.score}/{h.total}</td><td>{h.percentage}%</td></tr>)}
        </tbody></table></div></>)}
    </section>)}</Status>;
}

function Chart({ data }) {
  const W = 600, H = 180, P = 28, d = data.slice(-20);
  const x = (i) => P + (d.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (d.length - 1));
  const y = (p) => H - P - (p / 100) * (H - 2 * P);
  return (
    <div className="card"><p className="small muted">Score over time (last {d.length} attempts)</p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Score percentage over time">
        {[0, 50, 100].map((t) => <g key={t}><line x1={P} x2={W - P} y1={y(t)} y2={y(t)} className="grid-l" /><text x={2} y={y(t) + 4} className="axis">{t}%</text></g>)}
        <polyline fill="none" className="line" points={d.map((p, i) => `${x(i)},${y(p.percentage)}`).join(' ')} />
        {d.map((p, i) => <circle key={p.id} cx={x(i)} cy={y(p.percentage)} r="4" className="dot"><title>{p.quizTitle}: {p.percentage}%</title></circle>)}
      </svg></div>
  );
}
