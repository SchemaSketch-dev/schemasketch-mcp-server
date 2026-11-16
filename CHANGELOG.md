# Changelog

`schemasketch-mcp-server`, the local (stdio) SchemaSketch MCP server. Versions follow
[Semantic Versioning](https://semver.org).

## 1.0.2 (2026-11-16)

- The MCP handshake reports the package's real version (it always said 1.0.0).

## 1.0.1 (2026-11-16)

- README written for users: getting a token, `npx`, the hosted server, Claude Desktop,
  the tools.
- Source published at https://github.com/sioannides/schemasketch-mcp-server; npm
  releases are built there by GitHub Actions with provenance.
- No direct dependency on `express` (the hosted server's web framework). The MCP SDK
  still installs it, so the install size is unchanged.

## 1.0.0 (2026-11-16)

First release on npm. 15 tools: list, read, create, update, delete and validate
diagrams; export to SQL, Laravel migrations and models, Mermaid and PlantUML; import
from SQL, Mermaid and PlantUML. Talks to https://schemasketch.dev/api with
`SCHEMASKETCH_TOKEN` (or `SCHEMASKETCH_EMAIL` / `SCHEMASKETCH_PASSWORD`).
