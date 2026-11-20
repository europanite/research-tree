/** Quoted CSV reader: commas, CRLF, multiline quotes and escaped quotes. */
export function parseCsv(text) {
  if (typeof text !== 'string') throw new TypeError('CSV input must be text');
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', inQuotes = false, quoted = false, afterQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { inQuotes = false; afterQuote = true; }
      } else { cell += ch; }
      continue;
    }
    if (ch === '"') {
      if (!cell.trim() && !quoted && !afterQuote) { cell = ''; inQuotes = true; quoted = true; }
      else throw new Error(`Invalid quote at character ${i + 1}`);
    } else if (ch === ',') {
      row.push(cell); cell = ''; quoted = false; afterQuote = false;
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell); rows.push(row); row = []; cell = ''; quoted = false; afterQuote = false;
      if (ch === '\r' && text[i + 1] === '\n') i++;
    } else if (afterQuote && !/\s/.test(ch)) {
      throw new Error(`Unexpected text after closing quote at character ${i + 1}`);
    } else { cell += ch; }
  }
  if (inQuotes) throw new Error('Unclosed quote in CSV');
  if (cell.length || quoted || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

const HEADER_WORDS = new Set(['word', 'words', 'term', 'terms', 'text', 'label', '単語', '語句', '用語', 'キーワード']);

export function extractWords(csv, { maxWords = 16384 } = {}) {
  const rows = parseCsv(csv);
  if (!rows.length) throw new Error('CSVが空です。');
  const headerIndex = rows[0].findIndex(s => HEADER_WORDS.has(s.trim().toLowerCase()));
  const column = headerIndex === -1 ? 0 : headerIndex;
  const data = headerIndex === -1 ? rows : rows.slice(1);
  const words = [], seen = new Set();
  let duplicates = 0;
  for (const row of data) {
    const value = (row[column] ?? '').trim();
    if (!value) continue;
    if (value.length > 160) throw new Error('単語は160文字以内にしてください。');
    const key = value.normalize('NFKC').toLowerCase();
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    words.push(value);
  }
  if (words.length < 2) throw new Error('異なる単語を2件以上入力してください。');
  if (words.length > maxWords) throw new Error(`単語は最大${maxWords}件です（現在${words.length}件）。`);
  return { words, duplicates, header: headerIndex !== -1 };
}

/** Formula-safe CSV for opening in desktop spreadsheet programs. */
export function csvEscape(value) {
  let str = String(value);
  if (typeof value === 'string' && /^[\s]*[=+@\-]/.test(str)) str = "'" + str;
  return `"${str.replaceAll('"', '""')}"`;
}

export function matrixToCsv(words, matrix, digits = 6) {
  return [
    ['', ...words].map(csvEscape).join(','),
    ...words.map((w, i) => [w, ...matrix[i].map(v => Number(v.toFixed(digits)))].map(csvEscape).join(','))
  ].join('\r\n') + '\r\n';
}
