import React, { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Menu } from 'lucide-react';
import { Toaster } from 'sonner';
import { AppSidebar, WorkspaceTab } from '@/src/components/AppSidebar';
import { ChatWorkspace } from '@/src/components/ChatWorkspace';
import { DocumentLibraryView } from '@/src/components/DocumentLibraryView';
import { NewChatScreen } from '@/src/components/NewChatScreen';
import { RuntimeStatusDialog } from '@/src/components/RuntimeStatusDialog';
import { Button } from '@/src/components/ui/button';
import { useCreateChatMutation } from '@/src/hooks/useRagQueries';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function WorkspaceShell() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('folio-theme');
    return saved === 'dark' ? 'dark' : 'light';
  });
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('chat');
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [pendingInitialPrompt, setPendingInitialPrompt] = useState<string | null>(
    null
  );
  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const createChat = useCreateChatMutation();

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('folio-theme', theme);
  }, [theme]);

  const handleStartChat = (params: {
    documentIds: string[];
    initialPrompt?: string;
    model?: string;
    numCtx?: number;
  }) => {
    createChat.mutate(
      {
        documentIds: params.documentIds,
        model: params.model,
        numCtx: params.numCtx,
      },
      {
        onSuccess: (chat) => {
          setPendingInitialPrompt(params.initialPrompt || null);
          setActiveChatId(chat.id);
          setActiveTab('chat');
        },
      }
    );
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <AppSidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        activeChatId={activeChatId}
        onSelectChat={(id) => {
          setPendingInitialPrompt(null);
          setActiveChatId(id);
        }}
        onNewChat={() => {
          setPendingInitialPrompt(null);
          setActiveChatId(null);
        }}
        theme={theme}
        onToggleTheme={() =>
          setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
        }
        onOpenRuntime={() => setRuntimeOpen(true)}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--background)]">
        {/* Mobile top bar when in Library or New Chat */}
        {(activeTab === 'library' || !activeChatId) && (
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--border)] px-4 md:hidden">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4" />
            </Button>
            <span className="font-display text-sm font-semibold">
              {activeTab === 'library' ? 'Document Library' : 'New Chat'}
            </span>
            <div className="w-8" />
          </div>
        )}

        {activeTab === 'library' ? (
          <DocumentLibraryView
            onStartChatWithDoc={(docId) =>
              handleStartChat({ documentIds: [docId] })
            }
          />
        ) : activeChatId ? (
          <ChatWorkspace
            chatId={activeChatId}
            initialPrompt={pendingInitialPrompt}
            onConsumeInitialPrompt={() => setPendingInitialPrompt(null)}
            onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
            onNewChat={() => {
              setPendingInitialPrompt(null);
              setActiveChatId(null);
            }}
            onOpenRuntime={() => setRuntimeOpen(true)}
          />
        ) : (
          <NewChatScreen
            onStartChat={handleStartChat}
            isCreating={createChat.isPending}
            onOpenRuntime={() => setRuntimeOpen(true)}
          />
        )}
      </main>

      <RuntimeStatusDialog open={runtimeOpen} onOpenChange={setRuntimeOpen} />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WorkspaceShell />
      <Toaster position="bottom-right" richColors closeButton />
    </QueryClientProvider>
  );
}
