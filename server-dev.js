/**
 * backend/src/ssr/server-dev.js
 *
 * Development-only SSR server.
 * Starts the Vite dev server as middleware inside Express so that:
 *   - entry-server.jsx changes are picked up instantly (HMR via ssrLoadModule)
 *   - index.html gets Vite's HMR client injected automatically
 *   - API routes still work through the same Express process
 *
 * Usage:
 *   node backend/src/ssr/server-dev.js
 *   OR add to backend package.json: "dev:ssr": "node src/ssr/server-dev.js"
 *
 * In production use the regular server:
 *   node backend/src/server.js   (after: cd frontend && npm run build:ssr)
 */

import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSsrMiddleware } from './render.js';

const __filename  = fileURLToPath(import.meta.url);
const __dirname   = path.dirname(__filename);
const FRONTEND_ROOT = path.resolve(__dirname, '../../../frontend');

const PORT = Number(process.env.SSR_DEV_PORT || 3000);

async function startDevServer() {
  const app = express();

  // ── Vite dev server as middleware ─────────────────────────────────────────
  const vite = await createViteServer({
    root: FRONTEND_ROOT,
    server: { middlewareMode: true },
    appType: 'custom', // disable Vite's own HTML serving — we do it via SSR
  });

  // Vite serves JS/CSS/HMR WebSocket — must come BEFORE SSR middleware
  app.use(vite.middlewares);

  // ── SSR middleware (with Vite instance for HMR) ───────────────────────────
  app.use(createSsrMiddleware({ vite }));

  app.listen(PORT, () => {
    console.log(`[SSR dev] Server running at http://localhost:${PORT}`);
    console.log('[SSR dev] Vite HMR active — edits to entry-server.jsx reload instantly');
  });
}

startDevServer().catch((err) => {
  console.error('[SSR dev] Failed to start:', err);
  process.exit(1);
});
