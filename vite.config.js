import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Three.js alone is ~550 kB; that is expected for a 3D game.
    chunkSizeWarningLimit: 800,
  },
  test: {
    include: ['tests/**/*.test.js'],
  },
});
