import type { APIRoute } from 'astro';
import { voteSolution } from '../../lib/db';

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

export const POST: APIRoute = async ({ request }) => {
  let body: { solutionId?: string; voter?: string };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request' }, 400);
  }
  const solutionId = (body.solutionId || '').trim();
  const voter = (body.voter || '').trim().slice(0, 64);
  if (!solutionId || !voter) return json({ ok: false, error: 'Missing fields' }, 400);

  try {
    const votes = await voteSolution(solutionId, voter);
    return json({ ok: true, votes });
  } catch {
    return json({ ok: false, error: 'Could not record vote' }, 503);
  }
};
