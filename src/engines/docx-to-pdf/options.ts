/**
 * The docx-to-pdf engine has no user-tunable options in v1. The type is
 * kept extensible for future settings (output filename customization,
 * page-size override, font-substitution overrides) — see spec §16
 * future scope.
 */
export type DocxToPdfOptions = Record<string, never>;

export const defaultDocxToPdfOptions: DocxToPdfOptions = {};
