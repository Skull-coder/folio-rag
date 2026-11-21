import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { DocumentChunkRecord } from '../types.ts';

const workerFile = path.resolve(
  process.cwd(),
  'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
);
if (fs.existsSync(workerFile)) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerFile).href;
}

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export async function extractPdfPages(
  filePath: string,
  onProgress?: (page: number, totalPages: number) => Promise<void> | void
): Promise<{ pages: ExtractedPage[]; pageCount: number }> {
  const fileBuffer = await fs.promises.readFile(filePath);
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(fileBuffer),
    verbosity: 0,
    useWorkerFetch: false,
  });

  const pdfDoc = await loadingTask.promise;
  const pageCount = pdfDoc.numPages;
  const pages: ExtractedPage[] = [];

  try {
    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const strings: string[] = [];
      let lastY: number | null = null;

      for (const item of textContent.items) {
        if ('str' in item) {
          const y = Array.isArray(item.transform) ? item.transform[5] : null;
          if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) {
            strings.push('\n');
          }
          strings.push(item.str);
          if (item.hasEOL) {
            strings.push('\n');
          }
          if (y !== null) {
            lastY = y;
          }
        }
      }

      const rawText = strings
        .join(' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();

      if (rawText.length > 0) {
        pages.push({ pageNumber: pageNum, text: rawText });
      }

      if (onProgress) {
        await onProgress(pageNum, pageCount);
      }
    }
  } finally {
    await loadingTask.destroy();
  }

  return { pages, pageCount };
}

export function chunkExtractedPages(
  documentId: string,
  filename: string,
  pages: ExtractedPage[],
  chunkSize = 900,
  overlap = 160
): DocumentChunkRecord[] {
  const chunks: DocumentChunkRecord[] = [];
  let chunkIndex = 0;

  for (const page of pages) {
    const text = page.text.trim();
    if (!text) continue;

    if (text.length <= chunkSize) {
      chunks.push({
        id: `${documentId}_c${chunkIndex}`,
        documentId,
        filename,
        pageNumber: page.pageNumber,
        chunkIndex,
        text,
      });
      chunkIndex++;
      continue;
    }

    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + chunkSize, text.length);

      // Prefer breaking on paragraph, sentence, or whitespace boundary
      if (end < text.length) {
        const windowStart = Math.max(start + Math.floor(chunkSize * 0.55), start);
        const slice = text.slice(windowStart, end);
        const lastPara = slice.lastIndexOf('\n\n');
        const lastSentence = Math.max(
          slice.lastIndexOf('. '),
          slice.lastIndexOf('? '),
          slice.lastIndexOf('! ')
        );
        const lastSpace = slice.lastIndexOf(' ');

        if (lastPara !== -1) {
          end = windowStart + lastPara + 2;
        } else if (lastSentence !== -1) {
          end = windowStart + lastSentence + 2;
        } else if (lastSpace !== -1) {
          end = windowStart + lastSpace;
        }
      }

      const piece = text.slice(start, end).trim();
      if (piece.length > 20) {
        chunks.push({
          id: `${documentId}_c${chunkIndex}`,
          documentId,
          filename,
          pageNumber: page.pageNumber,
          chunkIndex,
          text: piece,
        });
        chunkIndex++;
      }

      if (end >= text.length) break;
      start = Math.max(end - overlap, start + 1);
    }
  }

  return chunks;
}
