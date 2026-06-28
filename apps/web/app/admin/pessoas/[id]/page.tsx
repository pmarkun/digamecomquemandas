"use client";

/* eslint-disable @next/next/no-img-element */

import { FormEvent, useEffect, useRef, useState } from 'react';
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
  image_id?: string;
  score: number;
  status: string;
  bbox?: { x: number; y: number; w: number; h: number };
  image_url?: string;
  image_width?: number;
  image_height?: number;
  article_id?: string;
  article_title?: string;
  article_url?: string;
};

type DetectedFacePayload = {
  x: number;
  y: number;
  w: number;
  h: number;
  score?: number;
  embedding?: number[];
  embedding_model?: string;
};

type Detail = {
  person: Person;
  reference_images: ReferenceImage[];
  matches: Match[];
};

let faceModelLoad: Promise<unknown> | null = null;
const APPROVED_MATCH_STATUSES = new Set(['APPROVED', 'APPROVED_MANUAL']);
const PENDING_MATCH_STATUSES = new Set(['AUTO', 'AUTO_APPROVED']);

function proxiedImageUrl(url: string) {
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

async function loadFaceModels() {
  const [tf, faceapi] = await Promise.all([import('@tensorflow/tfjs'), import('face-api.js')]);
  if (!faceModelLoad) {
    faceModelLoad = (async () => {
      await tf.setBackend('cpu');
      await tf.ready();
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri('/models'),
        faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
      ]);
    })();
  }
  await faceModelLoad;
  return faceapi;
}

function facePayloadFromDetection(detection: unknown, image: HTMLImageElement): DetectedFacePayload | null {
  const naturalWidth = image.naturalWidth || 1;
  const naturalHeight = image.naturalHeight || 1;
  const candidate = detection as {
    detection?: { box?: { x: number; y: number; width: number; height: number }; score?: number; imageWidth?: number; imageHeight?: number };
    box?: { x: number; y: number; width: number; height: number };
    score?: number;
    imageWidth?: number;
    imageHeight?: number;
    descriptor?: Float32Array | number[];
  };
  const source = candidate.detection || candidate;
  const box = source.box;
  if (!box) return null;

  const sourceWidth = source.imageWidth || naturalWidth;
  const sourceHeight = source.imageHeight || naturalHeight;
  const scaleX = naturalWidth / sourceWidth;
  const scaleY = naturalHeight / sourceHeight;
  const x = Math.max(0, Number(box.x) * scaleX);
  const y = Math.max(0, Number(box.y) * scaleY);
  const w = Math.min(Math.max(0, Number(box.width) * scaleX), naturalWidth - x);
  const h = Math.min(Math.max(0, Number(box.height) * scaleY), naturalHeight - y);
  if (![x, y, w, h].every(Number.isFinite) || w < 18 || h < 18) return null;

  const descriptor = candidate.descriptor ? Array.from(candidate.descriptor).map(Number) : undefined;
  return {
    x,
    y,
    w,
    h,
    score: typeof source.score === 'number' ? source.score : undefined,
    ...(descriptor?.length === 128 ? { embedding: descriptor, embedding_model: 'face-api.js/faceRecognitionNet' } : {}),
  };
}

async function detectFacesForImage(image: HTMLImageElement): Promise<DetectedFacePayload[]> {
  const faceapi = await loadFaceModels();
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.35 });
  try {
    const detections = await faceapi.detectAllFaces(image, options).withFaceLandmarks(true).withFaceDescriptors();
    return detections
      .map((detection: unknown) => facePayloadFromDetection(detection, image))
      .filter(Boolean) as DetectedFacePayload[];
  } catch (_error: unknown) {
    const detections = await faceapi.detectAllFaces(image, options);
    return detections
      .map((detection: unknown) => facePayloadFromDetection(detection, image))
      .filter(Boolean) as DetectedFacePayload[];
  }
}

function bboxOverlayStyle(
  bbox: { x: number; y: number; w: number; h: number },
  naturalSize: { width: number; height: number },
) {
  const width = naturalSize.width || 1;
  const height = naturalSize.height || 1;
  const left = Math.max(0, (bbox.x / width) * 100);
  const top = Math.max(0, (bbox.y / height) * 100);
  const boxWidth = Math.min(100 - left, (bbox.w / width) * 100);
  const boxHeight = Math.min(100 - top, (bbox.h / height) * 100);
  return {
    left: `${left}%`,
    top: `${top}%`,
    width: `${Math.max(2, boxWidth)}%`,
    height: `${Math.max(2, boxHeight)}%`,
  };
}

export default function AdminPersonPage({ params }: { params: { id: string } }) {
  const modalImageRef = useRef<HTMLImageElement | null>(null);
  const [token, setToken] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [feedback, setFeedback] = useState('');
  const [reassignTargets, setReassignTargets] = useState<Record<string, string>>({});
  const [people, setPeople] = useState<Person[]>([]);
  const [referenceUrl, setReferenceUrl] = useState('');
  const [activeImageMatch, setActiveImageMatch] = useState<Match | null>(null);
  const [modalNaturalSize, setModalNaturalSize] = useState({ width: 0, height: 0 });
  const [detectedFaces, setDetectedFaces] = useState<DetectedFacePayload[]>([]);
  const [detectedFaceTargets, setDetectedFaceTargets] = useState<Record<number, string>>({});
  const [modalFeedback, setModalFeedback] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [matchTab, setMatchTab] = useState<'approved' | 'pending'>('approved');

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

  const deleteReference = async (reference: ReferenceImage) => {
    if (!confirm(`Excluir esta foto de referência de ${detail?.person.display_name || 'pessoa'}?`)) {
      return;
    }
    await api.post(`/admin/people/${params.id}/reference-images/${reference.id}/delete`, {}, headersFor());
    setFeedback('Foto de referência excluída.');
    await loadDetail();
  };

  const reassignMatch = async (match: Match) => {
    const targetPersonId = reassignTargets[match.id] || '';
    if (!targetPersonId) {
      setFeedback('Escolha a pessoa correta antes de mover a face.');
      return;
    }
    const target = people.find((person) => person.id === targetPersonId);
    const targetName = target?.display_name || target?.name || targetPersonId;
    if (!confirm(`Mover esta face de "${match.article_title || 'matéria sem título'}" para ${targetName}?`)) {
      return;
    }
    await api.post(`/admin/matches/${match.id}/reassign`, { person_id: targetPersonId, status: 'APPROVED' }, headersFor());
    setFeedback('Face reatribuída para curadoria do modelo.');
    await loadDetail();
  };

  const discardImageForPerson = async (match: Match) => {
    if (!match.image_id) {
      setFeedback('Esta ocorrência não tem ID de imagem para descarte.');
      return;
    }
    if (!confirm(`Descartar esta imagem do perfil de ${detail?.person.display_name || 'pessoa'}?`)) {
      return;
    }
    await api.post(`/admin/people/${params.id}/article-images/${match.image_id}/discard`, {}, headersFor());
    setFeedback('Imagem descartada deste perfil.');
    await loadDetail();
  };

  const openImageModal = (match: Match) => {
    setActiveImageMatch(match);
    setModalNaturalSize({ width: match.image_width || 0, height: match.image_height || 0 });
    setDetectedFaces([]);
    setDetectedFaceTargets({});
    setModalFeedback('Clique em "Detectar faces" para procurar novas pessoas nesta imagem.');
  };

  const runDetectorOnModalImage = async () => {
    const image = modalImageRef.current;
    if (!image) {
      setModalFeedback('Imagem ainda não carregada.');
      return;
    }
    setDetecting(true);
    setModalFeedback('Detectando faces no navegador...');
    try {
      const faces = await detectFacesForImage(image);
      setDetectedFaces(faces);
      setDetectedFaceTargets({});
      setModalFeedback(
        faces.length
          ? `${faces.length} face(s) detectada(s). Escolha pessoas para vincular ou salve sem pessoa para tentar match automático.`
          : 'Nenhuma face nova detectada nesta imagem.',
      );
    } catch (error: unknown) {
      setModalFeedback(error instanceof Error ? error.message : 'Falha ao detectar faces nesta imagem.');
    } finally {
      setDetecting(false);
    }
  };

  const saveDetectedFaces = async () => {
    if (!activeImageMatch?.image_id || detectedFaces.length === 0) {
      setModalFeedback('Não há faces detectadas para salvar.');
      return;
    }
    const out = await api.post<{
      created_faces: number;
      reused_faces: number;
      manual_matches: number;
      automatic_matches: number;
    }>(
      `/admin/article-images/${activeImageMatch.image_id}/faces`,
      {
        faces: detectedFaces.map((face, index) => ({
          ...face,
          person_id: detectedFaceTargets[index] || null,
        })),
      },
      headersFor(),
    );
    setModalFeedback(
      `Salvo: ${out.created_faces} face(s) nova(s), ${out.reused_faces} reutilizada(s), ${out.manual_matches} vínculo(s) manual(is), ${out.automatic_matches} match(es) automático(s).`,
    );
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

  const approvedMatches = detail.matches.filter((match) => APPROVED_MATCH_STATUSES.has(match.status));
  const pendingMatches = detail.matches.filter((match) => PENDING_MATCH_STATUSES.has(match.status));
  const visibleMatches = matchTab === 'approved' ? approvedMatches : pendingMatches;

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
          <div className="toolbar">
            <a className="button secondary" href="/admin">Voltar ao admin</a>
            <a className="button secondary" href={`/pessoa/${detail.person.slug}`}>Perfil público</a>
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
                  <div className="toolbar split">
                    <span className="badge">{item.status}</span>
                    <button className="button secondary compact" type="button" onClick={() => deleteReference(item)}>Excluir</button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="panel wide">
            <h2>Matérias e faces associadas</h2>
            <div className="admin-tabs two-tabs" role="tablist" aria-label="Filtro de faces associadas">
              <button className={matchTab === 'approved' ? 'active' : ''} type="button" onClick={() => setMatchTab('approved')}>
                Aprovadas <strong>{approvedMatches.length}</strong>
              </button>
              <button className={matchTab === 'pending' ? 'active' : ''} type="button" onClick={() => setMatchTab('pending')}>
                Pendentes <strong>{pendingMatches.length}</strong>
              </button>
            </div>
            <div className="match-grid">
              {visibleMatches.map((match) => (
                <article className="match-card" key={match.id}>
                  {match.image_url && (
                    <button className="image-open-button" type="button" onClick={() => openImageModal(match)}>
                      <img src={match.image_url} alt="" />
                      <span>Ampliar e detectar faces</span>
                    </button>
                  )}
                  <div>
                    <strong>{match.article_title || 'Matéria sem título'}</strong>
                    <p>{match.article_url}</p>
                    <p>Score {match.score.toFixed(3)} · <span className="badge">{match.status}</span></p>
                    {match.bbox && <p>Face: x {Math.round(match.bbox.x)}, y {Math.round(match.bbox.y)}, w {Math.round(match.bbox.w)}, h {Math.round(match.bbox.h)}</p>}
                    <div className="match-reassign">
                      <select
                        className="input"
                        value={reassignTargets[match.id] || ''}
                        onChange={(event) => setReassignTargets({ ...reassignTargets, [match.id]: event.target.value })}
                      >
                        <option value="">Mover para...</option>
                        {people
                          .filter((person) => person.id !== detail.person.id)
                          .map((person) => (
                            <option key={person.id} value={person.id}>{person.display_name || person.name} · {person.slug}</option>
                          ))}
                      </select>
                      <button className="button secondary" type="button" onClick={() => reassignMatch(match)}>Mover face</button>
                    </div>
                    <div className="toolbar">
                      <button className="button secondary" type="button" onClick={() => discardImageForPerson(match)}>Descartar imagem deste perfil</button>
                    </div>
                  </div>
                </article>
              ))}
              {visibleMatches.length === 0 && (
                <p>Nenhuma face {matchTab === 'approved' ? 'aprovada' : 'pendente'} associada.</p>
              )}
            </div>
          </section>
        </div>
      </div>
      {activeImageMatch?.image_url && (
        <div className="image-modal-backdrop" role="dialog" aria-modal="true" aria-label="Ampliar imagem para detectar faces">
          <section className="image-modal">
            <div className="toolbar split">
              <div>
                <p className="eyebrow">Imagem da matéria</p>
                <h2>{activeImageMatch.article_title || 'Matéria sem título'}</h2>
              </div>
              <button className="button secondary" type="button" onClick={() => setActiveImageMatch(null)}>Fechar</button>
            </div>
            <div className="image-modal-layout">
              <div className="image-modal-stage">
                <div className="image-modal-wrap">
                  <img
                    ref={modalImageRef}
                    src={proxiedImageUrl(activeImageMatch.image_url)}
                    alt=""
                    onLoad={(event) => {
                      setModalNaturalSize({
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight,
                      });
                    }}
                  />
                  {activeImageMatch.bbox && (
                    <span
                      className="modal-face-box existing"
                      style={bboxOverlayStyle(activeImageMatch.bbox, modalNaturalSize)}
                    >
                      atual
                    </span>
                  )}
                  {detectedFaces.map((face, index) => (
                    <span
                      className="modal-face-box detected"
                      key={`${face.x}-${face.y}-${index}`}
                      style={bboxOverlayStyle(face, modalNaturalSize)}
                    >
                      {index + 1}
                    </span>
                  ))}
                </div>
              </div>
              <aside className="image-modal-side">
                <button className="button" type="button" onClick={runDetectorOnModalImage} disabled={detecting}>
                  {detecting ? 'Detectando...' : 'Detectar faces'}
                </button>
                <p className="status-line">{modalFeedback}</p>
                {detectedFaces.length > 0 && (
                  <div className="detected-face-list">
                    {detectedFaces.map((face, index) => (
                      <label className="detected-face-row" key={`${face.x}-${face.y}-${index}`}>
                        <span>Face {index + 1}{face.score ? ` · ${Math.round(face.score * 100)}%` : ''}</span>
                        <select
                          className="input"
                          value={detectedFaceTargets[index] || ''}
                          onChange={(event) => setDetectedFaceTargets({ ...detectedFaceTargets, [index]: event.target.value })}
                        >
                          <option value="">Sem pessoa definida</option>
                          {people.map((person) => (
                            <option key={person.id} value={person.id}>{person.display_name || person.name} · {person.slug}</option>
                          ))}
                        </select>
                      </label>
                    ))}
                    <button className="button secondary" type="button" onClick={saveDetectedFaces}>
                      Salvar faces detectadas
                    </button>
                  </div>
                )}
              </aside>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
