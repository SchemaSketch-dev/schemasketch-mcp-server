// Generate PlantUML entity syntax from a parsed schema. Like Mermaid's
// erDiagram, PlantUML's relationship line only relates two entities, not
// columns - so the FK column is marked with a <<FK>> stereotype in the
// attribute list, letting fromPlantUML find it back on import.

function sanitizeType(type) {
  return type.trim().replace(/\s+/g, '_');
}

export function toPlantUML(schema) {
  const lines = ['@startuml'];

  const fkColumns = new Set();
  for (const ref of schema.refs) {
    if (ref.type === '<') fkColumns.add(`${ref.toTable}.${ref.toColumn}`);
    else fkColumns.add(`${ref.fromTable}.${ref.fromColumn}`); // '>', '-', '<>'
  }

  for (const table of schema.tables) {
    lines.push(`entity ${table.name} {`);
    const pkCols = table.columns.filter((c) => c.pk);
    const otherCols = table.columns.filter((c) => !c.pk);

    for (const col of pkCols) {
      lines.push(`  * ${col.name} : ${sanitizeType(col.type)}`);
    }
    if (pkCols.length && otherCols.length) lines.push('  --');
    for (const col of otherCols) {
      const isFk = fkColumns.has(`${table.name}.${col.name}`);
      const stereotype = col.unique ? ' <<unique>>' : isFk ? ' <<FK>>' : '';
      lines.push(`  ${col.name} : ${sanitizeType(col.type)}${stereotype}`);
    }
    lines.push('}');
    lines.push('');
  }

  for (const ref of schema.refs) {
    const label = ref.fromColumn;
    if (ref.type === '-') {
      lines.push(`${ref.fromTable} ||--|| ${ref.toTable} : ${label}`);
    } else if (ref.type === '>') {
      lines.push(`${ref.toTable} ||--o{ ${ref.fromTable} : ${label}`);
    } else if (ref.type === '<') {
      lines.push(`${ref.fromTable} ||--o{ ${ref.toTable} : ${label}`);
    } else if (ref.type === '<>') {
      lines.push(`${ref.fromTable} }o--o{ ${ref.toTable} : ${label}`);
    }
  }

  lines.push('@enduml');
  return lines.join('\n');
}
