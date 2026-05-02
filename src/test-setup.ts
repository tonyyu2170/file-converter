import "@testing-library/jest-dom/vitest";

// jsdom 25 does not implement Blob.prototype.arrayBuffer; polyfill via FileReader.
if (typeof Blob !== "undefined" && Blob.prototype.arrayBuffer === undefined) {
  Blob.prototype.arrayBuffer = function arrayBuffer(): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => "";
}
if (typeof URL.revokeObjectURL !== "function") {
  URL.revokeObjectURL = () => undefined;
}

if (typeof globalThis.createImageBitmap !== "function") {
  globalThis.createImageBitmap = (() =>
    Promise.reject(new Error("createImageBitmap stub"))) as typeof createImageBitmap;
}

// jsdom does not implement matchMedia; some shadcn primitives query it.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});
