export type VdfValue = string | VdfObject;
export interface VdfObject {
  [key: string]: VdfValue;
}

const tokenize = (src: string): string[] => {
  const tokens: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"') {
      let end = i + 1;
      let value = '';
      while (end < src.length && src[end] !== '"') {
        if (src[end] === '\\' && end + 1 < src.length) {
          const next = src[end + 1];
          value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          end += 2;
        } else {
          value += src[end];
          end += 1;
        }
      }
      tokens.push(value);
      i = end + 1;
    } else if (c === '{' || c === '}') {
      tokens.push(c);
      i += 1;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
    } else {
      i += 1;
    }
  }
  return tokens;
};

const parseBlock = (tokens: string[], start: number): { value: VdfObject; next: number } => {
  const obj: VdfObject = {};
  let i = start;
  while (i < tokens.length) {
    const tok = tokens[i] ?? '';
    if (tok === '}') return { value: obj, next: i + 1 };
    if (!tok) break;
    const key = tok;
    i += 1;
    if (i >= tokens.length) break;
    if (tokens[i] === '{') {
      const sub = parseBlock(tokens, i + 1);
      obj[key] = sub.value;
      i = sub.next;
    } else {
      const val = tokens[i] ?? '';
      obj[key] = val;
      i += 1;
    }
  }
  return { value: obj, next: i };
};

export const parseVdf = (src: string): VdfObject => {
  const tokens = tokenize(src);
  if (tokens.length === 0) return {};
  const rootKey = tokens[0] ?? '';
  if (!rootKey) return {};
  if (tokens[1] !== '{') return {};
  const parsed = parseBlock(tokens, 2);
  return { [rootKey]: parsed.value };
};

const escapeValue = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const stringify = (obj: VdfObject, indent: number): string => {
  const tab = '\t'.repeat(indent);
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      lines.push(`${tab}"${escapeValue(key)}"\t\t"${escapeValue(value)}"`);
    } else {
      lines.push(`${tab}"${escapeValue(key)}"`);
      lines.push(`${tab}{`);
      lines.push(stringify(value, indent + 1));
      lines.push(`${tab}}`);
    }
  }
  return lines.join('\n');
};

export const writeVdfString = (root: VdfObject): string => {
  const entries = Object.entries(root);
  if (entries.length === 0) return '';
  const first = entries[0];
  if (!first) return '';
  const [key, value] = first;
  if (typeof value === 'string') return `"${escapeValue(key)}"\t\t"${escapeValue(value)}"\n`;
  return `"${escapeValue(key)}"\n{\n${stringify(value, 1)}\n}\n`;
};

export const getObj = (parent: VdfObject, key: string): VdfObject => {
  const cur = parent[key];
  if (cur && typeof cur === 'object') return cur;
  const fresh: VdfObject = {};
  parent[key] = fresh;
  return fresh;
};
