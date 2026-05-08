import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      ignored: ['**/model/**']
    },
    proxy: {
      // Proxy all /api requests to Express backend on port 5050
      '/api': {
        target: 'http://localhost:5050',
        changeOrigin: true,
        secure: false,
      },
      // Proxy video feed from Flask AI model on port 5001
      '/video_feed': {
        target: 'http://localhost:5001',
        changeOrigin: true,
        secure: false,
      },
    }
  }
})
