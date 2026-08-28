import { defineConfig } from 'astro/config';

// Static site. The daily agent writes JSON into /content, Vercel rebuilds.
export default defineConfig({
  site: 'https://trending-ledger.vercel.app',
  build: { format: 'directory' },
});
