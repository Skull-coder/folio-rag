import React, { useMemo } from 'react';
import { Check, ChevronDown, Cpu, RefreshCw } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/src/components/ui/dropdown-menu';
import { useModelsQuery } from '@/src/hooks/useRagQueries';
import { ModelProvider, OllamaModelInfo } from '@/src/lib/types';
import { cn } from '@/src/lib/utils';

interface ModelContextSelectorProps {
  model: string;
  numCtx?: number;
  onChange: (next: { model: string; numCtx?: number }) => void;
  onOpenRuntime?: () => void;
}

const PROVIDER_META: Record<
  ModelProvider,
  { title: string; envVar?: string; shortName: string }
> = {
  ollama: { title: 'Local · Ollama', shortName: 'Ollama' },
  gemini: { title: 'Google Gemini', envVar: 'GEMINI_API_KEY', shortName: 'Gemini' },
  openai: { title: 'OpenAI · ChatGPT', envVar: 'OPENAI_API_KEY', shortName: 'OpenAI' },
  deepseek: { title: 'DeepSeek', envVar: 'DEEPSEEK_API_KEY', shortName: 'DeepSeek' },
  anthropic: {
    title: 'Anthropic Claude',
    envVar: 'ANTHROPIC_API_KEY',
    shortName: 'Claude',
  },
};

function formatCtxLabel(tokens: number): string {
  if (tokens >= 1000000) {
    return '1M';
  }
  if (tokens >= 1024) {
    const k = Math.round(tokens / 1024);
    return `${k}K`;
  }
  return String(tokens);
}

export function ModelContextSelector({
  model,
  numCtx,
  onChange,
  onOpenRuntime,
}: ModelContextSelectorProps) {
  const { data, isFetching, refetch } = useModelsQuery();
  const models = data?.models || [];
  const ollamaConnected = Boolean(data?.providers?.ollama);

  const isRemoteHost =
    typeof window !== 'undefined' &&
    !['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);

  const activeModelInfo: OllamaModelInfo = useMemo(() => {
    return (
      models.find((m) => m.name === model) ||
      models[0] || {
        name: model || 'qwen3:4b',
        label: model || 'qwen3:4b',
        provider: 'ollama',
        available: true,
        sizeBytes: 0,
        parameterSize: '4B',
        maxContextLength: 32768,
        defaultNumCtx: 32768,
      }
    );
  }, [models, model]);

  const effectiveNumCtx = numCtx
    ? Math.min(numCtx, activeModelInfo.maxContextLength)
    : activeModelInfo.defaultNumCtx;

  const ctxPresets = useMemo(() => {
    const max = activeModelInfo.maxContextLength;
    const candidates = [
      8192, 16384, 32768, 65536, 131072, 262144, 524288, 1048576,
    ].filter((v) => v <= max);
    if (!candidates.includes(max) && max >= 4096) {
      candidates.push(max);
    }
    return candidates;
  }, [activeModelInfo.maxContextLength]);

  const ollamaModels = useMemo(() => {
    const matched = models.filter(
      (m) =>
        m.provider === 'ollama' ||
        (!m.provider &&
          !m.name.includes('gemini') &&
          !m.name.includes('gpt') &&
          !m.name.includes('o3-') &&
          !m.name.includes('deepseek') &&
          !m.name.includes('claude'))
    );
    if (ollamaConnected && matched.length === 0) {
      return [
        {
          name: 'qwen3:4b',
          label: 'qwen3:4b',
          provider: 'ollama' as const,
          available: true,
          sizeBytes: 0,
          parameterSize: '4B',
          maxContextLength: 32768,
          defaultNumCtx: 32768,
        },
      ];
    }
    return matched;
  }, [models, ollamaConnected]);

  const configuredCloudGroups = useMemo(() => {
    const cloudOrder: Exclude<ModelProvider, 'ollama'>[] = [
      'gemini',
      'openai',
      'deepseek',
      'anthropic',
    ];
    return cloudOrder
      .map((provider) => ({
        provider,
        items: models.filter((m) => m.provider === provider && m.available),
      }))
      .filter((g) => g.items.length > 0);
  }, [models]);

  const unconfiguredCloudProviders = useMemo(() => {
    const cloudOrder: Exclude<ModelProvider, 'ollama'>[] = [
      'gemini',
      'openai',
      'deepseek',
      'anthropic',
    ];
    return cloudOrder.filter(
      (provider) => !models.some((m) => m.provider === provider && m.available)
    );
  }, [models]);

  return (
    <div className="flex items-center gap-1.5">
      {/* Model Selector — opens upward above bottom composer */}
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) {
            void refetch();
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-8 select-none items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)] cursor-pointer whitespace-nowrap shrink-0"
            title="Switch local or cloud AI model"
          >
            <Cpu className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
            <span className="max-w-[10rem] truncate font-mono">
              {activeModelInfo.label || activeModelInfo.name}
            </span>
            <ChevronDown className="h-3 w-3 text-[var(--muted-foreground)]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={16}
          className="w-80 max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto"
        >
          {/* Local Ollama Section — always pinned at the top */}
          <div className="py-1">
            <div className="flex items-center justify-between px-2.5 py-1 text-[11px] font-semibold text-[var(--muted-foreground)]">
              <div className="flex items-center gap-1.5">
                <span>Local · Ollama</span>
                <span
                  className={cn(
                    'font-mono text-[10px]',
                    ollamaConnected
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-amber-700 dark:text-amber-400'
                  )}
                >
                  {ollamaConnected ? 'Connected' : 'Offline'}
                </span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void refetch();
                }}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)] cursor-pointer"
                title="Refresh installed Ollama models"
              >
                <RefreshCw
                  className={cn('h-3 w-3', isFetching && 'animate-spin')}
                />
                <span>Refresh</span>
              </button>
            </div>

            {ollamaConnected ? (
              ollamaModels.map((m) => {
                const isSelected = m.name === activeModelInfo.name;
                return (
                  <DropdownMenuItem
                    key={m.name}
                    onSelect={() => {
                      onChange({ model: m.name, numCtx: m.defaultNumCtx });
                    }}
                    className="flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs font-medium">
                        {m.label || m.name}
                      </div>
                      <div className="text-[11px] text-[var(--muted-foreground)] tabular-nums">
                        {m.parameterSize ? `${m.parameterSize} · ` : ''}
                        Max {formatCtxLabel(m.maxContextLength)} ctx
                      </div>
                    </div>
                    {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </DropdownMenuItem>
                );
              })
            ) : (
              <div className="mx-2 my-1 rounded-md border border-[var(--border)] bg-[var(--muted)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
                {isRemoteHost ? (
                  <>
                    Cloud preview cannot access Ollama on your PC. Run{' '}
                    <code className="font-mono text-[var(--foreground)]">
                      ./start.sh
                    </code>{' '}
                    on{' '}
                    <code className="font-mono text-[var(--foreground)]">
                      http://localhost:3000
                    </code>{' '}
                    to use <code className="font-mono">qwen3:4b</code> or{' '}
                    <code className="font-mono">qwen2.5:3b</code>.
                  </>
                ) : (
                  <>
                    Ollama is not responding at{' '}
                    <code className="font-mono">127.0.0.1:11434</code>. Start{' '}
                    <code className="font-mono text-[var(--foreground)]">
                      ollama serve
                    </code>{' '}
                    and click Refresh.
                  </>
                )}
              </div>
            )}
          </div>

          {/* Configured Cloud Providers */}
          {configuredCloudGroups.map((group) => {
            const meta = PROVIDER_META[group.provider];
            return (
              <div
                key={group.provider}
                className="border-t border-[var(--border)] py-1"
              >
                <div className="flex items-center justify-between px-2.5 py-1 text-[11px] font-semibold text-[var(--muted-foreground)]">
                  <span>{meta.title}</span>
                  <span className="font-mono text-[10px] text-emerald-700 dark:text-emerald-400">
                    Connected
                  </span>
                </div>
                {group.items.map((m) => {
                  const isSelected = m.name === activeModelInfo.name;
                  return (
                    <DropdownMenuItem
                      key={m.name}
                      onSelect={() => {
                        onChange({ model: m.name, numCtx: m.defaultNumCtx });
                      }}
                      className="flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-mono text-xs font-medium">
                          {m.label || m.name}
                        </div>
                        <div className="text-[11px] text-[var(--muted-foreground)] tabular-nums">
                          Max {formatCtxLabel(m.maxContextLength)} ctx
                        </div>
                      </div>
                      {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                    </DropdownMenuItem>
                  );
                })}
              </div>
            );
          })}

          {/* Compact footer for additional cloud providers */}
          {unconfiguredCloudProviders.length > 0 && (
            <div className="border-t border-[var(--border)] px-2.5 py-2 text-[11px] text-[var(--muted-foreground)]">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">
                  More:{' '}
                  {unconfiguredCloudProviders
                    .map((p) => PROVIDER_META[p].shortName)
                    .join(', ')}{' '}
                  (.env / Secrets)
                </span>
                {onOpenRuntime && (
                  <button
                    type="button"
                    onClick={() => onOpenRuntime()}
                    className="shrink-0 font-medium text-[var(--foreground)] underline underline-offset-2 cursor-pointer"
                  >
                    Status
                  </button>
                )}
              </div>
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Context Window Selector — opens upward above bottom composer */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-8 select-none items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs font-mono text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)] cursor-pointer whitespace-nowrap shrink-0 tabular-nums"
            title="Context window budget sent per prompt"
          >
            <span>{formatCtxLabel(effectiveNumCtx)} ctx</span>
            <ChevronDown className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={16}
          className="w-56 max-h-[min(18rem,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto"
        >
          <div className="px-2.5 py-1.5 text-[11px] font-semibold text-[var(--muted-foreground)]">
            Context Window Size
          </div>
          {ctxPresets.map((preset) => {
            const isSelected = effectiveNumCtx === preset;
            return (
              <DropdownMenuItem
                key={preset}
                onSelect={() =>
                  onChange({ model: activeModelInfo.name, numCtx: preset })
                }
                className={cn(
                  'flex items-center justify-between font-mono text-xs tabular-nums'
                )}
              >
                <span>
                  {formatCtxLabel(preset)} ({preset.toLocaleString()} tokens)
                </span>
                {isSelected && <Check className="h-3.5 w-3.5" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
