import React, { useState } from 'react';
import {
  Database,
  Files,
  Loader2,
  MessageSquare,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/src/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/src/components/ui/dropdown-menu';
import { Input } from '@/src/components/ui/input';
import { Progress } from '@/src/components/ui/progress';
import { ScrollArea } from '@/src/components/ui/scroll-area';
import {
  ACTIVE_STATUSES,
  useChatsQuery,
  useDeleteChatMutation,
  useDocumentsQuery,
  useRenameChatMutation,
} from '@/src/hooks/useRagQueries';
import { ChatSummary } from '@/src/lib/types';
import { cn, formatRelativeTime } from '@/src/lib/utils';

export type WorkspaceTab = 'chat' | 'library';

interface AppSidebarProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  activeChatId: string | null;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onOpenRuntime: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function AppSidebar({
  activeTab,
  onSelectTab,
  activeChatId,
  onSelectChat,
  onNewChat,
  theme,
  onToggleTheme,
  onOpenRuntime,
  mobileOpen,
  onCloseMobile,
}: AppSidebarProps) {
  const { data: chats = [] } = useChatsQuery();
  const { data: documents = [] } = useDocumentsQuery();
  const renameChat = useRenameChatMutation();
  const deleteChat = useDeleteChatMutation();

  const [renamingChat, setRenamingChat] = useState<ChatSummary | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const activeJobs = documents.filter((d) => ACTIVE_STATUSES.has(d.status));

  const handleConfirmRename = (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingChat || !renameValue.trim()) return;
    renameChat.mutate(
      { chatId: renamingChat.id, title: renameValue.trim() },
      { onSuccess: () => setRenamingChat(null) }
    );
  };

  const sidebarContent = (
    <aside className="flex h-full w-[268px] flex-col border-r border-[var(--border)] bg-[var(--sidebar)] text-[var(--foreground)]">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center justify-between px-4 border-b border-[var(--border)]">
        <button
          type="button"
          onClick={() => {
            onSelectTab('chat');
            onNewChat();
            onCloseMobile();
          }}
          className="font-display text-lg font-bold tracking-tight text-[var(--foreground)] whitespace-nowrap shrink-0 cursor-pointer"
        >
          Folio RAG
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          onClick={onCloseMobile}
          aria-label="Close sidebar"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Primary Action + Section Switcher */}
      <div className="space-y-3 p-3 border-b border-[var(--border)]">
        <Button
          type="button"
          variant="default"
          className="w-full justify-start"
          onClick={() => {
            onSelectTab('chat');
            onNewChat();
            onCloseMobile();
          }}
        >
          <Plus className="h-4 w-4" />
          <span>New chat</span>
        </Button>

        <div className="grid grid-cols-2 gap-1 rounded-lg border border-[var(--border)] bg-[var(--background)] p-1">
          <button
            type="button"
            onClick={() => {
              onSelectTab('chat');
              onCloseMobile();
            }}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer',
              activeTab === 'chat'
                ? 'bg-[var(--accent)] text-[#111111] dark:bg-neutral-800 dark:text-white'
                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            )}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span>Chats</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onSelectTab('library');
              onCloseMobile();
            }}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer tabular-nums',
              activeTab === 'library'
                ? 'bg-[var(--accent)] text-[#111111] dark:bg-neutral-800 dark:text-white'
                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            )}
          >
            <Files className="h-3.5 w-3.5" />
            <span>PDFs ({documents.length})</span>
          </button>
        </div>
      </div>

      {/* Recent Conversations */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="px-4 pt-3 pb-1.5 text-xs font-medium text-[var(--muted-foreground)]">
          Conversations
        </div>
        <ScrollArea className="flex-1 px-2">
          {chats.length === 0 ? (
            <p className="px-2 py-4 text-xs text-[var(--muted-foreground)]">
              No conversations yet. Select a PDF to begin.
            </p>
          ) : (
            <div className="space-y-0.5 pb-4">
              {chats.map((chat) => {
                const isSelected =
                  activeTab === 'chat' && activeChatId === chat.id;
                return (
                  <div
                    key={chat.id}
                    className={cn(
                      'group flex items-center justify-between gap-1 rounded-lg px-2.5 py-2 text-sm transition-colors',
                      isSelected
                        ? 'bg-[var(--accent)] text-[#111111] font-medium dark:bg-neutral-800 dark:text-white'
                        : 'text-[var(--foreground)] hover:bg-[var(--secondary)]'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectTab('chat');
                        onSelectChat(chat.id);
                        onCloseMobile();
                      }}
                      className="min-w-0 flex-1 text-left cursor-pointer"
                    >
                      <div className="truncate text-xs font-medium">
                        {chat.title}
                      </div>
                      <div
                        className={cn(
                          'mt-0.5 flex items-center gap-1.5 text-[11px] tabular-nums',
                          isSelected
                            ? 'text-[#111111]/75 dark:text-neutral-300'
                            : 'text-[var(--muted-foreground)]'
                        )}
                      >
                        <span>
                          {chat.documentIds.length}{' '}
                          {chat.documentIds.length === 1 ? 'PDF' : 'PDFs'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{formatRelativeTime(chat.updatedAt)}</span>
                      </div>
                    </button>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label="Conversation options"
                          className="rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 hover:bg-[var(--background)]/70 cursor-pointer"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            setRenamingChat(chat);
                            setRenameValue(chat.title);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          <span>Rename</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            deleteChat.mutate(chat.id);
                          }}
                          className="text-red-600 dark:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Delete</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Active Background Processing Card */}
      {activeJobs.length > 0 && (
        <div className="mx-3 mb-2 rounded-lg border border-[var(--border)] bg-[var(--background)] p-2.5">
          <div className="flex items-center justify-between text-xs font-medium">
            <span className="flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Indexing {activeJobs.length} PDF</span>
            </span>
            <span className="font-mono tabular-nums">
              {activeJobs[0].progress}%
            </span>
          </div>
          <p className="mt-1 truncate text-[11px] text-[var(--muted-foreground)]">
            {activeJobs[0].filename}
          </p>
          <Progress value={activeJobs[0].progress} className="mt-1.5 h-1.5" />
        </div>
      )}

      {/* Footer Controls */}
      <div className="shrink-0 space-y-1 border-t border-[var(--border)] p-3">
        <button
          type="button"
          onClick={onOpenRuntime}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)] cursor-pointer"
        >
          <Database className="h-4 w-4 text-[var(--muted-foreground)]" />
          <span>Local AI &amp; Docker status</span>
        </button>

        <button
          type="button"
          onClick={onToggleTheme}
          className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)] cursor-pointer"
        >
          <span className="flex items-center gap-2.5">
            {theme === 'dark' ? (
              <Sun className="h-4 w-4 text-[var(--muted-foreground)]" />
            ) : (
              <Moon className="h-4 w-4 text-[var(--muted-foreground)]" />
            )}
            <span>
              {theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            </span>
          </span>
          <span className="text-[11px] text-[var(--muted-foreground)]">
            {theme === 'dark' ? 'Dark' : 'Light'}
          </span>
        </button>
      </div>

      {/* Rename Chat Dialog */}
      <Dialog
        open={Boolean(renamingChat)}
        onOpenChange={(open) => !open && setRenamingChat(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename conversation</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleConfirmRename} className="mt-4 space-y-4">
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="Conversation title"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRenamingChat(null)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!renameValue.trim()}>
                Save
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </aside>
  );

  return (
    <>
      {/* Desktop persistent sidebar */}
      <div className="hidden h-full md:block">{sidebarContent}</div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">{sidebarContent}</div>
        </div>
      )}
    </>
  );
}
