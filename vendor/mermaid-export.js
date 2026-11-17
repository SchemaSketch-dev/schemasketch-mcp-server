// Generate Mermaid erDiagram syntax from a parsed schema.
// Mermaid's relationship line (`A ||--o{ B : label`) only relates two
// entities, not specific columns — so the FK column on the "many" side is
// marked with the `FK` key type on export, which is what lets fromMermaid
// find the right column back on import instead of having to guess one.

function sanitizeType(type) {
  // Mermaid's attribute grammar is whitespace-sensitive (a bare space ends
  // the type token), so "int unsigned" or "varchar(255)" need collapsing
  // into one word to survive a round-trip through a real Mermaid renderer.
  return type.trim().replace(/\s+/g, '_');
}

// Mermaid's grammar also rejects a comma inside a type ("decimal(8,2) total"
// is a parse error, so GitHub shows an error instead of the diagram). Such a
// type keeps its base name and carries the precision as the column comment:
// `decimal total "(8,2)"`. fromMermaid puts it back.
function splitPrecision(type) {
  const m = type.trim().match(/^([^(]*)(\(.*,.*\))$/);
  if (!m) return { type: sanitizeType(type), comment: null };
  return { type: sanitizeType(m[1]), comment: m[2].replace(/[^0-9, ()]/g, '') };
}

function keyMarkerFor(col, isForeignKey) {
  if (col.pk) return 'PK';
  if (col.unique) return 'UK';
  if (isForeignKey) return 'FK';
  return '';
}

export function toMermaid(schema) {
  const lines = ['erDiagram'];

  // Which (table, column) pairs are the FK side of some ref, so the
  // attribute block below can mark them even though Mermaid's relationship
  // line itself carries no column information.
  const fkColumns = new Set();
  for (const ref of schema.refs) {
    if (ref.type === '<') fkColumns.add(`${ref.toTable}.${ref.toColumn}`);
    else fkColumns.add(`${ref.fromTable}.${ref.fromColumn}`); // '>', '-', '<>'
  }

  for (const table of schema.tables) {
    lines.push(`    ${table.name} {`);
    for (const col of table.columns) {
      const key = keyMarkerFor(col, fkColumns.has(`${table.name}.${col.name}`));
      const { type, comment } = splitPrecision(col.type);
      lines.push(`        ${type} ${col.name}${key ? ' ' + key : ''}${comment ? ` "${comment}"` : ''}`);
    }
    lines.push('    }');
  }

  for (const ref of schema.refs) {
    const label = ref.fromColumn;
    if (ref.type === '-') {
      lines.push(`    ${ref.fromTable} ||--|| ${ref.toTable} : ${label}`);
    } else if (ref.type === '>') {
      // from is many, to is one -> Mermaid always states the "one" side first.
      lines.push(`    ${ref.toTable} ||--o{ ${ref.fromTable} : ${label}`);
    } else if (ref.type === '<') {
      lines.push(`    ${ref.fromTable} ||--o{ ${ref.toTable} : ${label}`);
    } else if (ref.type === '<>') {
      lines.push(`    ${ref.fromTable} }o--o{ ${ref.toTable} : ${label}`);
    }
  }

  return lines.join('\n');
}
