import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = fileURLToPath(new URL('.', import.meta.url));
try {
  process.loadEnvFile(join(workspaceRoot, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const port = Number(process.env.PORT || 4173);
const storageMode = process.env.STORAGE_MODE === 'local-sqlite' ? 'local-sqlite' : 'browser';
const sqlitePath = process.env.SQLITE_DB_PATH || join(workspaceRoot, 'drafts.sqlite');
let localDb = null;

async function getLocalSqliteDb() {
  if (localDb) return localDb;
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(sqlitePath);
  db.exec(`CREATE TABLE IF NOT EXISTS drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_name TEXT NOT NULL,
    certificate_number TEXT NOT NULL,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  localDb = db;
  return localDb;
}
const apiBase = 'https://me-qr.com/api/v2';
const maxRequestBytes = 12 * 1024 * 1024;
const localOrigins = new Set([
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'http://127.0.0.1:4173',
  'http://localhost:4173'
]);
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/bg.jpg', ['bg.jpg', 'image/jpeg']],
  ['/bg.webp', ['bg.webp', 'image/webp']],
  ['/bg-klasik.jpg', ['bg-klasik.jpg', 'image/jpeg']],
  ['/bg-klasik.webp', ['bg-klasik.webp', 'image/webp']],
  ['/ttd.png', ['ttd.png', 'image/png']]
]);

function sendJson(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxRequestBytes) {
      const error = new Error('Lampiran terlalu besar untuk diunggah.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Permintaan JSON tidak valid.');
    error.status = 400;
    throw error;
  }
}

async function readApiJson(response) {
  const text = await response.text();
  try {
    return { data: JSON.parse(text), text };
  } catch {
    return { data: null, text };
  }
}

function apiResponseDetails(result) {
  return result.text.trim().slice(0, 500) || 'ME-QR mengembalikan respons kosong.';
}

async function createFileQr(request, response) {
  try {
    const input = await readJson(request);
    const clientToken = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
    const token = clientToken || process.env.ME_QR_API_TOKEN;
    if (!token) {
      sendJson(response, 400, { error: 'Masukkan ME-QR API Key di UI atau atur ME_QR_API_TOKEN di environment server lokal.' });
      return;
    }

    const imageMatch = typeof input.file === 'string'
      ? input.file.match(/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/)
      : null;
    const fileName = typeof input.fileName === 'string'
      ? basename(input.fileName).replace(/[^a-zA-Z0-9._-]/g, '-')
      : '';

    if (!imageMatch || !fileName || extname(fileName).toLowerCase() !== '.png') {
      sendJson(response, 400, { error: 'Unggah lampiran PNG yang valid.' });
      return;
    }

    const headers = {
      'Content-Type': 'application/json',
      'X-AUTH-TOKEN': token
    };
    const createResponse = await fetch(`${apiBase}/qr/file/create`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        qrFieldsData: {
          file: input.file,
          fileName
        },
        title: `Lampiran ${fileName}`,
        format: 'json'
      })
    });
    const created = await readApiJson(createResponse);

    if (!createResponse.ok) {
      sendJson(response, 502, {
        error: `ME-QR menolak pembuatan QR (HTTP ${createResponse.status}).`,
        details: apiResponseDetails(created)
      });
      return;
    }

    if (typeof created.data?.url === 'string') {
      const qrImageUrl = created.data.qrUrl || null;
      sendJson(response, 200, { url: created.data.url, qrImageUrl });
      return;
    }

    const entryId = created.data?.id;
    if ((typeof entryId !== 'number' && typeof entryId !== 'string') || String(entryId).length === 0) {
      sendJson(response, 502, {
        error: 'ME-QR menerima pembuatan QR, tetapi respons POST tidak menyertakan ID untuk melihat URL publik.',
        details: apiResponseDetails(created)
      });
      return;
    }

    const viewUrl = `${apiBase}/qr/file/${encodeURIComponent(String(entryId))}?format=json`;
    const viewResponse = await fetch(viewUrl, { headers: { 'X-AUTH-TOKEN': token } });
    const viewed = await readApiJson(viewResponse);
    if (!viewResponse.ok || typeof viewed.data?.url !== 'string') {
      sendJson(response, 502, {
        error: `Gagal mengambil data QR dari ME-QR (HTTP ${viewResponse.status}).`,
        details: apiResponseDetails(viewed)
      });
      return;
    }

    let qrImageUrl = viewed.data.qrUrl;
    if (typeof qrImageUrl !== 'string' || qrImageUrl.length === 0) {
      const imageResponse = await fetch(`${apiBase}/qr/file/${encodeURIComponent(String(entryId))}?format=png`, {
        headers: { 'X-AUTH-TOKEN': token }
      });
      if (!imageResponse.ok) {
        sendJson(response, 502, { error: `Gagal mengambil gambar QR dari ME-QR (HTTP ${imageResponse.status}).` });
        return;
      }
      const image = Buffer.from(await imageResponse.arrayBuffer()).toString('base64');
      qrImageUrl = `data:image/png;base64,${image}`;
    }

    sendJson(response, 200, { url: viewed.data.url, qrImageUrl });
  } catch (error) {
    sendJson(response, error.status || 502, { error: error.message || 'Gagal terhubung ke ME-QR.' });
  }
}

function applyLocalCors(request, response, methods) {
  const origin = request.headers.origin;
  if (origin && localOrigins.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }

  if (request.method === 'OPTIONS') {
    if (!localOrigins.has(origin)) {
      sendJson(response, 403, { error: 'Origin lokal tidak diizinkan.' });
      return true;
    }
    response.writeHead(204, {
      'Access-Control-Allow-Methods': methods,
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    response.end();
    return true;
  }
  return false;
}

async function handleDraftsApi(request, response, pathname) {
  if (storageMode !== 'local-sqlite') {
    sendJson(response, 404, { error: 'Penyimpanan SQLite lokal tidak aktif (STORAGE_MODE=browser).' });
    return;
  }

  const db = await getLocalSqliteDb();
  const idMatch = pathname.match(/^\/api\/drafts\/(\d+)$/);

  if (pathname === '/api/drafts' && request.method === 'GET') {
    const drafts = db.prepare(
      'SELECT id, recipient_name, certificate_number, updated_at FROM drafts ORDER BY updated_at DESC'
    ).all();
    sendJson(response, 200, { drafts });
    return;
  }

  if (pathname === '/api/drafts' && request.method === 'POST') {
    const body = await readJson(request);
    const data = body.data && typeof body.data === 'object' ? body.data : body;
    const now = new Date().toISOString();
    const recipientName = String(data.in_recipient_name || '').trim() || 'Tanpa nama';
    const certificateNumber = String(data.in_cert_no || '').trim();
    const result = db.prepare(
      'INSERT INTO drafts (recipient_name, certificate_number, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(recipientName, certificateNumber, JSON.stringify(data), now, now);
    sendJson(response, 201, {
      draft: {
        id: Number(result.lastInsertRowid),
        recipient_name: recipientName,
        certificate_number: certificateNumber,
        created_at: now,
        updated_at: now
      }
    });
    return;
  }

  if (idMatch && request.method === 'GET') {
    const draft = db.prepare(
      'SELECT id, recipient_name, certificate_number, data_json, created_at, updated_at FROM drafts WHERE id = ?'
    ).get(Number(idMatch[1]));
    if (!draft) {
      sendJson(response, 404, { error: 'Draft tidak ditemukan.' });
      return;
    }
    sendJson(response, 200, { draft });
    return;
  }

  if (idMatch && request.method === 'PUT') {
    const body = await readJson(request);
    const data = body.data && typeof body.data === 'object' ? body.data : body;
    const now = new Date().toISOString();
    const recipientName = String(data.in_recipient_name || '').trim() || 'Tanpa nama';
    const certificateNumber = String(data.in_cert_no || '').trim();
    const result = db.prepare(
      'UPDATE drafts SET recipient_name = ?, certificate_number = ?, data_json = ?, updated_at = ? WHERE id = ?'
    ).run(recipientName, certificateNumber, JSON.stringify(data), now, Number(idMatch[1]));
    if (result.changes === 0) {
      sendJson(response, 404, { error: 'Draft tidak ditemukan.' });
      return;
    }
    sendJson(response, 200, {
      draft: {
        id: Number(idMatch[1]),
        recipient_name: recipientName,
        certificate_number: certificateNumber,
        updated_at: now
      }
    });
    return;
  }

  if (idMatch && request.method === 'DELETE') {
    db.prepare('DELETE FROM drafts WHERE id = ?').run(Number(idMatch[1]));
    sendJson(response, 200, { deleted: true });
    return;
  }

  sendJson(response, 405, { error: 'Metode tidak diizinkan.' });
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  if (requestUrl.pathname === '/api/config') {
    if (applyLocalCors(request, response, 'GET, OPTIONS')) return;
    if (request.method === 'GET') {
      sendJson(response, 200, { storageMode });
      return;
    }
  }

  if (requestUrl.pathname === '/api/drafts' || requestUrl.pathname.startsWith('/api/drafts/')) {
    if (applyLocalCors(request, response, 'GET, POST, PUT, DELETE, OPTIONS')) return;
    try {
      await handleDraftsApi(request, response, requestUrl.pathname);
    } catch (error) {
      sendJson(response, error.status || 500, { error: error.message || 'Kesalahan server SQLite lokal.' });
    }
    return;
  }

  if (requestUrl.pathname === '/api/qr/file') {
    if (applyLocalCors(request, response, 'POST, OPTIONS')) return;

    if (request.method === 'POST') {
      await createFileQr(request, response);
      return;
    }
  }

  if (request.method !== 'GET' || !staticFiles.has(requestUrl.pathname)) {
    sendJson(response, 404, { error: 'Halaman atau file tidak ditemukan.' });
    return;
  }

  const [fileName, contentType] = staticFiles.get(requestUrl.pathname);
  const filePath = join(workspaceRoot, fileName);
  if (!existsSync(filePath)) {
    sendJson(response, 404, { error: 'Halaman atau file tidak ditemukan.' });
    return;
  }
  response.writeHead(200, { 'Content-Type': contentType });
  createReadStream(filePath).pipe(response);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Editor sertifikat berjalan di http://localhost:${port}`);
});
