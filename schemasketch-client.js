// Thin HTTP client for the SchemaSketch Laravel API (bearer-token auth via
// Sanctum). Node 18+ has a global fetch, so no HTTP library dependency is
// needed.
//
// Two ways to get a client:
// - createClient(token) — one token, bound to one client instance. Used by
//   the remote HTTP MCP server (http-server.js), where every request
//   carries its own token and must never share state with any other
//   request.
// - `schemasketch` (below) — an env-based singleton for the local stdio
//   server (index.js), where one process always serves exactly one user.

import { USER_AGENT, currentTool } from './tool-context.js';

// Defaults to the live site, so `npx schemasketch-mcp-server` works with just a
// token. Local development sets SCHEMASKETCH_API_BASE (see ../.mcp.json).
const API_BASE = process.env.SCHEMASKETCH_API_BASE || 'https://schemasketch.dev/api';

async function httpRequest(apiBase, token, path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const tool = currentTool();
  if (tool) headers['X-SchemaSketch-Action'] = tool;

  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON (e.g. a proxy's HTML error page). Fine for errors, handled below.
    if (res.ok) throw new Error('SchemaSketch returned an unexpected response. Try again in a minute.');
  }
  if (!res.ok) {
    const err = new Error(errorMessage(res.status, data));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Errors reach people through AI agents and Zapier, so say what happened
// and what to do next.
function errorMessage(status, data) {
  if (status === 401) {
    return 'Your SchemaSketch token is invalid or has expired. Create a new one in the ' +
      '"Connect AI agent" dialog at https://schemasketch.dev/app and reconnect with it.';
  }
  if (status === 422 && data?.errors) {
    return `Invalid input: ${Object.values(data.errors).flat().join(' ')}`;
  }
  if (status === 409) {
    const v = data?.current?.version;
    return 'Not saved: someone else changed this diagram since you read it' +
      (v ? ` (it is now version ${v})` : '') + '. Fetch it again with get_diagram and reapply your change.';
  }
  if (status === 429) return 'Too many requests to SchemaSketch. Wait a minute and try again.';
  if (status >= 500) {
    return `SchemaSketch had a problem handling this request (HTTP ${status}). Try again in a minute.`;
  }
  return data?.message || `SchemaSketch API request failed (HTTP ${status}).`;
}

const diagramPath = (id) => `/diagrams/${encodeURIComponent(id)}`;

export function createClient(token, apiBase = API_BASE) {
  return {
    listDiagrams: () => httpRequest(apiBase, token, '/diagrams'),
    getDiagram: (id) => httpRequest(apiBase, token, diagramPath(id)),
    createDiagram: (payload) => httpRequest(apiBase, token, '/diagrams', { method: 'POST', body: payload }),
    updateDiagram: (id, payload) => httpRequest(apiBase, token, diagramPath(id), { method: 'PUT', body: payload }),
    deleteDiagram: (id) => httpRequest(apiBase, token, diagramPath(id), { method: 'DELETE' }),
  };
}

let cachedToken = process.env.SCHEMASKETCH_TOKEN || null;
const canReLogin = Boolean(process.env.SCHEMASKETCH_EMAIL && process.env.SCHEMASKETCH_PASSWORD);

async function login() {
  const res = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ email: process.env.SCHEMASKETCH_EMAIL, password: process.env.SCHEMASKETCH_PASSWORD }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || `Login failed (${res.status})`);
  return data.token;
}

async function ensureToken() {
  if (cachedToken) return cachedToken;
  if (!canReLogin) {
    throw new Error(
      'No SchemaSketch credentials configured. Set SCHEMASKETCH_TOKEN (create one at https://schemasketch.dev/app: ' +
      '"Connect AI agent" → Local), ' +
      'or SCHEMASKETCH_EMAIL and SCHEMASKETCH_PASSWORD, in this MCP server\'s environment.'
    );
  }
  cachedToken = await login();
  return cachedToken;
}

async function requestWithRelogin(path, opts = {}, isRetry = false) {
  const token = await ensureToken();
  try {
    return await httpRequest(API_BASE, token, path, opts);
  } catch (e) {
    if (e.status === 401 && !isRetry && canReLogin) {
      cachedToken = null; // the token (ours or user-supplied) is no longer valid — try one fresh login
      return requestWithRelogin(path, opts, true);
    }
    throw e;
  }
}

export const schemasketch = {
  listDiagrams: () => requestWithRelogin('/diagrams'),
  getDiagram: (id) => requestWithRelogin(diagramPath(id)),
  createDiagram: (payload) => requestWithRelogin('/diagrams', { method: 'POST', body: payload }),
  updateDiagram: (id, payload) => requestWithRelogin(diagramPath(id), { method: 'PUT', body: payload }),
  deleteDiagram: (id) => requestWithRelogin(diagramPath(id), { method: 'DELETE' }),
};
