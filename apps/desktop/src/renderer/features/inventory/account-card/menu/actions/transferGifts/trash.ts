export const normalizeGiftName = (s: string): string => {
  let result = '';
  let prevWasSpace = false;

  for (const c of s) {
    if (/[\p{L}\p{N}]/u.test(c)) {
      result += c.toLowerCase();
      prevWasSpace = false;
    } else if (/\s/u.test(c)) {
      if (!prevWasSpace && result.length > 0) result += ' ';
      prevWasSpace = true;
    }
  }

  if (result.endsWith(' ')) result = result.slice(0, -1);
  return result;
};

export const buildTrashSet = (lines: string[]): Set<string> => {
  const set = new Set<string>();
  for (const line of lines) {
    if (line.trimStart().startsWith('#')) continue;
    const key = normalizeGiftName(line);
    if (key) set.add(key);
  }
  return set;
};

export const isTrashListed = (marketHashName: string, trash: Set<string>): boolean => {
  if (trash.size === 0) return false;
  const key = normalizeGiftName(marketHashName);
  return key.length > 0 && trash.has(key);
};
