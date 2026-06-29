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
  images: BootstrapImage[];
};

type BootstrapFace = {
  face_id: string;
  bbox: BBox;
  quality_score?: number | null;
  matches: BootstrapMatch[];
  suggestions: BootstrapSuggestion[];
};

type BootstrapMatch = {
  id: string;
  person_id: string;
  person_name: string;
  person_slug: string;
  score: number;
  status: string;
};

type BootstrapSuggestion = {
  id: string;
  suggested_name: string;
  suggested_person_id?: string | null;
  suggested_person_name?: string | null;
  status: string;
};

type BootstrapGroupFace = {
  face_id: string;
  bbox: BBox;
  image_id?: string | null;
  image_url?: string | null;
  image_width?: number | null;
  image_height?: number | null;
  article_url?: string | null;
  article_title?: string | null;
};

type BootstrapImage = {
  image_id: string;
  image_url: string;
  width?: number | null;
  height?: number | null;
  status: string;
  faces: BootstrapFace[];
};

type BootstrapGroup = {
  group_id: string;
  face_count: number;
  article_count: number;
  faces: BootstrapGroupFace[];
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

type AnalyzedImagePayload = {
  image_url: string;
  width: number | null;
  height: number | null;
  faces: DetectedFacePayload[];
};

let faceModelLoad: Promise<unknown> | null = null;
const BOOTSTRAP_MIN_IMAGE_DIMENSION = Number(process.env.NEXT_PUBLIC_BOOTSTRAP_MIN_IMAGE_DIMENSION || 300);

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

function imageArea(image: { width?: number | null; height?: number | null }) {
  return Number(image.width || 0) * Number(image.height || 0);
}

function imageVariantKey(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    for (const key of ['w', 'width', 'h', 'height', 'resize', 'size', 'crop', 'fit', 'quality', 'q', 'format', 'auto', 'dpr']) {
      url.searchParams.delete(key);
    }
    url.pathname = url.pathname
      .replace(/([_-])\d{2,5}x\d{2,5}(?=\.[a-z0-9]+$)/i, '$1SIZE')
      .replace(/([_-])\d{2,5}(?=\.[a-z0-9]+$)/i, '$1SIZE')
      .replace(/\/(?:w|width|h|height|fit-in|resize)\/\d{2,5}(?=\/)/gi, '/SIZE');
    return url.toString();
  } catch {
    return rawUrl.replace(/([_-])\d{2,5}x\d{2,5}(?=\.[a-z0-9]+$)/i, '$1SIZE');
  }
}

function dedupeImageVariants(images: AnalyzedImagePayload[]) {
  const byVariant = new Map<string, AnalyzedImagePayload>();
  let dropped = 0;
  for (const image of images) {
    const key = imageVariantKey(image.image_url);
    const current = byVariant.get(key);
    if (!current) {
      byVariant.set(key, image);
      continue;
    }
    dropped += 1;
    const currentArea = imageArea(current);
    const nextArea = imageArea(image);
    if (nextArea > currentArea || (nextArea === currentArea && image.image_url.length > current.image_url.length)) {
      byVariant.set(key, image);
    }
  }
  return { images: Array.from(byVariant.values()), dropped };
}

function isTooSmallForBootstrap(image: { width?: number | null; height?: number | null }) {
  const minDimension = bootstrapMinImageDimension();
  return Boolean(image.width && image.height && (image.width < minDimension || image.height < minDimension));
}

function bootstrapMinImageDimension() {
  return Number.isFinite(BOOTSTRAP_MIN_IMAGE_DIMENSION) && BOOTSTRAP_MIN_IMAGE_DIMENSION > 0
    ? BOOTSTRAP_MIN_IMAGE_DIMENSION
    : 300;
}

function cropStyle(face: BootstrapFace, image: BootstrapImage): CSSProperties {
  const width = Math.max(1, Number(image.width || 1));
  const height = Math.max(1, Number(image.height || 1));
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
      const detectedImages: AnalyzedImagePayload[] = [];
      for (const image of discovery.images) {
        try {
          const detected = await detectFaces(image.image_url);
          if (isTooSmallForBootstrap(detected)) {
            warnings.push(`Imagem ignorada: menor que ${bootstrapMinImageDimension()}px (${detected.width} × ${detected.height}).`);
            continue;
          }
          if (detected.faces.length > 0) {
            detectedImages.push({
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
      const { images: analyzedImages, dropped } = dedupeImageVariants(detectedImages);
      if (dropped > 0) {
        warnings.push(`${dropped} variante(s) menor(es) da mesma imagem ignorada(s).`);
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
