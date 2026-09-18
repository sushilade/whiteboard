import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const base = process.env.BASE_URL || '/';

export default defineConfig({
  plugins: [react()],
  root: 'client',
  base,
  server: {
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: true
      }
    }
  }
});
