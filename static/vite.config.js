import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.source.html')
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
            return 'vendor';
          }
          if (id.includes('node_modules/framer-motion')) {
            return 'motion';
          }
        }
      }
    }
  },
  server: {
    proxy: {
      '/login': 'http://localhost:8080',
      '/register': 'http://localhost:8080',
      '/me': 'http://localhost:8080',
      '/rooms': 'http://localhost:8080',
      '/api': 'http://localhost:8080',
      '/chat': {
        target: 'ws://localhost:8080',
        ws: true
      }
    }
  }
});
