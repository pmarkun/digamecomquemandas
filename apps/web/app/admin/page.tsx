"use client";

/* eslint-disable @next/next/no-img-element */

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';

type Person = {
  id: string;
  name: string;
  display_name?: string;
  slug: string;
  category?: string;
  public_office?: string;
  description?: string;
  source_urls?: string[];
  status: string;
};

type Suggestion = {
  id: string;
  detected_face_id: string;
  suggested_name: string;
  suggested_person_id?: string;
  suggested_person_name?: string;
  comment?: string;
  submitter_email?: string;
  status: string;
  created_at?: string;
  bbox?: { x: number; y: number; w: number; h: number };
  image_url?: string;
  image_width?: number;
  image_height?: number;
  article_title?: string;
  article_url?: string;
};

type Match = {
  id: string;
  detected_face_id: string;
  person_id: string;
  person_name?: string;
  person_slug?: string;
  score: number;
  status: string;
  bbox?: { x: number; y: number; w: number; h: number };
  image_url?: string;
  image_width?: number;
  image_height?: number;
  article_title?: string;
  article_url?: string;
};

type Optout = {
  id: string;
  person_id: string;
  requester_name: string;
  requester_email: string;
  relationship?: string;
  message?: string;
  verification_status: string;
  decision?: string;
  created_at?: string;
};

type AuditLog = {
  id: string;
  actor_type: string;
  actor_id?: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  created_at?: string;
  metadata?: Record<string, unknown>;
};

type AllowedDomain = {
  id: string;
  domain: string;
  enabled: boolean;
};

type AdminArticle = {
  id: string;
  url: string;
  canonical_url?: string;
  domain: string;
  title?: string;
  captured_at?: string;
  created_at?: string;
  image_count: number;
  face_count: number;
  match_count: number;
  suggestion_count: number;
  thumbnail_url?: string;
};

type QueueKey = 'suggestions' | 'matches' | 'articles' | 'people' | 'optouts' | 'allowlist' | 'audit';

type PersonForm = {
  name: string;
  display_name: string;
  slug: string;
  category: string;
  public_office: string;
  description: string;
  source_urls: string;
};

const emptyPersonForm: PersonForm = {
  name: '',
  display_name: '',
  slug: '',
  category: 'public_figure',
  public_office: '',
  description: '',
  source_urls: '',
};

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

function compactDate(value?: string) {
  return value ? new Date(value).toLocaleString('pt-BR') : 'sem data';
}

function bboxText(bbox?: { x: number; y: number; w: number; h: number }) {
  if (!bbox) return 'bbox indisponível';
  return `x ${Math.round(bbox.x)}, y ${Math.round(bbox.y)}, w ${Math.round(bbox.w)}, h ${Math.round(bbox.h)}`;
}

export default function AdminPage() {
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('admin');
  const [feedback, setFeedback] = useState('');
  const [logged, setLogged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [optouts, setOptouts] = useState<Optout[]>([]);
  const [audits, setAudits] = useState<AuditLog[]>([]);
  const [allowedDomains, setAllowedDomains] = useState<AllowedDomain[]>([]);
  const [articles, setArticles] = useState<AdminArticle[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const [personQuery, setPersonQuery] = useState('');
  const [articleQuery, setArticleQuery] = useState('');
  const [editingArticleId, setEditingArticleId] = useState<string | null>(null);
  const [articleForm, setArticleForm] = useState({ title: '', url: '', domain: '', canonical_url: '' });
  const [activeQueue, setActiveQueue] = useState<QueueKey>('suggestions');
  const [showSuggestionHistory, setShowSuggestionHistory] = useState(false);
  const [matchStatus, setMatchStatus] = useState('');
  const [showPersonForm, setShowPersonForm] = useState(false);
  const [personForm, setPersonForm] = useState<PersonForm>(emptyPersonForm);

  const headersFor = (authToken = token) => ({
    Authorization: `Bearer ${authToken}`,
  });

  const loadProtected = async (
    authToken = token,
    includeSuggestionHistory = showSuggestionHistory,
    nextMatchStatus = matchStatus,
  ) => {
    setLoading(true);
    try {
      const headers = headersFor(authToken);
      const suggestionPath = includeSuggestionHistory ? '/admin/suggestions?status=' : '/admin/suggestions';
      const matchPath = nextMatchStatus ? `/admin/matches?status=${encodeURIComponent(nextMatchStatus)}` : '/admin/matches';
      const articlePath = articleQuery.trim()
        ? `/admin/articles?query=${encodeURIComponent(articleQuery.trim())}&limit=50`
        : '/admin/articles?limit=50';
      const [listPeople, listSuggestions, listMatches, listOptouts, listAudits, listAllowedDomains, listArticles] = await Promise.all([
        api.get<Person[]>(`/admin/people`, headers),
        api.get<Suggestion[]>(suggestionPath, headers),
        api.get<Match[]>(matchPath, headers),
        api.get<Optout[]>(`/admin/optout-requests`, headers),
        api.get<AuditLog[]>(`/admin/audit-logs`, headers),
        api.get<AllowedDomain[]>(`/admin/allowed-domains`, headers),
        api.get<AdminArticle[]>(articlePath, headers),
      ]);
      setPeople(listPeople);
      setSuggestions(listSuggestions);
      setMatches(listMatches);
      setOptouts(listOptouts);
      setAudits(listAudits);
      setAllowedDomains(listAllowedDomains);
      setArticles(listArticles);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const stored = window.localStorage.getItem('digaMeAdminToken') || '';
    if (!stored) return;
    setToken(stored);
    setLogged(true);
    loadProtected(stored).catch(() => {
      setLogged(false);
      setFeedback('Sessão admin expirada. Faça login novamente.');
      window.localStorage.removeItem('digaMeAdminToken');
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const out = await api.post<{ token: string }>(`/admin/login`, { email, password });
      setToken(out.token);
      window.localStorage.setItem('digaMeAdminToken', out.token);
      setLogged(true);
      setFeedback('Login ok.');
      await loadProtected(out.token);
    } catch (_error: unknown) {
      setFeedback('Falha no login');
      setLogged(false);
    }
  };

  const filteredPeople = useMemo(() => {
    const query = personQuery.trim().toLowerCase();
    if (!query) return people;
    return people.filter((item) => {
      const text = `${item.name} ${item.display_name || ''} ${item.slug} ${item.public_office || ''}`.toLowerCase();
      return text.includes(query);
    });
  }, [people, personQuery]);

  const submitPerson = async (event: FormEvent) => {
    event.preventDefault();
    const name = personForm.name.trim();
    const slug = personForm.slug.trim() || slugify(name);
    if (!name || !slug) {
      setFeedback('Informe nome e slug para criar a pessoa.');
      return;
    }
    await api.post(
      `/admin/people`,
      {
        name,
        display_name: personForm.display_name.trim() || name,
        slug,
        category: personForm.category.trim() || 'public_figure',
        public_office: personForm.public_office.trim() || null,
        description: personForm.description.trim() || null,
        source_urls: personForm.source_urls.split('\n').map((line) => line.trim()).filter(Boolean),
      },
      headersFor(),
    );
    setPersonForm(emptyPersonForm);
    setShowPersonForm(false);
    setFeedback(`Pessoa ${name} criada.`);
    await loadProtected();
  };

  const updatePersonName = (value: string) => {
    setPersonForm((current) => ({
      ...current,
      name: value,
      display_name: current.display_name || value,
      slug: current.slug ? current.slug : slugify(value),
    }));
  };

  const reviewSuggestion = async (suggestionId: string, status: 'APPROVED' | 'REJECTED') => {
    await api.post(`/admin/suggestions/${suggestionId}/review`, { status }, headersFor());
    setFeedback(status === 'APPROVED' ? 'Sugestão aprovada.' : 'Sugestão rejeitada.');
    await loadProtected();
  };

  const toggleSuggestionHistory = async () => {
    const next = !showSuggestionHistory;
    setShowSuggestionHistory(next);
    await loadProtected(token, next);
  };

  const changeMatchStatus = async (status: string) => {
    setMatchStatus(status);
    await loadProtected(token, showSuggestionHistory, status);
  };

  const reviewMatch = async (matchId: string, status: 'APPROVED' | 'REJECTED') => {
    await api.post(`/admin/matches/${matchId}/review`, { status }, headersFor());
    setFeedback(status === 'APPROVED' ? 'Match aprovado.' : 'Match rejeitado.');
    await loadProtected();
  };

  const optoutPerson = async (personId: string) => {
    if (!confirm('Confirma aplicar opt-out para esta pessoa?')) {
      return;
    }
    await api.post(`/admin/people/${personId}/optout`, {}, headersFor());
    setFeedback('Opt-out aplicado.');
    await loadProtected();
  };

  const addAllowedDomain = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = newDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (!normalized) {
      setFeedback('Informe um domínio válido.');
      return;
    }
    await api.post(`/admin/allowed-domains?domain=${encodeURIComponent(normalized)}`, {}, headersFor());
    setNewDomain('');
    setFeedback(`Domínio ${normalized} adicionado à allowlist.`);
    await loadProtected();
  };

  const searchArticles = async (event: FormEvent) => {
    event.preventDefault();
    await loadProtected();
  };

  const startEditArticle = (article: AdminArticle) => {
    setEditingArticleId(article.id);
    setArticleForm({
      title: article.title || '',
      url: article.url,
      domain: article.domain,
      canonical_url: article.canonical_url || '',
    });
  };

  const saveArticle = async (articleId: string) => {
    const url = articleForm.url.trim();
    if (!url) {
      setFeedback('Informe a URL da matéria.');
      return;
    }
    await api.post(
      `/admin/articles/${articleId}/update`,
      {
        title: articleForm.title.trim() || null,
        url,
        domain: articleForm.domain.trim() || null,
        canonical_url: articleForm.canonical_url.trim() || null,
      },
      headersFor(),
    );
    setEditingArticleId(null);
    setFeedback('Matéria atualizada.');
    await loadProtected();
  };

  const deleteArticle = async (article: AdminArticle) => {
    if (!confirm(`Apagar a matéria "${article.title || article.url}" e todas as faces/imagens vinculadas?`)) {
      return;
    }
    await api.post(`/admin/articles/${article.id}/delete`, {}, headersFor());
    setFeedback('Matéria apagada.');
    await loadProtected();
  };

  const mergeArticleDuplicates = async (article: AdminArticle) => {
    if (!confirm(`Mesclar matérias duplicadas com a mesma URL limpa de "${article.title || article.url}"?`)) {
      return;
    }
    const out = await api.post<{ merged: { removed_articles: number; moved_images: number } }>(
      `/admin/articles/${article.id}/merge-duplicates`,
      {},
      headersFor(),
    );
    setFeedback(`Duplicatas mescladas: ${out.merged.removed_articles} matéria(s), ${out.merged.moved_images} imagem(ns).`);
    await loadProtected();
  };

  const queues: Array<{ key: QueueKey; label: string; count: number }> = [
    { key: 'suggestions', label: showSuggestionHistory ? 'Sugestões' : 'Sugestões pendentes', count: suggestions.length },
    { key: 'matches', label: 'Matches', count: matches.length },
    { key: 'articles', label: 'Matérias', count: articles.length },
    { key: 'people', label: 'Pessoas', count: people.length },
    { key: 'optouts', label: 'Opt-out', count: optouts.length },
    { key: 'allowlist', label: 'Allowlist', count: allowedDomains.length },
    { key: 'audit', label: 'Auditoria', count: audits.length },
  ];

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/">Diga-me</a>
        <nav className="navline">
          <a href="/">Home</a>
          <a href="/admin">Admin</a>
          <a href="/admin/bootstrap">Bootstrap</a>
        </nav>
      </header>

      <div className="page">
        <section className="admin-header">
          <div>
            <p className="eyebrow">Painel de curadoria</p>
            <h1 className="admin-title">Admin</h1>
          </div>
          {logged && (
            <div className="toolbar">
              <button className="button secondary" type="button" onClick={() => loadProtected()}>
                {loading ? 'Atualizando...' : 'Atualizar'}
              </button>
              <button className="button" type="button" onClick={() => setShowPersonForm(true)}>Adicionar pessoa</button>
            </div>
          )}
        </section>

        {!logged && (
          <form className="login-strip panel" onSubmit={login}>
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="senha"
            />
            <button className="button" type="submit">Entrar</button>
          </form>
        )}
        {feedback && <p className="feedback">{feedback}</p>}

        {logged && (
          <>
            <section className="dashboard-grid">
              <div className="stat"><strong>{people.length}</strong><span>Pessoas</span></div>
              <div className="stat"><strong>{matches.length}</strong><span>Matches na fila</span></div>
              <div className="stat"><strong>{suggestions.length}</strong><span>{showSuggestionHistory ? 'Sugestões no histórico' : 'Sugestões pendentes'}</span></div>
              <div className="stat"><strong>{articles.length}</strong><span>Matérias recentes</span></div>
            </section>

            {showPersonForm && (
              <section className="panel admin-form-panel">
                <div className="toolbar split">
                  <h2>Nova figura pública</h2>
                  <button className="button secondary" type="button" onClick={() => setShowPersonForm(false)}>Cancelar</button>
                </div>
                <form className="form-grid" onSubmit={submitPerson}>
                  <input className="input" value={personForm.name} onChange={(event) => updatePersonName(event.target.value)} placeholder="Nome" required />
                  <input className="input" value={personForm.display_name} onChange={(event) => setPersonForm({ ...personForm, display_name: event.target.value })} placeholder="Nome público" />
                  <input className="input" value={personForm.slug} onChange={(event) => setPersonForm({ ...personForm, slug: slugify(event.target.value) })} placeholder="slug-sem-acento" required />
                  <input className="input" value={personForm.category} onChange={(event) => setPersonForm({ ...personForm, category: event.target.value })} placeholder="Categoria" />
                  <input className="input" value={personForm.public_office} onChange={(event) => setPersonForm({ ...personForm, public_office: event.target.value })} placeholder="Cargo ou mandato" />
                  <textarea className="input wide-input" value={personForm.description} onChange={(event) => setPersonForm({ ...personForm, description: event.target.value })} placeholder="Resumo editorial" />
                  <textarea className="input wide-input" value={personForm.source_urls} onChange={(event) => setPersonForm({ ...personForm, source_urls: event.target.value })} placeholder="Links públicos, um por linha" />
                  <button className="button" type="submit">Criar pessoa</button>
                </form>
              </section>
            )}

            <nav className="admin-tabs" aria-label="Filas de curadoria">
              {queues.map((queue) => (
                <button
                  className={activeQueue === queue.key ? 'active' : ''}
                  key={queue.key}
                  type="button"
                  onClick={() => setActiveQueue(queue.key)}
                >
                  <span>{queue.label}</span>
                  <strong>{queue.count}</strong>
                </button>
              ))}
            </nav>

            {activeQueue === 'suggestions' && (
              <section className="admin-queue">
                <div className="toolbar split">
                  <div>
                    <h2>{showSuggestionHistory ? 'Histórico de sugestões' : 'Sugestões pendentes'}</h2>
                    <p className="muted">Cada cartão mostra a face, a matéria e o contexto enviado por quem sugeriu.</p>
                  </div>
                  <button className="button secondary" type="button" onClick={toggleSuggestionHistory}>
                    {showSuggestionHistory ? 'Ver pendentes' : 'Ver histórico'}
                  </button>
                </div>
                {suggestions.length === 0 && <p className="empty-panel">{showSuggestionHistory ? 'Nenhuma sugestão no histórico.' : 'Nenhuma sugestão pendente.'}</p>}
                <div className="review-card-list">
                  {suggestions.map((item) => (
                    <article className="review-card" key={item.id}>
                      {item.image_url ? <img className="review-card-media" src={item.image_url} alt="" /> : <div className="review-card-media placeholder">sem imagem</div>}
                      <div className="review-card-body">
                        <div className="toolbar split">
                          <div>
                            <p className="eyebrow">{compactDate(item.created_at)}</p>
                            <h3>{item.suggested_name}</h3>
                          </div>
                          <span className="badge">{item.status}</span>
                        </div>
                        <p>{item.article_title || 'Matéria sem título'}</p>
                        {item.article_url && <a href={item.article_url} target="_blank" rel="noreferrer">{item.article_url}</a>}
                        {item.comment && <p className="quote-line">{item.comment}</p>}
                        <div className="technical-line">
                          <span>{bboxText(item.bbox)}</span>
                          <span>{item.image_width && item.image_height ? `${item.image_width}x${item.image_height}` : 'dimensão desconhecida'}</span>
                          {item.submitter_email && <span>{item.submitter_email}</span>}
                        </div>
                        {item.status === 'PENDING_REVIEW' ? (
                          <div className="toolbar">
                            <button className="button" type="button" onClick={() => reviewSuggestion(item.id, 'APPROVED')}>Aprovar</button>
                            <button className="button secondary" type="button" onClick={() => reviewSuggestion(item.id, 'REJECTED')}>Rejeitar</button>
                          </div>
                        ) : (
                          <span className="muted">Sugestão já revisada</span>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {activeQueue === 'matches' && (
              <section className="admin-queue">
                <div className="toolbar split">
                  <div>
                    <h2>Matches de reconhecimento</h2>
                    <p className="muted">Aprovação manual publica a aparição; rejeição remove o match da superfície pública.</p>
                  </div>
                  <select className="input" value={matchStatus} onChange={(event) => changeMatchStatus(event.target.value)}>
                    <option value="">Todos os status</option>
                    <option value="AUTO">AUTO</option>
                    <option value="AUTO_APPROVED">AUTO_APPROVED</option>
                    <option value="APPROVED">APPROVED</option>
                    <option value="APPROVED_MANUAL">APPROVED_MANUAL</option>
                    <option value="REJECTED">REJECTED</option>
                    <option value="HIDDEN_OPTOUT">HIDDEN_OPTOUT</option>
                  </select>
                </div>
                {matches.length === 0 && <p className="empty-panel">Nenhum match encontrado.</p>}
                <div className="review-card-list">
                  {matches.map((item) => (
                    <article className="review-card" key={item.id}>
                      {item.image_url ? <img className="review-card-media" src={item.image_url} alt="" /> : <div className="review-card-media placeholder">sem imagem</div>}
                      <div className="review-card-body">
                        <div className="toolbar split">
                          <div>
                            <p className="eyebrow">{item.score ? `${Math.round(item.score * 100)}%` : 'sem score'}</p>
                            <h3>{item.person_slug ? <a href={`/admin/pessoas/${item.person_id}`}>{item.person_name || item.person_slug}</a> : item.person_name || item.person_id.slice(0, 8)}</h3>
                          </div>
                          <span className="badge">{item.status}</span>
                        </div>
                        <p>{item.article_title || 'Matéria sem título'}</p>
                        {item.article_url && <a href={item.article_url} target="_blank" rel="noreferrer">{item.article_url}</a>}
                        <div className="technical-line">
                          <span>{bboxText(item.bbox)}</span>
                          <span>face {item.detected_face_id.slice(0, 8)}</span>
                          <span>{item.image_width && item.image_height ? `${item.image_width}x${item.image_height}` : 'dimensão desconhecida'}</span>
                        </div>
                        <div className="toolbar">
                          <button className="button" type="button" onClick={() => reviewMatch(item.id, 'APPROVED')}>Aprovar</button>
                          <button className="button secondary" type="button" onClick={() => reviewMatch(item.id, 'REJECTED')}>Rejeitar</button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {activeQueue === 'articles' && (
              <section className="admin-queue">
                <div className="toolbar split">
                  <div>
                    <h2>Matérias e imagens associadas</h2>
                    <p className="muted">Corrija título/URL/domínio ou apague entradas duplicadas e testes que poluíram as notícias recentes.</p>
                  </div>
                  <form className="toolbar" onSubmit={searchArticles}>
                    <input
                      className="input"
                      value={articleQuery}
                      onChange={(event) => setArticleQuery(event.target.value)}
                      placeholder="Buscar por título, URL ou domínio"
                    />
                    <button className="button secondary" type="submit">Buscar</button>
                  </form>
                </div>
                {articles.length === 0 && <p className="empty-panel">Nenhuma matéria encontrada.</p>}
                <div className="review-card-list">
                  {articles.map((article) => (
                    <article className="review-card" key={article.id}>
                      {article.thumbnail_url ? <img className="review-card-media" src={article.thumbnail_url} alt="" /> : <div className="review-card-media placeholder">sem imagem</div>}
                      <div className="review-card-body">
                        <div className="toolbar split">
                          <div>
                            <p className="eyebrow">{article.domain} · {compactDate(article.captured_at)}</p>
                            <h3><a href={`/materia/${article.id}`} target="_blank" rel="noreferrer">{article.title || 'Matéria sem título'}</a></h3>
                          </div>
                          <span className="badge">{article.image_count} img · {article.face_count} faces</span>
                        </div>
                        {editingArticleId === article.id ? (
                          <div className="article-admin-form">
                            <input className="input" value={articleForm.title} onChange={(event) => setArticleForm({ ...articleForm, title: event.target.value })} placeholder="Título" />
                            <input className="input" value={articleForm.url} onChange={(event) => setArticleForm({ ...articleForm, url: event.target.value })} placeholder="URL da matéria" />
                            <input className="input" value={articleForm.domain} onChange={(event) => setArticleForm({ ...articleForm, domain: event.target.value })} placeholder="Domínio" />
                            <input className="input" value={articleForm.canonical_url} onChange={(event) => setArticleForm({ ...articleForm, canonical_url: event.target.value })} placeholder="URL canônica opcional" />
                            <div className="toolbar">
                              <button className="button" type="button" onClick={() => saveArticle(article.id)}>Salvar</button>
                              <button className="button secondary" type="button" onClick={() => setEditingArticleId(null)}>Cancelar</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <a href={article.url} target="_blank" rel="noreferrer">{article.url}</a>
                            <div className="technical-line">
                              <span>{article.match_count} match(es)</span>
                              <span>{article.suggestion_count} sugestão(ões)</span>
                              <span>id {article.id.slice(0, 8)}</span>
                            </div>
                            <div className="toolbar">
                              <button className="button" type="button" onClick={() => startEditArticle(article)}>Corrigir</button>
                              <button className="button secondary" type="button" onClick={() => mergeArticleDuplicates(article)}>Mesclar duplicatas</button>
                              <button className="button secondary" type="button" onClick={() => deleteArticle(article)}>Apagar</button>
                            </div>
                          </>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {activeQueue === 'people' && (
              <section className="admin-queue">
                <div className="toolbar split">
                  <div>
                    <h2>Pessoas</h2>
                    <p className="muted">Use a busca para abrir a ficha, revisar referências ou aplicar opt-out.</p>
                  </div>
                  <input
                    className="input"
                    list="admin-people"
                    value={personQuery}
                    onChange={(event) => setPersonQuery(event.target.value)}
                    placeholder="Buscar por nome, slug ou cargo"
                  />
                </div>
                <datalist id="admin-people">
                  {people.map((item) => (
                    <option key={item.id} value={item.name} />
                  ))}
                </datalist>
                <div className="people-list">
                  {filteredPeople.map((item) => (
                    <article className="people-row" key={item.id}>
                      <div>
                        <strong><a href={`/admin/pessoas/${item.id}`}>{item.display_name || item.name}</a></strong>
                        <p>{item.public_office || item.category || 'Sem cargo informado'} · <span>{item.slug}</span></p>
                      </div>
                      <span className="badge">{item.status}</span>
                      <button className="button secondary" type="button" onClick={() => optoutPerson(item.id)}>Opt-out</button>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {activeQueue === 'optouts' && (
              <section className="admin-queue">
                <h2>Pedidos de opt-out</h2>
                {optouts.length === 0 && <p className="empty-panel">Nenhum pedido de opt-out.</p>}
                <div className="people-list">
                  {optouts.map((item) => (
                    <article className="people-row" key={item.id}>
                      <div>
                        <strong>{item.requester_name}</strong>
                        <p>{item.requester_email} · {item.relationship || 'relação não informada'}</p>
                        {item.message && <p>{item.message}</p>}
                      </div>
                      <span className="badge">{item.verification_status}</span>
                      <span>{item.decision || 'sem decisão'}</span>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {activeQueue === 'allowlist' && (
              <section className="admin-queue">
                <div className="toolbar split">
                  <div>
                    <h2>Allowlist de jornais</h2>
                    <p className="muted">Domínios autorizados para entrada de URLs de matérias.</p>
                  </div>
                  <form className="toolbar" onSubmit={addAllowedDomain}>
                    <input
                      className="input"
                      value={newDomain}
                      onChange={(event) => setNewDomain(event.target.value)}
                      placeholder="g1.globo.com"
                    />
                    <button className="button secondary" type="submit">Adicionar</button>
                  </form>
                </div>
                <div className="people-list">
                  {allowedDomains.map((item) => (
                    <article className="people-row compact" key={item.id}>
                      <strong>{item.domain}</strong>
                      <span className="badge">{item.enabled ? 'ativo' : 'desativado'}</span>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {activeQueue === 'audit' && (
              <section className="admin-queue">
                <h2>Auditoria</h2>
                {audits.length === 0 && <p className="empty-panel">Nenhuma ação administrativa ainda.</p>}
                <div className="people-list">
                  {audits.map((item) => (
                    <article className="people-row compact" key={item.id}>
                      <span>{compactDate(item.created_at)}</span>
                      <strong>{item.action}</strong>
                      <span>{item.actor_type}</span>
                      <span>{item.entity_type}</span>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
