// Generate Laravel migration files from a parsed schema.
// One migration per table (schema only, no FKs), plus a final migration
// that adds all foreign keys — this sidesteps table-creation ordering entirely.

// Diagram content is untrusted (collaborators and invites control every name,
// note and default), and these migrations get run with `php artisan migrate`.
// So every value from the diagram goes into the PHP only as a single-quoted
// string literal built by phpString(), and sizes only as plain numbers.

// A PHP single-quoted string literal for any value. Backslashes are escaped
// first, then quotes: escaping only the quote would let a value ending in a
// backslash turn the added backslash into an escaped backslash and close the
// string early (`\\'); system(...)`).
function phpString(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

// Size/precision arguments are emitted as bare PHP numbers, so only digits.
function numericArg(s) {
  return /^\d+$/.test(s) ? s : null;
}

// Table names end up in file names: keep them to a safe character set.
function fileSlug(s) {
  return String(s).replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'table';
}

function toLaravelColumn(col, enums) {
  const type = col.type.trim();
  const nameArg = phpString(col.name);
  const commentSuffix = col.note ? `->comment(${phpString(col.note)})` : '';

  // `id int [pk, increment]` named "id" is Laravel's implicit auto-incrementing PK.
  if (col.pk && col.increment && col.name === 'id') {
    return `$table->id()${commentSuffix};`;
  }

  const sizeMatch = type.match(/^(\w+)\s*\(([^)]+)\)$/);
  const baseType = (sizeMatch ? sizeMatch[1] : type).toLowerCase();
  const args = sizeMatch ? sizeMatch[2].split(',').map((s) => numericArg(s.trim())) : [];
  const enumMatch = (enums || []).find((e) => e.name.toLowerCase() === baseType);

  let call;
  let incrementHandled = false;
  if (enumMatch) {
    call = `$table->enum(${nameArg}, [${enumMatch.values.map((v) => phpString(v)).join(', ')}])`;
  } else {
    switch (baseType) {
      case 'int':
      case 'integer':
        call = col.increment ? `$table->increments(${nameArg})` : `$table->integer(${nameArg})`;
        incrementHandled = col.increment;
        break;
      case 'bigint':
        call = col.increment ? `$table->bigIncrements(${nameArg})` : `$table->bigInteger(${nameArg})`;
        incrementHandled = col.increment;
        break;
      case 'smallint':
        call = `$table->smallInteger(${nameArg})`;
        break;
      case 'varchar':
      case 'char':
      case 'string':
        call = args[0] ? `$table->string(${nameArg}, ${args[0]})` : `$table->string(${nameArg})`;
        break;
      case 'text':
      case 'longtext':
        call = `$table->text(${nameArg})`;
        break;
      case 'boolean':
      case 'bool':
        call = `$table->boolean(${nameArg})`;
        break;
      case 'date':
        call = `$table->date(${nameArg})`;
        break;
      case 'datetime':
        call = `$table->dateTime(${nameArg})`;
        break;
      case 'timestamp':
        call = `$table->timestamp(${nameArg})`;
        break;
      case 'decimal':
      case 'numeric':
        call = args.length === 2 && args[0] && args[1] ? `$table->decimal(${nameArg}, ${args[0]}, ${args[1]})` : `$table->decimal(${nameArg})`;
        break;
      case 'float':
        call = `$table->float(${nameArg})`;
        break;
      case 'double':
        call = `$table->double(${nameArg})`;
        break;
      case 'json':
      case 'jsonb':
        call = `$table->json(${nameArg})`;
        break;
      case 'uuid':
        call = `$table->uuid(${nameArg})`;
        break;
      default:
        call = `$table->string(${nameArg})`;
    }
  }

  if (!incrementHandled) {
    if (col.increment) call += '->autoIncrement()';
    if (!col.notNull && !col.pk) call += '->nullable()';
    if (col.unique) call += '->unique()';
    if (col.pk) call += '->primary()';
    if (col.default !== null && col.default !== undefined) {
      const isNumeric = /^-?\d+(\.\d+)?$/.test(col.default);
      const isKeyword = /^(true|false)$/i.test(col.default);
      const isRaw = /^(now\(\)|current_timestamp)$/i.test(col.default);
      if (isRaw) call += `->useCurrent()`;
      else if (isNumeric || isKeyword) call += `->default(${col.default})`;
      else call += `->default(${phpString(col.default)})`;
    }
  }

  return call + commentSuffix + ';';
}

// created_at+updated_at collapse into Laravel's timestamps() helper, and a
// lone deleted_at into softDeletes() - but only when they look like Laravel
// actually generated them (plain nullable date/datetime/timestamp columns,
// no pk/unique/increment), so a genuinely custom column isn't silently
// reinterpreted as one of these shortcuts.
function isFoldableTimestampColumn(col) {
  return col && /^(date|datetime|timestamp)/i.test(col.type.trim()) && !col.pk && !col.unique && !col.increment;
}

function buildColumnLines(table, enums) {
  const lowerNames = table.columns.map((c) => c.name.toLowerCase());
  const createdIdx = lowerNames.indexOf('created_at');
  const updatedIdx = lowerNames.indexOf('updated_at');
  const deletedIdx = lowerNames.indexOf('deleted_at');
  const useTimestamps =
    createdIdx !== -1 && updatedIdx !== -1 &&
    isFoldableTimestampColumn(table.columns[createdIdx]) && isFoldableTimestampColumn(table.columns[updatedIdx]);
  const useSoftDeletes = deletedIdx !== -1 && isFoldableTimestampColumn(table.columns[deletedIdx]);
  const timestampsAtIdx = useTimestamps ? Math.min(createdIdx, updatedIdx) : -1;

  const lines = [];
  table.columns.forEach((col, idx) => {
    if (useTimestamps && (idx === createdIdx || idx === updatedIdx)) {
      if (idx === timestampsAtIdx) lines.push('            $table->timestamps();');
      return;
    }
    if (useSoftDeletes && idx === deletedIdx) {
      lines.push('            $table->softDeletes();');
      return;
    }
    lines.push('            ' + toLaravelColumn(col, enums));
  });

  for (const idx of table.indexes || []) {
    const cols = idx.columns.map((c) => phpString(c)).join(', ');
    const nameArg = idx.name ? `, ${phpString(idx.name)}` : '';
    if (idx.pk) {
      lines.push(`            $table->primary([${cols}]${nameArg});`);
    } else if (idx.unique) {
      // A single-column unique index that's already declared inline via the
      // column's own [unique] flag would otherwise be emitted twice.
      const alreadyInline = idx.columns.length === 1 &&
        table.columns.some((c) => c.name === idx.columns[0] && c.unique);
      if (!alreadyInline) lines.push(`            $table->unique([${cols}]${nameArg});`);
    } else {
      lines.push(`            $table->index([${cols}]${nameArg});`);
    }
  }

  return lines.join('\n');
}

const FK_ACTION_METHOD = {
  cascade: 'cascade',
  restrict: 'restrict',
  'no action': 'noAction',
};

function fkActionCall(action, kind) {
  const method = FK_ACTION_METHOD[action];
  if (method) return `->${method}On${kind}()`;
  if (action === 'set null' && kind === 'Delete') return '->nullOnDelete()';
  // Laravel has no dedicated helper for "set null" on update or "set
  // default" on either action - the generic setter accepts the raw
  // referential action string instead.
  return `->on${kind}(${phpString(action)})`;
}

function pad(n) { return String(n).padStart(2, '0'); }

// "public" is Postgres's default schema, so public.users is just users. Other
// schemas stay: Laravel's Postgres grammar handles 'billing.invoices'.
function tableName(name) {
  return String(name).replace(/^public\./i, '');
}

function schemaOf(name) {
  const n = tableName(name);
  const i = n.lastIndexOf('.');
  return i === -1 ? null : n.slice(0, i);
}

function schemasMigration(schemas) {
  const statements = schemas
    .map((s) => `            DB::statement(${phpString(`CREATE SCHEMA IF NOT EXISTS "${s.replace(/"/g, '""')}"`)});`)
    .join('\n');
  return `<?php

use Illuminate\\Database\\Migrations\\Migration;
use Illuminate\\Support\\Facades\\DB;

return new class extends Migration
{
    public function up(): void
    {
        // Only Postgres has schemas. On MySQL, 'billing.invoices' means a
        // database named billing, which must already exist.
        if (DB::getDriverName() === 'pgsql') {
${statements}
        }
    }

    public function down(): void
    {
        // Schemas are left in place: other tables or objects may live in them.
    }
};
`;
}

function migrationTimestamp(baseDate, offsetSeconds) {
  const d = new Date(baseDate.getTime() + offsetSeconds * 1000);
  return `${d.getFullYear()}_${pad(d.getMonth() + 1)}_${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function toLaravelMigrations(schema) {
  const files = [];
  const baseDate = new Date();

  const schemas = [...new Set(schema.tables.map((t) => schemaOf(t.name)).filter(Boolean))];
  if (schemas.length) {
    files.push({ filename: `${migrationTimestamp(baseDate, -10)}_create_schemas.php`, content: schemasMigration(schemas) });
  }

  schema.tables.forEach((table, i) => {
    const body = buildColumnLines(table, schema.enums);

    const content = `<?php

use Illuminate\\Database\\Migrations\\Migration;
use Illuminate\\Database\\Schema\\Blueprint;
use Illuminate\\Support\\Facades\\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create(${phpString(tableName(table.name))}, function (Blueprint $table) {
${body}
        });
    }

    public function down(): void
    {
        Schema::dropIfExists(${phpString(tableName(table.name))});
    }
};
`;
    const filename = `${migrationTimestamp(baseDate, i * 10)}_create_${fileSlug(tableName(table.name))}_table.php`;
    files.push({ filename, content });
  });

  const fkRefs = schema.refs.filter((r) => r.type !== '<>');
  if (fkRefs.length) {
    const byChild = new Map();
    for (const ref of fkRefs) {
      let child = ref.fromTable, childCol = ref.fromColumn, parent = ref.toTable, parentCol = ref.toColumn;
      if (ref.type === '<') {
        child = ref.toTable; childCol = ref.toColumn; parent = ref.fromTable; parentCol = ref.fromColumn;
      }
      if (!byChild.has(child)) byChild.set(child, []);
      byChild.get(child).push({ childCol, parent, parentCol, onDelete: ref.onDelete, onUpdate: ref.onUpdate });
    }

    const upBlocks = [];
    const downBlocks = [];
    for (const [child, fks] of byChild) {
      const upLines = fks.map((fk) => {
        let line = `            $table->foreign(${phpString(fk.childCol)})->references(${phpString(fk.parentCol)})->on(${phpString(tableName(fk.parent))})`;
        line += fk.onDelete ? fkActionCall(fk.onDelete, 'Delete') : '->cascadeOnDelete()';
        if (fk.onUpdate) line += fkActionCall(fk.onUpdate, 'Update');
        return line + ';';
      }).join('\n');
      const downLines = fks.map((fk) => `            $table->dropForeign([${phpString(fk.childCol)}]);`).join('\n');
      upBlocks.push(`        Schema::table(${phpString(tableName(child))}, function (Blueprint $table) {\n${upLines}\n        });`);
      downBlocks.push(`        Schema::table(${phpString(tableName(child))}, function (Blueprint $table) {\n${downLines}\n        });`);
    }

    const content = `<?php

use Illuminate\\Database\\Migrations\\Migration;
use Illuminate\\Database\\Schema\\Blueprint;
use Illuminate\\Support\\Facades\\Schema;

return new class extends Migration
{
    public function up(): void
    {
${upBlocks.join('\n\n')}
    }

    public function down(): void
    {
${downBlocks.join('\n\n')}
    }
};
`;
    const filename = `${migrationTimestamp(baseDate, schema.tables.length * 10)}_add_foreign_keys_to_tables.php`;
    files.push({ filename, content });
  }

  return files;
}
