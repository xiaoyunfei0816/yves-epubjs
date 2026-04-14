import { unzipSync } from "fflate";
import {
  normalizeResourcePath,
  resolveResourcePath
} from "./resource-path";

export interface ResourceContainer {
  readText(path: string): Promise<string>;
  readBinary(path: string): Promise<Uint8Array>;
  resolvePath(base: string, relative: string): string;
  exists(path: string): boolean;
}

export class InMemoryResourceContainer implements ResourceContainer {
  protected readonly files = new Map<string, Uint8Array>();

  constructor(initialFiles: Record<string, Uint8Array> = {}) {
    for (const [path, value] of Object.entries(initialFiles)) {
      this.files.set(normalizeResourcePath(path), value);
    }
  }

  async readText(path: string): Promise<string> {
    const binary = await this.readBinary(path);
    return new TextDecoder().decode(binary);
  }

  async readBinary(path: string): Promise<Uint8Array> {
    const file = this.files.get(normalizeResourcePath(path));
    if (!file) {
      throw new Error(`Resource not found: ${path}`);
    }

    return file;
  }

  resolvePath(base: string, relative: string): string {
    return resolveResourcePath(base, relative);
  }

  exists(path: string): boolean {
    return this.files.has(normalizeResourcePath(path));
  }

  listPaths(): string[] {
    return [...this.files.keys()].sort();
  }
}

export class ZipResourceContainer extends InMemoryResourceContainer {
  constructor(initialFiles: Record<string, Uint8Array> = {}) {
    super();

    for (const path of Object.keys(initialFiles)) {
      const value = initialFiles[path];

      if (!value) {
        continue;
      }

      this.files.set(normalizeResourcePath(path), value);
    }
  }

  static async fromZip(input: Uint8Array): Promise<ZipResourceContainer> {
    let archiveEntries: Record<string, Uint8Array>;

    try {
      archiveEntries = unzipSync(input);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown ZIP parse error";
      throw new Error(`Failed to unzip EPUB container: ${message}`);
    }

    return new ZipResourceContainer(archiveEntries);
  }
}
