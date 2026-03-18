import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '1.0.0'),
  },
  build: {
    outDir: 'dist',
    sourcemap: false,  // no source maps in production build
    minify: 'terser',
    terserOptions: {
      compress: {
        // Remove all console.* calls in production
        drop_console: mode === 'production',
        drop_debugger: true,
        pure_funcs: mode === 'production' ? ['console.log', 'console.info', 'console.debug', 'console.warn'] : [],
      },
      mangle: {
        toplevel: true,
      },
      format: {
        comments: false,  // strip all comments
      },
    },
    rollupOptions: {
      output: {
        // Chunk splitting for better caching
        manualChunks: {
          vendor:  ['react', 'react-dom', 'react-router-dom'],
          lucide:  ['lucide-react'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
}))
