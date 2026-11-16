#!/usr/bin/env node
// Local stdio MCP server entrypoint (published to npm as
// schemasketch-mcp-server, run via `npx schemasketch-mcp-server`). Tool
// definitions live in create-server.js, shared with http-server.js (the
// hosted mcp.schemasketch.dev endpoint) — this file only wires stdio.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { schemasketch } from './schemasketch-client.js';
import { createMcpServer } from './create-server.js';

// Links point at the site whose API this server talks to, unless overridden.
const apiBase = process.env.SCHEMASKETCH_API_BASE;
const appUrl = process.env.SCHEMASKETCH_APP_URL || (apiBase ? new URL(apiBase).origin : undefined);
const server = createMcpServer(schemasketch, { appUrl });
const transport = new StdioServerTransport();
await server.connect(transport);
