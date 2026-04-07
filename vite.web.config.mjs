import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig(({ mode }) => ({
  root: 'web',
  envDir: path.resolve(__dirname),
  plugins: [react(), tailwindcss()],
  publicDir: 'public',
  resolve: {
    alias: {
      '@terminal-x/services': path.resolve(__dirname, 'packages/services'),
      '@terminal-x/data': path.resolve(__dirname, 'packages/data'),
      '@terminal-x/ui': path.resolve(__dirname, 'packages/ui'),
      '@': path.resolve(__dirname, 'packages/ui'),
    },
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname)],
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '1.0.0'),
  },
  build: {
    outDir: '../dist-web',
    emptyOutDir: true,
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
        manualChunks(id) {
          if (id.includes('node_modules/react-dom')) return 'vendor'
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-router')) return 'vendor'
          if (id.includes('node_modules/lucide-react')) return 'lucide'
          if (id.includes('node_modules/@supabase')) return 'supabase'
          if (id.includes('node_modules/pdf-lib') || id.includes('node_modules/qrcode')) return 'pdf'
          if (id.includes('packages/services/ecf') || id.includes('packages/services/printer') || id.includes('packages/services/pdf')) return 'services'
          if (id.includes('packages/data/web')) return 'data'
        },
      },
    },
    chunkSizeWarningLimit: 800,
  },
}))
