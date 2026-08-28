import type { APIRoute } from 'astro';
import { addSolution } from '../../lib/db';
import { getProjectByFullName, slugFor } from '../../lib/content';

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

// Parse the repos textarea: one per line, "owner/name" optionally "owner/name - role".
function parseRepos(raw: string) {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((line) => {
      const [repoPart, ...roleParts] = line.split(/\s+[-–—]\s+/);
      const repo = repoPart.trim();
      const role = roleParts.join(' - ').trim();
      return { repo, role };
    })
    .filter((l) => /^[^/\s]+\/[^/\s]+$/.test(l.repo))
    .map((l) => {
      const project = getProjectByFullName(l.repo);
      return {
        repo: l.repo,
        role: l.role,
        inCorpus: !!project,
        url: project ? `/project/${project.date}/${slugFor(project)}/` : `https://github.com/${l.repo}`,
      };
    });
}

export const POST: APIRoute = async ({ request }) => {
  let body: { problemId?: string; title?: string; summary?: string; repos?: string; guide?: string; author?: string };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request' }, 400);
  }

  const problemId = (body.problemId || '').trim();
  const title = (body.title || '').trim().slice(0, 120);
  const summary = (body.summary || '').trim().slice(0, 400);
  const author = (body.author || '').trim().slice(0, 60) || 'Anonymous';
  const libraries = parseRepos(body.repos || '');
  const steps = (body.guide || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);

  if (!problemId) return json({ ok: false, error: 'Missing problem.' }, 400);
  if (title.length < 4) return json({ ok: false, error: 'Give your solution a short title.' }, 400);
  if (libraries.length === 0) return json({ ok: false, error: 'List at least one GitHub library as owner/name.' }, 400);
  if (steps.length === 0) return json({ ok: false, error: 'Add a few steps explaining how to build it.' }, 400);

  try {
    const id = await addSolution({ problemId, source: 'community', title, summary, libraries, steps, author });
    return json({ ok: true, solutionId: id, libraries, steps, title, summary, author });
  } catch {
    return json({ ok: false, error: 'Could not save your solution. Try again.' }, 503);
  }
};
