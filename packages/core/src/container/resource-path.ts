export function normalizeResourcePath(path: string): string {
  return path.replace(/^\.?\//, "").replace(/\\/g, "/");
}

export function resolveResourcePath(base: string, relative: string): string {
  if (!relative) {
    return normalizeResourcePath(base);
  }

  if (relative.startsWith("/")) {
    return normalizeResourcePath(relative);
  }

  const baseParts = normalizeResourcePath(base).split("/").slice(0, -1);
  const nextParts = relative.split("/");

  for (const part of nextParts) {
    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      baseParts.pop();
      continue;
    }

    baseParts.push(part);
  }

  return normalizeResourcePath(baseParts.join("/"));
}
