import type { APIRoute } from 'astro';
import { getAllProjects, getProjectByFullName, slugFor } from '../../lib/content';

export const prerender = false;

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

function env(key: string): string | undefined {
  const p = (globalThis as any).process?.env?.[key];
  return p ?? (import.meta.env as any)[key];
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function validEmail(email: string) {
  return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

interface RawSolution {
  solved: boolean;
  title: string;
  summary: string;
  libraries: { repo: string; role: string }[];
  steps: string[];
}

async function generateSolution(problem: string): Promise<RawSolution> {
  const key = env('DEEPSEEK_API_KEY')?.replace(/[^\x21-\x7E]/g, '');
  if (!key) throw new Error('DEEPSEEK_API_KEY is not configured');

  const projects = getAllProjects();
  const palette = projects
    .map((p) => `- ${p.full_name}: ${p.one_liner || p.description}`)
    .join('\n');

  const system =
    'You are a pragmatic senior engineer who solves a real-world problem by ' +
    'combining open-source GitHub libraries. Given a PROBLEM and a PALETTE of ' +
    'currently-trending libraries, design ONE concrete solution.\n' +
    'Rules:\n' +
    '- Prefer libraries from the PALETTE, but you MAY add well-known GitHub ' +
    'libraries (use exact "owner/name") if a solution genuinely needs them.\n' +
    '- Pick 1 to 4 libraries. Each needs a clear role.\n' +
    '- Write the guide as plain sentences with NO markdown, NO backticks, NO ' +
    'headings, NO bullet characters — just clear steps a smart beginner can follow.\n' +
    '- If the problem genuinely cannot be solved with software libraries, set ' +
    'solved=false and explain briefly in summary.\n' +
    'Respond with STRICT JSON only:\n' +
    '{"solved": true, "title": "short name for the solution", "summary": "one ' +
    'plain sentence on what you build", "libraries": [{"repo":"owner/name","role":' +
    '"what it does here"}], "steps": ["step one", "step two"]}';

  const user = `PROBLEM:\n${problem}\n\nPALETTE (trending today):\n${palette}\n\nReturn JSON only.`;

  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 900,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DeepSeek HTTP ${res.status}: ${body.slice(0, 160)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? '{}';
  return JSON.parse(content) as RawSolution;
}

export const POST: APIRoute = async ({ request }) => {
  let payload: { problem?: string; email?: string };
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: 'Send JSON with { problem }.' }, 400);
  }

  const problem = (payload.problem || '').trim();
  const email = (payload.email || '').trim();

  if (problem.length < 8) return json({ ok: false, error: 'Describe your problem in a bit more detail.' }, 400);
  if (problem.length > 600) return json({ ok: false, error: 'Please keep it under 600 characters.' }, 400);
  if (!validEmail(email)) return json({ ok: false, error: 'That email looks off — check it or leave it blank.' }, 400);

  let raw: RawSolution;
  try {
    raw = await generateSolution(problem);
  } catch {
    return json({ ok: false, error: 'The solution engine is busy right now. Please try again in a moment.' }, 503);
  }

  // Resolve each library: link to our page if we cover it, else to GitHub.
  const libraries = (raw.libraries || [])
    .filter((l) => l && typeof l.repo === 'string' && /^[^/\s]+\/[^/\s]+$/.test(l.repo))
    .slice(0, 4)
    .map((l) => {
      const project = getProjectByFullName(l.repo);
      return {
        repo: l.repo,
        role: l.role || '',
        inCorpus: !!project,
        url: project ? `/project/${project.date}/${slugFor(project)}/` : `https://github.com/${l.repo}`,
      };
    });

  return json({
    ok: true,
    solved: raw.solved !== false && libraries.length > 0,
    title: raw.title || 'A solution',
    summary: raw.summary || '',
    libraries,
    steps: Array.isArray(raw.steps) ? raw.steps.filter((s) => typeof s === 'string' && s.trim()) : [],
  });
};
