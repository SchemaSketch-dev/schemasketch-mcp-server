# Changelog

`schemasketch-mcp-server`, the local (stdio) SchemaSketch MCP server. Versions follow
[Semantic Versioning](https://semver.org).

## 1.2.0 (2026-11-17)

- Composite relationships (`Ref: lines.(order_id, region) > orders.(id, region)`) keep every
  column. `export_sql` writes the full foreign key, and `export_laravel_migrations` writes
  `foreign([...])->references([...])`. `export_laravel_models` adds a comment instead of a
  relation on half the key, because Eloquent has no composite relations. Validation checks
  every column and reports sides with different column counts.
- `export_sql` now writes the `indexes` block: a composite primary key, `UNIQUE` constraints
  (named ones as `CONSTRAINT … UNIQUE`) and `CREATE INDEX` for plain indexes. Before, all of
  them were left out, so a composite foreign key had no key to point at.

## 1.1.2 (2026-11-17)

- Fixed: named relationships (`Ref fk_orders_customer: …`, quoted names, `Ref name { … }`)
  were dropped from every export, and a named `Ref` line followed by a table swallowed that
  table. `export_sql` now uses the name as the constraint name.

## 1.1.1 (2026-11-17)

- README badges: version, tests, downloads, Node, MCP, license, service status. No code
  changes.

## 1.1.0 (2026-11-17)

- Fixed: diagrams with schemas (`public.users`, `billing.invoices`). Relationships between
  schema-qualified tables lost their schema, so saving was rejected ("unknown table") and
  every export pointed at the wrong table. `public` now counts as the default schema
  (`users` and `public.users` are the same table).
- `export_sql`: schema and table are quoted separately (`"billing"."invoices"`, not
  `"billing.invoices"`), the schemas a diagram uses are created first (Postgres, MySQL,
  SQL Server), the `public.` prefix is dropped, and constraint names have no dots.
- `export_laravel_migrations`: a first migration creates the schemas (Postgres only), and
  `public.` is dropped.
- `export_laravel_models`: classes are named after the table, not the schema (`Invoice`, not
  `Billinginvoice`). When two schemas share a table name, the non-public one gets its schema as
  a prefix (`AuditUser`).

## 1.0.4 (2026-11-17)

- The source moved to the SchemaSketch organization on GitHub:
  https://github.com/SchemaSketch-dev/schemasketch-mcp-server (old links redirect). No code
  changes.

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
- Source published at https://github.com/SchemaSketch-dev/schemasketch-mcp-server; npm
  releases are built there by GitHub Actions with provenance.
- No direct dependency on `express` (the hosted server's web framework). The MCP SDK
  still installs it, so the install size is unchanged.

## 1.0.0 (2026-11-16)

First release on npm. 15 tools: list, read, create, update, delete and validate
diagrams; export to SQL, Laravel migrations and models, Mermaid and PlantUML; import
from SQL, Mermaid and PlantUML. Talks to https://schemasketch.dev/api with
`SCHEMASKETCH_TOKEN` (or `SCHEMASKETCH_EMAIL` / `SCHEMASKETCH_PASSWORD`).
