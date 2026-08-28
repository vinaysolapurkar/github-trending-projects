// Single source of truth for reading the /content folder at build time.
// The daily agent writes JSON here; the site reads it. No database.

export interface MoneyIdea {
  idea: string;
  revenue_model: string;
}

export interface Project {
  date: string;
  owner: string;
  name: string;
  full_name: string;
  url: string;
  description: string;
  language: string | null;
  stars_total: number;
  stars_today: number;
  one_liner: string;
  buyer: string;
  business_use_cases: string[];
  money_ideas: MoneyIdea[];
  steal_this: string;
  opportunity_rating?: number; // 1-5, optional editorial score
  generated_at: string;
}

export interface Mashup {
  id: string;
  date: string;
  repo_a: string;
  repo_b: string;
  title: string;
  pitch: string;
  why_now: string;
}

// slug used in URLs and filenames: owner__name
export function slugFor(p: Pick<Project, 'owner' | 'name'>): string {
  return `${p.owner}__${p.name}`;
}

// --- load every project file: /content/days/<date>/<owner>__<name>.json ---
const projectModules = import.meta.glob<Project>('/content/days/*/*.json', {
  eager: true,
  import: 'default',
});

const allProjects: Project[] = Object.entries(projectModules)
  // index.json files are day manifests, not projects — skip them
  .filter(([path]) => !path.endsWith('/index.json'))
  .map(([, mod]) => mod as Project);

// --- load every mashup file: /content/mashups/<id>.json ---
const mashupModules = import.meta.glob<Mashup>('/content/mashups/*.json', {
  eager: true,
  import: 'default',
});

const allMashups: Mashup[] = Object.values(mashupModules) as Mashup[];

// --- public API -----------------------------------------------------------

/** All dates that have at least one project, newest first (YYYY-MM-DD). */
export function getDays(): string[] {
  const set = new Set(allProjects.map((p) => p.date));
  return [...set].sort((a, b) => (a < b ? 1 : -1));
}

/** The newest day with content, or null if the site is empty. */
export function getLatestDay(): string | null {
  return getDays()[0] ?? null;
}

/** Projects for a given day, ordered by stars gained today (desc). */
export function getProjectsForDay(date: string): Project[] {
  return allProjects
    .filter((p) => p.date === date)
    .sort((a, b) => b.stars_today - a.stars_today);
}

/** One project by date + slug, or null. */
export function getProject(date: string, slug: string): Project | null {
  return (
    allProjects.find((p) => p.date === date && slugFor(p) === slug) ?? null
  );
}

/** Every project, for building static routes. */
export function getAllProjects(): Project[] {
  return allProjects;
}

/** All mashups, newest first. */
export function getMashups(): Mashup[] {
  return [...allMashups].sort((a, b) => (a.id < b.id ? 1 : -1));
}

/** Total counts for the masthead. */
export function getTotals() {
  return {
    projects: allProjects.length,
    days: getDays().length,
    mashups: allMashups.length,
  };
}

// --- Problem matching -----------------------------------------------------

export interface Problem {
  id: string;
  text: string;
  persona: string;
}

export interface Match {
  problem_id: string;
  repo: string | null; // full_name, or null = no match
  why: string;
  confidence?: 'high' | 'medium' | 'low';
}

interface ProblemsFile {
  problems: Problem[];
}
interface MatchesFile {
  date: string;
  matches: Match[];
}

const problemsModules = import.meta.glob<ProblemsFile>('/content/problems.json', {
  eager: true,
  import: 'default',
});
const allProblems: Problem[] =
  (Object.values(problemsModules)[0] as ProblemsFile | undefined)?.problems ?? [];

const matchesModules = import.meta.glob<MatchesFile>('/content/matches/*.json', {
  eager: true,
  import: 'default',
});
const allMatchFiles: MatchesFile[] = Object.values(matchesModules) as MatchesFile[];

/** The seeded/collected problems. */
export function getProblems(): Problem[] {
  return allProblems;
}

/** Find a project by "owner/name" (latest day it appeared), for linking matches. */
export function getProjectByFullName(fullName: string): Project | null {
  const hits = allProjects
    .filter((p) => p.full_name === fullName)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return hits[0] ?? null;
}

/** Latest non-null match for a problem across all match days, or null. */
export function getLatestMatch(problemId: string): (Match & { date: string }) | null {
  const days = [...allMatchFiles].sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const day of days) {
    const m = day.matches.find((x) => x.problem_id === problemId && x.repo);
    if (m) return { ...m, date: day.date };
  }
  return null;
}

/** Problems paired with their best current match (repo may be null). */
export function getProblemBoard(): Array<{ problem: Problem; match: (Match & { date: string }) | null; project: Project | null }> {
  return allProblems.map((problem) => {
    const match = getLatestMatch(problem.id);
    const project = match?.repo ? getProjectByFullName(match.repo) : null;
    return { problem, match, project };
  });
}

export function getProblemStats() {
  const board = getProblemBoard();
  return {
    total: board.length,
    solved: board.filter((b) => b.match).length,
    unmatched: board.filter((b) => !b.match).length,
  };
}
