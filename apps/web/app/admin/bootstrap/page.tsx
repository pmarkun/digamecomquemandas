"use client";

/* eslint-disable @next/next/no-img-element */

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import {
  BootstrapFace,
  BootstrapGroup,
  BootstrapImage,
  BootstrapRun,
  RunArticle,
  cropStyle,
  processBootstrapArticle,
} from '@/lib/bootstrapProcessor';

type PersonOption = {
  id: string;
  name: string;
  display_name?: string;
  slug: string;
};

function headersFor(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export default function BootstrapAdminPage() {
  const peopleTimer = useRef<number | null>(null);
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('admin');
  const [logged, setLogged] = useState(false);
  const [limit, setLimit] = useState(10);
  const [renderBrowser, setRenderBrowser] = useState(true);
  const [run, setRun] = useState<BootstrapRun | null>(null);
  const [runList, setRunList] = useState<Array<{ id: string; status: string; created_at: string }>>([]);
  const [feedback, setFeedback] = useState('');
  const [processing, setProcessing] = useState(false);
  const [activeArticleId, setActiveArticleId] = useState<string | null>(null);
  const [activeArticleIndex, setActiveArticleIndex] = useState(0);
  const [groupNames, setGroupNames] = useState<Record<string, string>>({});
  const [peopleOptions, setPeopleOptions] = useState<Record<string, PersonOption[]>>({});

  const remainingArticles = useMemo(
    () => run?.articles.filter((article) => ['DISCOVERED', 'ERROR'].includes(article.status)) || [],
    [run],
  );
  const reviewArticles = useMemo(() => run?.articles || [], [run]);
  const currentArticle = reviewArticles[activeArticleIndex] || null;

  useEffect(() => {
    if (activeArticleIndex >= reviewArticles.length) {
      setActiveArticleIndex(Math.max(0, reviewArticles.length - 1));
    }
  }, [activeArticleIndex, reviewArticles.length]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!reviewArticles.length) return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key === 'ArrowLeft') {
        setActiveArticleIndex((current) => Math.max(0, current - 1));
      }
      if (event.key === 'ArrowRight') {
        setActiveArticleIndex((current) => Math.min(reviewArticles.length - 1, current + 1));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [reviewArticles.length]);

  useEffect(() => {
    const stored = window.localStorage.getItem('digaMeAdminToken') || '';
    if (!stored) return;
    setToken(stored);
    setLogged(true);
    loadRuns(stored).catch(() => {
      setLogged(false);
      setFeedback('Sessão admin expirada. Faça login novamente.');
      window.localStorage.removeItem('digaMeAdminToken');
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setFeedback('');
    try {
      const out = await api.post<{ token: string }>('/admin/login', { email, password });
      setToken(out.token);
      window.localStorage.setItem('digaMeAdminToken', out.token);
      setLogged(true);
      setFeedback('Login ok.');
      await loadRuns(out.token);
    } catch (_error: unknown) {
      setLogged(false);
      setFeedback('Falha no login.');
    }
  };

  const loadRuns = async (authToken = token) => {
    const rows = await api.get<Array<{ id: string; status: string; created_at: string }>>('/admin/bootstrap-runs', headersFor(authToken));
    setRunList(rows);
    if (!run && rows[0]) {
      await loadRun(rows[0].id, authToken);
    }
  };

  const loadRun = async (runId: string, authToken = token) => {
    const nextRun = await api.get<BootstrapRun>(`/admin/bootstrap-runs/${runId}`, headersFor(authToken));
    setRun(nextRun);
  };

  const createRun = async (event: FormEvent) => {
    event.preventDefault();
    setFeedback('Criando run e coletando links de editoria...');
    const nextRun = await api.post<BootstrapRun>(
      '/admin/bootstrap-runs',
      { limit_per_source: limit, render_browser: renderBrowser },
      headersFor(token),
    );
    setRun(nextRun);
    await loadRuns();
    setFeedback(`Run criado com ${nextRun.counts.articles} matérias.`);
  };

  const processArticle = async (article: RunArticle) => {
    if (!run) return;
    setActiveArticleId(article.id);
    try {
      await processBootstrapArticle(article, {
        runId: run.id,
        token,
        renderBrowser,
        maxImages: 4,
      });
    } finally {
      setActiveArticleId(null);
    }
  };

  const processRun = async () => {
    if (!run) return;
    setProcessing(true);
    setFeedback('Processando matérias e detectando faces...');
    try {
      for (const article of remainingArticles) {
        await processArticle(article);
        await loadRun(run.id);
      }
      await loadRun(run.id);
      setFeedback('Processamento concluído.');
    } finally {
      setProcessing(false);
    }
  };

  const searchPeople = (groupId: string, value: string) => {
    setGroupNames((current) => ({ ...current, [groupId]: value }));
    if (peopleTimer.current) window.clearTimeout(peopleTimer.current);
    if (value.trim().length < 2) {
      setPeopleOptions((current) => ({ ...current, [groupId]: [] }));
      return;
    }
    peopleTimer.current = window.setTimeout(async () => {
      const rows = await api.get<PersonOption[]>(`/admin/people?query=${encodeURIComponent(value.trim())}`, headersFor(token));
      setPeopleOptions((current) => ({ ...current, [groupId]: rows }));
    }, 180);
  };

  const reviewMatch = async (matchId: string, status: 'APPROVED' | 'REJECTED') => {
    if (!run) return;
    await api.post(`/admin/matches/${matchId}/review`, { status }, headersFor(token));
    setFeedback(status === 'APPROVED' ? 'Match aprovado.' : 'Match rejeitado.');
    await loadRun(run.id);
  };

  const assignFace = async (face: BootstrapFace) => {
    if (!run) return;
    const value = (groupNames[face.face_id] || '').trim();
    if (!value) return;
    const selected = (peopleOptions[face.face_id] || []).find((person) => [person.name, person.display_name].includes(value));
    await api.post(
      `/admin/bootstrap-runs/${run.id}/faces/${face.face_id}/assign`,
      {
        person_id: selected?.id || null,
        name: selected ? null : value,
      },
      headersFor(token),
    );
    setGroupNames((current) => ({ ...current, [face.face_id]: '' }));
    setFeedback(`Face atribuída a ${value}.`);
    await loadRun(run.id);
  };

  const ignoreImage = async (image: BootstrapImage) => {
    if (!run) return;
    await api.post(`/admin/bootstrap-runs/${run.id}/article-images/${image.image_id}/ignore`, {}, headersFor(token));
    setFeedback('Imagem ignorada neste run.');
    await loadRun(run.id);
  };

  const labelGroup = async (group: BootstrapGroup) => {
    if (!run) return;
    const name = (groupNames[group.group_id] || '').trim();
    const selected = (peopleOptions[group.group_id] || []).find((person) => [person.name, person.display_name].includes(name));
    await api.post(
      `/admin/bootstrap-runs/${run.id}/label-group`,
      {
        face_ids: group.faces.map((face) => face.face_id),
        person_id: selected?.id || null,
        name: selected ? null : name,
      },
      headersFor(token),
    );
    setGroupNames((current) => ({ ...current, [group.group_id]: '' }));
    setFeedback(`Grupo nomeado como ${name}.`);
    await loadRun(run.id);
  };

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/">Diga-me</a>
        <nav className="navline">
          <a href="/admin">Admin</a>
          <a href="/admin/bootstrap">Bootstrap</a>
        </nav>
      </header>

      <div className="page">
        <section className="admin-header">
          <div>
            <p className="eyebrow">Bootstrap da base</p>
            <h1 className="admin-title">Nomeação em lote</h1>
          </div>
          <div className="toolbar">
            <a className="button secondary" href="/admin">Voltar ao admin</a>
            {run && <button className="button secondary" type="button" onClick={() => loadRun(run.id)}>Atualizar</button>}
          </div>
        </section>

        {!logged && (
          <section className="panel">
            <form className="login-strip" onSubmit={login}>
              <input className="input" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email" autoComplete="username" />
              <input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="senha" autoComplete="current-password" />
              <button className="button" type="submit">Entrar</button>
            </form>
            <p className="muted">A bancada usa a mesma sessão do admin, mas no mobile ela também aceita login direto.</p>
            {feedback && <p className="feedback">{feedback}</p>}
          </section>
        )}

        {logged && (
          <>
            <section className="panel">
              <form className="toolbar split" onSubmit={createRun}>
                <label className="inline-field">
                  Matérias por fonte
                  <input className="input" type="number" min={1} max={50} value={limit} onChange={(event) => setLimit(Number(event.target.value) || 10)} />
                </label>
                <label className="checkline">
                  <input type="checkbox" checked={renderBrowser} onChange={(event) => setRenderBrowser(event.target.checked)} />
                  HTML + browser fallback
                </label>
                <button className="button" type="submit">Criar run</button>
              </form>
              {runList.length > 0 && (
                <div className="toolbar">
                  <span className="muted">Runs recentes</span>
                  <select className="input" value={run?.id || ''} onChange={(event) => loadRun(event.target.value)}>
                    {runList.map((item) => (
                      <option key={item.id} value={item.id}>{item.id.slice(0, 8)} · {item.status}</option>
                    ))}
                  </select>
                </div>
              )}
            </section>

            {feedback && <p className="feedback">{feedback}</p>}

            {run && (
              <>
                <section className="dashboard-grid">
                  <div className="stat"><strong>{run.counts.articles}</strong><span>Matérias</span></div>
                  <div className="stat"><strong>{run.counts.images}</strong><span>Imagens com faces</span></div>
                  <div className="stat"><strong>{run.counts.faces}</strong><span>Faces persistidas</span></div>
                  <div className="stat"><strong>{run.groups.length}</strong><span>Grupos desconhecidos</span></div>
                </section>

                <section className="panel">
                  <div className="toolbar split">
                    <div>
                      <h2>Coleta e análise</h2>
                      <p className="muted">Run {run.id.slice(0, 8)} · {remainingArticles.length} matérias pendentes.</p>
                    </div>
                    <div className="toolbar">
                      {currentArticle && (
                        <button className="button secondary" type="button" disabled={processing || activeArticleId === currentArticle.id} onClick={() => processArticle(currentArticle).then(() => loadRun(run.id))}>
                          {activeArticleId === currentArticle.id ? 'Processando...' : 'Processar esta'}
                        </button>
                      )}
                      <button className="button" type="button" disabled={processing || remainingArticles.length === 0} onClick={processRun}>
                        {processing ? 'Processando...' : 'Processar pendentes'}
                      </button>
                    </div>
                  </div>
                  {currentArticle ? (
                    <article className="bootstrap-review-deck">
                      <div className="bootstrap-review-nav">
                        <button className="icon-button" type="button" disabled={activeArticleIndex === 0} onClick={() => setActiveArticleIndex((current) => Math.max(0, current - 1))} aria-label="Matéria anterior">←</button>
                        <span className="badge">{activeArticleIndex + 1} de {reviewArticles.length}</span>
                        <button className="icon-button" type="button" disabled={activeArticleIndex >= reviewArticles.length - 1} onClick={() => setActiveArticleIndex((current) => Math.min(reviewArticles.length - 1, current + 1))} aria-label="Próxima matéria">→</button>
                      </div>

                      <div className="bootstrap-review-header">
                        <span className="badge">{activeArticleId === currentArticle.id ? 'PROCESSANDO' : currentArticle.status}</span>
                        <h2>{currentArticle.title || currentArticle.article_url}</h2>
                        <p className="muted">{currentArticle.source} · {currentArticle.image_count} imagem(ns) · {currentArticle.face_count} face(s)</p>
                        <a href={currentArticle.article_url} target="_blank" rel="noreferrer">{currentArticle.article_url}</a>
                        {currentArticle.warnings.length > 0 && (
                          <details className="bootstrap-warnings">
                            <summary>{currentArticle.warnings.length} aviso(s)</summary>
                            <ul>
                              {currentArticle.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
                            </ul>
                          </details>
                        )}
                      </div>

                      {currentArticle.images.length === 0 && (
                        <p className="empty-panel">Nenhuma imagem analisada para esta matéria ainda.</p>
                      )}

                      <div className="bootstrap-image-list">
                        {currentArticle.images.map((image) => (
                          <section className="bootstrap-image-review" key={image.image_id}>
                            <a className="bootstrap-image-preview" href={image.image_url} target="_blank" rel="noreferrer">
                              <img src={image.image_url} alt="" />
                            </a>
                            <div className="bootstrap-face-review-list">
                              <div className="toolbar split">
                                <div>
                                  <strong>{image.faces.length} face(s)</strong>
                                  <p className="muted">{image.width || '?'} × {image.height || '?'} · {image.status}</p>
                                </div>
                                <button className="button secondary compact" type="button" onClick={() => ignoreImage(image)}>Ignorar imagem</button>
                              </div>
                              {image.faces.length === 0 && <p className="muted">Imagem sem faces persistidas.</p>}
                              {image.faces.map((face) => {
                                const fieldId = `face-person-${face.face_id}`;
                                const primaryMatch = face.matches[0];
                                return (
                                  <article className="bootstrap-face-review" key={face.face_id}>
                                    <div className="bootstrap-face">
                                      <img src={image.image_url} alt="" style={cropStyle(face, image)} />
                                    </div>
                                    <div className="bootstrap-face-body">
                                      <div className="toolbar split">
                                        <div>
                                          <strong>{primaryMatch ? primaryMatch.person_name : 'Sem identificação'}</strong>
                                          {primaryMatch && (
                                            <p className="muted">{Math.round(primaryMatch.score * 100)}% · {primaryMatch.status}</p>
                                          )}
                                        </div>
                                        {primaryMatch && (
                                          <div className="toolbar">
                                            <button className="button secondary compact" type="button" onClick={() => reviewMatch(primaryMatch.id, 'APPROVED')}>Aprovar</button>
                                            <button className="button secondary compact" type="button" onClick={() => reviewMatch(primaryMatch.id, 'REJECTED')}>Rejeitar</button>
                                          </div>
                                        )}
                                      </div>
                                      {face.matches.length > 1 && (
                                        <p className="muted">Outros candidatos: {face.matches.slice(1).map((match) => `${match.person_name} ${Math.round(match.score * 100)}%`).join(' · ')}</p>
                                      )}
                                      {face.suggestions.length > 0 && (
                                        <p className="muted">Sugestões: {face.suggestions.map((suggestion) => suggestion.suggested_name).join(' · ')}</p>
                                      )}
                                      <form className="toolbar" onSubmit={(event) => { event.preventDefault(); void assignFace(face); }}>
                                        <input
                                          className="input"
                                          list={fieldId}
                                          value={groupNames[face.face_id] || ''}
                                          onChange={(event) => searchPeople(face.face_id, event.target.value)}
                                          placeholder="Corrigir ou atribuir pessoa"
                                          required
                                        />
                                        <datalist id={fieldId}>
                                          {(peopleOptions[face.face_id] || []).map((person) => (
                                            <option key={person.id} value={person.display_name || person.name}>{person.slug}</option>
                                          ))}
                                        </datalist>
                                        <button className="button compact" type="submit">Atribuir</button>
                                      </form>
                                    </div>
                                  </article>
                                );
                              })}
                            </div>
                          </section>
                        ))}
                      </div>
                    </article>
                  ) : (
                    <p className="empty-panel">Nenhuma matéria neste run.</p>
                  )}
                </section>

                <section className="admin-queue">
                  <div className="toolbar split">
                    <div>
                      <h2>Grupos para nomear</h2>
                      <p className="muted">Atalho secundário para nomear faces desconhecidas semelhantes.</p>
                    </div>
                  </div>
                  {run.groups.length === 0 && <p className="empty-panel">Nenhum grupo desconhecido disponível.</p>}
                  <div className="bootstrap-group-list">
                    {run.groups.map((group) => {
                      const datalistId = `bootstrap-people-${group.group_id}`;
                      return (
                        <article className="bootstrap-group" key={group.group_id}>
                          <div className="toolbar split">
                            <div>
                              <h3>{group.face_count} face(s)</h3>
                              <p className="muted">{group.article_count} matéria(s)</p>
                            </div>
                            <span className="badge">{group.group_id}</span>
                          </div>
                          <div className="bootstrap-face-strip">
                            {group.faces.slice(0, 12).map((face) => (
                              <a className="bootstrap-face" href={face.article_url || '#'} target="_blank" rel="noreferrer" key={face.face_id} title={face.article_title || ''}>
                                {face.image_url ? <img src={face.image_url} alt="" /> : null}
                              </a>
                            ))}
                          </div>
                          <form className="toolbar" onSubmit={(event) => { event.preventDefault(); void labelGroup(group); }}>
                            <input
                              className="input"
                              list={datalistId}
                              value={groupNames[group.group_id] || ''}
                              onChange={(event) => searchPeople(group.group_id, event.target.value)}
                              placeholder="Nome da pessoa"
                              required
                            />
                            <datalist id={datalistId}>
                              {(peopleOptions[group.group_id] || []).map((person) => (
                                <option key={person.id} value={person.display_name || person.name}>{person.slug}</option>
                              ))}
                            </datalist>
                            <button className="button" type="submit">Nomear grupo</button>
                          </form>
                        </article>
                      );
                    })}
                  </div>
                </section>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
