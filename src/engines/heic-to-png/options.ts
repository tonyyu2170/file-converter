export type HeicToPngOptions = {
  // No options for v1. Type kept as a record to allow future expansion
  // (e.g., bit depth, color profile preservation) without changing the
  // engine signature.
  _placeholder?: never;
};

export const defaultHeicToPngOptions: HeicToPngOptions = {};
