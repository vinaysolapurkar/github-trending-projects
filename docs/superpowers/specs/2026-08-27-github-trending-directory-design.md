# PRD — GitHub Trending Business Directory

**Date:** 2026-08-27
**Status:** Approved design, pre-implementation
**Owner:** Vinay

---

## 1. One-paragraph summary

A self-updating website that, every morning, reads the day's GitHub
Trending list, writes a business-focused one-pager for each repo
(who'd pay for it, business use cases, money-making ideas, a
weekend-shippable idea), and publishes them as a browsable directory.
It also grows a "mashup" section daily — imaginative business ideas
that combine two projects from the archive. The whole thing runs
itself in the cloud; the owner's machine stays off.

## 2. The picture (shared mental model)

A **newsstand**.

- Each morning a self-driving van drops fresh magazines.
- Each magazine is one trending GitHub project.
- Inside each magazine: what it is, who'd pay, money ideas.
- One rack at the front: "mashups" — two magazines stapled together.
- Old magazines stay on the shelves forever (archive).

## 3. Goals

- Publish a business analysis page for **every** repo on GitHub
  Trending each day (~25/day).
- Make the analysis genuinely useful and interesting to a founder /
  indie hacker looking for ideas — not a dry repo mirror.
- Accumulate a growing **mashup** idea bank over time.
- **Zero daily effort** from the owner after setup. No local machine.

## 4. Non-goals (YAGNI)

- No user accounts, login, or comments.
- No search filters / faceted search in v1 (archive-by-date is enough).
- No real database in v1 (files in the repo are the database).
- No editorial human-in-the-loop approval before publishing.
- No email newsletter in v1 (possible later).

## 5. Decisions locked

| Decision | Choice |
|---|---|
| Daily automation engine | **Claude Code /schedule** cloud agent (cron) |
| Storage | **Files in the git repo** (JSON + markdown), no DB |
| Selection policy | **Keep the whole daily trending list** (GitHub already curates "trending") |
| Site framework | **Astro** (static, content-collection driven) |
| Hosting | **Vercel** |

## 6. Architecture

```
GitHub Trending page
        │  (scrape HTML daily)
        ▼
  Claude Code scheduled cloud agent  ──►  writes files
        │                                   /content/YYYY-MM-DD/*.json
        │                                   /content/mashups/*.json
        ▼
   git commit + push
        │
        ▼
   Vercel build (Astro)  ──►  static site republished
```

Two clean units, each independently understandable/testable:

### 6.1 The daily agent (the "van")
- **What it does:** produces today's content files.
- **How it's used:** invoked on a cron schedule by Claude Code /schedule.
- **Depends on:** the GitHub Trending page, the Claude model, the repo.
- **Steps:**
  1. Fetch `https://github.com/trending` (optionally `?since=daily`),
     parse the repo list (owner/name, description, language,
     stars-today, total stars, URL).
  2. For each repo: fetch its README (raw GitHub URL) + basic stats.
  3. Generate the business one-pager (see §7 schema) via Claude.
  4. Write one JSON file per repo to `/content/days/YYYY-MM-DD/<owner>__<name>.json`.
  5. Write a day-index file `/content/days/YYYY-MM-DD/index.json`
     (ordered list of that day's repos).
  6. Generate 1–2 mashups: pick 2 repos from the full archive index,
     write a combined business idea, append to `/content/mashups/`.
  7. Update `/content/archive.json` (list of all days).
  8. `git add . && git commit && git push`. Vercel auto-deploys.
- **Idempotency / re-runs:** if today's folder already exists, the
  agent updates it rather than duplicating. Re-running the same day is
  safe.
- **Resilience:** scraping is defensive — if the trending page layout
  changes, the parser logs a clear error and the run fails loudly
  (no silent empty publish). A day with zero parsed repos must NOT
  overwrite a previous good day.

### 6.2 The site (the "newsstand")
- **What it does:** renders the content files into a fast static site.
- **How it's used:** `npm run build` on Vercel on every push.
- **Depends on:** the `/content` folder only.
- **Pages:**
  - `/` — today's (latest day's) projects as cards, plus a strip of
    recent days.
  - `/day/YYYY-MM-DD` — all projects from that day.
  - `/project/YYYY-MM-DD/<owner>__<name>` — the full one-pager.
  - `/mashups` — the growing mashup idea bank, newest first.
  - `/archive` — index of all days.

## 7. Data schemas (the contract between the two units)

### 7.1 Project file — `content/days/<date>/<owner>__<name>.json`
```json
{
  "date": "2026-08-27",
  "owner": "acme",
  "name": "coolproject",
  "full_name": "acme/coolproject",
  "url": "https://github.com/acme/coolproject",
  "description": "raw GitHub description",
  "language": "Python",
  "stars_total": 12000,
  "stars_today": 850,
  "one_liner": "Plain-English what-it-is, no jargon.",
  "buyer": "Who would pay for this and why.",
  "business_use_cases": [
    "Concrete use case 1",
    "Concrete use case 2",
    "Concrete use case 3"
  ],
  "money_ideas": [
    { "idea": "...", "revenue_model": "subscription / one-off / usage" }
  ],
  "steal_this": "The fastest thing you could ship this weekend using it.",
  "generated_at": "2026-08-27T07:00:00Z"
}
```

### 7.2 Day index — `content/days/<date>/index.json`
```json
{ "date": "2026-08-27", "projects": ["acme__coolproject", "..."] }
```

### 7.3 Mashup file — `content/mashups/<id>.json`
```json
{
  "id": "2026-08-27-001",
  "date": "2026-08-27",
  "repo_a": "acme/coolproject",
  "repo_b": "other/thing",
  "title": "Catchy mashup name",
  "pitch": "One-paragraph business idea combining both.",
  "why_now": "Why this combo makes sense today."
}
```

### 7.4 Archive index — `content/archive.json`
```json
{ "days": ["2026-08-27", "2026-08-26"] }
```

## 8. Content quality bar (per project page)

- `one_liner`: no jargon, understandable by a non-coder.
- `buyer`: a specific person/role, not "businesses".
- `business_use_cases`: concrete, not generic ("automate X for dental
  clinics", not "improve productivity").
- `money_ideas`: each has a revenue model attached.
- `steal_this`: an actual buildable weekend project.
- Tone: energetic, opportunity-spotting, honest (call out when a repo
  has weak business value rather than faking it).

## 9. Error handling

- **Scrape returns 0 repos** → fail the run, do not commit, log error.
- **A single repo fails** (no README, API error) → skip that one repo,
  keep the rest, note it in the run log.
- **Model returns malformed JSON** → retry once; if still bad, skip that
  repo rather than write garbage.
- **Duplicate day run** → update in place, never duplicate files.
- **Git push conflict** → pull/rebase and retry once.

## 10. Testing strategy

- **Scraper parser:** unit test against a saved snapshot of the
  trending HTML → asserts it extracts N repos with all fields.
- **Schema validation:** every generated JSON file validated against
  the schema before commit.
- **Site build:** `npm run build` must succeed with sample content
  fixtures (a mini `/content` with 2 days + 1 mashup).
- **End-to-end dry run:** run the agent locally once with a real
  trending fetch, inspect output files, before wiring the schedule.

## 11. Build order (milestones)

1. **Scaffold Astro site** + sample content fixtures → deploy an empty
   shell to Vercel. (See a live URL early.)
2. **Content schemas + site pages** rendering the fixtures.
3. **Scraper + generator script** (the agent's job) → run locally,
   produce one real day of content.
4. **Mashup generator.**
5. **Wire Claude Code /schedule** to run the script daily + push.
6. **Harden** error handling + parser resilience.

## 12. Open questions (to resolve during build, not blockers)

- Exact run time of day (default 07:00 in owner's timezone).
- How many mashups per day (default 1–2).
- Whether to cap total pages shown on home before "load more".

## 13. Risks

- **GitHub Trending HTML changes** → parser breaks. Mitigation:
  defensive parsing, loud failure, easy-to-fix isolated parser module.
- **/schedule cloud agent limits** (runtime, network, git push auth) —
  must be validated in milestone 5; fallback is GitHub Actions with an
  Anthropic API key if /schedule can't push reliably.
- **Content sameness** — every page reading the same → mitigated by a
  strong, varied prompt and the "be honest about weak repos" rule.
