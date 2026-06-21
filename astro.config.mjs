import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://yoghurtofyouth.co.uk',
  integrations: [
    react(),
    sitemap({
      filter: (page) => !page.includes('/success'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()]
  }
});