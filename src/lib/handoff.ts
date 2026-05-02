let staged: File[] = [];

export function stageFiles(files: File[]): void {
  staged = files;
}

export function takeStagedFiles(): File[] {
  const r = staged;
  staged = [];
  return r;
}
