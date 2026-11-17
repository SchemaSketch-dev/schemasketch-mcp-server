// Parse Mermaid erDiagram syntax into DBML text. Deliberately lenient
// (regex-based, not a strict grammar) - same philosophy as sql-import.js.
//
// Mermaid's relationship line (`A ||--o{ B : label`) relates two entities,
// not two columns, so the FK column on the "many" side has to come from
// somewhere else: a column explicitly marked `FK` in that entity's
// attribute block (what toMermaid's export produces) if one exists,
// otherwise a `<one_table>_id` guess - the same kind of best-effort
// fallback fromSQL already relies on for messy input.

function stripComments(text) {
  return text.replace(/%%.*$/gm, '');
}

function parseEntityBlock(name, inner) {
  const columns = [];
  for (const raw of inner.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\S+)\s+(\S+)(?:\s+(PK|FK|UK)(?:\s*,\s*(PK|FK|UK))?)?(?:\s+"([^"]*)")?/i);
    if (!m) continue;
    const [, type, colName, key1, key2, comment] = m;
    // toMermaid moves a precision such as (8,2) into the comment, because
    // Mermaid can't parse a comma inside a type. Any other comment is ignored.
    const precision = comment && /^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(comment) ? comment.replace(/\s+/g, '') : '';
    const keys = [key1, key2].filter(Boolean).map((k) => k.toUpperCase());
    columns.push({
      name: colName,
      type: type.replace(/_/g, ' ') + precision,
      pk: keys.includes('PK'),
      unique: keys.includes('UK'),
      isForeignKey: keys.includes('FK'),
    });
  }
  return { name, columns };
}

export function fromMermaid(source) {
  const text = stripComments(source);
  const tables = new Map();
  const refs = [];

  // Entity attribute blocks: `Name { ... }`.
  const entityRe = /(\w+)\s*\{([^}]*)\}/g;
  let m;
  while ((m = entityRe.exec(text))) {
    const table = parseEntityBlock(m[1], m[2]);
    tables.set(table.name, table);
  }

  // Relationship lines: `A <symbol> B [: label]`, symbol e.g. ||--o{, }o--||, }o--o{, ||--||.
  // A dashed line (`..`, a non-identifying relationship; schemasketch:export
  // uses it for relationships only the Eloquent models know about) reads the same.
  const relRe = /^\s*(\w+)\s+([|o}][|o]?(?:--|\.\.)[|o][|o{]?)\s+(\w+)\s*(?::\s*(.+))?$/gm;
  while ((m = relRe.exec(text))) {
    const [, left, symbol, right] = m;
    const [leftSym, rightSym] = symbol.split(/--|\.\./);
    // Crow's-foot notation mirrors around `--`: "many" is `}` on the left
    // side, `{` on the right side (they point outward from the relation).
    const leftMany = leftSym.includes('}');
    const rightMany = rightSym.includes('{');
    let fromTable, toTable, type;
    if (leftMany && rightMany) {
      fromTable = left; toTable = right; type = '<>';
    } else if (!leftMany && !rightMany) {
      fromTable = left; toTable = right; type = '-';
    } else if (rightMany) {
      fromTable = right; toTable = left; type = '>';
    } else {
      fromTable = left; toTable = right; type = '>';
    }

    const manyTable = tables.get(fromTable);
    const fkCol = manyTable && manyTable.columns.find((c) => c.isForeignKey);
    const fromColumn = fkCol ? fkCol.name : `${toTable.toLowerCase()}_id`;
    const oneTable = tables.get(toTable);
    const toColumn = (oneTable && oneTable.columns.find((c) => c.pk)?.name) || 'id';
    refs.push({ fromTable, fromColumn, toTable, toColumn, type });
  }

  const lines = [];
  for (const table of tables.values()) {
    lines.push(`Table ${table.name} {`);
    for (const col of table.columns) {
      const settings = [];
      if (col.pk) settings.push('pk');
      if (col.unique) settings.push('unique');
      lines.push(`  ${col.name} ${col.type}${settings.length ? ` [${settings.join(', ')}]` : ''}`);
    }
    lines.push('}');
    lines.push('');
  }
  for (const ref of refs) {
    lines.push(`Ref: ${ref.fromTable}.${ref.fromColumn} ${ref.type} ${ref.toTable}.${ref.toColumn}`);
  }

  return lines.join('\n').trim() + '\n';
}
