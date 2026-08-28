#!/usr/bin/env node
// Validates every content JSON file against the schema BEFORE commit.
// Run by the daily agent after it writes files. Exits non-zero on any problem
// so a bad run never gets published.
//
// Usage: node scripts/validate-content.mjs [YYYY-MM-DD]
//   With a date, also asserts that day's folder exists and is non-empty.

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = join(ROOT, 'content');
const requireDate = process.argv[2] || null;

const errors = [];
function err(file, msg) {
  errors.push(`${file}: ${msg}`);
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

async function readJson(path) {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw);
}

function validateProject(file, p) {
  const strFields = ['date', 'owner', 'name', 'full_name', 'url', 'one_liner', 'buyer', 'steal_this'];
  for (const f of strFields) if (!isNonEmptyString(p[f])) err(file, `missing/empty "${f}"`);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '')) err(file, `bad date "${p.date}"`);
  if (typeof p.stars_total !== 'number') err(file, `stars_total must be a number`);
  if (typeof p.stars_today !== 'number') err(file, `stars_today must be a number`);

  if (!Array.isArray(p.business_use_cases) || p.business_use_cases.length < 2)
    err(file, `business_use_cases needs >= 2 entries`);
  else p.business_use_cases.forEach((c, i) => { if (!isNonEmptyString(c)) err(file, `business_use_cases[${i}] empty`); });

  if (!Array.isArray(p.money_ideas) || p.money_ideas.length < 1)
    err(file, `money_ideas needs >= 1 entry`);
  else p.money_ideas.forEach((m, i) => {
    if (!isNonEmptyString(m?.idea)) err(file, `money_ideas[${i}].idea empty`);
    if (!isNonEmptyString(m?.revenue_model)) err(file, `money_ideas[${i}].revenue_model empty`);
  });

  if (p.opportunity_rating != null && (typeof p.opportunity_rating !== 'number' || p.opportunity_rating < 1 || p.opportunity_rating > 5))
    err(file, `opportunity_rating must be 1-5 or omitted`);
}

function validateMashup(file, m) {
  for (const f of ['id', 'date', 'repo_a', 'repo_b', 'title', 'pitch', 'why_now'])
    if (!isNonEmptyString(m[f])) err(file, `missing/empty "${f}"`);
}

async function main() {
  if (!existsSync(CONTENT)) {
    console.error('No content/ folder found.');
    process.exit(1);
  }

  // days
  const daysDir = join(CONTENT, 'days');
  const days = existsSync(daysDir) ? await readdir(daysDir) : [];
  for (const day of days) {
    const dir = join(daysDir, day);
    const files = await readdir(dir);
    const projectFiles = files.filter((f) => f.endsWith('.json') && f !== 'index.json');

    if (!files.includes('index.json')) err(`days/${day}`, 'missing index.json');
    else {
      const idx = await readJson(join(dir, 'index.json'));
      if (idx.date !== day) err(`days/${day}/index.json`, `date "${idx.date}" != folder "${day}"`);
      if (!Array.isArray(idx.projects)) err(`days/${day}/index.json`, 'projects must be an array');
    }

    if (projectFiles.length === 0) err(`days/${day}`, 'no project files');
    for (const f of projectFiles) {
      const p = await readJson(join(dir, f));
      validateProject(`days/${day}/${f}`, p);
      if (p.date !== day) err(`days/${day}/${f}`, `date "${p.date}" != folder "${day}"`);
    }
  }

  // mashups
  const mashDir = join(CONTENT, 'mashups');
  if (existsSync(mashDir)) {
    for (const f of (await readdir(mashDir)).filter((f) => f.endsWith('.json'))) {
      validateMashup(`mashups/${f}`, await readJson(join(mashDir, f)));
    }
  }

  // archive.json
  const archivePath = join(CONTENT, 'archive.json');
  if (existsSync(archivePath)) {
    const a = await readJson(archivePath);
    if (!Array.isArray(a.days)) err('archive.json', 'days must be an array');
  }

  // required date present + non-empty
  if (requireDate) {
    const dir = join(daysDir, requireDate);
    if (!existsSync(dir)) err(`days/${requireDate}`, 'required day folder is missing');
    else {
      const pf = (await readdir(dir)).filter((f) => f.endsWith('.json') && f !== 'index.json');
      if (pf.length === 0) err(`days/${requireDate}`, 'required day has no projects');
    }
  }

  if (errors.length) {
    console.error(`\n✗ ${errors.length} validation error(s):\n`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log('✓ content valid');
}

main().catch((e) => {
  console.error('validator crashed:', e.message);
  process.exit(1);
});
