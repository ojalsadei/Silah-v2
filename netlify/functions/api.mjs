import { handleRequest } from '../../server.js';

function normalizeApiUrl(requestUrl) {
  const url = new URL(requestUrl);
  let pathname = url.pathname;

  const functionPrefix = '/.netlify/functions/api';
  if (pathname.startsWith(functionPrefix)) {
    const rest = pathname.slice(functionPrefix.length);
    pathname = rest.startsWith('/api/') ? rest : `/api${rest || '/'}`;
  }

  if (!pathname.startsWith('/api/')) {
    pathname = `/api${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
  }

  return `${pathname}${url.search}`;
}

function makeNodeRequest(request) {
  const headers = Object.fromEntries(request.headers.entries());
  if (!headers.host) headers.host = new URL(request.url).host;

  return {
    method: request.method,
    headers,
    url: normalizeApiUrl(request.url),
    async *[Symbol.asyncIterator]() {
      if (request.method === 'GET' || request.method === 'HEAD') return;
      const body = Buffer.from(await request.arrayBuffer());
      if (body.length) yield body;
    }
  };
}

function makeNodeResponse(resolve) {
  let status = 200;
  const headers = new Headers();
  const chunks = [];
  let ended = false;

  const response = {
    writeHead(nextStatus, nextHeaders = {}) {
      status = nextStatus;
      for (const [key, value] of Object.entries(nextHeaders)) {
        if (value !== undefined) headers.set(key, String(value));
      }
      return response;
    },
    setHeader(key, value) {
      headers.set(key, String(value));
    },
    getHeader(key) {
      return headers.get(key);
    },
    write(chunk) {
      if (chunk !== undefined && chunk !== null) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      return true;
    },
    end(chunk) {
      if (ended) return;
      ended = true;
      if (chunk !== undefined && chunk !== null) response.write(chunk);
      headers.delete('content-length');
      const body = chunks.length ? Buffer.concat(chunks) : null;
      resolve(new Response(body, { status, headers }));
    }
  };

  return response;
}

export default async function handler(request) {
  return await new Promise(async (resolve) => {
    const req = makeNodeRequest(request);
    const res = makeNodeResponse(resolve);

    try {
      await handleRequest(req, res);
    } catch (error) {
      console.error('Netlify API adapter error', error);
      resolve(new Response(JSON.stringify({ error: 'حدث خطأ غير متوقع في الخادم' }), {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      }));
    }
  });
}
