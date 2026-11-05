import { initDb } from './db.js';
import { app } from './app.js';
const port = process.env.PORT || 4000;
initDb().then(() => app.listen(port, () => console.log(`API on http://localhost:${port}`)))
  .catch((e) => { console.error('Failed to start (is SQL Server running? check server/.env):', e.message); process.exit(1); });
