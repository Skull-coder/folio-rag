import {
  ChatMessageRecord,
  CitationSource,
  ContextUsageSummary,
  ModelProvider,
  PdfDocumentRecord,
} from '../types.ts';
import { OllamaChatMessage } from './ollama.ts';

/** Conservative character-to-token approximation (~3.8 chars/token) */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.8) + 4;
}

/**
 * Combines recent conversation turns with the current prompt so vector retrieval
 * stays accurate for follow-up questions like "Explain that in more detail" or
 * "Compare it with the second PDF".
 */
export function buildContextualizedRetrievalQuery(
  priorMessages: ChatMessageRecord[],
  currentPrompt: string
): string {
  const recentUserTurns = priorMessages
    .filter((m) => m.role === 'user')
    .slice(-2)
    .map((m) => m.content.trim().slice(0, 220));

  if (recentUserTurns.length === 0) {
    return currentPrompt;
  }

  return `${recentUserTurns.join(' ')} ${currentPrompt}`;
}

/**
 * Scales retrieved chunk count based on the active model's context window
 * and number of attached documents.
 */
export function computeTopKForContext(numCtx: number, docCount: number): number {
  if (numCtx >= 128000) {
    return Math.min(28, Math.max(16, docCount * 6));
  }
  if (numCtx >= 65536) {
    return Math.min(20, Math.max(12, docCount * 5));
  }
  if (numCtx >= 32768) {
    return Math.min(16, Math.max(10, docCount * 4));
  }
  if (numCtx >= 16384) {
    return Math.min(12, Math.max(8, docCount * 3));
  }
  return Math.min(8, Math.max(5, docCount * 2));
}

export function buildContextWindow(params: {
  model: string;
  provider: ModelProvider;
  numCtx: number;
  selectedDocs: PdfDocumentRecord[];
  priorMessages: ChatMessageRecord[];
  retrievedSources: CitationSource[];
  currentPrompt: string;
}): {
  messages: OllamaChatMessage[];
  systemPrompt: string;
  historyMessages: OllamaChatMessage[];
  usedSources: CitationSource[];
  contextUsage: ContextUsageSummary;
} {
  const {
    model,
    provider,
    numCtx,
    selectedDocs,
    priorMessages,
    retrievedSources,
    currentPrompt,
  } = params;

  // Reserve space for the model's generated answer
  const outputReserve = Math.min(8192, Math.max(1024, Math.floor(numCtx * 0.2)));
  const promptBudget = Math.max(2048, numCtx - outputReserve);

  const currentUserTokens = estimateTokens(currentPrompt);

  const docInventoryLines = selectedDocs.map((doc) => {
    const statusText =
      doc.status === 'indexed'
        ? `${doc.pageCount} pages, ${doc.chunkCount} chunks`
        : `status: ${doc.status} (${doc.progress}%)`;
    return `- "${doc.filename}" (${statusText})`;
  });

  const baseInstructions = [
    `You are Folio, a precise personal AI document assistant.`,
    `The user currently has the following ${selectedDocs.length} PDF document(s) attached to this conversation:`,
    ...docInventoryLines,
    ``,
    `Instructions:`,
    `1. Answer using both the conversation history and the retrieved document excerpts below.`,
    `2. Ground every factual claim from the documents in the retrieved excerpts and cite the exact filename and page number inline like [Filename.pdf, p. X].`,
    `3. If multiple documents are attached and relevant, compare or synthesize across them clearly.`,
    `4. If the retrieved excerpts do not contain enough information to answer, state clearly what is missing rather than fabricating details.`,
    `5. Format answers cleanly with headings, lists, or tables when helpful.`,
  ].join('\n');

  const baseInstructionTokens = estimateTokens(baseInstructions);

  const availableAfterBase = Math.max(
    1024,
    promptBudget - baseInstructionTokens - currentUserTokens
  );
  const maxChunksBudget = Math.floor(availableAfterBase * 0.55);

  const usedSources: CitationSource[] = [];
  const excerptBlocks: string[] = [];
  let excerptTokens = 0;

  for (let i = 0; i < retrievedSources.length; i++) {
    const src = retrievedSources[i];
    const block = `[Source ${i + 1} | Document: "${src.filename}" | Page ${src.pageNumber}]\n${src.excerpt}`;
    const blockTokens = estimateTokens(block);
    if (excerptTokens + blockTokens > maxChunksBudget && usedSources.length > 0) {
      break;
    }
    excerptBlocks.push(block);
    usedSources.push(src);
    excerptTokens += blockTokens;
  }

  const contextSection =
    excerptBlocks.length > 0
      ? excerptBlocks.join('\n\n---\n\n')
      : 'No matching excerpts were retrieved from the selected documents for this query.';

  const systemPrompt = `${baseInstructions}\n\nRETRIEVED DOCUMENT EXCERPTS:\n${contextSection}`;
  const systemTokens = estimateTokens(systemPrompt);

  const historyBudget = Math.max(
    0,
    promptBudget - systemTokens - currentUserTokens - 64
  );

  const includedHistory: OllamaChatMessage[] = [];
  let historyTokens = 0;

  for (let i = priorMessages.length - 1; i >= 0; i--) {
    const msg = priorMessages[i];
    const content = msg.content.trim();
    if (!content) continue;
    const msgTokens = estimateTokens(content);
    if (historyTokens + msgTokens > historyBudget) {
      break;
    }
    includedHistory.unshift({
      role: msg.role,
      content,
    });
    historyTokens += msgTokens;
  }

  const omittedCount = priorMessages.length - includedHistory.length;
  const finalSystemPrompt =
    omittedCount > 0
      ? `${systemPrompt}\n\nNote: ${omittedCount} earlier message(s) in this thread were trimmed to fit the ${numCtx.toLocaleString()}-token context window.`
      : systemPrompt;

  const messages: OllamaChatMessage[] = [
    { role: 'system', content: finalSystemPrompt },
    ...includedHistory,
    { role: 'user', content: currentPrompt },
  ];

  const estimatedPromptTokens =
    estimateTokens(finalSystemPrompt) + historyTokens + currentUserTokens;

  return {
    messages,
    systemPrompt: finalSystemPrompt,
    historyMessages: includedHistory,
    usedSources,
    contextUsage: {
      model,
      provider,
      numCtx,
      historyMessagesIncluded: includedHistory.length,
      totalMessagesInChat: priorMessages.length,
      retrievedChunks: usedSources.length,
      selectedDocumentsCount: selectedDocs.length,
      estimatedPromptTokens,
    },
  };
}
