import type { APIRoute } from 'astro';
import { getRecentProblems } from '../../lib/db';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const problems = await getRecentProblems(10);
    return new Response(JSON.stringify({ ok: true, problems }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ ok: true, problems: [] }), {
      headers: { 'content-type': 'application/json' },
    });
  }
};
