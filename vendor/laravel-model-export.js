// Generate Laravel Eloquent model files (with inferred relationships) from a
// parsed schema. Separate from laravel-export.js (migrations) so a caller
// can ask for just one or the other, matching the one-exporter-per-format
// pattern used across this codebase.
//
// Laravel version matters for exactly one thing here: the `casts()` method
// (Laravel 11+) is not recognized by Eloquent 10 at all - a model relying on
// it there would have its casts silently not apply. So versions < 11 get the
// old `protected $casts` property instead; everything else about a model is
// unchanged across 10/11/12.

// Diagram content is untrusted (collaborators and invites control every
// name), and these models end up in app/Models. Names go into the PHP either
// as single-quoted string literals (phpString) or, where they become a class
// or method name, reduced to letters, digits and underscores (phpIdentifier).

// Backslashes first, then quotes - see laravel-export.js.
function phpString(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function phpIdentifier(s, fallback) {
  const id = String(s).replace(/[^A-Za-z0-9_]/g, '');
  if (!id) return fallback;
  return /^[0-9]/.test(id) ? `_${id}` : id;
}

function toStudly(str) {
  return str
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

function toCamel(str) {
  const studly = toStudly(str);
  return studly.charAt(0).toLowerCase() + studly.slice(1);
}

// A small heuristic, not a full inflector: covers the common table-naming
// shapes (categories, statuses/boxes, users) well enough for a generated
// class name. Getting this wrong only affects the class name, since the
// real table is always pinned explicitly via `protected $table`.
function singularize(word) {
  if (/ies$/i.test(word)) return word.slice(0, -3) + 'y';
  if (/(s|x|z|ch|sh)es$/i.test(word)) return word.slice(0, -2);
  if (/s$/i.test(word) && !/ss$/i.test(word)) return word.slice(0, -1);
  return word;
}

// "billing.invoices" -> "invoices". Class and method names come from the
// table's own name; the schema only appears in `protected $table`.
function baseName(tableName) {
  return String(tableName).slice(String(tableName).lastIndexOf('.') + 1);
}

// "public" is Postgres's default schema, so public.users is just users.
function tableName(name) {
  return String(name).replace(/^public\./i, '');
}

// Not 'Model': that's the Eloquent class every model extends.
function className(tableName) {
  const fromBase = phpIdentifier(toStudly(singularize(baseName(tableName))), '');
  return fromBase || phpIdentifier(toStudly(singularize(String(tableName))), 'TableModel');
}

// One class per table. When two schemas share a table name (public.users and
// audit.users), the non-public one gets its schema as a prefix: User, AuditUser.
function classNames(tables) {
  const plain = new Map(tables.map((t) => [t.name, className(t.name)]));
  const counts = new Map();
  for (const c of plain.values()) counts.set(c, (counts.get(c) || 0) + 1);
  const names = new Map();
  for (const t of tables) {
    const c = plain.get(t.name);
    const qualified = tableName(t.name);
    const schema = qualified.includes('.') ? qualified.slice(0, qualified.lastIndexOf('.')) : null;
    names.set(t.name, counts.get(c) > 1 && schema ? phpIdentifier(toStudly(schema) + c, c) : c);
  }
  return names;
}

function relationMethodFromFkColumn(colName) {
  const stripped = /_id$/i.test(colName) ? colName.slice(0, -3) : colName;
  return phpIdentifier(toCamel(stripped), 'related');
}

function castForColumn(col) {
  const baseType = (col.type.trim().match(/^(\w+)/) || [, ''])[1].toLowerCase();
  switch (baseType) {
    case 'boolean':
    case 'bool':
      return 'boolean';
    case 'date':
      return 'date';
    case 'datetime':
    case 'timestamp':
      return 'datetime';
    case 'json':
    case 'jsonb':
      return 'array';
    case 'decimal':
    case 'numeric': {
      const m = col.type.match(/,\s*(\d+)\s*\)/);
      return m ? `decimal:${m[1]}` : 'decimal:2';
    }
    default:
      return null;
  }
}

function isTimestampType(col) {
  return /^(date|datetime|timestamp)/i.test(col.type.trim());
}

function hasTimestamps(table) {
  const names = table.columns.map((c) => c.name.toLowerCase());
  return names.includes('created_at') && names.includes('updated_at');
}

function hasSoftDeletes(table) {
  const col = table.columns.find((c) => c.name.toLowerCase() === 'deleted_at');
  return !!col && isTimestampType(col);
}

// direction-resolve a ref into { childTable, childCol, parentTable, parentCol },
// same "who holds the FK" convention as laravel-export.js's migration builder.
function resolveFk(ref) {
  if (ref.type === '<') {
    return { childTable: ref.toTable, childCol: ref.toColumn, parentTable: ref.fromTable, parentCol: ref.fromColumn };
  }
  return { childTable: ref.fromTable, childCol: ref.fromColumn, parentTable: ref.toTable, parentCol: ref.toColumn };
}

// A table with exactly two FK columns to two different other tables, and
// nothing else meaningful, is treated as a plain pivot: no model file of its
// own, just belongsToMany() on the two tables it joins.
function findPivotTables(tables, fksByTable) {
  const pivots = new Map(); // tableName -> { fks: [fk, fk] }
  for (const table of tables) {
    const fks = fksByTable.get(table.name) || [];
    if (fks.length !== 2) continue;
    if (fks[0].parentTable === fks[1].parentTable) continue;
    const fkCols = new Set(fks.map((fk) => fk.childCol.toLowerCase()));
    const extra = table.columns.filter((c) => {
      const n = c.name.toLowerCase();
      if (fkCols.has(n)) return false;
      if (n === 'id' && c.pk && c.increment) return false;
      if (n === 'created_at' || n === 'updated_at') return false;
      return true;
    });
    if (extra.length === 0) pivots.set(table.name, { fks });
  }
  return pivots;
}

export function toLaravelModels(schema, laravelVersion = 11) {
  const version = Number(laravelVersion) || 11;
  const useCastsMethod = version >= 11;

  const fksByTable = new Map(); // childTable -> [{childTable, childCol, parentTable, parentCol}]
  // Eloquent has no composite relations: a belongsTo on half the key would match the
  // wrong rows. Those refs get a comment on the child model instead.
  const compositeNotes = new Map(); // childTable -> [comment line]
  const oneLine = (v) => String(v).replace(/[\r\n]+/g, ' ');
  for (const ref of schema.refs) {
    if (ref.type === '<>') continue; // direct many-to-many with no modeled pivot - no table to point belongsToMany() at
    const fromCols = ref.fromColumns ?? [ref.fromColumn];
    const toCols = ref.toColumns ?? [ref.toColumn];
    if (fromCols.length > 1 || toCols.length > 1) {
      const [child, childCols, parent, parentCols] = ref.type === '<'
        ? [ref.toTable, toCols, ref.fromTable, fromCols]
        : [ref.fromTable, fromCols, ref.toTable, toCols];
      if (!compositeNotes.has(child)) compositeNotes.set(child, []);
      compositeNotes.get(child).push(oneLine(
        `    // Composite foreign key (${childCols.join(', ')}) -> ${tableName(parent)} (${parentCols.join(', ')}): ` +
        'Eloquent has no composite relations, so none is generated.',
      ));
      continue;
    }
    const fk = resolveFk(ref);
    if (!fksByTable.has(fk.childTable)) fksByTable.set(fk.childTable, []);
    fksByTable.get(fk.childTable).push(fk);
  }

  const pivots = findPivotTables(schema.tables, fksByTable);
  const names = classNames(schema.tables);
  const cls = (table) => names.get(table) || className(table);

  // relations[tableName] accumulates { name, kind, code } entries as both
  // sides of every ref/pivot are discovered, before any file is rendered.
  const relations = new Map(schema.tables.map((t) => [t.name, []]));

  for (const [child, fks] of fksByTable) {
    if (pivots.has(child)) continue;
    for (const fk of fks) {
      if (pivots.has(fk.parentTable)) continue;
      const childCol = schema.tables.find((t) => t.name === child)?.columns.find((c) => c.name === fk.childCol);
      const belongsToName = relationMethodFromFkColumn(fk.childCol);
      relations.get(child)?.push({
        kind: 'BelongsTo',
        code: `    public function ${belongsToName}(): BelongsTo\n    {\n        return $this->belongsTo(${cls(fk.parentTable)}::class, ${phpString(fk.childCol)}, ${phpString(fk.parentCol)});\n    }`,
      });

      const isOneToOne = !!(childCol && (childCol.unique || childCol.pk));
      const parentSideName = phpIdentifier(isOneToOne ? toCamel(singularize(baseName(child))) : toCamel(baseName(child)), 'related');
      const kind = isOneToOne ? 'HasOne' : 'HasMany';
      const method = isOneToOne ? 'hasOne' : 'hasMany';
      relations.get(fk.parentTable)?.push({
        kind,
        code: `    public function ${parentSideName}(): ${kind}\n    {\n        return $this->${method}(${cls(child)}::class, ${phpString(fk.childCol)}, ${phpString(fk.parentCol)});\n    }`,
      });
    }
  }

  for (const [pivotTable, { fks }] of pivots) {
    const [a, b] = fks;
    const nameOnA = phpIdentifier(toCamel(baseName(b.parentTable)), 'related');
    const nameOnB = phpIdentifier(toCamel(baseName(a.parentTable)), 'related');
    relations.get(a.parentTable)?.push({
      kind: 'BelongsToMany',
      code: `    public function ${nameOnA}(): BelongsToMany\n    {\n        return $this->belongsToMany(${cls(b.parentTable)}::class, ${phpString(tableName(pivotTable))}, ${phpString(a.childCol)}, ${phpString(b.childCol)});\n    }`,
    });
    relations.get(b.parentTable)?.push({
      kind: 'BelongsToMany',
      code: `    public function ${nameOnB}(): BelongsToMany\n    {\n        return $this->belongsToMany(${cls(a.parentTable)}::class, ${phpString(tableName(pivotTable))}, ${phpString(b.childCol)}, ${phpString(a.childCol)});\n    }`,
    });
  }

  const relationImport = {
    BelongsTo: 'use Illuminate\\Database\\Eloquent\\Relations\\BelongsTo;',
    HasMany: 'use Illuminate\\Database\\Eloquent\\Relations\\HasMany;',
    HasOne: 'use Illuminate\\Database\\Eloquent\\Relations\\HasOne;',
    BelongsToMany: 'use Illuminate\\Database\\Eloquent\\Relations\\BelongsToMany;',
  };

  const files = [];
  for (const table of schema.tables) {
    if (pivots.has(table.name)) continue; // plain pivot tables get no model of their own

    const fillable = table.columns
      .filter((c) => !(c.pk && c.increment) && !c.pk)
      .filter((c) => !['created_at', 'updated_at', 'deleted_at'].includes(c.name.toLowerCase()))
      .map((c) => c.name);

    const casts = {};
    for (const c of table.columns) {
      // created_at/updated_at/deleted_at are already Carbon instances via
      // Eloquent's native timestamp handling (deleted_at via SoftDeletes) -
      // an explicit cast here would just be redundant, not incorrect.
      if (['created_at', 'updated_at', 'deleted_at'].includes(c.name.toLowerCase())) continue;
      const cast = castForColumn(c);
      if (cast) casts[c.name] = cast;
    }

    const tableRelations = relations.get(table.name) || [];
    const usedImports = new Set(tableRelations.map((r) => r.kind));

    const withSoftDeletes = hasSoftDeletes(table);
    const withTimestamps = hasTimestamps(table);

    const importLines = ['use Illuminate\\Database\\Eloquent\\Model;'];
    if (withSoftDeletes) importLines.push('use Illuminate\\Database\\Eloquent\\SoftDeletes;');
    for (const kind of usedImports) importLines.push(relationImport[kind]);

    const bodyParts = [];
    bodyParts.push(`    protected $table = ${phpString(tableName(table.name))};`);
    if (!withTimestamps) bodyParts.push(`    public $timestamps = false;`);
    if (fillable.length) {
      bodyParts.push(`    protected $fillable = [\n${fillable.map((f) => `        ${phpString(f)},`).join('\n')}\n    ];`);
    }
    if (Object.keys(casts).length) {
      const entries = Object.entries(casts).map(([k, v]) => `            ${phpString(k)} => ${phpString(v)},`).join('\n');
      if (useCastsMethod) {
        bodyParts.push(`    protected function casts(): array\n    {\n        return [\n${entries}\n        ];\n    }`);
      } else {
        bodyParts.push(`    protected $casts = [\n${entries.replace(/^ {4}/gm, '')}\n    ];`);
      }
    }
    for (const r of tableRelations) bodyParts.push(r.code);
    const notes = compositeNotes.get(table.name);
    if (notes) bodyParts.push(notes.join('\n'));

    const traits = withSoftDeletes ? '\n    use SoftDeletes;\n' : '';

    const content = `<?php

namespace App\\Models;

${importLines.join('\n')}

class ${cls(table.name)} extends Model
{${traits}
${bodyParts.join('\n\n')}
}
`;
    files.push({ filename: `${cls(table.name)}.php`, content });
  }

  return files;
}
