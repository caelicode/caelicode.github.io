import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const port = Number(process.env.PREVIEW_PORT || 4174);
const host = process.env.PREVIEW_HOST || '127.0.0.1';
const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

function safePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const candidate = resolve(root, '.' + normalize(clean));
  return candidate.startsWith(root) ? candidate : null;
}

const server = createServer(async (request, response) => {
  let path = safePath(request.url || '/');
  if (!path) {
    response.writeHead(400);
    response.end('Bad request');
    return;
  }

  try {
    const info = await stat(path);
    if (info.isDirectory()) path = join(path, 'index.html');
    await stat(path);
  } catch {
    path = join(root, '404.html');
    response.statusCode = 404;
  }

  response.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
  response.setHeader('Cache-Control', 'no-store');
  createReadStream(path).pipe(response);
});

server.listen(port, host, () => {
  console.log(`CaeliCode Platform preview: http://${host}:${port}/`);
});
