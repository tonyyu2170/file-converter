import type { OutputItem } from "@/engines/_shared/types";
import * as Comlink from "comlink";

const api = {
  async convertSingle(
    bytes: ArrayBuffer,
    name: string,
    _type: string,
    _opts: unknown,
  ): Promise<OutputItem> {
    // Echo bytes back unchanged. Used only to prove the worker boundary
    // does not generate any network traffic.
    return {
      filename: `${name}.stub`,
      mime: "application/octet-stream",
      blob: new Blob([bytes], { type: "application/octet-stream" }),
    };
  },
};

Comlink.expose(api);
