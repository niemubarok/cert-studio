import { basename, extname } from 'node:path';

const API_BASE = 'https://me-qr.com/api/v2';
const MAX_REQUEST_BYTES = 12 * 1024 * 1024;

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      const error = new Error('Permintaan JSON tidak valid.');
      error.status = 400;
      throw error;
    }
  }

  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) {
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

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Metode tidak diizinkan.' });
    return;
  }

  try {
    const input = await readJsonBody(req);
    const clientToken = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
    const token = clientToken || process.env.ME_QR_API_TOKEN;
    if (!token) {
      sendJson(res, 400, { error: 'Masukkan ME-QR API Key di UI atau atur ME_QR_API_TOKEN di Environment Variables Vercel.' });
      return;
    }

    const imageMatch = typeof input.file === 'string'
      ? input.file.match(/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/)
      : null;
    const fileName = typeof input.fileName === 'string'
      ? basename(input.fileName).replace(/[^a-zA-Z0-9._-]/g, '-')
      : '';

    if (!imageMatch || !fileName || extname(fileName).toLowerCase() !== '.png') {
      sendJson(res, 400, { error: 'Unggah lampiran PNG yang valid.' });
      return;
    }

    const headers = {
      'Content-Type': 'application/json',
      'X-AUTH-TOKEN': token
    };
    const createResponse = await fetch(`${API_BASE}/qr/file/create`, {
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
      sendJson(res, 502, {
        error: `ME-QR menolak pembuatan QR (HTTP ${createResponse.status}).`,
        details: apiResponseDetails(created)
      });
      return;
    }

    if (typeof created.data?.url === 'string') {
      const qrImageUrl = created.data.qrUrl || null;
      sendJson(res, 200, { url: created.data.url, qrImageUrl });
      return;
    }

    const entryId = created.data?.id;
    if ((typeof entryId !== 'number' && typeof entryId !== 'string') || String(entryId).length === 0) {
      sendJson(res, 502, {
        error: 'ME-QR menerima pembuatan QR, tetapi respons POST tidak menyertakan ID untuk melihat URL publik.',
        details: apiResponseDetails(created)
      });
      return;
    }

    const viewUrl = `${API_BASE}/qr/file/${encodeURIComponent(String(entryId))}?format=json`;
    const viewResponse = await fetch(viewUrl, { headers: { 'X-AUTH-TOKEN': token } });
    const viewed = await readApiJson(viewResponse);
    if (!viewResponse.ok || typeof viewed.data?.url !== 'string') {
      sendJson(res, 502, {
        error: `Gagal mengambil data QR dari ME-QR (HTTP ${viewResponse.status}).`,
        details: apiResponseDetails(viewed)
      });
      return;
    }

    let qrImageUrl = viewed.data.qrUrl;
    if (typeof qrImageUrl !== 'string' || qrImageUrl.length === 0) {
      const imageResponse = await fetch(`${API_BASE}/qr/file/${encodeURIComponent(String(entryId))}?format=png`, {
        headers: { 'X-AUTH-TOKEN': token }
      });
      if (!imageResponse.ok) {
        sendJson(res, 502, { error: `Gagal mengambil gambar QR dari ME-QR (HTTP ${imageResponse.status}).` });
        return;
      }
      const image = Buffer.from(await imageResponse.arrayBuffer()).toString('base64');
      qrImageUrl = `data:image/png;base64,${image}`;
    }

    sendJson(res, 200, { url: viewed.data.url, qrImageUrl });
  } catch (error) {
    sendJson(res, error.status || 502, { error: error.message || 'Gagal terhubung ke ME-QR.' });
  }
}
