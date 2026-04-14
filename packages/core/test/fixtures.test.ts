import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");

describe("test fixtures", () => {
  it("reads the minimal book fixture metadata", () => {
    const fixturePath = resolve(
      ROOT,
      "test-fixtures/books/minimal-book/fixture-info.json"
    );
    const raw = readFileSync(fixturePath, "utf8");
    const fixture = JSON.parse(raw) as {
      id: string;
      title: string;
      status: string;
    };

    expect(fixture.id).toBe("minimal-book");
    expect(fixture.title).toBe("Minimal Book Fixture");
    expect(fixture.status).toBe("placeholder");
  });

  it("keeps the snapshot directory documented and available", () => {
    const snapshotReadmePath = resolve(ROOT, "test-fixtures/snapshots/README.md");
    const readme = readFileSync(snapshotReadmePath, "utf8");

    expect(readme).toContain("解析快照");
    expect(readme).toContain("布局快照");
  });
});
