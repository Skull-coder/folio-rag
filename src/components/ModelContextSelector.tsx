import React, { useMemo } from 'react';
import { Check, ChevronDown, Cpu } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/src/components/ui/dropdown-menu';
import { useModelsQuery } from '@/src/hooks/useRagQueries';
import { cn } from '@/src/lib/utils';

interface ModelContextSelectorProps {
  model: string;
  numCtx?: number;
  onChange: (next: { model: string; numCtx?: number }) => void;
}

function formatCtxLabel(tokens: number): string {
  if (tokens >= 1024) {
    const k = tokens / 1024;
    return `${Number.isInteger(k) ? k : k.toFixed(0)}K`;
  }
  return String(tokens);
}

export function ModelContextSelector({
  model,
  numCtx,
  onChange,
}: ModelContextSelectorProps) {
  const { data } = useModelsQuery();
  const models = data?.models || [];

  const activeModelInfo = useMemo(() => {
    return (
      models.find((m) => m.name === model) ||
      models[0] || {
        name: model || 'qwen3:4b',
        sizeBytes: 0,
        parameterSize: '4B',
        maxContextLength: 32768,
        defaultNumCtx: 16384,
      }
    );
  }, [models, model]);

  const effectiveNumCtx = numCtx
    ? Math.min(numCtx, activeModelInfo.maxContextLength)
    : activeModelInfo.defaultNumCtx;

  const ctxPresets = useMemo(() => {
    const max = activeModelInfo.maxContextLength;
    const candidates = [8192, 16384, 32768, 65536, 131072].filter(
      (v) => v <= max
    );
    if (!candidates.includes(max) && max >= 4096) {
      candidates.push(max);
    }
    return candidates;
  }, [activeModelInfo.maxContextLength]);

  return (
    <div className="flex items-center gap-1.5">
      {/* Model Selector */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)] cursor-pointer whitespace-nowrap shrink-0"
            title="Switch local Ollama model"
          >
            <Cpu className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
            <span className="max-w-[9rem] truncate font-mono">
              {activeModelInfo.name}
            </span>
            <ChevronDown className="h-3 w-3 text-[var(--muted-foreground)]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <div className="px-2.5 py-1.5 text-[11px] font-semibold text-[var(--muted-foreground)]">
            Local Ollama Models
          </div>
          {models.map((m) => {
            const isSelected = m.name === activeModelInfo.name;
            return (
              <DropdownMenuItem
                key={m.name}
                onSelect={() => {
                  const clampedCtx = numCtx
                    ? Math.min(numCtx, m.maxContextLength)
                    : m.defaultNumCtx;
                  onChange({ model: m.name, numCtx: clampedCtx });
                }}
                className="flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs font-medium">
                    {m.name}
                  </div>
                  <div className="text-[11px] text-[var(--muted-foreground)] tabular-nums">
                    {m.parameterSize ? `${m.parameterSize} · ` : ''}
                    Max {formatCtxLabel(m.maxContextLength)} ctx
                  </div>
                </div>
                {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
              </DropdownMenuItem>
            );
          })}
          {!data?.connected && (
            <div className="border-t border-[var(--border)] px-2.5 py-2 text-[11px] text-[var(--muted-foreground)]">
              Run <code className="font-mono">ollama pull &lt;model&gt;</code> to add more local models.
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Context Window Selector */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs font-mono text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)] cursor-pointer whitespace-nowrap shrink-0 tabular-nums"
            title="Context window budget sent per prompt"
          >
            <span>{formatCtxLabel(effectiveNumCtx)} ctx</span>
            <ChevronDown className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
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
                className={cn('flex items-center justify-between font-mono text-xs tabular-nums')}
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
