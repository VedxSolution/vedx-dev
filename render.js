/**
 * backend/src/ssr/render.js
 *
 * Express middleware that drives the full SSR pipeline for VedX Solution:
 *
 *   Browser Request
 *       ↓
 *   Express server receives request  (this file, via createSsrMiddleware())
 *       ↓
 *   ReactDOMServer.renderToString()  (frontend/src/entry-server.jsx)
 *       ↓
 *   Inject HTML + Emotion styles + Helmet meta into index.html template
 *       ↓
 *   Returns full HTML with content
 *       ↓
 *   Browser displays page immediately — no blank flash, SEO-ready
 *       ↓
 *   entry-client.jsx → hydrateRoot() → React becomes interactive → SPA navigation
 *
 * Build:
 *   Production SSR bundle:  cd frontend && npm run build:ssr
 *   Output:                 frontend/dist/server/entry-server.js
 *
 * Development:
 *   Uses vite.ssrLoadModule() for instant HMR — no build step needed.
 *   See server-dev.js for how to pass the Vite dev server instance here.
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { injectIntoTemplate } from './template.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─── File paths ───────────────────────────────────────────────────────────────
const FRONTEND_ROOT   = path.resolve(__dirname, '../../../frontend');
const SSR_BUNDLE      = path.join(FRONTEND_ROOT, 'dist/server/entry-server.js');
const INDEX_HTML_PROD = path.join(FRONTEND_ROOT, 'dist/index.html');
const INDEX_HTML_DEV  = path.join(FRONTEND_ROOT, 'index.html');

// ─── Noindex: inject on dev.vedxsolution.com only ────────────────────────────
// Reads VITE_NOINDEX from the backend .env — no nginx sub_filter needed.
// Set VITE_NOINDEX=true in backend/.env.development
// Set VITE_NOINDEX=false (or omit) in backend/.env (production)
const NOINDEX_TAG = process.env.VITE_NOINDEX === 'true'
  ? '<meta name="robots" content="noindex, nofollow" />'
  : '';

// ─── Routes that must NOT be SSR'd ───────────────────────────────────────────
// Admin is CSR-only. API, sitemaps, and static assets pass straight through.
const SKIP_SSR_PREFIXES = [
  '/admin',
  '/api',
  '/assets',
  '/_vite',
  '/sitemap',
  '/robots.txt',
  '/llms.txt',
];

const shouldSkipSSR = (url) => {
  const pathname = url.split('?')[0];
  if (path.extname(pathname)) return true; // static asset (e.g. .png, .js, .css)
  return SKIP_SSR_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/')
  );
};

// ─── Load SSR render function ─────────────────────────────────────────────────
// Cached after first load in production so we don't re-import on every request.
let _renderFn = null;

// ─── Cache management ─────────────────────────────────────────────────────────
/**
 * Clear the cached render function so the next request reloads the SSR bundle.
 * Called by POST /api/admin/ssr-cache/clear.
 */
export const clearSsrCache = () => {
  _renderFn = null;
};

export const getSsrCacheStats = () => ({
  renderFnCached: _renderFn !== null,
});

const loadRender = async (vite) => {
  // Development: always use ssrLoadModule so edits are picked up instantly (HMR)
  if (vite) {
    const mod = await vite.ssrLoadModule('/src/entry-server.jsx');
    return mod.render;
  }

  // Production: load once, then cache
  if (_renderFn) return _renderFn;

  if (!existsSync(SSR_BUNDLE)) {
    throw new Error(
      `[SSR] Server bundle not found: ${SSR_BUNDLE}\n` +
      'Run:  cd frontend && npm run build:ssr'
    );
  }

  // Node's ESM loader requires a file:// URL for absolute-path dynamic
  // import()s on Windows (a raw drive-letter path like "D:\..." throws
  // ERR_UNSUPPORTED_ESM_URL_SCHEME); pathToFileURL() is a no-op-equivalent
  // on POSIX, so this is safe on every platform.
  const mod  = await import(pathToFileURL(SSR_BUNDLE).href);
  _renderFn  = mod.render;
  return _renderFn;
};

// ─── Load HTML template ───────────────────────────────────────────────────────
const readTemplate = (htmlPath) => readFileSync(htmlPath, 'utf-8');

// ─── Middleware factory ───────────────────────────────────────────────────────
/**
 * createSsrMiddleware(options?)
 *
 * @param {object}  [options]
 * @param {import('vite').ViteDevServer} [options.vite]
 *   Pass the Vite dev server in development for HMR + HTML transformation.
 *   Omit (or leave undefined) in production.
 *
 * @returns Express request handler
 */
export const createSsrMiddleware = ({ vite } = {}) => {
  return async (req, res, next) => {
    // Skip — let API routes, admin, and static assets through
    if (shouldSkipSSR(req.url)) return next();

    try {
      // ── Load and (in dev) transform the HTML template ───────────────────
      let template;
      if (vite) {
        // Vite injects HMR client script and resolves module URLs for dev
        const raw = readTemplate(INDEX_HTML_DEV);
        template  = await vite.transformIndexHtml(req.originalUrl, raw);
      } else {
        template = readTemplate(
          existsSync(INDEX_HTML_PROD) ? INDEX_HTML_PROD : INDEX_HTML_DEV
        );
      }

      // ── Call ReactDOMServer.renderToString() ────────────────────────────
      const render                          = await loadRender(vite);
      const { html, styles, helmet, noIndexTag } = await render(req.originalUrl);

      // ── Inject SSR output into the HTML shell ───────────────────────────
      // Styles are injected inline as <style> tags directly into the HTML —
      // NOT as an external /__ssr-styles/*.css file — so Nginx never needs
      // to proxy a second request for the CSS (which it would block via the
      // static-asset location rule before it reaches Express).
      const fullHtml = injectIntoTemplate(template, {
        html,
        styles,   // raw <style data-emotion="css …">…</style> tags, injected inline
        helmet,
        // NOINDEX_TAG from backend env takes priority over SSR bundle value
        noIndexTag: NOINDEX_TAG || noIndexTag || '',
      });

      res.status(200).set('Content-Type', 'text/html').send(fullHtml);
    } catch (err) {
      if (vite) vite.ssrFixStacktrace(err); // improve stack traces in dev
      console.error('[SSR] Error rendering', req.url, '—', err?.message ?? err);
      next(err); // fall back to Express error handler
    }
  };
};
