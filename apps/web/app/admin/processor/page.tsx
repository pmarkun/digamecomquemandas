"use client";

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { BootstrapRun, RunArticle, processBootstrapArticle } from '@/lib/bootstrapProcessor';

type ProcessorStatus = {
  status: 'idle' | 'running' | 'done' | 'error';
  run_id?: string;
  processed: number;
  total: number;
  current_article?: string;
  error?: string;
};

declare global {
  interface Window {
    __DIGA_PROCESSOR__?: ProcessorStatus;
  }
}

function headersFor(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function publish(status: ProcessorStatus) {
  window.__DIGA_PROCESSOR__ = status;
}

export default function BootstrapProcessorPage() {
  const [status, setStatus] = useState<ProcessorStatus>({ status: 'idle', processed: 0, total: 0 });
  const params = useMemo(() => new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search), []);
  const token = params.get('token') || '';
  const runId = params.get('run_id') || '';
  const maxImages = Number(params.get('max_images') || 4);

  const setPublishedStatus = (next: ProcessorStatus) => {
    setStatus(next);
    publish(next);
  };

  useEffect(() => {
    let cancelled = false;

    const runProcessor = async () => {
      if (!token || !runId) {
        setPublishedStatus({
          status: 'error',
          run_id: runId || undefined,
          processed: 0,
          total: 0,
          error: 'Informe run_id e token.',
        });
        return;
      }

      try {
        const run = await api.get<BootstrapRun>(`/admin/bootstrap-runs/${runId}`, headersFor(token));
        const pending = run.articles.filter((article) => ['DISCOVERED', 'ERROR'].includes(article.status));
        setPublishedStatus({ status: 'running', run_id: run.id, processed: 0, total: pending.length });

        let processed = 0;
        for (const article of pending) {
          if (cancelled) return;
          setPublishedStatus({
            status: 'running',
            run_id: run.id,
            processed,
            total: pending.length,
            current_article: article.article_url,
          });
          await processBootstrapArticle(article as RunArticle, {
            runId: run.id,
            token,
            renderBrowser: run.render_browser,
            maxImages: Number.isFinite(maxImages) && maxImages > 0 ? maxImages : 4,
          });
          processed += 1;
        }

        setPublishedStatus({ status: 'done', run_id: run.id, processed, total: pending.length });
      } catch (error: unknown) {
        setPublishedStatus({
          status: 'error',
          run_id: runId,
          processed: status.processed,
          total: status.total,
          error: error instanceof Error ? error.message : 'Erro desconhecido',
        });
      }
    };

    void runProcessor();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="shell">
      <div className="page">
        <section className="panel">
          <p className="eyebrow">Processor headless</p>
          <h1 className="admin-title">Bootstrap automático</h1>
          <p>Status: <strong>{status.status}</strong></p>
          <p>{status.processed} de {status.total}</p>
          {status.current_article && <p className="muted">{status.current_article}</p>}
          {status.error && <p className="feedback">{status.error}</p>}
        </section>
      </div>
    </main>
  );
}
