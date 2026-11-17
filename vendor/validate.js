// Semantic lint pass over a parsed schema — duplicate names, dangling refs,
// relationships pointing at a column that can't actually enforce uniqueness,
// unrecognized/mistyped column types, and type mismatches across a relationship.
// Separate from parser.js's hard syntax errors (unclosed braces, etc.), which
// block rendering entirely; these are advisory.

export const KNOWN_TYPES = new Set([
  'int', 'integer', 'smallint', 'bigint', 'tinyint', 'mediumint',
  'decimal', 'numeric', 'float', 'double', 'real', 'money',
  'serial', 'bigserial', 'smallserial',
  'varchar', 'char', 'character', 'text', 'longtext', 'mediumtext', 'tinytext',
  'string', 'nvarchar', 'nchar', 'uuid',
  'boolean', 'bool',
  'date', 'datetime', 'timestamp', 'timestamptz', 'time', 'year', 'interval',
  'json', 'jsonb',
  'blob', 'binary', 'varbinary', 'bytea',
  'xml', 'point', 'geometry', 'geography', 'inet', 'cidr', 'macaddr',
]);

// Columns joined by a Ref don't need identical types, but they should at
// least be in the same family — an int FK pointing at a varchar PK is
// almost always a mistake.
const TYPE_FAMILY = {
  int: 'numeric', integer: 'numeric', smallint: 'numeric', bigint: 'numeric', tinyint: 'numeric', mediumint: 'numeric',
  decimal: 'numeric', numeric: 'numeric', float: 'numeric', double: 'numeric', real: 'numeric', money: 'numeric',
  serial: 'numeric', bigserial: 'numeric', smallserial: 'numeric',
  varchar: 'string', char: 'string', character: 'string', text: 'string', longtext: 'string', mediumtext: 'string',
  tinytext: 'string', string: 'string', nvarchar: 'string', nchar: 'string', uuid: 'string',
  boolean: 'boolean', bool: 'boolean',
  date: 'datetime', datetime: 'datetime', timestamp: 'datetime', timestamptz: 'datetime', time: 'datetime', year: 'datetime',
  json: 'json', jsonb: 'json',
};

function baseType(type) {
  return (type || '').trim().toLowerCase().replace(/\[\]$/, '').replace(/\(.*\)$/, '').trim();
}

export function validateSchema(schema) {
  const issues = [];
  const tableByLower = new Map();
  const enumNames = new Set((schema.enums || []).map((e) => e.name.toLowerCase()));

  for (const table of schema.tables) {
    const key = table.name.toLowerCase();
    if (tableByLower.has(key)) {
      issues.push({
        severity: 'warning',
        category: 'Duplicate table',
        message: `Table "${table.name}" is defined more than once.`,
        table: table.name,
      });
    }
    tableByLower.set(key, table);

    const colByLower = new Set();
    for (const col of table.columns) {
      const ck = col.name.toLowerCase();
      if (colByLower.has(ck)) {
        issues.push({
          severity: 'warning',
          category: 'Duplicate column',
          message: `Column "${table.name}.${col.name}" is defined more than once.`,
          table: table.name,
        });
      }
      colByLower.add(ck);

      const base = baseType(col.type);
      if (base && !KNOWN_TYPES.has(base) && !enumNames.has(base)) {
        issues.push({
          severity: 'warning',
          category: 'Unrecognized type',
          message: `Column "${table.name}.${col.name}" has type "${col.type}", which isn't a recognized type — check for a typo.`,
          table: table.name,
        });
      }
    }
  }

  function findCol(tableName, colName) {
    const table = tableByLower.get((tableName || '').toLowerCase());
    if (!table) return { table: null, col: null };
    const col = table.columns.find((c) => c.name.toLowerCase() === (colName || '').toLowerCase());
    return { table, col };
  }

  const seenRefs = new Set();
  for (const ref of schema.refs) {
    // Composite refs (b.(x, y) > a.(x, y)) list every column; others have one.
    const fromCols = ref.fromColumns ?? [ref.fromColumn];
    const toCols = ref.toColumns ?? [ref.toColumn];
    const side = (table, cols) => (cols.length > 1 ? `${table}.(${cols.join(', ')})` : `${table}.${cols[0]}`);
    const label = `${side(ref.fromTable, fromCols)} ${ref.type} ${side(ref.toTable, toCols)}`;

    const key = label.toLowerCase();
    if (seenRefs.has(key)) {
      issues.push({
        severity: 'warning',
        category: 'Duplicate relationship',
        message: `${label} is declared more than once.`,
      });
    }
    seenRefs.add(key);

    const from = fromCols.map((c) => findCol(ref.fromTable, c));
    const to = toCols.map((c) => findCol(ref.toTable, c));
    for (const [tableName, cols, found] of [[ref.fromTable, fromCols, from], [ref.toTable, toCols, to]]) {
      if (!found[0].table) {
        issues.push({ severity: 'error', category: 'Unknown table', message: `Relationship references unknown table "${tableName}".` });
        continue;
      }
      found.forEach((f, i) => {
        if (!f.col) {
          issues.push({ severity: 'error', category: 'Unknown column', message: `Relationship references unknown column "${tableName}.${cols[i]}".`, table: tableName });
        }
      });
    }

    if (fromCols.length !== toCols.length) {
      const n = (k) => `${k} column${k === 1 ? '' : 's'}`;
      issues.push({
        severity: 'error',
        category: 'Column count mismatch',
        message: `Relationship ${label} has ${n(fromCols.length)} on one side and ${n(toCols.length)} on the other.`,
        table: ref.fromTable,
      });
    }

    // Only single-column refs: a composite key's columns are unique together, not one by one.
    if (fromCols.length === 1 && toCols.length === 1 && from[0].col && to[0].col && ref.type !== '<>') {
      const oneSide = ref.type === '<' ? from[0] : to[0];
      if (!oneSide.col.pk && !oneSide.col.unique) {
        issues.push({
          severity: 'warning',
          category: 'Mismatched ref constraints',
          message: `Column ${oneSide.table.name}.${oneSide.col.name} is the "one" side of a relationship but isn't marked pk or unique.`,
          table: oneSide.table.name,
        });
      }
    }

    for (let i = 0; i < Math.min(from.length, to.length); i++) {
      const f = from[i];
      const t = to[i];
      if (!f.col || !t.col) continue;
      const fromFamily = TYPE_FAMILY[baseType(f.col.type)];
      const toFamily = TYPE_FAMILY[baseType(t.col.type)];
      if (fromFamily && toFamily && fromFamily !== toFamily) {
        issues.push({
          severity: 'warning',
          category: 'Type mismatch',
          message: `${f.table.name}.${f.col.name} (${f.col.type}) and ${t.table.name}.${t.col.name} (${t.col.type}) have different types — a foreign key should usually match its referenced column's type.`,
          table: f.table.name,
        });
      }
    }
  }

  return issues;
}
