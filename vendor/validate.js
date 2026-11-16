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
    const key = `${ref.fromTable}.${ref.fromColumn}|${ref.type}|${ref.toTable}.${ref.toColumn}`.toLowerCase();
    if (seenRefs.has(key)) {
      issues.push({
        severity: 'warning',
        category: 'Duplicate relationship',
        message: `${ref.fromTable}.${ref.fromColumn} ${ref.type} ${ref.toTable}.${ref.toColumn} is declared more than once.`,
      });
    }
    seenRefs.add(key);

    const from = findCol(ref.fromTable, ref.fromColumn);
    const to = findCol(ref.toTable, ref.toColumn);

    if (!from.table) {
      issues.push({ severity: 'error', category: 'Unknown table', message: `Relationship references unknown table "${ref.fromTable}".` });
    } else if (!from.col) {
      issues.push({ severity: 'error', category: 'Unknown column', message: `Relationship references unknown column "${ref.fromTable}.${ref.fromColumn}".`, table: ref.fromTable });
    }
    if (!to.table) {
      issues.push({ severity: 'error', category: 'Unknown table', message: `Relationship references unknown table "${ref.toTable}".` });
    } else if (!to.col) {
      issues.push({ severity: 'error', category: 'Unknown column', message: `Relationship references unknown column "${ref.toTable}.${ref.toColumn}".`, table: ref.toTable });
    }

    if (from.col && to.col && ref.type !== '<>') {
      const oneSide = ref.type === '<' ? from : to;
      if (!oneSide.col.pk && !oneSide.col.unique) {
        issues.push({
          severity: 'warning',
          category: 'Mismatched ref constraints',
          message: `Column ${oneSide.table.name}.${oneSide.col.name} is the "one" side of a relationship but isn't marked pk or unique.`,
          table: oneSide.table.name,
        });
      }
    }

    if (from.col && to.col) {
      const fromFamily = TYPE_FAMILY[baseType(from.col.type)];
      const toFamily = TYPE_FAMILY[baseType(to.col.type)];
      if (fromFamily && toFamily && fromFamily !== toFamily) {
        issues.push({
          severity: 'warning',
          category: 'Type mismatch',
          message: `${from.table.name}.${from.col.name} (${from.col.type}) and ${to.table.name}.${to.col.name} (${to.col.type}) have different types — a foreign key should usually match its referenced column's type.`,
          table: from.table.name,
        });
      }
    }
  }

  return issues;
}
