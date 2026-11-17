import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createClient } from './schemasketch-client.js';
import { runTool, USER_AGENT } from './tool-context.js';

async function withServer(fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers);
    res.setHeader('Content-Type', 'application/json');
    res.end('{"data":[]}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await fn(`http://127.0.0.1:${server.address().port}/api`, seen);
  } finally {
    server.close();
  }
}

test('requests name the MCP client and the tool', async () => {
  await withServer(async (base, seen) => {
    const client = createClient('t0ken', base);
    await runTool('list_diagrams', () => client.listDiagrams());
    await client.listDiagrams();

    assert.match(USER_AGENT, /^SchemaSketch-MCP\/\d+\.\d+\.\d+$/);
    assert.equal(seen[0]['user-agent'], USER_AGENT);
    assert.equal(seen[0]['x-schemasketch-action'], 'list_diagrams');
    // Outside a tool call there is no action header.
    assert.equal(seen[1]['x-schemasketch-action'], undefined);
  });
});

test('concurrent tool calls keep their own names', async () => {
  await withServer(async (base, seen) => {
    const client = createClient('t0ken', base);
    await Promise.all([
      runTool('get_diagram', async () => { await new Promise((r) => setTimeout(r, 20)); return client.listDiagrams(); }),
      runTool('export_sql', () => client.listDiagrams()),
    ]);
    assert.deepEqual(seen.map((h) => h['x-schemasketch-action']).sort(), ['export_sql', 'get_diagram']);
  });
});

test('the MCP handshake reports the package version, not a hard-coded one', async () => {
  const { readFileSync } = await import('node:fs');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const { createMcpServer } = await import('./create-server.js');
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(createClient('tok', 'http://example.test/api'), {});
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  try {
    assert.deepEqual(client.getServerVersion(), { name: 'schemasketch', version: pkg.version });
  } finally {
    await client.close();
  }
});
