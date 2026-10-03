// Read-only, localhost-only preview. Never reads or writes operational data.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const port = Number(process.env.PORT || 8092);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
http.createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (pathname.startsWith('/api/')) { response.writeHead(503, { 'Content-Type': 'application/json' }); response.end('{"error":"Isolated preview"}'); return; }
  const guidedPreview = pathname === '/grading-preview';
  if (pathname !== '/' && !guidedPreview && !pathname.startsWith('/assets/')) { response.writeHead(404); response.end(); return; }
  const file = path.resolve(root, pathname === '/' || guidedPreview ? 'index.html' : `.${pathname}`);
  if (!file.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
  try {
    let content = await fs.readFile(file);
    if (guidedPreview) {
      // Replace only the local preview's bootstrap. Production HTML is untouched.
      // No login, synchronization, operational save or real printer is involved.
      content = content.toString('utf8').replace(/<script src="assets\/remarkt-grading\.js[^\"]*"><\/script>/, `<script>
        STATE.currentUser = { id: 'local-preview', naam: 'Lokale preview', rol: 'Manager', voorkeur: 'beginner' };
        STATE.language = 'nl';
        startTestGrading('beginner');
        render();
      </script>`);
    }
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(content);
  } catch { response.writeHead(404); response.end(); }
}).listen(port, '127.0.0.1', () => console.log(`Isolated grading preview: http://127.0.0.1:${port}`));
