import {
  type ResourceContainer,
  ZipResourceContainer
} from "../container/resource-container";
import type { Book } from "../model/types";
import { parseContainerXml } from "./container-parser";
import { parseNavDocument } from "./nav-parser";
import { parseNcxDocument } from "./ncx-parser";
import { parseOpfDocument } from "./opf-parser";
import { parseSpineContentDocument } from "./spine-content-parser";

export type BookParserInput = {
  sourceName?: string;
  data: Uint8Array;
};

export type BookParseResult = {
  book: Book;
  resources: ResourceContainer;
  sectionContents: Array<{
    href: string;
    content: string;
  }>;
};

export class BookParser {
  async parseDetailed(input: BookParserInput): Promise<BookParseResult> {
    const container = await ZipResourceContainer.fromZip(input.data);
    const containerXml = await container.readText("META-INF/container.xml");
    const packageDocument = parseContainerXml(containerXml);
    const opfXml = await container.readText(packageDocument.fullPath);
    const opf = parseOpfDocument(opfXml, packageDocument.fullPath);
    const navManifestItem = opf.manifest.find((item) =>
      item.properties?.split(/\s+/).includes("nav")
    );
    const ncxManifestItem = opf.manifest.find(
      (item) => item.mediaType === "application/x-dtbncx+xml"
    );
    const toc = navManifestItem
      ? parseNavDocument(
          await container.readText(navManifestItem.href),
          navManifestItem.href
        )
      : ncxManifestItem
        ? parseNcxDocument(
            await container.readText(ncxManifestItem.href),
            ncxManifestItem.href
          )
        : [];
    const sectionContents = await Promise.all(
      opf.spine.map(async (spineItem, index) => {
        const sectionXml = await container.readText(spineItem.href);
        return {
          href: spineItem.href,
          content: sectionXml,
          index
        };
      })
    );
    const sections = sectionContents.map((entry) => {
      const spineItem = opf.spine[entry.index];
      if (!spineItem) {
        throw new Error(`Missing spine item at index ${entry.index}`);
      }

        const section = parseSpineContentDocument({
          href: spineItem.href,
          content: entry.content,
          ...(spineItem.mediaType ? { mediaType: spineItem.mediaType } : {})
        });
        return {
          ...section,
          id: `section-${entry.index + 1}`
        };
      });

    return {
      book: {
        metadata: opf.metadata,
        manifest: opf.manifest,
        spine: opf.spine,
        toc,
        sections
      },
      resources: container,
      sectionContents: sectionContents.map(({ href, content }) => ({ href, content }))
    };
  }

  async parse(input: BookParserInput): Promise<Book> {
    const result = await this.parseDetailed(input);
    return result.book;
  }
}
