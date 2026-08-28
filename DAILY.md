# Daily run — runbook for the scheduled agent

You are the morning editor of **The Trending Ledger**. Run these steps in
order. If any step fails, STOP and do not commit — a bad run must never be
published. Today's date is the run date in `YYYY-MM-DD` (call it `<DATE>`).

## Step 1 — Scrape today's trending list

```
node scripts/fetch-trending.mjs <DATE>
```

This writes `.cache/trending-<DATE>.json` containing every trending repo with
its description, language, stars total, stars today, and a slice of its README.
If the script exits with an error (fewer than 5 repos parsed), GitHub likely
changed its HTML — STOP and fix `scripts/fetch-trending.mjs`; do not publish.

## Step 2 — Write one business page per repo

Read `.cache/trending-<DATE>.json`. For **every** repo, write one file:

`content/days/<DATE>/<owner>__<name>.json`

Use the README + description to fill this exact schema:

```json
{
  "date": "<DATE>",
  "owner": "<owner>",
  "name": "<name>",
  "full_name": "<owner>/<name>",
  "url": "https://github.com/<owner>/<name>",
  "description": "<raw description from the scrape>",
  "language": "<language or null>",
  "stars_total": <number from scrape>,
  "stars_today": <number from scrape>,
  "one_liner": "Plain-English what-it-is. No jargon. A non-coder gets it.",
  "buyer": "A specific role/person who would pay, and why. Not 'businesses'.",
  "business_use_cases": ["concrete case 1", "concrete case 2", "concrete case 3"],
  "money_ideas": [
    { "idea": "how someone makes money with it", "revenue_model": "subscription | one-off | usage | ads" }
  ],
  "steal_this": "The single fastest thing you could ship this weekend using it.",
  "opportunity_rating": <1-5, honest business potential>,
  "generated_at": "<ISO timestamp>"
}
```

Then write the day index `content/days/<DATE>/index.json`:

```json
{ "date": "<DATE>", "projects": ["<owner>__<name>", "..."] }
```

### Quality bar (this is the whole point of the site)
- `one_liner`: no jargon; a shopkeeper understands it.
- `buyer`: a specific person/role in a specific setting.
- `business_use_cases`: concrete and vivid ("track competitor prices for a
  local bike shop"), never generic ("improves productivity").
- `money_ideas`: each has a revenue model attached.
- `steal_this`: an actual buildable weekend project.
- **Be honest.** If a repo is a dev tool, a joke, or a list with weak business
  value, say so plainly and give it a low `opportunity_rating`. A directory of
  honest reads is worth more than fake enthusiasm.

## Step 3 — Add one compound entry (mashup)

Pick two repos that combine into a genuinely interesting business idea. At least
one should be from today; the other may come from any earlier day (read the
`content/days/*/` folders). Write:

`content/mashups/<DATE>-001.json`

```json
{
  "id": "<DATE>-001",
  "date": "<DATE>",
  "repo_a": "owner/name",
  "repo_b": "owner/name",
  "title": "Catchy name for the combined idea",
  "pitch": "One paragraph: what you'd build by combining them, and who buys it.",
  "why_now": "Why this combo makes sense today."
}
```

(Use `-002`, `-003` if you add more than one. One is enough.)

## Step 4 — Update the archive index

Edit `content/archive.json` so `days` lists every date folder under
`content/days/`, newest first:

```json
{ "days": ["<DATE>", "...older..."] }
```

## Step 5 — Validate, then commit and push

```
node scripts/validate-content.mjs <DATE>
```

If it prints `✓ content valid`, commit and push:

```
git add content/
git commit -m "Ledger: <DATE> (<N> entries)"
git push
```

Vercel redeploys automatically on push. Done.

## Rules
- If Step 1 or Step 5 fails, do NOT commit. Report the failure.
- Re-running the same day is safe: overwrite that day's files, never duplicate.
- Never edit `src/` during a daily run — content only.
