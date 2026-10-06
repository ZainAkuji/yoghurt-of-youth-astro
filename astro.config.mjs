import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import googleReviewsDev from './integrations/google-reviews-dev.ts';

export default defineConfig({
  site: 'https://yoghurtofyouth.co.uk',
  integrations: [
    react(),
    googleReviewsDev(),
    sitemap({
      filter: (page) => !page.includes('/success'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()]
  }
});
