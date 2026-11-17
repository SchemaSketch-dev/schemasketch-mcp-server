// Reverse-engineer CREATE TABLE / ALTER TABLE ... FOREIGN KEY SQL (Postgres,
// MySQL, and SQLite dumps are all close enough to this dialect) into DBML.
// Deliberately lenient — this reads real-world dumps, not a strict grammar.

function stripComments(sql) {
  return sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function splitTopLevelCommas(str) {
  const parts = [];
  let depth = 0;
  let cur = '';
  let quote = null;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((s) => s.trim());
}

function stripIdentQuotes(s) {
  return (s || '').trim().replace(/^[`"[\]]|[`"[\]]$/g, '').trim();
}

function parseColumnDef(line, tableName, refs) {
  const m = line.match(/^[`"[\]]?(\w+)[`"[\]]?\s+([A-Za-z_][\w]*(?:\s*\([^)]*\))?)([\s\S]*)$/);
  if (!m) return null;
  const name = m[1];
  let type = m[2].trim();
  const rest = m[3] || '';
  const restUpper = rest.toUpperCase();

  const col = { name, type, pk: false, notNull: false, unique: false, increment: false, default: null };

  if (/PRIMARY\s+KEY/.test(restUpper)) col.pk = true;
  if (/NOT\s+NULL/.test(restUpper)) col.notNull = true;
  if (/\bUNIQUE\b/.test(restUpper)) col.unique = true;
  if (/AUTO_INCREMENT|AUTOINCREMENT/.test(restUpper)) col.increment = true;

  if (/^SERIAL$/i.test(type)) { type = 'int'; col.increment = true; }
  if (/^BIGSERIAL$/i.test(type)) { type = 'bigint'; col.increment = true; }
  col.type = type;

  const defMatch = rest.match(/DEFAULT\s+('(?:[^']|'')*'|"(?:[^"]|"")*"|[\w.()]+)/i);
  if (defMatch) col.default = defMatch[1].replace(/^['"]|['"]$/g, '');

  const refMatch = rest.match(/REFERENCES\s+[`"[\]]?(\w+)[`"[\]]?\s*\(([^)]+)\)/i);
  if (refMatch) {
    refs.push({
      fromTable: tableName, fromColumn: name,
      toTable: refMatch[1], toColumn: stripIdentQuotes(splitTopLevelCommas(refMatch[2])[0]),
      type: '>',
    });
  }

  return col;
}

export function fromSQL(sql) {
  const text = stripComments(sql || '');
  const tables = [];
  const refs = [];

  const createRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[\]]?(\w+)[`"[\]]?\s*\(([\s\S]*?)\)\s*(?:ENGINE[\s\S]*?)?;/gi;
  let m;
  while ((m = createRe.exec(text)) !== null) {
    const tableName = m[1];
    const table = { name: tableName, columns: [] };

    for (const raw of splitTopLevelCommas(m[2])) {
      const line = raw.trim();
      if (!line) continue;
      const upper = line.toUpperCase();

      if (upper.startsWith('PRIMARY KEY')) {
        const pkMatch = line.match(/\(([^)]+)\)/);
        if (pkMatch) {
          for (const c of splitTopLevelCommas(pkMatch[1])) {
            const col = table.columns.find((c2) => c2.name === stripIdentQuotes(c));
            if (col) col.pk = true;
          }
        }
        continue;
      }
      if (upper.startsWith('FOREIGN KEY') || upper.startsWith('CONSTRAINT')) {
        const fkMatch = line.match(/FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s*[`"[\]]?(\w+)[`"[\]]?\s*\(([^)]+)\)/i);
        if (fkMatch) {
          refs.push({
            fromTable: tableName,
            fromColumn: stripIdentQuotes(splitTopLevelCommas(fkMatch[1])[0]),
            toTable: fkMatch[2],
            toColumn: stripIdentQuotes(splitTopLevelCommas(fkMatch[3])[0]),
            type: '>',
          });
        }
        continue;
      }
      if (upper.startsWith('UNIQUE') || upper.startsWith('KEY ') || upper.startsWith('INDEX')) continue;

      const col = parseColumnDef(line, tableName, refs);
      if (col) table.columns.push(col);
    }

    tables.push(table);
  }

  const alterRe = /ALTER\s+TABLE\s+[`"[\]]?(\w+)[`"[\]]?\s+ADD\s+(?:CONSTRAINT\s+\S+\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+[`"[\]]?(\w+)[`"[\]]?\s*\(([^)]+)\)/gi;
  while ((m = alterRe.exec(text)) !== null) {
    refs.push({
      fromTable: m[1],
      fromColumn: stripIdentQuotes(splitTopLevelCommas(m[2])[0]),
      toTable: m[3],
      toColumn: stripIdentQuotes(splitTopLevelCommas(m[4])[0]),
      type: '>',
    });
  }

  return serializeToDBML(tables, refs);
}

function serializeToDBML(tables, refs) {
  let out = '';
  for (const t of tables) {
    out += `Table ${t.name} {\n`;
    for (const c of t.columns) {
      const attrs = [];
      if (c.pk) attrs.push('pk');
      if (c.increment) attrs.push('increment');
      if (c.notNull && !c.pk) attrs.push('not null');
      if (c.unique) attrs.push('unique');
      if (c.default !== null && c.default !== undefined && c.default !== '') {
        attrs.push(`default: '${c.default}'`);
      }
      out += `  ${c.name} ${c.type}${attrs.length ? ` [${attrs.join(', ')}]` : ''}\n`;
    }
    out += `}\n\n`;
  }
  for (const r of refs) {
    out += `Ref: ${r.fromTable}.${r.fromColumn} ${r.type} ${r.toTable}.${r.toColumn}\n`;
  }
  return out.trim() + '\n';
}
