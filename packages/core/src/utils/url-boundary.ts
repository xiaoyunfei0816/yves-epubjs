const SAFE_EXTERNAL_LINK_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
const SAFE_EMBEDDED_RESOURCE_SCHEMES = new Set(["data", "blob"]);
const SAFE_EXTERNAL_EMBEDDED_RESOURCE_SCHEMES = new Set(["http", "https"]);
const URL_SCHEME_PATTERN = /^([a-zA-Z][a-zA-Z\d+.-]*):/;

export const SANITIZED_EMBEDDED_RESOURCE_URL = "data:,";

export type NavigationHrefResolution =
  | {
      kind: "internal";
    }
  | {
      kind: "external-safe";
      scheme: string;
    }
  | {
      kind: "external-blocked";
      scheme: string;
    };

export function classifyNavigationHref(href: string): NavigationHrefResolution {
  const normalized = href.trim();
  if (!normalized) {
    return {
      kind: "internal"
    };
  }

  if (normalized.startsWith("#")) {
    return {
      kind: "internal"
    };
  }

  if (normalized.startsWith("//")) {
    return {
      kind: "external-safe",
      scheme: "protocol-relative"
    };
  }

  const scheme = extractUrlScheme(normalized);
  if (!scheme) {
    return {
      kind: "internal"
    };
  }

  if (SAFE_EXTERNAL_LINK_SCHEMES.has(scheme)) {
    return {
      kind: "external-safe",
      scheme
    };
  }

  return {
    kind: "external-blocked",
    scheme
  };
}

export function sanitizeEmbeddedResourceUrl(
  value: string,
  options: {
    allowExternalEmbeddedResources?: boolean;
  } = {}
): string {
  const normalized = value.trim();
  if (!normalized) {
    return normalized;
  }

  if (normalized.startsWith("//")) {
    return options.allowExternalEmbeddedResources
      ? normalized
      : SANITIZED_EMBEDDED_RESOURCE_URL;
  }

  const scheme = extractUrlScheme(normalized);
  if (!scheme) {
    return normalized;
  }

  return SAFE_EMBEDDED_RESOURCE_SCHEMES.has(scheme) ||
    (options.allowExternalEmbeddedResources &&
      SAFE_EXTERNAL_EMBEDDED_RESOURCE_SCHEMES.has(scheme))
    ? normalized
    : SANITIZED_EMBEDDED_RESOURCE_URL;
}

function extractUrlScheme(value: string): string | null {
  const match = value.match(URL_SCHEME_PATTERN);
  return match?.[1]?.toLowerCase() ?? null;
}
