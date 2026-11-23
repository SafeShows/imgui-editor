import { defineConfig } from 'vite';

// Relative base: the built site works from any GitHub Pages path (or a local folder served over http).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    // jsimgui 0.14 imports a freetype+extensions loader it doesn't ship; only the default loader is used here.
    rollupOptions: { external: [/loader-freetype-extensions\.js$/] },
  },
  // Served as-is so its WebAssembly file resolves next to it.
  optimizeDeps: { exclude: ['@mori2003/jsimgui'] },
});
