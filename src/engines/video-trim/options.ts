// src/engines/video-trim/options.ts
import {
  type Container,
  type ContainerOrSame,
  containerSupportsCodecs,
} from "@/engines/_shared/ffmpeg/codec-compat";

export type VideoTrimContainer = ContainerOrSame;

export type VideoTrimOptions = {
  startSec: number;
  endSec: number;
  containerFormat: VideoTrimContainer;
};

export const VIDEO_TRIM_CONTAINERS: ReadonlyArray<VideoTrimContainer> = [
  "same",
  "mp4",
  "webm",
  "mkv",
];

export const defaultVideoTrimOptions: VideoTrimOptions = {
  startSec: 0,
  endSec: 0,
  containerFormat: "same",
};

const OUTPUT_MIME_FOR_CONTAINER: Record<Container, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
};

function extensionOf(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}

export function outputExtensionFor(fmt: VideoTrimContainer, inputName: string): string {
  if (fmt === "same") return extensionOf(inputName);
  return fmt;
}

export function outputMimeFor(fmt: VideoTrimContainer, inputMime: string): string {
  if (fmt === "same") return inputMime || "video/mp4";
  return OUTPUT_MIME_FOR_CONTAINER[fmt];
}

export { containerSupportsCodecs };
