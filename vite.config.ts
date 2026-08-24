import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname, 'src/viewer'),
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'dist/viewer'),
    emptyOutDir: true,
    assetsDir: 'assets',
  },
  base: './',
});
