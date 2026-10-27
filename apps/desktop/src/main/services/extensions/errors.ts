import type { ExtensionErrorCode } from '@shared-types';

/** A failure the settings page can name by its code; the message is for the log. */
export class ExtensionError extends Error {
  constructor(
    public readonly code: ExtensionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionError';
  }
}

/** A declaration, not an arrow: only those narrow types after a call that never returns. */
export function fail(code: ExtensionErrorCode, message: string): never {
  throw new ExtensionError(code, message);
}
