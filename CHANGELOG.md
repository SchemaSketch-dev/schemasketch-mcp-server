# Changelog

`schemasketch-mcp-server`, the local (stdio) SchemaSketch MCP server. Versions follow
[Semantic Versioning](https://semver.org).

## 1.0.3 (2026-11-16)

- **Security:** `export_laravel_migrations` and `export_laravel_models` could turn names
  from a diagram into executable PHP. Someone able to edit a diagram you export (a
  collaborator, or anyone who invites you to their diagram) could hide code in a table,
  column, index or enum name, a note, a default or a column size, and it would run when
  the generated migrations were run (`php artisan migrate`). Every value now goes into the
  PHP as a properly escaped string; class and method names keep only letters, digits and
  underscores; sizes must be plain numbers; file names use a cleaned table name. Normal
  schemas export exactly as before. If you exported migrations or models from a diagram
  someone else could edit, check them before running them.

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
