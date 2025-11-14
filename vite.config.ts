import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    allowedHosts: ['wsl-3000.rensatsu.eu.org'],
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
});
