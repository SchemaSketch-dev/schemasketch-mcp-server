import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from './schemasketch-client.js';

test('createClient sends the given bearer token to the right path', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify([{ id: '1', name: 'Test' }]), { status: 200 });
  };
  try {
    const client = createClient('tok_abc123', 'http://example.test/api');
    const result = await client.listDiagrams();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://example.test/api/diagrams');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer tok_abc123');
    assert.deepEqual(result, [{ id: '1', name: 'Test' }]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('two createClient instances never share token state', async () => {
  const authHeaders = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    authHeaders.push(options.headers.Authorization);
    return new Response('null', { status: 200 });
  };
  try {
    const clientA = createClient('token-a', 'http://example.test/api');
    const clientB = createClient('token-b', 'http://example.test/api');
    await clientA.listDiagrams();
    await clientB.listDiagrams();
    await clientA.listDiagrams();
    assert.deepEqual(authHeaders, ['Bearer token-a', 'Bearer token-b', 'Bearer token-a']);
  } finally {
    global.fetch = originalFetch;
  }
});

// Errors reach people through AI agents and Zapier, so each status gets a
// message that says what happened and what to do next.
async function errorFor(status, body, contentType = 'application/json') {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(body, { status, headers: { 'Content-Type': contentType } });
  try {
    await createClient('tok', 'http://example.test/api').getDiagram('x');
    assert.fail('expected an error');
  } catch (e) {
    return e;
  } finally {
    global.fetch = originalFetch;
  }
}

test('401 says the token is invalid or expired and how to get a new one', async () => {
  const e = await errorFor(401, JSON.stringify({ message: 'Unauthenticated.' }));
  assert.equal(e.status, 401);
  assert.match(e.message, /token is invalid or has expired/);
  assert.match(e.message, /Connect AI agent/);
});

test('403 and 404 pass the API message through', async () => {
  assert.equal((await errorFor(404, JSON.stringify({ message: 'Diagram not found.' }))).message, 'Diagram not found.');
  assert.equal((await errorFor(403, JSON.stringify({ message: 'This token is read-only.' }))).message, 'This token is read-only.');
});

test('422 lists the field errors', async () => {
  const e = await errorFor(422, JSON.stringify({
    message: 'The name field is required.',
    errors: { name: ['The name field is required.'], dbml_source: ['The dbml source must be a string.'] },
  }));
  assert.equal(e.message, 'Invalid input: The name field is required. The dbml source must be a string.');
});

test('429 asks to wait', async () => {
  assert.match((await errorFor(429, JSON.stringify({ message: 'Too Many Attempts.' }))).message, /Too many requests.*wait a minute/i);
});

test('5xx and non-JSON bodies give a plain retry message, not a JSON parse error', async () => {
  const e = await errorFor(502, '<html><body>Bad Gateway</body></html>', 'text/html');
  assert.equal(e.status, 502);
  assert.match(e.message, /SchemaSketch had a problem.*HTTP 502.*try again/i);
});

test('diagram ids are URL-encoded so they cannot reach another route', async () => {
  const originalFetch = global.fetch;
  let calledUrl;
  global.fetch = async (url) => { calledUrl = url; return new Response('{}', { status: 200 }); };
  try {
    await createClient('tok', 'http://example.test/api').getDiagram('abc/share');
    assert.equal(calledUrl, 'http://example.test/api/diagrams/abc%2Fshare');
  } finally {
    global.fetch = originalFetch;
  }
});

test('409 says someone else changed the diagram and how to recover', async () => {
  const e = await errorFor(409, JSON.stringify({ message: 'changed', current: { version: 7 } }));
  assert.match(e.message, /someone else changed this diagram.*version 7.*get_diagram/);
});
