import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const port = Number(process.env.GARDEN_PORT || 7432);
const api = {
  '/api/daily-reminder': '../api/daily-reminder.js',
  '/api/garden-advice': '../api/garden-advice.js',
  '/api/seed-lookup': '../api/seed-lookup.js'
};
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (api[url.pathname]) {
      res.status = code => { res.statusCode = code; return res; };
      req.query = Object.fromEntries(url.searchParams);
      const parts = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) return res.status(413).end('Request too large');
        parts.push(chunk);
      }
      if (parts.length) {
        try { req.body = JSON.parse(Buffer.concat(parts).toString('utf8')); }
        catch { return res.status(400).end('Invalid JSON'); }
      }
      const { default: handler } = await import(api[url.pathname]);
      return await handler(req, res);
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.statusCode = 405; return res.end(); }
    let pathname = decodeURIComponent(url.pathname).replaceAll('\\', '/');
    if (pathname.endsWith('/')) pathname += 'index.html';
    const target = resolve(root, '.' + pathname);
    if ((!pathname.startsWith('/outputs/') && pathname !== '/index.html') || !target.startsWith(root + sep)) { res.statusCode = 404; return res.end('Not found'); }
    const info = await stat(target);
    if (!info.isFile()) throw new Error('Not a file');
    res.setHeader('Content-Type', types[extname(target)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    if (req.method === 'HEAD') return res.end();
    createReadStream(target).pipe(res);
  } catch {
    if (!res.headersSent) res.statusCode = 404;
    res.end('This resource is unavailable.');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Garden preview: http://127.0.0.1:${port}/`));
process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
