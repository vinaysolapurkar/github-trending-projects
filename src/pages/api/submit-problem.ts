import type { APIRoute } from 'astro';
import { getAllProjects, getProjectByFullName, slugFor } from '../../lib/content';

// On-demand (serverless) — this route is NOT prerendered.
export const prerender = false;

interface MatchResult {
  repo: string | null;
  why: string;
  confidence: 'high' | 'medium' | 'low';
}

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

// Read env at runtime (Vercel serverless populates process.env) with a
// build-time fallback.
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
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Fire-and-forget: notify the owner of every submission so nothing is lost,
// even before the notify-later datastore exists. No-op if env not configured.
async function notifyOwner(problem: string, email: string, matched: string | null) {
  const token = env('TELEGRAM_BOT_TOKEN');
  const chatId = env('TELEGRAM_CHAT_ID');
  if (!token || !chatId) return;
  const text =
    `🧩 New problem submitted\n\n"${problem}"\n\nfrom: ${email}\n` +
    (matched ? `instant match: ${matched}` : 'no instant match — hold + notify later');
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch {
    /* best effort */
  }
}

async function matchWithDeepSeek(problem: string): Promise<MatchResult> {
  const key = env('DEEPSEEK_API_KEY');
  if (!key) throw new Error('DEEPSEEK_API_KEY is not configured');

  const projects = getAllProjects();
  const catalog = projects
    .map((p) => `- ${p.full_name}: ${p.one_liner || p.description}`)
    .join('\n');

  const system =
    'You match a user\'s real-world problem to AT MOST ONE open-source tool from ' +
    'the provided list. Only match if a tool genuinely helps solve the problem. ' +
    'If nothing on the list is a real fit, return null — a forced match is worse ' +
    'than an honest null. Respond with STRICT JSON only: ' +
    '{"repo": "owner/name" or null, "why": "one plain-English sentence", "confidence": "high|medium|low"}.';

  const user = `PROBLEM:\n${problem}\n\nTOOLS:\n${catalog}\n\nReturn JSON only.`;

  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 300,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DeepSeek HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? '{}';
  let parsed: MatchResult;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = { repo: null, why: 'Could not interpret the match result.', confidence: 'low' };
  }

  // Guard against a hallucinated repo not in our catalog.
  if (parsed.repo && !getProjectByFullName(parsed.repo)) {
    parsed.repo = null;
  }
  return parsed;
}

export const POST: APIRoute = async ({ request }) => {
  let payload: { problem?: string; email?: string };
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: 'Send JSON with { problem, email }.' }, 400);
  }

  const problem = (payload.problem || '').trim();
  const email = (payload.email || '').trim();

  if (problem.length < 8) return json({ ok: false, error: 'Describe your problem in a bit more detail.' }, 400);
  if (problem.length > 500) return json({ ok: false, error: 'Please keep it under 500 characters.' }, 400);
  if (!validEmail(email)) return json({ ok: false, error: 'Enter a valid email so we can reach you.' }, 400);

  let match: MatchResult;
  try {
    match = await matchWithDeepSeek(problem);
  } catch (e) {
    return json(
      { ok: false, error: 'The matching engine is unavailable right now. Please try again shortly.' },
      503
    );
  }

  await notifyOwner(problem, email, match.repo);

  if (match.repo) {
    const project = getProjectByFullName(match.repo);
    const url = project ? `/project/${project.date}/${slugFor(project)}/` : null;
    return json({
      ok: true,
      matched: true,
      repo: match.repo,
      why: match.why,
      confidence: match.confidence,
      url,
    });
  }

  return json({
    ok: true,
    matched: false,
    message:
      "Nothing trending solves this yet. We've logged your problem and will email you the morning a matching tool trends.",
  });
};
