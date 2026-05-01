const MAGIC: Array<{ mime: string; bytes: readonly number[]; offset?: number }> = [
  { mime: "image/heic", bytes: [0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], offset: 4 },
  { mime: "image/heif", bytes: [0x66, 0x74, 0x79, 0x70, 0x6d, 0x69, 0x66, 0x31], offset: 4 },
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF; WEBP follows at offset 8
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] }, // "%PDF"
  {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: [0x50, 0x4b, 0x03, 0x04], // ZIP magic; DOCX is a ZIP. Disambiguation by checking for "word/" entry not done at this layer.
  },
];

export async function detectMime(file: File): Promise<string> {
  // Trust file.type when reliable.
  if (file.type && !file.type.startsWith("application/octet-stream")) {
    return file.type;
  }
  // Fallback: read first 512 bytes and check magic.
  const buf = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  for (const entry of MAGIC) {
    const offset = entry.offset ?? 0;
    if (buf.length < offset + entry.bytes.length) continue;
    let match = true;
    for (let i = 0; i < entry.bytes.length; i++) {
      if (buf[offset + i] !== entry.bytes[i]) {
        match = false;
        break;
      }
    }
    if (match) return entry.mime;
  }
  return "application/octet-stream";
}

export function extensionFromName(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}
