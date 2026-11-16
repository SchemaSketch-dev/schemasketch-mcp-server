// Parse PlantUML entity syntax into DBML text. Deliberately lenient
// (regex-based, not a strict grammar) - same philosophy as sql-import.js
// and mermaid-import.js, which this mirrors closely: PlantUML's
// relationship line also only relates two entities, not columns, so the
// FK column comes from a <<FK>> stereotype when present (what
// toPlantUML's export produces), otherwise a `<one_table>_id` guess.

function stripComments(text) {
  return text.replace(/'.*$/gm, '');
}

function parseEntityBlock(name, inner) {
  const columns = [];
  for (const raw of inner.split('\n')) {
    const line = raw.trim();
    if (!line || line === '--') continue;
    const isPk = line.startsWith('*');
    const body = isPk ? line.slice(1).trim() : line;
    const m = body.match(/^(\S+)\s*:\s*(\S+)(?:\s*<<(\w+)>>)?/);
    if (!m) continue;
    const [, colName, type, stereotype] = m;
    const st = (stereotype || '').toLowerCase();
    columns.push({
      name: colName,
      type: type.replace(/_/g, ' '),
      pk: isPk,
      unique: st === 'unique',
      isForeignKey: st === 'fk',
    });
  }
  return { name, columns };
}

export function fromPlantUML(source) {
  const text = stripComments(source);
  const tables = new Map();
  const refs = [];

  // `entity Name { ... }` or, just as commonly in real diagrams,
  // `entity "Display Name" as alias ##Color { ... }` - the alias (when
  // present) is what relationship lines actually refer to, so it takes
  // priority over the bare or quoted name as this table's key.
  const entityRe = /entity\s+(?:"([^"]+)"|(\w+))(?:\s+as\s+(\w+))?[^{\n]*\{([^}]*)\}/g;
  let m;
  while ((m = entityRe.exec(text))) {
    const name = m[3] || m[2] || m[1];
    const table = parseEntityBlock(name, m[4]);
    tables.set(table.name, table);
  }

  // PlantUML relationship lines can be drawn solid (--) or dotted (..) -
  // both carry identical crow's-foot semantics, just a different line style.
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
