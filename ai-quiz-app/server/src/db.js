import 'dotenv/config';
import sql from 'mssql';
import { seed } from './seed.js';
const cfg = { server: process.env.DB_SERVER || 'localhost', port: +(process.env.DB_PORT || 1433),
  user: process.env.DB_USER || 'sa', password: process.env.DB_PASSWORD || 'Your_password123',
  options: { encrypt: false, trustServerCertificate: true } };
const DB = process.env.DB_NAME || 'QuizApp';
let pool;
export { sql };
export async function run(text, params = {}) {
  const r = pool.request();
  for (const [k, [t, v]] of Object.entries(params)) r.input(k, t, v);
  return r.query(text);
}
export const rows = async (text, params) => (await run(text, params)).recordset;
const SCHEMA = `
IF OBJECT_ID('dbo.Quizzes') IS NULL CREATE TABLE dbo.Quizzes(id INT IDENTITY PRIMARY KEY, slug NVARCHAR(60) NOT NULL UNIQUE, title NVARCHAR(120) NOT NULL, category NVARCHAR(60) NOT NULL, description NVARCHAR(300) NOT NULL);
IF OBJECT_ID('dbo.Questions') IS NULL CREATE TABLE dbo.Questions(id INT IDENTITY PRIMARY KEY, quiz_id INT NOT NULL REFERENCES dbo.Quizzes(id), position INT NOT NULL, text NVARCHAR(500) NOT NULL, options NVARCHAR(MAX) NOT NULL, correct_index INT NOT NULL, explanation NVARCHAR(600) NOT NULL);
IF OBJECT_ID('dbo.Attempts') IS NULL CREATE TABLE dbo.Attempts(id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY, user_id NVARCHAR(64) NOT NULL, quiz_id INT NOT NULL REFERENCES dbo.Quizzes(id), status NVARCHAR(12) NOT NULL DEFAULT 'in_progress', started_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), completed_at DATETIME2 NULL, score INT NULL, total INT NULL);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_Attempts_open') CREATE UNIQUE INDEX UX_Attempts_open ON dbo.Attempts(user_id, quiz_id) WHERE status='in_progress';
IF OBJECT_ID('dbo.AttemptAnswers') IS NULL CREATE TABLE dbo.AttemptAnswers(attempt_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Attempts(id), question_id INT NOT NULL REFERENCES dbo.Questions(id), selected_index INT NOT NULL, is_correct BIT NOT NULL, answered_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), PRIMARY KEY(attempt_id, question_id));`;
export async function initDb() {
  const master = await new sql.ConnectionPool({ ...cfg, database: 'master' }).connect();
  await master.request().query(`IF DB_ID('${DB.replace(/[^\w]/g, '')}') IS NULL CREATE DATABASE [${DB.replace(/[^\w]/g, '')}]`);
  await master.close();
  pool = await new sql.ConnectionPool({ ...cfg, database: DB }).connect();
  await pool.request().query(SCHEMA);
  await seed(run, sql);
}
