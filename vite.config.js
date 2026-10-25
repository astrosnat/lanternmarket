import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the build works from any sub-path
  // (e.g. GitHub Pages at /lanternmarket/) as well as from the root.
  base: './',
});
