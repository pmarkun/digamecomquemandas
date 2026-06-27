"use client";

/* eslint-disable @next/next/no-img-element */

import { FormEvent, useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Person = {
  id: string;
  name: string;
  display_name: string;
  slug: string;
  category: string;
  description?: string;
  public_office?: string;
  source_urls: string[];
  status: string;
};

type ReferenceImage = {
  id: string;
  source_url: string;
  sha256?: string;
  phash?: string;
  status: string;
};

type Match = {
  id: string;
  detected_face_id: string;
  score: number;
  status: string;
  bbox?: { x: number; y: number; w: number; h: number };
  image_url?: string;
  article_id?: string;
  article_title?: string;
  article_url?: string;
};

type Detail = {
  person: Person;
  reference_images: ReferenceImage[];
  matches: Match[];
};

export default function AdminPersonPage({ params }: { params: { id: string } }) {
  const [token, setToken] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [feedback, setFeedback] = useState('');
  const [targetPersonId, setTargetPersonId] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [referenceUrl, setReferenceUrl] = useState('');

  const headersFor = (authToken = token) => ({ Authorization: `Bearer ${authToken}` });

  const loadDetail = async (authToken = token) => {
    const [personDetail, listPeople] = await Promise.all([
      api.get<Detail>(`/admin/people/${params.id}`, headersFor(authToken)),
      api.get<Person[]>(`/admin/people`, headersFor(authToken)),
    ]);
    setDetail(personDetail);
    setPeople(listPeople);
  };

  useEffect(() => {
    const stored = window.localStorage.getItem('digaMeAdminToken') || '';
    setToken(stored);
    if (stored) {
      const headers = { Authorization: `Bearer ${stored}` };
      Promise.all([
        api.get<Detail>(`/admin/people/${params.id}`, headers),
        api.get<Person[]>(`/admin/people`, headers),
      ])
        .then(([personDetail, listPeople]) => {
          setDetail(personDetail);
          setPeople(listPeople);
        })
        .catch(() => setFeedback('Sessão admin expirada. Volte ao painel e faça login.'));
    }
  }, [params.id]);

  const savePerson = async (event: FormEvent) => {
    event.preventDefault();
    if (!detail) return;
    await api.post(`/admin/people/${params.id}/update`, detail.person, headersFor());
    setFeedback('Informações salvas.');
    await loadDetail();
  };

  const addReference = async (event: FormEvent) => {
    event.preventDefault();
    if (!referenceUrl.trim()) return;
    await api.post(`/admin/people/${params.id}/reference-images`, { source_url: referenceUrl.trim() }, headersFor());
    setReferenceUrl('');
    setFeedback('Imagem de referência adicionada.');
    await loadDetail();
  };

  const reassignMatch = async (matchId: string) => {
    if (!targetPersonId) {
      setFeedback('Escolha a pessoa correta antes de mover a face.');
      return;
    }
    await api.post(`/admin/matches/${matchId}/reassign`, { person_id: targetPersonId, status: 'APPROVED' }, headersFor());
    setFeedback('Face reatribuída para curadoria do modelo.');
    await loadDetail();
  };

  if (!token) {
    return (
      <main className="shell">
        <div className="page">
          <section className="panel">
            <h1>Admin</h1>
            <p>Abra o painel admin, faça login e volte para esta página.</p>
            <a className="button" href="/admin">Ir para login</a>
          </section>
        </div>
      </main>
    );
  }

  if (!detail) {
    return <main className="shell"><div className="page"><p className="feedback">{feedback || 'Carregando...'}</p></div></main>;
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/">Diga-me</a>
        <nav className="navline">
          <a href="/admin">Admin</a>
          <a href={`/pessoa/${detail.person.slug}`}>Perfil público</a>
        </nav>
      </header>
      <div className="page">
        <section className="admin-header">
          <div>
            <p className="eyebrow">Curadoria de pessoa</p>
            <h1 className="admin-title">{detail.person.display_name}</h1>
          </div>
        </section>
        {feedback && <p className="feedback">{feedback}</p>}

        <div className="admin-sections">
          <section className="panel">
            <h2>Informações</h2>
            <form className="form-grid" onSubmit={savePerson}>
              <input className="input" value={detail.person.name} onChange={(event) => setDetail({ ...detail, person: { ...detail.person, name: event.target.value } })} placeholder="Nome" />
              <input className="input" value={detail.person.display_name} onChange={(event) => setDetail({ ...detail, person: { ...detail.person, display_name: event.target.value } })} placeholder="Nome público" />
              <input className="input" value={detail.person.slug} onChange={(event) => setDetail({ ...detail, person: { ...detail.person, slug: event.target.value } })} placeholder="Slug" />
              <input className="input" value={detail.person.category} onChange={(event) => setDetail({ ...detail, person: { ...detail.person, category: event.target.value } })} placeholder="Categoria" />
              <input className="input" value={detail.person.public_office || ''} onChange={(event) => setDetail({ ...detail, person: { ...detail.person, public_office: event.target.value } })} placeholder="Cargo" />
              <select className="input" value={detail.person.status} onChange={(event) => setDetail({ ...detail, person: { ...detail.person, status: event.target.value } })}>
                <option value="ACTIVE">ACTIVE</option>
                <option value="UNDER_REVIEW">UNDER_REVIEW</option>
                <option value="OPTOUT_LIMITED">OPTOUT_LIMITED</option>
                <option value="REMOVED">REMOVED</option>
              </select>
              <textarea className="input wide-input" value={detail.person.description || ''} onChange={(event) => setDetail({ ...detail, person: { ...detail.person, description: event.target.value } })} placeholder="Descrição" />
              <textarea className="input wide-input" value={(detail.person.source_urls || []).join('\n')} onChange={(event) => setDetail({ ...detail, person: { ...detail.person, source_urls: event.target.value.split('\n').map((line) => line.trim()).filter(Boolean) } })} placeholder="Links públicos, um por linha" />
              <button className="button" type="submit">Salvar informações</button>
            </form>
          </section>

          <section className="panel">
            <h2>Fotos de referência</h2>
            <form className="toolbar" onSubmit={addReference}>
              <input className="input" value={referenceUrl} onChange={(event) => setReferenceUrl(event.target.value)} placeholder="URL da imagem pública" />
              <button className="button secondary" type="submit">Adicionar</button>
            </form>
            <div className="image-grid">
              {detail.reference_images.map((item) => (
                <article className="thumb-card" key={item.id}>
                  <img src={item.source_url} alt="" />
                  <span className="badge">{item.status}</span>
                </article>
              ))}
            </div>
          </section>

          <section className="panel wide">
            <h2>Matérias e faces associadas</h2>
            <div className="toolbar">
              <input className="input" list="people-reassign" value={targetPersonId} onChange={(event) => setTargetPersonId(event.target.value)} placeholder="ID da pessoa correta" />
              <datalist id="people-reassign">
                {people.map((person) => (
                  <option key={person.id} value={person.id}>{person.display_name || person.name}</option>
                ))}
              </datalist>
            </div>
            <div className="match-grid">
              {detail.matches.map((match) => (
                <article className="match-card" key={match.id}>
                  {match.image_url && <img src={match.image_url} alt="" />}
                  <div>
                    <strong>{match.article_title || 'Matéria sem título'}</strong>
                    <p>{match.article_url}</p>
                    <p>Score {match.score.toFixed(3)} · <span className="badge">{match.status}</span></p>
                    {match.bbox && <p>Face: x {Math.round(match.bbox.x)}, y {Math.round(match.bbox.y)}, w {Math.round(match.bbox.w)}, h {Math.round(match.bbox.h)}</p>}
                    <button className="button secondary" type="button" onClick={() => reassignMatch(match.id)}>Mover face para pessoa escolhida</button>
                  </div>
                </article>
              ))}
              {detail.matches.length === 0 && <p>Nenhuma face associada ainda.</p>}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
