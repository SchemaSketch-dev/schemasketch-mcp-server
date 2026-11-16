// mcp-server/create-server.js
// The 15 MCP tools, extracted from index.js so both the local stdio
// entrypoint (index.js) and the hosted HTTP entrypoint (http-server.js)
// share one definition. Takes a client (see schemasketch-client.js)
// instead of importing one directly, so the HTTP entrypoint can bind a
// fresh, per-request, per-token client without ever touching a shared
// singleton.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withToolContext } from './tool-context.js';
import { z } from 'zod';

import { parseSchema } from './vendor/parser.js';
import { validateSchema } from './vendor/validate.js';
import { toSQL } from './vendor/sql-export.js';
import { fromSQL } from './vendor/sql-import.js';
import { toLaravelMigrations } from './vendor/laravel-export.js';
import { toLaravelModels } from './vendor/laravel-model-export.js';
import { toMermaid } from './vendor/mermaid-export.js';
import { fromMermaid } from './vendor/mermaid-import.js';
import { toPlantUML } from './vendor/plantuml-export.js';
import { fromPlantUML } from './vendor/plantuml-import.js';
import { DBML_GUIDE } from './dbml-guide.js';

// Every result carries the same JSON twice: as text for LLM clients, and as
// structuredContent for clients that read fields directly. Zapier's MCP
// Client finds no results in a text-only reply, so strings and arrays get
// wrapped under a named key (structuredContent must be an object).
function text(value, structured) {
  const str = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const result = { content: [{ type: 'text', text: str }] };
  if (structured === undefined && value && typeof value === 'object' && !Array.isArray(value)) {
    structured = value;
  }
  if (structured !== undefined) result.structuredContent = structured;
  return result;
}
function errorText(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

// MCP tool annotations. Clients such as Zapier's MCP Client only offer a
// tool to read-only actions and polling triggers when it is marked
// readOnlyHint, so every tool that never writes to the server says so.
const READ_ONLY = { readOnlyHint: true, openWorldHint: false };
const CREATES = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
// update_diagram replaces the whole source, so it counts as destructive.
const OVERWRITES = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
const DELETES = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

// readOnly: the token can't change diagrams, so the write tools are left out
// of the tool list entirely (the API would refuse them with a 403 anyway).
// appUrl: the site diagram links point at.
export function createMcpServer(client, { readOnly = false, appUrl = 'https://schemasketch.dev' } = {}) {
  // Every diagram in a result carries a link to open it in the editor, so
  // agents and Zaps can hand people something clickable.
  const withUrl = (diagram) =>
    diagram && diagram.id
      ? { ...diagram, url: `${appUrl.replace(/\/$/, '')}/app?diagram=${encodeURIComponent(diagram.id)}` }
      : diagram;

  // Runs the editor's own validator before a write. Syntax errors and
  // relationships to missing tables or columns block the save; warnings
  // (duplicate names, unrecognized types) are returned with the result.
  function checkBeforeSave(dbml) {
    const schema = parseSchema(dbml);
    const found = validateSchema(schema);
    const problems = [
      ...schema.errors.map((message) => ({ severity: 'error', category: 'Syntax', message })),
      ...found.filter((w) => w.severity === 'error'),
    ];
    return { problems, warnings: found.filter((w) => w.severity !== 'error') };
  }

  function notSavedText(problems) {
    return errorText(
      'Not saved: the DBML has errors. Fix these and try again (validate_dbml checks without saving):\n' +
      problems.map((p) => `- ${p.message}`).join('\n')
    );
  }

  const withWarnings = (result, warnings) => (warnings.length ? { ...result, warnings } : result);

  async function resolveDbml({ dbml_source, diagram_id }) {
    if (dbml_source !== undefined) return dbml_source;
    if (diagram_id !== undefined) {
      const d = await client.getDiagram(diagram_id);
      return d.dbml_source || '';
    }
    throw new Error('Provide either dbml_source or diagram_id.');
  }

  const server = new McpServer({ name: 'schemasketch', version: '1.0.0' });

  // Every tool runs with its name in context, so API calls can say which
  // tool they come from (see tool-context.js).
  const tool = withToolContext(server.tool.bind(server));
  const writeTool = readOnly ? () => {} : tool;

  tool(
    'get_dbml_syntax_guide',
    'Read this before writing or editing any DBML — the exact syntax SchemaSketch accepts, with a full example.',
    {},
    READ_ONLY,
    async () => text(DBML_GUIDE, { guide: DBML_GUIDE })
  );

  tool(
    'list_diagrams',
    "List the signed-in user's saved diagrams (id, name, last updated).",
    {},
    READ_ONLY,
    async () => {
      try {
        // The API pages its results; give structured clients a flat list.
        const page = await client.listDiagrams();
        const diagrams = (Array.isArray(page) ? page : page.data).map(withUrl);
        const linked = Array.isArray(page) ? diagrams : { ...page, data: diagrams };
        return text(linked, { diagrams, total: page.total ?? diagrams.length });
      } catch (e) {
        return errorText(e.message);
      }
    }
  );

  tool(
    'get_diagram',
    'Fetch one diagram by id, including its full DBML source and table positions.',
    { diagram_id: z.string().describe('The diagram id (a UUID), from list_diagrams.') },
    READ_ONLY,
    async ({ diagram_id }) => {
      try {
        return text(withUrl(await client.getDiagram(diagram_id)));
      } catch (e) {
        return errorText(e.message);
      }
    }
  );

  tool(
    'validate_dbml',
    'Parse DBML and report syntax errors plus semantic warnings (duplicate names, dangling refs, ' +
    'unrecognized/mismatched types) before saving it. Read-only — never touches the server.',
    { dbml_source: z.string().describe('The DBML text to check.') },
    READ_ONLY,
    async ({ dbml_source }) => {
      const schema = parseSchema(dbml_source);
      const warnings = validateSchema(schema);
      return text({
        syntax_errors: schema.errors,
        warnings,
        tables: schema.tables.map((t) => ({ name: t.name, columns: t.columns.map((c) => c.name) })),
        refs: schema.refs,
        table_groups: schema.tableGroups.map((g) => g.name),
      });
    }
  );

  writeTool(
    'create_diagram',
    'Create a new diagram. The DBML is validated first: syntax errors or relationships to missing ' +
    'tables/columns mean nothing is saved; warnings are returned with the result.',
    {
      name: z.string().min(1).describe('Diagram title, shown on the dashboard.'),
      dbml_source: z.string().optional().describe('Initial DBML text. Empty diagram if omitted.'),
    },
    CREATES,
    async ({ name, dbml_source }) => {
      try {
        const { problems, warnings } = checkBeforeSave(dbml_source || '');
        if (problems.length) return notSavedText(problems);
        const created = await client.createDiagram({ name, dbml_source: dbml_source || '', positions: {} });
        return text(withWarnings(withUrl(created), warnings));
      } catch (e) {
        return errorText(e.message);
      }
    }
  );

  writeTool(
    'update_diagram',
    "Replace a diagram's DBML source (and/or rename it). This overwrites the whole source — " +
    'fetch it with get_diagram first if you need to edit rather than replace it outright, and pass its ' +
    'version as base_version so you never overwrite someone else\'s newer change. New DBML ' +
    'is validated first: errors mean nothing is saved; warnings are returned with the result.',
    {
      diagram_id: z.string().describe('The diagram id (a UUID), from list_diagrams.'),
      dbml_source: z.string().optional().describe('New full DBML text. Omit to leave unchanged.'),
      name: z.string().min(1).optional().describe('New title. Omit to leave unchanged.'),
      base_version: z.number().int().min(1).optional().describe(
        'The diagram\'s `version` from get_diagram. When given, the update is refused if someone ' +
        'else saved since, instead of overwriting their change. Recommended whenever you edit.'
      ),
      renames: z.array(z.object({
        kind: z.enum(['table', 'column', 'enum', 'table_group']),
        table: z.string().optional().describe('For a column: the table it belongs to (old or new name).'),
        from: z.string().describe('The old name.'),
        to: z.string().describe('The new name.'),
      })).max(200).optional().describe(
        'Tables, columns, enums and table groups this edit renames. Always list them: without it a rename can look like ' +
        'a removed column plus a new one, and a migration generated from the diagram would drop the ' +
        'column and its data instead of renaming it.'
      ),
    },
    OVERWRITES,
    async ({ diagram_id, dbml_source, name, base_version, renames }) => {
      if (dbml_source === undefined && name === undefined) {
        return errorText('Provide dbml_source and/or name to update.');
      }
      try {
        const payload = {};
        let warnings = [];
        if (dbml_source !== undefined) {
          const checked = checkBeforeSave(dbml_source);
          if (checked.problems.length) return notSavedText(checked.problems);
          warnings = checked.warnings;
          payload.dbml_source = dbml_source;
        }
        if (name !== undefined) payload.name = name;
        if (base_version !== undefined) payload.base_version = base_version;
        if (renames?.length && dbml_source !== undefined) payload.renames = renames;
        return text(withWarnings(withUrl(await client.updateDiagram(diagram_id, payload)), warnings));
      } catch (e) {
        return errorText(e.message);
      }
    }
  );

  writeTool(
    'delete_diagram',
    'Permanently delete a diagram. This cannot be undone — confirm with the user before calling it.',
    { diagram_id: z.string().describe('The diagram id (a UUID), from list_diagrams.') },
    DELETES,
    async ({ diagram_id }) => {
      try {
        await client.deleteDiagram(diagram_id);
        return text(`Deleted diagram ${diagram_id}.`, { deleted: true, diagram_id });
      } catch (e) {
        return errorText(e.message);
      }
    }
  );

  tool(
    'export_sql',
    'Generate CREATE TABLE / ALTER TABLE SQL DDL for a diagram, in a given dialect.',
    {
      diagram_id: z.string().optional().describe('A saved diagram to export (its UUID).'),
      dbml_source: z.string().optional().describe('Or export unsaved DBML text directly instead of a saved diagram.'),
      dialect: z.enum(['postgres', 'mysql', 'mssql', 'oracle']).default('postgres'),
    },
    READ_ONLY,
    async (args) => {
      try {
        const dbml = await resolveDbml(args);
        const schema = parseSchema(dbml);
        const sql = toSQL(schema, args.dialect);
        return text(sql, { sql });
      } catch (e) {
        return errorText(e.message);
      }
    }
  );

  tool(
    'export_laravel_migrations',
    'Generate Laravel migration files (one per table, plus a foreign-keys migration) for a diagram.',
    {
      diagram_id: z.string().optional().describe('A saved diagram to export (its UUID).'),
      dbml_source: z.string().optional().describe('Or export unsaved DBML text directly instead of a saved diagram.'),
    },
    READ_ONLY,
    async (args) => {
      try {
        const dbml = await resolveDbml(args);
        const schema = parseSchema(dbml);
        const files = toLaravelMigrations(schema);
        return text(files, { files });
      } catch (e) {
        return errorText(e.message);
      }
    }
  );

  tool(
    'export_laravel_models',
    'Generate Laravel Eloquent model files (fillable, casts, and inferred relationships including belongsToMany through plain pivot tables) for a diagram.',
    {
      diagram_id: z.string().optional().describe('A saved diagram to export (its UUID).'),
      dbml_source: z.string().optional().describe('Or export unsaved DBML text directly instead of a saved diagram.'),
      laravel_version: z.number().int().default(11).describe(
        'Target Laravel major version. 10 emits the legacy `protected $casts` property; 11+ emits the newer `casts(): array` method (not recognized by Eloquent 10).'
      ),
    },
    READ_ONLY,
    async (args) => {
      try {
        const dbml = await resolveDbml(args);
        const schema = parseSchema(dbml);
        const files = toLaravelModels(schema, args.laravel_version);
        return text(files, { files });
      } catch (e) {
        return errorText(e.message);
      }
    }
  );

  tool(
    'export_mermaid',
    'Generate Mermaid erDiagram syntax for a diagram.',
    {
      diagram_id: z.string().optional().describe('A saved diagram to export (its UUID).'),
      dbml_source: z.string().optional().describe('Or export unsaved DBML text directly instead of a saved diagram.'),
    },
    READ_ONLY,
    async (args) => {
      try {
        const dbml = await resolveDbml(args);
        const schema = parseSchema(dbml);
        const mermaid = toMermaid(schema);
        return text(mermaid, { mermaid });
      } catch (e) {
        return errorText(e.message);
      }
    }
  );

  tool(
    'export_plantuml',
    'Generate PlantUML entity syntax for a diagram.',
    {
      diagram_id: z.string().optional().describe('A saved diagram to export (its UUID).'),
      dbml_source: z.string().optional().describe('Or export unsaved DBML text directly instead of a saved diagram.'),
    },
    READ_ONLY,
    async (args) => {
      try {
        const dbml = await resolveDbml(args);
        const schema = parseSchema(dbml);
        const plantuml = toPlantUML(schema);
        return text(plantuml, { plantuml });
      } catch (e) {
        return errorText(e.message);
      }
    }
  );

  tool(
    'import_sql',
    'Convert CREATE TABLE / ALTER TABLE SQL DDL into DBML text. Read-only — never touches the server; ' +
    'pass the result to create_diagram or update_diagram to actually save it.',
    { sql: z.string().describe('The SQL text to convert (CREATE TABLE / ALTER TABLE ... FOREIGN KEY statements).') },
    READ_ONLY,
    async ({ sql }) => {
      try {
        const dbml = fromSQL(sql);
        return text(dbml, { dbml });
      } catch (e) {
        return errorText(e.message);
      }
    }
  );

  tool(
    'import_mermaid',
    'Convert Mermaid erDiagram syntax into DBML text. Read-only — never touches the server; ' +
    'pass the result to create_diagram or update_diagram to actually save it.',
    { mermaid: z.string().describe('The Mermaid erDiagram source to convert.') },
    READ_ONLY,
    async ({ mermaid }) => {
      try {
        const dbml = fromMermaid(mermaid);
        return text(dbml, { dbml });
      } catch (e) {
        return errorText(e.message);
      }
    }
  );

  tool(
    'import_plantuml',
    'Convert PlantUML entity syntax into DBML text. Read-only — never touches the server; ' +
    'pass the result to create_diagram or update_diagram to actually save it.',
    { plantuml: z.string().describe('The PlantUML entity source to convert.') },
    READ_ONLY,
    async ({ plantuml }) => {
      try {
        const dbml = fromPlantUML(plantuml);
        return text(dbml, { dbml });
      } catch (e) {
        return errorText(e.message);
      }
    }
  );

  return server;
}
