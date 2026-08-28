import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// Static site by default. The daily agent writes JSON into /content, Vercel
// rebuilds. Individual routes can opt into on-demand rendering with
// `export const prerender = false` (used by /api/* endpoints).
export default defineConfig({
  site: 'https://github-trending-projects.vercel.app',
  output: 'static',
  adapter: vercel(),
  build: { format: 'directory' },
});
