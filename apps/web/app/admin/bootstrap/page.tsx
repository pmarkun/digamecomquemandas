"use client";

/* eslint-disable @next/next/no-img-element */

import { CSSProperties, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';

type BBox = { x: number; y: number; w: number; h: number };

type DetectedFacePayload = {
  x: number;
  y: number;
  w: number;
  h: number;
  score?: number;
  embedding?: number[];
  embedding_model?: string;
};

type RunArticle = {
  id: string;
  source: string;
  domain: string;
  section_url: string;
  article_url: string;
  title?: string | null;
  status: string;
  article_id?: string | null;
  image_count: number;
  face_count: number;
  warnings: string[];
};

type BootstrapFace = {
  face_id: string;
  bbox: BBox;
  image_id?: string | null;
  image_url?: string | null;
  image_width?: number | null;
  image_height?: number | null;
  article_url?: string | null;
  article_title?: string | null;
};

type BootstrapGroup = {
  group_id: string;
  face_count: number;
  article_count: number;
  faces: BootstrapFace[];
};

type BootstrapRun = {
  id: string;
  status: string;
  limit_per_source: number;
  render_browser: boolean;
  warnings: string[];
  counts: {
    articles: number;
    images: number;
    faces: number;
    statuses: Record<string, number>;
  };
  articles: RunArticle[];
  groups: BootstrapGroup[];
};

type PersonOption = {
  id: string;
  name: string;
  display_name?: string;
  slug: string;
};

type DiscoveredImage = {
  image_url: string;
  width?: number | null;
  height?: number | null;
};

type DiscoverResponse = {
  page_url: string;
  title?: string | null;
  images: DiscoveredImage[];
  warnings: string[];
};

type AnalyzeResponse = {
  article_id: string;
  results: Array<{ image_url: string; image_id: string; faces: Array<{ face_id: string }> }>;
  warnings: string[];
};

let faceModelLoad: Promise<unknown> | null = null;

function headersFor(token: string) {
  return { Authorization: `Bearer ${token}` };
}

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

function imageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Imagem não carregada para detecção.'));
    image.src = proxiedImageUrl(url);
  });
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

async function detectFaces(imageUrl: string): Promise<{ width: number; height: number; faces: DetectedFacePayload[] }> {
  const faceapi = await loadFaceModels();
  const image = await imageFromUrl(imageUrl);
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.35 });
  let detections: unknown[];
  try {
    detections = await faceapi.detectAllFaces(image, options).withFaceLandmarks(true).withFaceDescriptors();
  } catch (_error: unknown) {
    detections = await faceapi.detectAllFaces(image, options);
  }
  return {
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
    faces: detections
      .map((detection) => facePayloadFromDetection(detection, image))
      .filter(Boolean) as DetectedFacePayload[],
  };
}

function cropStyle(face: BootstrapFace): CSSProperties {
  const width = Math.max(1, Number(face.image_width || 1));
  const height = Math.max(1, Number(face.image_height || 1));
  const padX = Math.max(18, Number(face.bbox.w || 0) * 0.55);
  const padY = Math.max(18, Number(face.bbox.h || 0) * 0.65);
  const rawX = Math.max(0, Number(face.bbox.x || 0) - padX);
  const rawY = Math.max(0, Number(face.bbox.y || 0) - padY);
  const rawW = Math.min(width - rawX, Number(face.bbox.w || 0) + padX * 2);
  const rawH = Math.min(height - rawY, Number(face.bbox.h || 0) + padY * 2);
  const square = Math.max(rawW, rawH, 80);
  const cropW = Math.min(width, square);
  const cropH = Math.min(height, square);
  const cropX = Math.max(0, Math.min(width - cropW, rawX - (cropW - rawW) / 2));
  const cropY = Math.max(0, Math.min(height - cropH, rawY - (cropH - rawH) / 2));
  const frame = 72;
  const scale = frame / cropW;
  return {
    height: `${height * scale}px`,
    left: `${-cropX * scale}px`,
    position: 'absolute',
    top: `${-cropY * scale}px`,
    width: `${width * scale}px`,
  };
}

export default function BootstrapAdminPage() {
  const peopleTimer = useRef<number | null>(null);
  const [token, setToken] = useState('');
  const [logged, setLogged] = useState(false);
  const [limit, setLimit] = useState(10);
  const [renderBrowser, setRenderBrowser] = useState(true);
  const [run, setRun] = useState<BootstrapRun | null>(null);
  const [runList, setRunList] = useState<Array<{ id: string; status: string; created_at: string }>>([]);
  const [feedback, setFeedback] = useState('');
  const [processing, setProcessing] = useState(false);
  const [activeArticleId, setActiveArticleId] = useState<string | null>(null);
  const [groupNames, setGroupNames] = useState<Record<string, string>>({});
  const [peopleOptions, setPeopleOptions] = useState<Record<string, PersonOption[]>>({});

  const remainingArticles = useMemo(
    () => run?.articles.filter((article) => ['DISCOVERED', 'ERROR'].includes(article.status)) || [],
    [run],
  );

  useEffect(() => {
    const stored = window.localStorage.getItem('digaMeAdminToken') || '';
    if (!stored) return;
    setToken(stored);
    setLogged(true);
    void loadRuns(stored);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const attachArticle = async (
    article: RunArticle,
    payload: { article_id?: string | null; status: string; image_count: number; face_count: number; warnings: string[] },
  ) => {
    if (!run) return;
    await api.post(`/admin/bootstrap-runs/${run.id}/articles/${article.id}/attach`, payload, headersFor(token));
  };

  const processArticle = async (article: RunArticle) => {
    setActiveArticleId(article.id);
    const warnings: string[] = [];
    try {
      const discovery = await api.post<DiscoverResponse>('/extension/discover-article-images', {
        page_url: article.article_url,
        render_browser: renderBrowser,
        max_images: 4,
      });
      warnings.push(...(discovery.warnings || []));
      const analyzedImages = [];
      for (const image of discovery.images) {
        try {
          const detected = await detectFaces(image.image_url);
          if (detected.faces.length > 0) {
            analyzedImages.push({
              image_url: image.image_url,
              width: detected.width || image.width || null,
              height: detected.height || image.height || null,
              faces: detected.faces,
            });
          }
        } catch (error: unknown) {
          warnings.push(`Imagem ignorada: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
        }
      }

      if (analyzedImages.length === 0) {
        await attachArticle(article, { status: 'NO_FACES', image_count: discovery.images.length, face_count: 0, warnings });
        return;
      }

      const analyzed = await api.post<AnalyzeResponse>('/extension/analyze-page', {
        page_url: article.article_url,
        title: article.title,
        images: analyzedImages,
      });
      warnings.push(...(analyzed.warnings || []));
      const faceCount = analyzed.results.reduce((total, item) => total + item.faces.length, 0);
      await attachArticle(article, {
        article_id: analyzed.article_id,
        status: faceCount > 0 ? 'ANALYZED' : 'NO_FACES',
        image_count: analyzedImages.length,
        face_count: faceCount,
        warnings,
      });
    } catch (error: unknown) {
      await attachArticle(article, {
        status: 'ERROR',
        image_count: 0,
        face_count: 0,
        warnings: [error instanceof Error ? error.message : 'Erro desconhecido'],
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
            <p>Faça login no admin principal antes de abrir esta bancada.</p>
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
                    <button className="button" type="button" disabled={processing || remainingArticles.length === 0} onClick={processRun}>
                      {processing ? 'Processando...' : 'Processar pendentes'}
                    </button>
                  </div>
                  <div className="bootstrap-article-grid">
                    {run.articles.map((article) => (
                      <article className="bootstrap-article" key={article.id}>
                        <span className="badge">{activeArticleId === article.id ? 'PROCESSANDO' : article.status}</span>
                        <strong>{article.title || article.article_url}</strong>
                        <small>{article.source} · {article.face_count} face(s)</small>
                        <a href={article.article_url} target="_blank" rel="noreferrer">Abrir matéria</a>
                      </article>
                    ))}
                  </div>
                </section>

                <section className="admin-queue">
                  <div className="toolbar split">
                    <div>
                      <h2>Grupos para nomear</h2>
                      <p className="muted">Aprovar um grupo cria match manual e promove as faces como referências da pessoa.</p>
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
                                {face.image_url ? <img src={face.image_url} alt="" style={cropStyle(face)} /> : null}
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
