let staged: File | null = null;

export function stageFile(file: File): void {
  staged = file;
}

export function takeStagedFile(): File | null {
  const file = staged;
  staged = null;
  return file;
}
