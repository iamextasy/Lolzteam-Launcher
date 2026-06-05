import { constants, access } from 'node:fs/promises';

// Returns true iff `path` exists (any node type, no permission check).
export const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};
