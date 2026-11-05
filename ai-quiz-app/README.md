# AI Development Quiz App (Node + React + SQL Server)

## Run
```bash
docker compose up -d        # SQL Server 2022 (or point server/.env at your own instance)
npm install && npm run install:all
npm run dev                 # API :4000, web http://localhost:5173
```
The API creates the database, tables and seed quizzes on first start. Production: `npm run build && npm start` (Express serves `client/dist`).

## Design decisions
- **Server-authoritative scoring / no answer key on the client.** Quiz payloads contain only question text + options. `POST /attempts/:id/answers` returns `{isCorrect, correctIndex, explanation}` for that one question *after* it is submitted, so feedback is instant (one round-trip) and the key is never shipped up front. The score is computed in SQL from stored answers at `POST /attempts/:id/complete`.
- **Consistency.** The UI renders the server's stored verdict, never its own guess; results come from the server response. Refresh = `GET /attempts/:id` rebuilds state exactly (route is `#/attempt/<id>`).
- **Idempotency / races.** `AttemptAnswers` PK `(attempt_id, question_id)` → first answer wins, repeats return the stored verdict. A filtered unique index allows one `in_progress` attempt per user+quiz, so double-clicking Start can't create duplicates (and starting resumes). `complete` is idempotent (`UPDATE … WHERE status='in_progress'`) and rejects incomplete attempts (409). Answer inserts are conditional on the attempt being open. UI buttons also lock while a request is in flight.
- **Identity.** Anonymous UUID in `localStorage` sent as `X-User-Id`; every attempt is scoped to it. Tradeoff: not real auth.
- **Loading/error states** on every view with Retry; validation on both layers; central error handler.

## API
`GET /api/quizzes` · `POST /api/quizzes/:id/attempts` · `GET /api/attempts/:id` · `POST /api/attempts/:id/answers` · `POST /api/attempts/:id/complete` · `GET /api/progress`

## Deliberately left out
Real auth, admin UI for authoring quizzes (add rows/`seed.js`), leaderboard, randomized order, rate limiting, automated tests, migrations tool.
