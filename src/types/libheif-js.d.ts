declare module "libheif-js" {
  interface DisplayTarget {
    data: Uint8ClampedArray;
    width: number;
    height: number;
  }

  interface HeifImage {
    get_width(): number;
    get_height(): number;
    display(target: DisplayTarget, callback: (result: DisplayTarget | null) => void): void;
  }

  interface HeifDecoder {
    decode(buffer: Uint8Array): HeifImage[];
  }

  interface LibHeif {
    HeifDecoder: new () => HeifDecoder;
  }

  const libheif: LibHeif;
  export default libheif;
}
