import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    // Three.js alone is ~550 kB; that is expected for a 3D game.
    chunkSizeWarningLimit: 800,
    // Two pages: the game (/) and the map editor (/editor/).
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        editor: resolve(import.meta.dirname, 'editor/index.html'),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.js'],
  },
});
