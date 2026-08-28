#!/usr/bin/env node
// Pure scraper — NO AI. Fetches github.com/trending, parses the repo list,
// pulls a slice of each README, and writes one raw JSON file.
//
// The scheduled Claude Code agent reads that raw file and writes the business
// analysis itself. Keeping this step dumb + isolated means when GitHub changes
// its HTML, only this one file needs a fix.
//
// Usage:  node scripts/fetch-trending.mjs [YYYY-MM-DD]
// Output: .cache/trending-<date>.json   (also prints a summary to stderr)

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA =
  'Mozilla/5.0 (compatible; TrendingLedgerBot/1.0; +https://github-trending-projects.vercel.app)';
const README_MAX = 6000; // chars kept per README
const MIN_REPOS = 5; // fail loud below this — a layout change likely broke us

const dateArg = process.argv[2] || new Date().toISOString().slice(0, 10);

function log(...a) {
  process.stderr.write(a.join(' ') + '\n');
}

function stripTags(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function toInt(s) {
  return s ? parseInt(s.replace(/[^0-9]/g, ''), 10) || 0 : 0;
}

async function fetchTrendingHtml() {
  const url = 'https://github.com/trending?since=daily';
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`Trending fetch failed: HTTP ${res.status}`);
  return res.text();
}

function parseRepos(html) {
  // Each repo is an <article class="Box-row"> ... </article>
  const chunks = html.split('<article class="Box-row">').slice(1);
  const repos = [];
  for (const chunk of chunks) {
    const body = chunk.split('</article>')[0];

    const path = body.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="\/([^"/]+)\/([^"/?#]+)"/);
    if (!path) continue;
    const owner = path[1];
    const name = path[2];

    const descM = body.match(/<p class="col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    const description = descM ? stripTags(descM[1]) : '';

    const langM = body.match(/<span itemprop="programmingLanguage">([^<]+)<\/span>/);
    const language = langM ? langM[1].trim() : null;

    const todayM = body.match(/([\d,]+)\s+stars?\s+today/i);
    const stars_today = toInt(todayM && todayM[1]);

    const totalM = body.match(
      new RegExp(`href="\\/${owner}\\/${name}\\/stargazers"[\\s\\S]*?>\\s*([\\d,]+)`, 'i')
    );
    const stars_total = toInt(totalM && totalM[1]);

    repos.push({
      owner,
      name,
      full_name: `${owner}/${name}`,
      url: `https://github.com/${owner}/${name}`,
      description,
      language,
      stars_total,
      stars_today,
    });
  }
  return repos;
}

async function fetchReadme(owner, name) {
  const branches = ['HEAD', 'main', 'master'];
  const files = ['README.md', 'readme.md', 'README.rst', 'README'];
  for (const branch of branches) {
    for (const file of files) {
      const raw = `https://raw.githubusercontent.com/${owner}/${name}/${branch}/${file}`;
      try {
        const res = await fetch(raw, { headers: { 'User-Agent': UA } });
        if (res.ok) {
          const text = await res.text();
          if (text.trim()) return text.slice(0, README_MAX);
        }
      } catch {
        /* try next */
      }
    }
  }
  return '';
}

async function main() {
  log(`[fetch-trending] date=${dateArg}`);
  const html = await fetchTrendingHtml();
  const repos = parseRepos(html);
  log(`[fetch-trending] parsed ${repos.length} repos`);

  if (repos.length < MIN_REPOS) {
    throw new Error(
      `Only ${repos.length} repos parsed (min ${MIN_REPOS}). GitHub's HTML likely changed — ` +
        `do NOT publish. Fix scripts/fetch-trending.mjs parseRepos().`
    );
  }

  // pull READMEs (sequentially — polite, and volume is small)
  for (const r of repos) {
    r.readme = await fetchReadme(r.owner, r.name);
    log(`  ${r.full_name}  +${r.stars_today} today  readme:${r.readme.length}c`);
  }

  const out = { date: dateArg, fetched_at: new Date().toISOString(), repos };
  const outPath = join(ROOT, '.cache', `trending-${dateArg}.json`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(out, null, 2));
  log(`[fetch-trending] wrote ${outPath}`);
  // print the path on stdout so the agent can find it
  process.stdout.write(outPath + '\n');
}

main().catch((e) => {
  log(`[fetch-trending] ERROR: ${e.message}`);
  process.exit(1);
});
