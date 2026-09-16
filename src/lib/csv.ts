// Tiny RFC-4180-ish CSV parser/writer (no dependencies).

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field.length === 0) {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char === '\r') {
      // swallow; \r\n handled by \n
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

export function csvEscape(value: string | null | undefined): string {
  const text = value ?? '';
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(rows: Array<Array<string | null | undefined>>): string {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
}

export interface ParsedSubscriberRow {
  email: string;
  name: string | null;
}

/**
 * Pulls `email` + optional `name`/`first name`/`last name` columns out of a
 * parsed CSV. Header names are matched case-insensitively.
 */
export function extractSubscriberRows(rows: string[][]): { rows: ParsedSubscriberRow[]; invalid: number } {
  if (rows.length === 0) return { rows: [], invalid: 0 };
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const emailIndex = header.findIndex((h) => h === 'email' || h === 'email address' || h === 'e-mail');
  const nameIndex = header.findIndex((h) => h === 'name' || h === 'full name' || h === 'fullname');
  const firstIndex = header.findIndex((h) => h === 'first name' || h === 'firstname');
  const lastIndex = header.findIndex((h) => h === 'last name' || h === 'lastname');

  const hasHeader = emailIndex !== -1;
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const result: ParsedSubscriberRow[] = [];
  let invalid = 0;

  for (const row of dataRows) {
    const rawEmail = (hasHeader ? row[emailIndex] : row[0])?.trim() ?? '';
    if (!rawEmail) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      invalid++;
      continue;
    }
    let name: string | null = null;
    if (nameIndex !== -1) name = row[nameIndex]?.trim() || null;
    else if (firstIndex !== -1 || lastIndex !== -1) {
      const combined = [row[firstIndex], row[lastIndex]].filter(Boolean).join(' ').trim();
      name = combined || null;
    } else if (!hasHeader && row[1]) {
      name = row[1]!.trim() || null;
    }
    result.push({ email: rawEmail.toLowerCase(), name });
  }
  return { rows: result, invalid };
}

export function isValidEmail(email: string): boolean {
  if (email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export function normalizeEmail(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  return isValidEmail(trimmed) ? trimmed : null;
}
