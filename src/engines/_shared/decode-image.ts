import { detectMime } from "./file-detection";

let libheifModulePromise: Promise<typeof import("libheif-js/wasm-bundle")> | undefined;

async function loadLibheif() {
  if (!libheifModulePromise) {
    libheifModulePromise = import("libheif-js/wasm-bundle");
  }
  return libheifModulePromise;
}

async function decodeHeic(file: File): Promise<ImageBitmap> {
  const lib = (await loadLibheif()).default;
  const decoder = new lib.HeifDecoder();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const data = decoder.decode(bytes);
  if (!data || data.length === 0) {
    throw new Error("libheif: no images decoded from HEIC");
  }
  const first = data[0];
  if (!first) throw new Error("libheif: first image missing");
  const width = first.get_width();
  const height = first.get_height();
  const rgba = await new Promise<Uint8ClampedArray<ArrayBuffer>>((resolve, reject) => {
    first.display(
      { data: new Uint8ClampedArray(new ArrayBuffer(width * height * 4)), width, height },
      (display: { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } | null) => {
        if (!display) reject(new Error("libheif: display callback received null"));
        else resolve(display.data);
      },
    );
  });
  const imageData = new ImageData(rgba, width, height);
  return await createImageBitmap(imageData);
}

export async function decodeImage(file: File): Promise<ImageBitmap> {
  const mime = await detectMime(file);
  if (mime === "image/heic" || mime === "image/heif") {
    return decodeHeic(file);
  }
  return createImageBitmap(file, { imageOrientation: "from-image" });
}
