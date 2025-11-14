import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    allowedHosts: ['wsl-3000.rensatsu.eu.org'],
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  build: {
    rollupOptions: {
      input: {
        index1: './index1.html',
        index2: './index2.html',
        index3: './index3.html',
        index4: './index4.html',
      }
    },
  },
});
