import { createClient, type Client } from '@libsql/client';

// Runtime-only. Never imported by prerendered pages.

function env(key: string): string | undefined {
  const p = (globalThis as any).process?.env?.[key];
  const v = p ?? (import.meta.env as any)[key];
  // strip stray BOM / whitespace that env tooling can inject
  return typeof v === 'string' ? v.replace(/[^\x21-\x7E]/g, '') : v;
}

let _client: Client | null = null;
let _ready: Promise<void> | null = null;

function client(): Client {
  if (_client) return _client;
  const url = env('TURSO_DATABASE_URL');
  const authToken = env('TURSO_AUTH_TOKEN');
  if (!url) throw new Error('TURSO_DATABASE_URL is not configured');
  _client = createClient({ url, authToken });
  return _client;
}

async function ensureSchema(): Promise<void> {
  if (_ready) return _ready;
  _ready = (async () => {
    const c = client();
    await c.batch(
      [
        `CREATE TABLE IF NOT EXISTS problems (
          id TEXT PRIMARY KEY,
          text TEXT NOT NULL,
          email TEXT,
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS solutions (
          id TEXT PRIMARY KEY,
          problem_id TEXT NOT NULL,
          source TEXT NOT NULL,
          title TEXT NOT NULL,
          summary TEXT,
          libraries TEXT NOT NULL,
          steps TEXT NOT NULL,
          author TEXT,
          votes INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS solution_votes (
          solution_id TEXT NOT NULL,
          voter TEXT NOT NULL,
          PRIMARY KEY (solution_id, voter)
        )`,
      ],
      'write'
    );
  })();
  return _ready;
}

async function db(): Promise<Client> {
  await ensureSchema();
  return client();
}

export interface Library {
  repo: string;
  role: string;
  inCorpus?: boolean;
  url?: string;
}
export interface SolutionRow {
  id: string;
  problem_id: string;
  source: 'ai' | 'community';
  title: string;
  summary: string;
  libraries: Library[];
  steps: string[];
  author: string | null;
  votes: number;
  created_at: number;
}
export interface ProblemRow {
  id: string;
  text: string;
  email: string | null;
  created_at: number;
}

function uid(): string {
  return (globalThis.crypto as Crypto).randomUUID();
}

export async function createProblem(text: string, email: string): Promise<string> {
  const c = await db();
  const id = uid();
  await c.execute({
    sql: 'INSERT INTO problems (id, text, email, created_at) VALUES (?, ?, ?, ?)',
    args: [id, text, email || null, Date.now()],
  });
  return id;
}

export async function addSolution(s: {
  problemId: string;
  source: 'ai' | 'community';
  title: string;
  summary: string;
  libraries: Library[];
  steps: string[];
  author?: string | null;
}): Promise<string> {
  const c = await db();
  const id = uid();
  await c.execute({
    sql: `INSERT INTO solutions
      (id, problem_id, source, title, summary, libraries, steps, author, votes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    args: [
      id,
      s.problemId,
      s.source,
      s.title,
      s.summary || '',
      JSON.stringify(s.libraries || []),
      JSON.stringify(s.steps || []),
      s.author || null,
      Date.now(),
    ],
  });
  return id;
}

function toSolution(row: any): SolutionRow {
  return {
    id: row.id,
    problem_id: row.problem_id,
    source: row.source,
    title: row.title,
    summary: row.summary,
    libraries: safeParse(row.libraries, []),
    steps: safeParse(row.steps, []),
    author: row.author,
    votes: Number(row.votes),
    created_at: Number(row.created_at),
  };
}
function safeParse<T>(s: any, fallback: T): T {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export async function getProblem(id: string): Promise<ProblemRow | null> {
  const c = await db();
  const r = await c.execute({ sql: 'SELECT * FROM problems WHERE id = ?', args: [id] });
  const row = r.rows[0] as any;
  return row ? { id: row.id, text: row.text, email: row.email, created_at: Number(row.created_at) } : null;
}

export async function getSolutions(problemId: string): Promise<SolutionRow[]> {
  const c = await db();
  const r = await c.execute({
    sql: 'SELECT * FROM solutions WHERE problem_id = ? ORDER BY votes DESC, created_at ASC',
    args: [problemId],
  });
  return r.rows.map(toSolution);
}

export async function getRecentProblems(
  limit = 12
): Promise<Array<ProblemRow & { solution_count: number; top_title: string | null }>> {
  const c = await db();
  const r = await c.execute({
    sql: `SELECT p.*,
            (SELECT COUNT(*) FROM solutions s WHERE s.problem_id = p.id) AS solution_count,
            (SELECT s.title FROM solutions s WHERE s.problem_id = p.id ORDER BY s.votes DESC, s.created_at ASC LIMIT 1) AS top_title
          FROM problems p
          ORDER BY p.created_at DESC
          LIMIT ?`,
    args: [limit],
  });
  return r.rows.map((row: any) => ({
    id: row.id,
    text: row.text,
    email: row.email,
    created_at: Number(row.created_at),
    solution_count: Number(row.solution_count),
    top_title: row.top_title,
  }));
}

/** Upvote once per voter. Returns the new vote count (or current if already voted). */
export async function voteSolution(solutionId: string, voter: string): Promise<number> {
  const c = await db();
  try {
    await c.execute({
      sql: 'INSERT INTO solution_votes (solution_id, voter) VALUES (?, ?)',
      args: [solutionId, voter],
    });
    await c.execute({ sql: 'UPDATE solutions SET votes = votes + 1 WHERE id = ?', args: [solutionId] });
  } catch {
    // duplicate vote — ignore, return current count
  }
  const r = await c.execute({ sql: 'SELECT votes FROM solutions WHERE id = ?', args: [solutionId] });
  return r.rows[0] ? Number((r.rows[0] as any).votes) : 0;
}
