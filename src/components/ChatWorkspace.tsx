import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  Loader2,
  Menu,
  Square,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { ManageChatPdfsDialog } from '@/src/components/ManageChatPdfsDialog';
import { ModelContextSelector } from '@/src/components/ModelContextSelector';
import { Button } from '@/src/components/ui/button';
import {
  ACTIVE_STATUSES,
  useChatDetailQuery,
  useDocumentsQuery,
  useModelsQuery,
  useUpdateChatDocumentsMutation,
  useUpdateChatSettingsMutation,
} from '@/src/hooks/useRagQueries';
import { api } from '@/src/lib/api';
import {
  ChatMessage,
  CitationSource,
  ContextUsageSummary,
  PdfDocument,
} from '@/src/lib/types';
import { cn } from '@/src/lib/utils';

interface ChatWorkspaceProps {
  chatId: string;
  initialPrompt?: string | null;
  onConsumeInitialPrompt: () => void;
  onOpenMobileSidebar: () => void;
  onNewChat: () => void;
  onOpenRuntime?: () => void;
}

function SourcesPanel({ sources }: { sources: CitationSource[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  if (!sources || sources.length === 0) return null;

  return (
    <div className="mt-4 border-t border-[var(--border)] pt-3">
      <p className="mb-2 text-xs font-semibold text-[var(--muted-foreground)]">
        Sources ({sources.length})
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {sources.map((src, idx) => {
          const isOpen = expandedIdx === idx;
          return (
            <div
              key={`${src.documentId}-${src.chunkIndex}-${idx}`}
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] text-xs"
            >
              <button
                type="button"
                onClick={() => setExpandedIdx(isOpen ? null : idx)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[var(--secondary)]/60 rounded-lg cursor-pointer"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
                  <span className="truncate font-medium text-[var(--foreground)]">
                    {src.filename}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2 font-mono text-[11px] text-[var(--muted-foreground)] tabular-nums">
                  <span>p. {src.pageNumber}</span>
                  {isOpen ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </div>
              </button>
              {isOpen && (
                <div className="border-t border-[var(--border)] px-3 py-2.5 text-xs leading-relaxed text-[var(--muted-foreground)]">
                  <p className="whitespace-pre-wrap">{src.excerpt}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ThinkingToggle({ thinking }: { thinking?: string }) {
  const [open, setOpen] = useState(false);
  if (!thinking || !thinking.trim()) return null;

  return (
    <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/70">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <span>Model reasoning</span>
      </button>
      {open && (
        <div className="border-t border-[var(--border)] px-3 py-2 text-xs leading-relaxed text-[var(--muted-foreground)] whitespace-pre-wrap">
          {thinking}
        </div>
      )}
    </div>
  );
}

function ContextUsageLine({ usage }: { usage?: ContextUsageSummary }) {
  if (!usage) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-mono text-[var(--muted-foreground)] tabular-nums">
      <span>{usage.model}</span>
      <span aria-hidden="true">·</span>
      <span>
        {usage.historyMessagesIncluded}/{usage.totalMessagesInChat} prev msgs
      </span>
      <span aria-hidden="true">·</span>
      <span>{usage.retrievedChunks} PDF chunks</span>
      <span aria-hidden="true">·</span>
      <span>
        ~{usage.estimatedPromptTokens.toLocaleString()} /{' '}
        {usage.numCtx.toLocaleString()} ctx
      </span>
    </div>
  );
}

export function ChatWorkspace({
  chatId,
  initialPrompt,
  onConsumeInitialPrompt,
  onOpenMobileSidebar,
  onNewChat,
  onOpenRuntime,
}: ChatWorkspaceProps) {
  const qc = useQueryClient();
  const { data: chat, isLoading: chatLoading } = useChatDetailQuery(chatId);
  const { data: allDocuments = [] } = useDocumentsQuery();
  const { data: modelsData } = useModelsQuery();
  const updateChatDocs = useUpdateChatDocumentsMutation();
  const updateChatSettings = useUpdateChatSettingsMutation();

  const [input, setInput] = useState('');
  const [manageOpen, setManageOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingThinking, setStreamingThinking] = useState('');
  const [streamingSources, setStreamingSources] = useState<CitationSource[]>([]);
  const [streamingContext, setStreamingContext] =
    useState<ContextUsageSummary | null>(null);
  const [pendingUserMsg, setPendingUserMsg] = useState<ChatMessage | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const firedInitialRef = useRef<string | null>(null);

  const activeModel =
    chat?.model || modelsData?.defaultModel || 'qwen3:4b';
  const activeNumCtx = chat?.numCtx;

  const docMap = useMemo(
    () => new Map<string, PdfDocument>(allDocuments.map((d) => [d.id, d])),
    [allDocuments]
  );

  const attachedDocs = useMemo(() => {
    if (!chat) return [];
    return chat.documentIds
      .map((id) => docMap.get(id))
      .filter((d): d is PdfDocument => Boolean(d));
  }, [chat, docMap]);

  const indexedAttachedCount = attachedDocs.filter(
    (d) => d.status === 'indexed'
  ).length;
  const activeProcessingDocs = attachedDocs.filter((d) =>
    ACTIVE_STATUSES.has(d.status)
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat?.messages.length, streamingContent, streamingThinking, pendingUserMsg]);

  const sendPrompt = async (text: string) => {
    if (!chat || isStreaming) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    if (chat.documentIds.length === 0) {
      toast.error('Attach at least one PDF document to this chat first.');
      setManageOpen(true);
      return;
    }

    if (indexedAttachedCount === 0) {
      toast.info(
        'Your attached PDF is still indexing in the background. Please wait until it hits 100%.'
      );
      return;
    }

    const optimisticMsg: ChatMessage = {
      id: `temp_${Date.now()}`,
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    };

    setPendingUserMsg(optimisticMsg);
    setStreamingContent('');
    setStreamingThinking('');
    setStreamingSources([]);
    setStreamingContext(null);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await api.streamChatMessage(
        chat.id,
        {
          content: trimmed,
          documentIds: chat.documentIds,
          model: activeModel,
          numCtx: activeNumCtx,
        },
        {
          onContext: (usage) => setStreamingContext(usage),
          onSources: (sources) => setStreamingSources(sources),
          onThinking: (chunk) => setStreamingThinking((prev) => prev + chunk),
          onToken: (chunk) => setStreamingContent((prev) => prev + chunk),
          onDone: async () => {
            await qc.invalidateQueries({ queryKey: ['chat', chat.id] });
            await qc.invalidateQueries({ queryKey: ['chats'] });
            setPendingUserMsg(null);
            setStreamingContent('');
            setStreamingThinking('');
            setStreamingSources([]);
            setStreamingContext(null);
            setIsStreaming(false);
          },
          onError: (errMsg) => {
            toast.error(errMsg);
            setPendingUserMsg(null);
            setIsStreaming(false);
            void qc.invalidateQueries({ queryKey: ['chat', chat.id] });
          },
        },
        controller.signal
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        toast.error(err instanceof Error ? err.message : 'Failed to send message');
      }
      setPendingUserMsg(null);
      setIsStreaming(false);
      void qc.invalidateQueries({ queryKey: ['chat', chat.id] });
    } finally {
      abortRef.current = null;
    }
  };

  useEffect(() => {
    if (
      initialPrompt &&
      chat &&
      !chatLoading &&
      firedInitialRef.current !== `${chat.id}:${initialPrompt}`
    ) {
      firedInitialRef.current = `${chat.id}:${initialPrompt}`;
      const toSend = initialPrompt;
      onConsumeInitialPrompt();
      void sendPrompt(toSend);
    }
  }, [initialPrompt, chat, chatLoading]);

  const handleStop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setPendingUserMsg(null);
    void qc.invalidateQueries({ queryKey: ['chat', chatId] });
  };

  const handleRemoveAttachedDoc = (docId: string) => {
    if (!chat) return;
    updateChatDocs.mutate({
      chatId: chat.id,
      documentIds: chat.documentIds.filter((id) => id !== docId),
    });
  };

  if (chatLoading || !chat) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  const displayMessages = [...chat.messages];
  if (
    pendingUserMsg &&
    !displayMessages.some(
      (m) =>
        m.role === 'user' &&
        m.content === pendingUserMsg.content &&
        m.id !== pendingUserMsg.id
    )
  ) {
    displayMessages.push(pendingUserMsg);
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Top Chat Header */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--background)] px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            onClick={onOpenMobileSidebar}
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </Button>
          <h2 className="truncate font-display text-base font-semibold text-[var(--foreground)]">
            {chat.title}
          </h2>
          <span className="hidden text-xs text-[var(--muted-foreground)] sm:inline whitespace-nowrap tabular-nums">
            · {attachedDocs.length} {attachedDocs.length === 1 ? 'PDF' : 'PDFs'}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="accent"
            size="sm"
            onClick={() => setManageOpen(true)}
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            <span>Add PDF</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onNewChat}
            className="hidden sm:inline-flex"
          >
            New chat
          </Button>
        </div>
      </header>

      {/* Mid-Chat Active PDF Scope Bar */}
      <div className="shrink-0 border-b border-[var(--border)] bg-[var(--card)] px-4 py-2 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-[var(--muted-foreground)] mr-1">
            Context:
          </span>
          {attachedDocs.length === 0 ? (
            <button
              type="button"
              onClick={() => setManageOpen(true)}
              className="text-xs font-medium underline underline-offset-4 text-[var(--foreground)] cursor-pointer"
            >
              No PDFs attached — click to select or upload
            </button>
          ) : (
            attachedDocs.map((doc) => {
              const isActive = ACTIVE_STATUSES.has(doc.status);
              return (
                <div
                  key={doc.id}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1 text-xs',
                    isActive
                      ? 'bg-[var(--accent)] text-[#111111] dark:bg-neutral-800 dark:text-white'
                      : 'bg-[var(--background)] text-[var(--foreground)]'
                  )}
                >
                  {isActive ? (
                    <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                  ) : (
                    <FileText className="h-3 w-3 shrink-0 text-[var(--muted-foreground)]" />
                  )}
                  <span className="max-w-[11rem] truncate font-medium">
                    {doc.filename}
                  </span>
                  {isActive && (
                    <span className="font-mono text-[11px] tabular-nums">
                      {doc.progress}%
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachedDoc(doc.id)}
                    aria-label={`Remove ${doc.filename} from chat`}
                    className="ml-0.5 rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)] cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })
          )}
          <button
            type="button"
            onClick={() => setManageOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--foreground)] hover:text-[var(--foreground)] cursor-pointer"
          >
            <FilePlus2 className="h-3 w-3" />
            <span>Add / Upload</span>
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {displayMessages.length === 0 && !isStreaming ? (
            <div className="py-12 text-center">
              <h3 className="font-display text-xl font-semibold text-[var(--foreground)]">
                Ready to answer from your documents
              </h3>
              <p className="mt-1.5 text-sm text-[var(--muted-foreground)]">
                Every prompt automatically carries your previous conversation turns and active PDFs, scaled to your chosen model&apos;s context window.
              </p>
            </div>
          ) : (
            displayMessages.map((msg) => {
              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl border border-[var(--border)] bg-[var(--accent)] px-4 py-3 text-sm leading-relaxed text-[#111111] dark:bg-neutral-800 dark:text-neutral-100">
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                );
              }

              return (
                <div key={msg.id} className="space-y-2">
                  <div className="text-xs font-semibold text-[var(--muted-foreground)]">
                    Folio · {msg.contextUsage?.model || activeModel}
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 sm:p-5">
                    <ThinkingToggle thinking={msg.thinking} />
                    <div className="prose-folio">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                    {msg.sources && <SourcesPanel sources={msg.sources} />}
                    <ContextUsageLine usage={msg.contextUsage} />
                  </div>
                </div>
              );
            })
          )}

          {/* Active Streaming Assistant Message */}
          {isStreaming && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--muted-foreground)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Generating grounded response ({activeModel})...</span>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 sm:p-5">
                <ThinkingToggle thinking={streamingThinking} />
                {streamingContent ? (
                  <div className="prose-folio">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {streamingContent}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-sm text-[var(--muted-foreground)]">
                    Packing conversation history &amp; retrieving relevant PDF sections...
                  </p>
                )}
                {streamingSources.length > 0 && (
                  <SourcesPanel sources={streamingSources} />
                )}
                <ContextUsageLine usage={streamingContext || undefined} />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Bottom Chat Composer */}
      <div className="shrink-0 border-t border-[var(--border)] bg-[var(--background)] px-4 py-3.5 sm:px-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!input.trim() || isStreaming) return;
            const text = input;
            setInput('');
            void sendPrompt(text);
          }}
          className="mx-auto max-w-3xl rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 focus-within:ring-2 focus-within:ring-[var(--ring)]"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (input.trim() && !isStreaming) {
                  const text = input;
                  setInput('');
                  void sendPrompt(text);
                }
              }
            }}
            rows={2}
            placeholder={
              activeProcessingDocs.length > 0 && indexedAttachedCount === 0
                ? 'Waiting for PDF indexing to finish...'
                : 'Ask a follow-up question or cite a topic across your PDFs...'
            }
            className="w-full resize-none bg-transparent px-1 py-1 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none"
          />

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setManageOpen(true)}
              >
                <FilePlus2 className="h-3.5 w-3.5" />
                <span>Add PDF mid-chat</span>
              </Button>
              <ModelContextSelector
                model={activeModel}
                numCtx={activeNumCtx}
                onChange={({ model, numCtx }) =>
                  updateChatSettings.mutate({
                    chatId: chat.id,
                    patch: { model, numCtx },
                  })
                }
                onOpenRuntime={onOpenRuntime}
              />
            </div>

            {isStreaming ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleStop}
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                <span>Stop</span>
              </Button>
            ) : (
              <Button
                type="submit"
                variant="default"
                size="icon-sm"
                disabled={!input.trim()}
                title="Send message"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </div>
        </form>
      </div>

      {/* Mid-Chat Add / Upload PDF Modal */}
      <ManageChatPdfsDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        selectedDocIds={chat.documentIds}
        onSaveSelection={(docIds) =>
          updateChatDocs.mutate({ chatId: chat.id, documentIds: docIds })
        }
      />
    </div>
  );
}
