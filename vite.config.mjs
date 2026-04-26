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
    // v2.16.12 — sourcemaps on for the diagnostic cycle. Adds ~25-30%
    // to dist size but lets the activity_log captureSentryException
    // resolve minified identifiers (the 'Ht' TDZ trace lost its file:line
    // without these). Hidden so they ship inside app.asar but aren't
    // exposed to the browser DevTools by default.
    sourcemap: 'hidden',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: mode === 'production',
        drop_debugger: true,
        pure_funcs: mode === 'production' ? ['console.log', 'console.info', 'console.debug', 'console.warn'] : [],
      },
      mangle: {
        // v2.16.11 — toplevel:true was renaming module-scoped identifiers
        // and, combined with our circular ESM import graph (CobrarModal ↔
        // PaymentErrorBoundary ↔ DataContext via useAPI), produced runtime
        // TDZ explosions: "Cannot access 'Ht' before initialization" at
        // CobrarModal mount → blocked every cobro on v2.16.10. Disabling
        // toplevel mangling. ~2-3% bundle size cost; total still < cap.
        toplevel: false,
      },
      format: {
        comments: false,
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          vendor:   ['react', 'react-dom', 'react-router-dom'],
          lucide:   ['lucide-react'],
          supabase: ['@supabase/supabase-js'],
          pdf:      ['pdf-lib', 'qrcode'],
        },
      },
    },
    chunkSizeWarningLimit: 800,
  },
}))
