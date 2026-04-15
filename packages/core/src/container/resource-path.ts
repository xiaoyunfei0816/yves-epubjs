export function normalizeResourcePath(path: string): string {
  return path.replace(/^\.?\//, "").replace(/\\/g, "/");
}

export function resolveResourcePath(base: string, relative: string): string {
  if (!relative) {
    return normalizeResourcePath(base);
  }

  if (relative.startsWith("#")) {
    return `${normalizeResourcePath(base).split("#", 1)[0] ?? normalizeResourcePath(base)}${relative}`;
  }

  if (relative.startsWith("/")) {
    return normalizeResourcePath(relative);
  }

  const [relativePath, suffix = ""] = relative.split(/(?=[?#])/, 2);
  const normalizedBase = normalizeResourcePath(base);
  const baseParts = normalizeResourcePath(base).split("/").slice(0, -1);
  const nextParts = (relativePath || "").split("/");

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

  const resolvedPath = relativePath ? normalizeResourcePath(baseParts.join("/")) : normalizedBase;
  return `${resolvedPath}${suffix}`;
}
