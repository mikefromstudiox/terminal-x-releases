import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig(({ mode }) => ({
  root: 'web',
  envDir: path.resolve(__dirname),
  plugins: [
    react(),
    tailwindcss(),
    // CSP nonce injector — adds nonce="__CSP_NONCE__" to every <script> and
    // <link rel="modulepreload"|"stylesheet"> tag in the built HTML so the
    // Edge middleware can swap them per-request. Required because Vite's
    // built-in HTML emitter strips custom attributes from the entry script.
    {
      name: 'csp-nonce-inject',
      enforce: 'post',
      transformIndexHtml: {
        order: 'post',
        handler(html) {
          // <script ...> without an existing nonce attribute. Skip
          // application/ld+json data blocks — they're not executable and CSP
          // script-src doesn't apply to them.
          html = html.replace(
            /<script(?![^>]*\bnonce=)(?![^>]*type=("|')application\/ld\+json\1)([^>]*)>/g,
            '<script$2 nonce="__CSP_NONCE__">'
          );
          // <link rel="modulepreload" ...> and <link rel="stylesheet" ...>
          html = html.replace(
            /<link(?![^>]*\bnonce=)([^>]*\brel=("|')(?:modulepreload|stylesheet)\2[^>]*)>/g,
            '<link$1 nonce="__CSP_NONCE__">'
          );
          return html;
        },
      },
    },
  ],
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
    // Strip modulepreload hints for heavy lazy-only chunks (pdf, data, supabase,
    // services). Vite preloads every reachable chunk by default — including ones
    // gated behind React.lazy() — which forces the landing page to download
    // ~330 KiB it never executes. Browser still fetches them on-demand when the
    // lazy import resolves; we just stop pre-fetching them at first paint.
    modulePreload: {
      resolveDependencies: (filename, deps) =>
        deps.filter(d => !/\/(pdf|data|supabase|services)-[A-Za-z0-9_-]+\.js$/.test(d)),
    },
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
