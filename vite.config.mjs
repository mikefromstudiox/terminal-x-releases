import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  base: './',
  resolve: {
    alias: {
      '@terminal-x/services': path.resolve(__dirname, 'packages/services'),
      '@terminal-x/data': path.resolve(__dirname, 'packages/data'),
      '@terminal-x/ui': path.resolve(__dirname, 'packages/ui'),
    },
  },
  server: {
    fs: {
      allow: [__dirname],
    },
    watch: { ignored: ['**/web/**', '**/dist-web/**', '**/electron/**'] },
  },
  optimizeDeps: {
    exclude: [],
    entries: ['index.html'],
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '1.0.0'),
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: mode === 'production',
        drop_debugger: true,
        pure_funcs: mode === 'production' ? ['console.log', 'console.info', 'console.debug', 'console.warn'] : [],
      },
      mangle: {
        toplevel: true,
      },
      format: {
        comments: false,
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          vendor:  ['react', 'react-dom', 'react-router-dom'],
          lucide:  ['lucide-react'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
}))
