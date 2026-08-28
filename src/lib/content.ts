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
