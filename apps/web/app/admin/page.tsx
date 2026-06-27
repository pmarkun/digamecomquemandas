"use client";

import { FormEvent, useState } from 'react';
import { api } from '@/lib/api';

type Person = {
  id: string;
  name: string;
  slug: string;
  status: string;
};

type Suggestion = {
  id: string;
  suggested_name: string;
  comment?: string;
  status: string;
  created_at?: string;
};

type Match = {
  id: string;
  detected_face_id: string;
  person_id: string;
  score: number;
  status: string;
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

export default function AdminPage() {
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('admin');
  const [feedback, setFeedback] = useState('');
  const [logged, setLogged] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [optouts, setOptouts] = useState<Optout[]>([]);
  const [audits, setAudits] = useState<AuditLog[]>([]);
  const [allowedDomains, setAllowedDomains] = useState<AllowedDomain[]>([]);
  const [newDomain, setNewDomain] = useState('');

  const headersFor = (authToken = token) => ({
    Authorization: `Bearer ${authToken}`,
  });

  const loadProtected = async (authToken = token) => {
    const headers = headersFor(authToken);
    const [listPeople, listSuggestions, listMatches, listOptouts, listAudits, listAllowedDomains] = await Promise.all([
      api.get<Person[]>(`/admin/people`, headers),
      api.get<Suggestion[]>(`/admin/suggestions`, headers),
      api.get<Match[]>(`/admin/matches`, headers),
      api.get<Optout[]>(`/admin/optout-requests`, headers),
      api.get<AuditLog[]>(`/admin/audit-logs`, headers),
      api.get<AllowedDomain[]>(`/admin/allowed-domains`, headers),
    ]);
    setPeople(listPeople);
    setSuggestions(listSuggestions);
    setMatches(listMatches);
    setOptouts(listOptouts);
    setAudits(listAudits);
    setAllowedDomains(listAllowedDomains);
  };

  const login = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const out = await api.post<{ token: string }>(`/admin/login`, { email, password });
      setToken(out.token);
      setLogged(true);
      setFeedback('Login ok.');
      await loadProtected(out.token);
    } catch (_error: unknown) {
      setFeedback('Falha no login');
      setLogged(false);
    }
  };

  const addPerson = async (event: FormEvent) => {
    event.preventDefault();
    const name = prompt('Nome da pessoa') || '';
    const slug = prompt('Slug da pessoa') || '';
    if (!name || !slug) {
      return;
    }
    await api.post(
      `/admin/people`,
      {
        name,
        display_name: name,
        slug,
        category: 'public_figure',
      },
      headersFor(),
    );
    await loadProtected();
  };

  const reviewSuggestion = async (suggestionId: string, status: 'APPROVED' | 'REJECTED') => {
    await api.post(`/admin/suggestions/${suggestionId}/review`, { status }, headersFor());
    await loadProtected();
  };

  const reviewMatch = async (matchId: string, status: 'APPROVED' | 'REJECTED') => {
    await api.post(`/admin/matches/${matchId}/review`, { status }, headersFor());
    await loadProtected();
  };

  const optoutPerson = async (personId: string) => {
    if (!confirm('Confirma aplicar opt-out para esta pessoa?')) {
      return;
    }
    await api.post(`/admin/people/${personId}/optout`, {}, headersFor());
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

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/">Diga-me</a>
        <nav className="navline">
          <a href="/">Home</a>
          <a href="/admin">Admin</a>
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
              <button className="button" type="button" onClick={addPerson}>Adicionar pessoa</button>
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
            <div className="stat"><strong>{matches.length}</strong><span>Matches</span></div>
            <div className="stat"><strong>{suggestions.length}</strong><span>Sugestões</span></div>
            <div className="stat"><strong>{optouts.length}</strong><span>Pedidos</span></div>
          </section>

          <div className="admin-sections">
          <section className="panel">
          <h2>Allowlist</h2>
          <form className="toolbar" onSubmit={addAllowedDomain}>
            <input
              className="input"
              value={newDomain}
              onChange={(event) => setNewDomain(event.target.value)}
              placeholder="g1.globo.com"
            />
            <button className="button secondary" type="submit">Adicionar</button>
          </form>
          {allowedDomains.length === 0 && <p>Nenhum domínio liberado.</p>}
          <table className="table">
            <tbody>
            {allowedDomains.map((item) => (
              <tr key={item.id}>
                <td>{item.domain}</td>
                <td><span className="badge">{item.enabled ? 'ativo' : 'desativado'}</span></td>
              </tr>
            ))}
            </tbody>
          </table>
          </section>

          <section className="panel">
          <h2>Pessoas</h2>
          <table className="table">
            <thead><tr><th>Nome</th><th>Slug</th><th>Status</th><th>Ação</th></tr></thead>
            <tbody>
            {people.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.slug}</td>
                <td><span className="badge">{item.status}</span></td>
                <td><button className="button secondary" type="button" onClick={() => optoutPerson(item.id)}>Opt-out</button></td>
              </tr>
            ))}
            </tbody>
          </table>
          </section>

          <section className="panel wide">
          <h2>Sugestões</h2>
          {suggestions.length === 0 && <p>Nenhuma sugestão encontrada.</p>}
          <table className="table">
            <thead><tr><th>Nome sugerido</th><th>Comentário</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody>
            {suggestions.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.suggested_name}</strong></td>
                <td>{item.comment || '-'}</td>
                <td><span className="badge">{item.status}</span></td>
                <td>
                  <button className="button secondary" type="button" onClick={() => reviewSuggestion(item.id, 'APPROVED')}>Aprovar</button>{' '}
                  <button className="button secondary" type="button" onClick={() => reviewSuggestion(item.id, 'REJECTED')}>Rejeitar</button>
                </td>
              </tr>
            ))}
            </tbody>
          </table>
          </section>

          <section className="panel wide">
          <h2>Matches</h2>
          {matches.length === 0 && <p>Nenhum match encontrado.</p>}
          <table className="table">
            <thead><tr><th>Face</th><th>Pessoa</th><th>Score</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody>
            {matches.map((item) => (
              <tr key={item.id}>
                <td>{item.detected_face_id.slice(0, 8)}</td>
                <td>{item.person_id.slice(0, 8)}</td>
                <td>{item.score.toFixed(3)}</td>
                <td><span className="badge">{item.status}</span></td>
                <td>
                  <button className="button secondary" type="button" onClick={() => reviewMatch(item.id, 'APPROVED')}>Aprovar</button>{' '}
                  <button className="button secondary" type="button" onClick={() => reviewMatch(item.id, 'REJECTED')}>Rejeitar</button>
                </td>
              </tr>
            ))}
            </tbody>
          </table>
          </section>

          <section className="panel">
          <h2>Pedidos de opt-out</h2>
          {optouts.length === 0 && <p>Nenhum pedido de opt-out.</p>}
          <table className="table">
            <tbody>
            {optouts.map((item) => (
              <tr key={item.id}>
                <td>{item.requester_name}<br />{item.requester_email}</td>
                <td><span className="badge">{item.verification_status}</span></td>
                <td>{item.decision || '-'}</td>
              </tr>
            ))}
            </tbody>
          </table>
          </section>

          <section className="panel">
          <h2>Auditoria</h2>
          {audits.length === 0 && <p>Nenhuma ação administrativa ainda.</p>}
          <table className="table">
            <tbody>
            {audits.map((item) => (
              <tr key={item.id}>
                <td>{item.created_at ? new Date(item.created_at).toLocaleString('pt-BR') : 'sem data'}</td>
                <td>{item.actor_type}</td>
                <td>{item.action}</td>
                <td>{item.entity_type}</td>
              </tr>
            ))}
            </tbody>
          </table>
          </section>
          </div>
        </>
      )}
      </div>
    </main>
  );
}
