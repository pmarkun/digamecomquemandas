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

  const headersFor = (authToken = token) => ({
    Authorization: `Bearer ${authToken}`,
  });

  const loadProtected = async (authToken = token) => {
    const headers = headersFor(authToken);
    const [listPeople, listSuggestions, listMatches, listOptouts, listAudits] = await Promise.all([
      api.get<Person[]>(`/admin/people`, headers),
      api.get<Suggestion[]>(`/admin/suggestions`, headers),
      api.get<Match[]>(`/admin/matches`, headers),
      api.get<Optout[]>(`/admin/optout-requests`, headers),
      api.get<AuditLog[]>(`/admin/audit-logs`, headers),
    ]);
    setPeople(listPeople);
    setSuggestions(listSuggestions);
    setMatches(listMatches);
    setOptouts(listOptouts);
    setAudits(listAudits);
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

  return (
    <main style={{ padding: '2rem', background: '#F7F2E8', color: '#191919' }}>
      <h1>Admin</h1>
      <p>Esta página exige login simples para ações administrativas no MVP.</p>
      {!logged && (
        <form onSubmit={login} style={{ marginBottom: '1rem' }}>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="senha"
          />
          <button type="submit">Login</button>
        </form>
      )}
      {feedback && <p>{feedback}</p>}
      {logged && (
        <div>
          <button type="button" onClick={addPerson}>Adicionar pessoa</button>
          <h2>Pessoas</h2>
          <ul>
            {people.map((item) => (
              <li key={item.id}>
                {item.name} ({item.slug}) — {item.status}
                <div>
                  <button type="button" onClick={() => optoutPerson(item.id)}>Aplicar opt-out</button>
                </div>
              </li>
            ))}
          </ul>

          <h2>Sugestões</h2>
          {suggestions.length === 0 && <p>Nenhuma sugestão encontrada.</p>}
          <ul>
            {suggestions.map((item) => (
              <li key={item.id}>
                <strong>{item.suggested_name}</strong> — {item.status}
                <br />
                {item.comment || ''}
                <div>
                  <button type="button" onClick={() => reviewSuggestion(item.id, 'APPROVED')}>Aprovar</button>{' '}
                  <button type="button" onClick={() => reviewSuggestion(item.id, 'REJECTED')}>Rejeitar</button>
                </div>
              </li>
            ))}
          </ul>

          <h2>Matches</h2>
          {matches.length === 0 && <p>Nenhum match encontrado.</p>}
          <ul>
            {matches.map((item) => (
              <li key={item.id}>
                Face {item.detected_face_id} ↦ pessoa {item.person_id} | score {item.score.toFixed(3)} | {item.status}
                <div>
                  <button type="button" onClick={() => reviewMatch(item.id, 'APPROVED')}>Aprovar</button>{' '}
                  <button type="button" onClick={() => reviewMatch(item.id, 'REJECTED')}>Rejeitar</button>
                </div>
              </li>
            ))}
          </ul>

          <h2>Pedidos de opt-out</h2>
          {optouts.length === 0 && <p>Nenhum pedido de opt-out.</p>}
          <ul>
            {optouts.map((item) => (
              <li key={item.id}>
                {item.requester_name} ({item.requester_email}) — {item.verification_status}
                {item.decision ? ` — decisão: ${item.decision}` : ''}
              </li>
            ))}
          </ul>

          <h2>Auditoria</h2>
          {audits.length === 0 && <p>Nenhuma ação administrativa ainda.</p>}
          <ul>
            {audits.map((item) => (
              <li key={item.id}>
                {item.created_at ? new Date(item.created_at).toLocaleString('pt-BR') : 'sem data'} — {item.actor_type}
                {' / '}
                {item.action}
                {' / '}
                {item.entity_type}
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
