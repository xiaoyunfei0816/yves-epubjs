import { XMLParser } from "fast-xml-parser";
import { resolveResourcePath } from "../container/resource-path";
import type { BookMetadata, ManifestItem, SpineItem } from "../model/types";

type XmlNode = Record<string, unknown>;

type OpfDocument = {
  package?: {
    metadata?: XmlNode;
    manifest?: {
      item?: XmlNode | XmlNode[];
    };
    spine?: {
      itemref?: XmlNode | XmlNode[];
    };
  };
};

export type ParsedOpf = {
  metadata: BookMetadata;
  manifest: ManifestItem[];
  spine: SpineItem[];
};

const xmlParser = new XMLParser({
  attributeNamePrefix: "@_",
  ignoreAttributes: false
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function readTextValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (value && typeof value === "object" && "#text" in value) {
    const text = (value as { "#text"?: unknown })["#text"];
    return typeof text === "string" && text.trim() ? text.trim() : undefined;
  }

  return undefined;
}

function readFirstText(metadata: XmlNode | undefined, keys: string[]): string | undefined {
  if (!metadata) {
    return undefined;
  }

  for (const key of keys) {
    const value = metadata[key];

    if (Array.isArray(value)) {
      for (const entry of value) {
        const text = readTextValue(entry);
        if (text) {
          return text;
        }
      }
      continue;
    }

    const text = readTextValue(value);
    if (text) {
      return text;
    }
  }

  return undefined;
}

export function parseOpfDocument(
  xml: string,
  packageDocumentPath: string
): ParsedOpf {
  const parsed = xmlParser.parse(xml) as OpfDocument;
  const packageNode = parsed.package;
  const metadataNode = packageNode?.metadata;
  const manifestNodes = asArray(packageNode?.manifest?.item);
  const spineNodes = asArray(packageNode?.spine?.itemref);

  const title = readFirstText(metadataNode, ["dc:title", "title"]) ?? "Untitled EPUB";
  const metadata: BookMetadata = { title };

  const language = readFirstText(metadataNode, ["dc:language", "language"]);
  const identifier = readFirstText(metadataNode, ["dc:identifier", "identifier"]);
  const creator = readFirstText(metadataNode, ["dc:creator", "creator"]);
  const publisher = readFirstText(metadataNode, ["dc:publisher", "publisher"]);

  if (language) {
    metadata.language = language;
  }
  if (identifier) {
    metadata.identifier = identifier;
  }
  if (creator) {
    metadata.creator = creator;
  }
  if (publisher) {
    metadata.publisher = publisher;
  }

  const manifest = manifestNodes.flatMap((item) => {
    const id = typeof item["@_id"] === "string" ? item["@_id"] : undefined;
    const href = typeof item["@_href"] === "string" ? item["@_href"] : undefined;
    const mediaType =
      typeof item["@_media-type"] === "string" ? item["@_media-type"] : undefined;

    if (!id || !href || !mediaType) {
      return [];
    }

    const manifestItem: ManifestItem = {
      id,
      href: resolveResourcePath(packageDocumentPath, href),
      mediaType
    };

    if (typeof item["@_properties"] === "string" && item["@_properties"].trim()) {
      manifestItem.properties = item["@_properties"].trim();
    }

    return [manifestItem];
  });

  const manifestById = new Map(manifest.map((item) => [item.id, item]));

  const spine = spineNodes.flatMap((item) => {
    const idref = typeof item["@_idref"] === "string" ? item["@_idref"] : undefined;

    if (!idref) {
      return [];
    }

    const manifestItem = manifestById.get(idref);
    if (!manifestItem) {
      return [];
    }

    const spineItem: SpineItem = {
      idref,
      href: manifestItem.href,
      linear: item["@_linear"] !== "no",
      mediaType: manifestItem.mediaType
    };

    if (typeof item["@_properties"] === "string" && item["@_properties"].trim()) {
      spineItem.properties = item["@_properties"].trim();
    }

    return [spineItem];
  });

  return {
    metadata,
    manifest,
    spine
  };
}
