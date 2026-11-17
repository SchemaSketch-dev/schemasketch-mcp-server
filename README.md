# SchemaSketch MCP server

[![Latest version](https://img.shields.io/npm/v/schemasketch-mcp-server?label=version)](https://www.npmjs.com/package/schemasketch-mcp-server)
[![Tests](https://github.com/SchemaSketch-dev/schemasketch-mcp-server/actions/workflows/check.yml/badge.svg?branch=main)](https://github.com/SchemaSketch-dev/schemasketch-mcp-server/actions/workflows/check.yml)
[![Downloads](https://img.shields.io/npm/dm/schemasketch-mcp-server)](https://www.npmjs.com/package/schemasketch-mcp-server)
[![Node](https://img.shields.io/node/v/schemasketch-mcp-server)](package.json)
[![MCP](https://img.shields.io/badge/MCP-server-6E56CF)](https://modelcontextprotocol.io)
[![License](https://img.shields.io/npm/l/schemasketch-mcp-server)](LICENSE)
[![SchemaSketch status](https://img.shields.io/endpoint?url=https%3A%2F%2Fstatus.schemasketch.dev%2Fbadge.json)](https://status.schemasketch.dev)

Lets AI agents (Claude, Cursor, Windsurf, Gemini and any other MCP client) read and edit
your [SchemaSketch](https://schemasketch.dev) database diagrams: list them, read and write
DBML, validate it, and convert to and from SQL, Laravel migrations and Eloquent models,
Mermaid and PlantUML.

## 1. Get a token

Sign in at [schemasketch.dev/app](https://schemasketch.dev/app) (free), click
**Connect AI agent**, and generate a token. Choose **Read & edit**, or **Read-only** if the
agent should only look; read-only tokens hide the tools that change diagrams.

## 2. Connect your agent

### Run it locally (npm)

Needs Node 18 or newer. Add this to your MCP client's config:

```json
{
  "mcpServers": {
    "schemasketch": {
      "command": "npx",
      "args": ["-y", "schemasketch-mcp-server"],
      "env": { "SCHEMASKETCH_TOKEN": "your-token" }
    }
  }
}
```

Instead of a token you can set `SCHEMASKETCH_EMAIL` and `SCHEMASKETCH_PASSWORD`; the
server then logs in by itself. A token is safer, since it can be read-only, expires, and
can be revoked without changing your password.

### Or use the hosted server (no install)

Clients that support remote MCP servers with a custom header can connect directly:

```json
{
  "mcpServers": {
    "schemasketch": {
      "url": "https://mcp.schemasketch.dev/mcp",
      "headers": { "Authorization": "Bearer your-token" }
    }
  }
}
```

In Claude Code: `claude mcp add --transport http schemasketch https://mcp.schemasketch.dev/mcp --header "Authorization: Bearer your-token"`

### Claude Desktop

Download [schemasketch.mcpb](https://schemasketch.dev/downloads/schemasketch.mcpb) and drag
it onto Claude Desktop; it asks for your token.

## Tools

The same 15 tools in every setup:

| Tool | Does |
|---|---|
| `get_dbml_syntax_guide` | Returns the DBML syntax reference. Call it before writing or editing DBML. |
| `list_diagrams` | Lists your saved diagrams. |
| `get_diagram` | Fetches one diagram's DBML source and positions. |
| `validate_dbml` | Parses DBML and reports syntax errors and warnings, without saving. |
| `create_diagram` | Creates a diagram. |
| `update_diagram` | Replaces a diagram's DBML and/or renames it. |
| `delete_diagram` | Permanently deletes a diagram. |
| `export_sql` | SQL DDL (PostgreSQL, MySQL, SQL Server, Oracle) for a diagram or raw DBML. |
| `export_laravel_migrations` | Laravel migration files for a diagram or raw DBML. |
| `export_laravel_models` | Laravel Eloquent models (fillable, casts, relationships) for Laravel 10 or 11+. |
| `export_mermaid` | Mermaid `erDiagram` syntax. |
| `export_plantuml` | PlantUML entity syntax. |
| `import_sql` | Converts SQL DDL into DBML (save it with `create_diagram` / `update_diagram`). |
| `import_mermaid` | Converts Mermaid `erDiagram` syntax into DBML. |
| `import_plantuml` | Converts PlantUML entity syntax into DBML. |

## Good to know

- The hosted server allows 60 requests a minute per token. Going over returns `429`
  with `retry_after` in seconds.
- An invalid or expired token returns a message telling you to create a new one.
- Agents work better with the SchemaSketch skill installed:
  `npx skills add SchemaSketch-dev/schemasketch-skills`
  ([more install options](https://github.com/SchemaSketch-dev/schemasketch-skills)).

Full documentation: [schemasketch.dev/docs](https://schemasketch.dev/docs#mcp-docs)

## Source and issues

Source: [github.com/SchemaSketch-dev/schemasketch-mcp-server](https://github.com/SchemaSketch-dev/schemasketch-mcp-server).
Report problems in its [issues](https://github.com/SchemaSketch-dev/schemasketch-mcp-server/issues)
or at hello@schemasketch.dev. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

MIT
