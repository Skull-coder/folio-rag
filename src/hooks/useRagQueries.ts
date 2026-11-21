import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/src/lib/api';
import { DocumentStatus } from '@/src/lib/types';

export const ACTIVE_STATUSES = new Set<DocumentStatus>([
  'queued',
  'extracting',
  'chunking',
  'embedding',
  'storing',
]);

export function useHealthQuery() {
  return useQuery({
    queryKey: ['health'],
    queryFn: api.getHealth,
    staleTime: 10_000,
    refetchInterval: 20_000,
  });
}

export function useModelsQuery() {
  return useQuery({
    queryKey: ['models'],
    queryFn: api.listModels,
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });
}

export function useDocumentsQuery() {
  return useQuery({
    queryKey: ['documents'],
    queryFn: api.listDocuments,
    refetchInterval: (query) => {
      const docs = query.state.data;
      if (!docs) return false;
      const hasActive = docs.some((d) => ACTIVE_STATUSES.has(d.status));
      return hasActive ? 650 : false;
    },
  });
}

export function useDocumentDetailQuery(documentId: string | null) {
  return useQuery({
    queryKey: ['document-detail', documentId],
    queryFn: () => api.getDocumentDetail(documentId!),
    enabled: Boolean(documentId),
  });
}

export function useJobsQuery() {
  return useQuery({
    queryKey: ['jobs'],
    queryFn: api.listJobs,
    refetchInterval: (query) => {
      const jobs = query.state.data;
      if (!jobs) return false;
      const hasActive = jobs.some((j) => ACTIVE_STATUSES.has(j.status));
      return hasActive ? 650 : false;
    },
  });
}

export function useChatsQuery() {
  return useQuery({
    queryKey: ['chats'],
    queryFn: api.listChats,
  });
}

export function useChatDetailQuery(chatId: string | null) {
  return useQuery({
    queryKey: ['chat', chatId],
    queryFn: () => api.getChat(chatId!),
    enabled: Boolean(chatId),
  });
}

export function useUploadPdfsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (files: File[]) => api.uploadPdfs(files),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['documents'] });
      void qc.invalidateQueries({ queryKey: ['jobs'] });
      const count = data.documents.length;
      toast.success(
        count === 1
          ? `Queued "${data.documents[0].filename}" for background indexing`
          : `Queued ${count} PDFs for background indexing`
      );
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'PDF upload failed');
    },
  });
}

export function useRetryDocumentMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.retryDocument(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['documents'] });
      void qc.invalidateQueries({ queryKey: ['jobs'] });
      toast.success('Re-queued PDF for indexing');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Retry failed');
    },
  });
}

export function useDeleteDocumentMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteDocument(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['documents'] });
      void qc.invalidateQueries({ queryKey: ['jobs'] });
      void qc.invalidateQueries({ queryKey: ['chats'] });
      toast.success('Removed document and its vector embeddings');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    },
  });
}

export function useCreateChatMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      documentIds: string[];
      title?: string;
      model?: string;
      numCtx?: number;
    }) => api.createChat(params),
    onSuccess: (chat) => {
      void qc.invalidateQueries({ queryKey: ['chats'] });
      qc.setQueryData(['chat', chat.id], chat);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to start chat');
    },
  });
}

export function useUpdateChatDocumentsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ chatId, documentIds }: { chatId: string; documentIds: string[] }) =>
      api.updateChatDocuments(chatId, documentIds),
    onSuccess: (chat) => {
      qc.setQueryData(['chat', chat.id], chat);
      void qc.invalidateQueries({ queryKey: ['chats'] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update chat PDFs');
    },
  });
}

export function useUpdateChatSettingsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      chatId,
      patch,
    }: {
      chatId: string;
      patch: { title?: string; model?: string; numCtx?: number | null };
    }) => api.updateChatSettings(chatId, patch),
    onSuccess: (chat, vars) => {
      qc.setQueryData(['chat', chat.id], chat);
      void qc.invalidateQueries({ queryKey: ['chats'] });
      if (vars.patch.title) {
        toast.success('Conversation renamed');
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update chat settings');
    },
  });
}

export function useRenameChatMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ chatId, title }: { chatId: string; title: string }) =>
      api.updateChatSettings(chatId, { title }),
    onSuccess: (chat) => {
      qc.setQueryData(['chat', chat.id], chat);
      void qc.invalidateQueries({ queryKey: ['chats'] });
      toast.success('Conversation renamed');
    },
  });
}

export function useDeleteChatMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (chatId: string) => api.deleteChat(chatId),
    onSuccess: (_res, chatId) => {
      qc.removeQueries({ queryKey: ['chat', chatId] });
      void qc.invalidateQueries({ queryKey: ['chats'] });
      toast.success('Conversation deleted');
    },
  });
}
