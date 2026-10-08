// D1 refuses any single SQL statement longer than about 100 KB (SQLITE_TOOBIG), but its own export writes
// each row as one statement, so a backup containing photos (stored inline) cannot be replayed as-is.
// splitLargeStatements() rewrites each oversize INSERT into a small INSERT plus a series of small UPDATEs
// that append the big text piece by piece. The result is identical data in statements D1 will accept.
const MAX_STATEMENT = 90_000, CHUNK = 60_000;

/** Splits "(a, 'b''c', NULL, 5)" into its literal tokens without interpreting them. */
function tokenize(values) {
  const tokens = []; let i = 0;
  while (i < values.length) {
    while (values[i] === ' ' || values[i] === ',') i++;
    if (i >= values.length) break;
    const start = i;
    if (values[i] === "'") { i++; while (i < values.length) { if (values[i] === "'") { if (values[i + 1] === "'") i += 2; else { i++; break; } } else i++; } }
    else while (i < values.length && values[i] !== ',') i++;
    tokens.push(values.slice(start, i).trim());
  }
  return tokens;
}

export function splitStatement(line) {
  if (line.length <= MAX_STATEMENT) return [line];
  const m = line.match(/^INSERT INTO ("?\w+"?)\s*\(([^)]*)\)\s*VALUES\((.*)\);\s*$/s);
  if (!m) throw new Error(`An oversize statement could not be split: ${line.slice(0, 60)}...`);
  const [, table, columns, body] = m, cols = columns.split(',').map((c) => c.trim()), tokens = tokenize(body);
  if (tokens.length !== cols.length) throw new Error(`Row for ${table} has ${tokens.length} values for ${cols.length} columns`);
  const updates = [];
  const small = tokens.map((t, k) => {
    if (t.length <= MAX_STATEMENT / 3 || t[0] !== "'") return t;
    const inner = t.slice(1, -1);
    let first = null;
    for (let at = 0; at < inner.length;) {
      let end = Math.min(inner.length, at + CHUNK);
      // never cut an escaped quote ('') in half
      let quotes = 0; for (let q = end - 1; q >= at && inner[q] === "'"; q--) quotes++;
      if (quotes % 2 === 1 && end < inner.length) end++;
      // The first piece goes into the INSERT itself so column checks (not blank, starts with data:image/) still pass.
      if (first === null) first = inner.slice(at, end);
      else updates.push(`UPDATE ${table} SET ${cols[k]}=${cols[k]}||'${inner.slice(at, end)}' WHERE rowid=(SELECT MAX(rowid) FROM ${table});`);
      at = end;
    }
    return `'${first}'`;
  });
  return [`INSERT INTO ${table} (${columns}) VALUES(${small.join(',')});`, ...updates];
}

export const splitLargeStatements = (sql) => sql.split('\n').flatMap((line) => (line.startsWith('INSERT INTO') ? splitStatement(line) : [line])).join('\n');
