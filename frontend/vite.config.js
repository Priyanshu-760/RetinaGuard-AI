import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev-server proxy forwards API calls to the Flask backend so no CORS
// changes are needed in app.py. Flask stays the source of truth:
//   GET  /health  -> service status
//   POST /analyze -> multipart image inference
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/health': 'http://localhost:5000',
      '/analyze': 'http://localhost:5000',
    },
  },
  preview: {
    port: 4173,
  },
});
