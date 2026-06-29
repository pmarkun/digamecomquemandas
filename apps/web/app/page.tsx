"use client";

/* eslint-disable @next/next/no-img-element */

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

type Face = {
  face_id: string;
  bbox: { x: number; y: number; w: number; h: number };
  matches: Array<{
    name: string;
    slug: string;
    score: number;
    profile_url?: string;
    status?: string;
  }>;
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

type PersonOption = {
  id?: string;
  person_id?: string;
  name: string;
  display_name?: string;
  slug: string;
  status?: string | null;
  score?: number | null;
  warning?: string | null;
};

type AnalyzeResponse = {
  article_id: string;
  results: Array<{
    image_url: string;
    image_id: string;
    faces: Face[];
  }>;
  warnings: string[];
};

type DiscoveredImage = {
  image_url: string;
  width?: number | null;
  height?: number | null;
  alt?: string | null;
  source: string;
  score: number;
};

type DiscoverResponse = {
  page_url: string;
  title?: string | null;
  images: DiscoveredImage[];
  ignored_images?: Array<DiscoveredImage & { reason: string }>;
  warnings: string[];
};

type RecentArticle = {
  article_id: string;
  title?: string | null;
  url: string;
  domain: string;
  captured_at?: string | null;
  thumbnail_url?: string | null;
  people: Array<{
    person_id: string;
    name: string;
    slug: string;
    score: number;
    status: string;
  }>;
};

type ArticleResolveResponse = {
  found: boolean;
  article_id?: string;
  url?: string;
  domain?: string;
  title?: string | null;
};

const DEFAULT_ARTICLE_URL =
  'https://www1.folha.uol.com.br/poder/2026/06/haddad-tera-franca-como-vice-na-disputa-pelo-governo-de-sp-com-tebet-e-marina-para-o-senado.shtml';

let faceModelLoad: Promise<unknown> | null = null;

function withProbeNonce(url: string) {
  const parsed = new URL(url);
  parsed.searchParams.set('diga_probe', String(Date.now()));
  return parsed.toString();
}

function proxiedImageUrl(url: string) {
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

function bboxStyle(face: Face, naturalSize: { width: number; height: number }) {
  const width = naturalSize.width || 1;
  const height = naturalSize.height || 1;
  const left = Math.max(0, (face.bbox.x / width) * 100);
  const top = Math.max(0, (face.bbox.y / height) * 100);
  const boxWidth = Math.min(100 - left, (face.bbox.w / width) * 100);
  const boxHeight = Math.min(100 - top, (face.bbox.h / height) * 100);

  return {
    left: `${left}%`,
    top: `${top}%`,
    width: `${Math.max(2, boxWidth)}%`,
    height: `${Math.max(2, boxHeight)}%`,
  };
}

function topMatch(face: Face) {
  return face.matches[0] || null;
}

function faceArea(face: Face) {
  return Math.max(0, face.bbox.w) * Math.max(0, face.bbox.h);
}

function confidenceLabel(face: Face) {
  const match = topMatch(face);
  return match ? `${Math.round(match.score * 100)}%` : "?";
}

function faceDisplayName(face: Face, index: number) {
  const match = topMatch(face);
  return match ? match.name : `Rosto ${index + 1}`;
}

function unknownFaceClass(face: Face, minMatchedArea: number | null) {
  if (face.matches.length > 0) {
    return "";
  }
  if (!minMatchedArea) {
    return "unknown-prominent";
  }
  return faceArea(face) >= minMatchedArea * 0.7 ? "unknown-prominent" : "unknown-subtle";
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
  if (!box) {
    return null;
  }

  const sourceWidth = source.imageWidth || naturalWidth;
  const sourceHeight = source.imageHeight || naturalHeight;
  const scaleX = naturalWidth / sourceWidth;
  const scaleY = naturalHeight / sourceHeight;
  const x = Math.max(0, Number(box.x) * scaleX);
  const y = Math.max(0, Number(box.y) * scaleY);
  const w = Math.min(Math.max(0, Number(box.width) * scaleX), naturalWidth - x);
  const h = Math.min(Math.max(0, Number(box.height) * scaleY), naturalHeight - y);

  if (![x, y, w, h].every(Number.isFinite) || w < 18 || h < 18) {
    return null;
  }

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

export default function HomePage() {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const peopleSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [inputUrl, setInputUrl] = useState(DEFAULT_ARTICLE_URL);
  const [submittedUrl, setSubmittedUrl] = useState('');
  const [submittedSourceUrl, setSubmittedSourceUrl] = useState('');
  const [articleUrl, setArticleUrl] = useState(DEFAULT_ARTICLE_URL);
  const [discoveredImages, setDiscoveredImages] = useState<DiscoveredImage[]>([]);
  const [ignoredImages, setIgnoredImages] = useState<Array<DiscoveredImage & { reason: string }>>([]);
  const [articleTitle, setArticleTitle] = useState('');
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [selectedFaceId, setSelectedFaceId] = useState<string | null>(null);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [suggestionNames, setSuggestionNames] = useState<Record<string, string>>({});
  const [peopleOptions, setPeopleOptions] = useState<Record<string, PersonOption[]>>({});
  const [suggestionFeedback, setSuggestionFeedback] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState('');
  const [detectorStatus, setDetectorStatus] = useState('Cole uma URL de matéria para começar.');
  const [loading, setLoading] = useState(false);
  const [recentArticles, setRecentArticles] = useState<RecentArticle[]>([]);

  const faces = result?.results[0]?.faces || [];
  const selectedFace = faces.find((face) => face.face_id === selectedFaceId) || faces[0] || null;
  const minMatchedArea = faces
    .filter((face) => face.matches.length > 0)
    .reduce<number | null>((min, face) => {
      const area = faceArea(face);
      return min === null ? area : Math.min(min, area);
    }, null);
  const currentImageSrc = useMemo(() => (submittedUrl ? proxiedImageUrl(submittedUrl) : ''), [submittedUrl]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const url = params.get('url');
    const article = params.get('article');
    if (article) {
      setArticleUrl(article);
      setInputUrl(article);
    }
    if (url) {
      setInputUrl(url);
      setSubmittedUrl(url);
      setSubmittedSourceUrl(url);
      setDetectorStatus('Carregando imagem...');
    } else if (article) {
      void analyzeArticleUrl(article);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.get<RecentArticle[]>('/articles/recent?limit=8')
      .then(setRecentArticles)
      .catch(() => setRecentArticles([]));
  }, []);

  const analyzeLoadedImage = async () => {
    const image = imageRef.current;
    if (!image || !submittedUrl) {
      return;
    }

    setLoading(true);
    setFeedback('');
    setSuggestionFeedback({});
    setSuggestionNames({});
    setPeopleOptions({});
    setSelectedFaceId(null);
    setResult(null);
    setDetectorStatus('Detectando faces no navegador...');

    try {
      const detectedFaces = await detectFacesForImage(image);
      setDetectorStatus(
        detectedFaces.length
          ? `${detectedFaces.length} face(s) detectada(s) localmente.`
          : 'Nenhuma face detectada localmente.',
      );

      const out = await api.post<AnalyzeResponse>('/extension/analyze-page', {
        page_url: withProbeNonce(articleUrl || DEFAULT_ARTICLE_URL),
        title: 'Teste direto de imagem',
        images: [
          {
            image_url: submittedUrl,
            width: image.naturalWidth,
            height: image.naturalHeight,
            faces: detectedFaces,
          },
        ],
      });
      setResult(out);
      setSelectedFaceId(out.results[0]?.faces[0]?.face_id || null);
      if (out.warnings.length > 0) {
        setFeedback(out.warnings.join(' '));
      }
    } catch (error: unknown) {
      setDetectorStatus('Não foi possível concluir a detecção/análise.');
      setFeedback(error instanceof Error ? error.message : 'Falha ao analisar imagem.');
    } finally {
      setLoading(false);
    }
  };

  const openImageUrl = (imageUrl: string, nextArticleUrl = articleUrl) => {
    const next = new URL(window.location.href);
    next.searchParams.set('url', imageUrl);
    if (nextArticleUrl.trim()) {
      next.searchParams.set('article', nextArticleUrl.trim());
    }
    window.history.replaceState({}, '', next);

    setSubmittedUrl(imageUrl);
    setNaturalSize({ width: 0, height: 0 });
    setResult(null);
    setFeedback('');
    setSuggestionFeedback({});
    setSuggestionNames({});
    setPeopleOptions({});
    setDetectorStatus('Carregando imagem...');
  };

  const discoverFromArticleUrl = async (url: string, debug = debugEnabled) => {
    const next = new URL(window.location.href);
    next.searchParams.delete('url');
    next.searchParams.set('article', url);
    window.history.replaceState({}, '', next);

    setLoading(true);
    setFeedback('');
    setResult(null);
    setDiscoveredImages([]);
    setIgnoredImages([]);
    setArticleTitle('');
    setSubmittedUrl('');
    setSubmittedSourceUrl(url);
    setDetectorStatus('Buscando imagens prováveis na matéria...');
    try {
      const discovery = await api.post<DiscoverResponse>('/extension/discover-article-images', {
        page_url: url,
        max_images: 12,
        debug,
      });
      setArticleUrl(discovery.page_url);
      setArticleTitle(discovery.title || '');
      setDiscoveredImages(discovery.images);
      setIgnoredImages(discovery.ignored_images || []);
      if (discovery.warnings.length > 0) {
        setFeedback(discovery.warnings.join(' '));
      }
      const firstImage = discovery.images[0]?.image_url;
      if (!firstImage) {
        setDetectorStatus('Nenhuma imagem jornalística provável foi encontrada.');
        return;
      }
      openImageUrl(firstImage, discovery.page_url);
    } catch (error: unknown) {
      setDetectorStatus('Não foi possível descobrir imagens nessa matéria.');
      setFeedback(error instanceof Error ? error.message : 'Falha ao ler a matéria.');
    } finally {
      setLoading(false);
    }
  };

  const analyzeArticleUrl = async (url: string) => {
    let normalizedUrl: string;
    try {
      normalizedUrl = new URL(url).toString();
    } catch (_error: unknown) {
      setFeedback('Informe uma URL de matéria válida.');
      return;
    }

    setLoading(true);
    setFeedback('');
    setSubmittedSourceUrl(normalizedUrl);
    setDiscoveredImages([]);
    setIgnoredImages([]);
    setArticleTitle('');
    setDetectorStatus('Verificando se a matéria já foi analisada...');

    try {
      const existing = await api.get<ArticleResolveResponse>(`/articles/resolve?url=${encodeURIComponent(normalizedUrl)}`);
      if (existing.found && existing.article_id) {
        window.location.assign(`/materia/${existing.article_id}`);
        return;
      }
    } catch (error: unknown) {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível verificar a matéria.');
      setLoading(false);
      return;
    }

    await discoverFromArticleUrl(normalizedUrl);
  };

  const submitUrl = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = inputUrl.trim();
    if (!trimmed) {
      setFeedback('Informe uma URL de matéria.');
      return;
    }

    await analyzeArticleUrl(trimmed);
  };

  const suggestFace = async (event: FormEvent, face: Face) => {
    event.preventDefault();
    const suggestedName = (suggestionNames[face.face_id] || '').trim();
    if (!suggestedName) {
      setSuggestionFeedback((current) => ({ ...current, [face.face_id]: 'Informe um nome para sugerir.' }));
      return;
    }

    const selectedPerson = (peopleOptions[face.face_id] || []).find(
      (person) => (person.display_name || person.name).toLowerCase() === suggestedName.trim().toLowerCase(),
    );
    setSuggestionFeedback((current) => ({ ...current, [face.face_id]: 'Enviando sugestão...' }));
    try {
      await api.post(`/extension/faces/${face.face_id}/suggestions`, {
        suggested_name: suggestedName.trim(),
        suggested_person_id: selectedPerson?.id || selectedPerson?.person_id || null,
        comment: 'Sugestão criada pela bancada de imagem direta.',
      });
      setSuggestionFeedback((current) => ({ ...current, [face.face_id]: 'Sugestão enviada para curadoria.' }));
      setSuggestionNames((current) => ({ ...current, [face.face_id]: '' }));
    } catch (error: unknown) {
      setSuggestionFeedback((current) => ({
        ...current,
        [face.face_id]: error instanceof Error ? error.message : 'Erro ao enviar sugestão.',
      }));
    }
  };

  const searchPeople = (face: Face, value: string) => {
    setSuggestionNames((current) => ({ ...current, [face.face_id]: value }));
    const query = value.trim();
    if (peopleSearchTimer.current) {
      clearTimeout(peopleSearchTimer.current);
    }
    if (query.length < 2) {
      setPeopleOptions((current) => ({ ...current, [face.face_id]: [] }));
      return;
    }
    peopleSearchTimer.current = setTimeout(() => {
      const request = debugEnabled
        ? api.get<PersonOption[]>(
            `/extension/debug/faces/${face.face_id}/people-scores?query=${encodeURIComponent(query)}`,
          )
        : api.get<PersonOption[]>(`/people?query=${encodeURIComponent(query)}`);
      request
        .then((rows) => {
          const filtered = rows.filter((person) => !person.status || person.status === 'ACTIVE' || person.score !== undefined).slice(0, 8);
          setPeopleOptions((current) => ({ ...current, [face.face_id]: filtered }));
        })
        .catch(() => setPeopleOptions((current) => ({ ...current, [face.face_id]: [] })));
    }, 220);
  };

  const selectSuggestion = (face: Face, person: PersonOption) => {
    setSuggestionNames((current) => ({ ...current, [face.face_id]: person.display_name || person.name }));
    setPeopleOptions((current) => ({ ...current, [face.face_id]: [] }));
  };

  const goBack = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.assign('/');
  };

  return (
    <main className="review-shell">
      <header className="review-topbar">
        <Link className="brand" href="/">Diga-me</Link>
        <nav className="navline">
          <button className="link-button" onClick={goBack} type="button">Voltar</button>
          <Link href="/admin">Admin</Link>
          <a href="chrome://extensions">Extensão</a>
        </nav>
      </header>

      <section className={`review-url-panel ${submittedUrl ? 'compact' : ''}`}>
        <p className="kicker">Bancada de marcação</p>
        <h1>Marcar e revisar faces em uma matéria</h1>
        <form className="review-url-form" onSubmit={submitUrl}>
          <label>
            URL da matéria
            <input
              className="input"
              value={inputUrl}
              onChange={(event) => setInputUrl(event.target.value)}
              placeholder="https://jornal.example/materia"
            />
          </label>
          <button className="button" type="submit" disabled={loading}>
            {loading ? 'Analisando...' : 'Analisar matéria'}
          </button>
        </form>
        <label className="debug-toggle">
          <input
            checked={debugEnabled}
            onChange={(event) => {
              const enabled = event.target.checked;
              setDebugEnabled(enabled);
              if (enabled && submittedSourceUrl) {
                void discoverFromArticleUrl(submittedSourceUrl, true);
              }
            }}
            type="checkbox"
          />
          Debug
        </label>
        <details className="article-context">
          <summary>Contexto da matéria usado pela API</summary>
          <input
            className="input"
            value={articleUrl}
            onChange={(event) => setArticleUrl(event.target.value)}
            placeholder="URL da matéria permitida"
          />
        </details>
        <p className="muted">Se a matéria já tiver análise pública, você será levado direto para a página dela.</p>
      </section>

      {recentArticles.length > 0 ? (
        <section className="recent-articles-band" aria-label="Últimas notícias processadas">
          <div className="recent-articles-head">
            <div>
              <p className="eyebrow">Últimas notícias processadas</p>
              <h2>Quem apareceu nas matérias recentes</h2>
            </div>
          </div>
          <div className="recent-article-grid">
            {recentArticles.map((article) => (
              <Link className="recent-article-card" href={`/materia/${article.article_id}`} key={article.article_id}>
                {article.thumbnail_url ? (
                  <img src={proxiedImageUrl(article.thumbnail_url)} alt="" />
                ) : (
                  <span className="recent-thumb-placeholder" />
                )}
                <div>
                  <strong>{article.title || article.url}</strong>
                  <p>{article.domain} · {article.captured_at ? new Date(article.captured_at).toLocaleString('pt-BR') : 'sem data'}</p>
                  <div className="recent-people-row">
                    {article.people.slice(0, 4).map((person) => (
                      <span key={`${article.article_id}-${person.person_id}`}>{person.name}</span>
                    ))}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {submittedUrl ? (
        <section className="review-workbench">
          <div className="review-stage-panel">
            <div className="review-stage-header">
              <div>
                <p className="eyebrow">{articleTitle ? articleTitle : 'Imagem'}</p>
                <strong>{detectorStatus}</strong>
              </div>
              <span className="face-count">{faces.length || 0} persistida(s)</span>
            </div>
            {discoveredImages.length > 1 ? (
              <div className="article-image-strip" aria-label="Imagens encontradas na matéria">
                {discoveredImages.map((item) => (
                  <button
                    className={item.image_url === submittedUrl ? 'active' : ''}
                    key={item.image_url}
                    onClick={() => openImageUrl(item.image_url, articleUrl)}
                    type="button"
                    title={`${item.source} · score ${item.score}`}
                  >
                    <img src={proxiedImageUrl(item.image_url)} alt={item.alt || ''} />
                    <span>{item.width && item.height ? `${item.width}x${item.height}` : item.source}</span>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="review-canvas">
              <div className="probe-image-wrap">
                <img
                  ref={imageRef}
                  src={currentImageSrc}
                  alt=""
                  onLoad={() => {
                    const image = imageRef.current;
                    setNaturalSize({
                      width: image?.naturalWidth || 0,
                      height: image?.naturalHeight || 0,
                    });
                    void analyzeLoadedImage();
                  }}
                  onError={() => {
                    const fallbackUrl = submittedSourceUrl || submittedUrl;
                    if (fallbackUrl && fallbackUrl === submittedUrl) {
                      void discoverFromArticleUrl(fallbackUrl);
                      return;
                    }
                    setDetectorStatus('Não foi possível carregar a imagem.');
                    setFeedback('A URL da imagem não carregou pela bancada.');
                  }}
                />
                {faces.map((face, index) => {
                  const match = topMatch(face);
                  return (
                  <button
                    className={`face-box ${selectedFace?.face_id === face.face_id ? 'active' : ''} ${
                      face.matches.length ? 'matched' : 'unmatched'
                    } ${unknownFaceClass(face, minMatchedArea)}`}
                    key={face.face_id}
                    onClick={() => {
                      setSelectedFaceId(face.face_id);
                      setSuggestionFeedback((current) => ({ ...current, [face.face_id]: '' }));
                    }}
                    style={bboxStyle(face, naturalSize)}
                    type="button"
                    title={match ? `${match.name} · ${confidenceLabel(face)}` : 'Pessoa não identificada'}
                  >
                    <span className="face-index">{match ? match.name : '?'}</span>
                    <span className="face-status">{confidenceLabel(face)}</span>
                  </button>
                  );
                })}
              </div>
            </div>
            {feedback ? <p className="feedback">{feedback}</p> : null}
          </div>

          <aside className="panel correction-panel">
            <div className="correction-head">
              <div>
                <p className="eyebrow">Curadoria</p>
                <h2>Faces detectadas</h2>
              </div>
              {result ? <Link href={`/materia/${result.article_id}`}>Matéria</Link> : null}
            </div>

            {!faces.length ? (
              <p className="empty-state">
                {loading ? 'Aguardando detecção...' : 'Nenhuma face selecionada ou detectada nesta imagem.'}
              </p>
            ) : null}

            {faces.length ? (
              <div className="curation-face-list" aria-label="Faces detectadas">
                {faces.map((face, index) => {
                  const match = topMatch(face);
                  const options = peopleOptions[face.face_id] || [];
                  const feedbackForFace = suggestionFeedback[face.face_id];
                  return (
                    <article
                      className={`curation-face-card ${selectedFace?.face_id === face.face_id ? 'active' : ''}`}
                      key={face.face_id}
                      onClick={() => setSelectedFaceId(face.face_id)}
                    >
                      <div className="curation-face-heading">
                        <span className="face-pill">{index + 1}</span>
                        {match ? (
                          <div>
                            <strong>{match.name}</strong>
                            <p className="muted">{confidenceLabel(face)} identificado</p>
                          </div>
                        ) : (
                          <div>
                            <strong>Não identificada</strong>
                            <p className="muted">Sugira uma pessoa para curadoria.</p>
                          </div>
                        )}
                        {match?.profile_url ? <Link href={match.profile_url}>Perfil</Link> : null}
                      </div>

                      {match ? (
                        <div className="candidate-list compact">
                          {face.matches.slice(1).map((item) => (
                            <div className="candidate-card compact" key={item.slug}>
                              <span>{item.name}</span>
                              <small>{Math.round(item.score * 100)}%</small>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <form className="inline-suggestion-form" onSubmit={(event) => suggestFace(event, face)}>
                          <div className="autocomplete-wrap">
                            <input
                              className="transparent-input"
                              value={suggestionNames[face.face_id] || ''}
                              onChange={(event) => searchPeople(face, event.target.value)}
                              onFocus={() => setSelectedFaceId(face.face_id)}
                              placeholder="Digite um nome"
                            />
                            {options.length > 0 ? (
                              <div className="autocomplete-menu">
                                {options.map((person) => (
                                  <button
                                    key={person.id || person.person_id || person.slug}
                                    onClick={() => selectSuggestion(face, person)}
                                    type="button"
                                  >
                                    <span>{person.display_name || person.name}</span>
                                    {debugEnabled && person.score !== undefined && person.score !== null ? (
                                      <small>{Math.round(person.score * 100)}%</small>
                                    ) : null}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          <button className="button subtle-button" type="submit">
                            Sugerir
                          </button>
                        </form>
                      )}

                      {feedbackForFace ? <p className="status-line">{feedbackForFace}</p> : null}
                    </article>
                  );
                })}
              </div>
            ) : null}

            {debugEnabled ? (
              <section className="debug-panel" aria-label="Debug">
                <div className="correction-head">
                  <div>
                    <p className="eyebrow">Debug</p>
                    <h3>Dados técnicos</h3>
                  </div>
                </div>
                <div className="debug-grid">
                  <div>
                    <strong>Imagem atual</strong>
                    <p>{submittedUrl || 'nenhuma'}</p>
                    <p>natural {naturalSize.width}x{naturalSize.height}</p>
                    {result ? <p>article {result.article_id}</p> : null}
                  </div>
                  <div>
                    <strong>Warnings</strong>
                    <p>{feedback || 'sem warnings'}</p>
                  </div>
                </div>
                <div className="debug-list">
                  <strong>Faces</strong>
                  {faces.map((face, index) => (
                    <p key={face.face_id}>
                      #{index + 1} {face.face_id} · x {Math.round(face.bbox.x)}, y {Math.round(face.bbox.y)}, w {Math.round(face.bbox.w)}, h {Math.round(face.bbox.h)}
                    </p>
                  ))}
                </div>
                <div className="debug-list">
                  <strong>Imagens aceitas pelo crawler</strong>
                  {discoveredImages.length ? discoveredImages.map((image) => (
                    <p key={image.image_url}>
                      {image.source} · {image.width || '?'}x{image.height || '?'} · score {image.score.toFixed(3)} · {image.image_url}
                    </p>
                  )) : <p>sem lista de crawler nesta análise</p>}
                </div>
                <div className="debug-list">
                  <strong>Imagens ignoradas pelo crawler</strong>
                  {ignoredImages.length ? ignoredImages.map((image) => (
                    <p key={`${image.reason}-${image.image_url}`}>
                      {image.reason} · {image.source} · {image.width || '?'}x{image.height || '?'} · score {image.score.toFixed(3)} · {image.image_url}
                    </p>
                  )) : <p>nenhuma imagem ignorada registrada</p>}
                </div>
              </section>
            ) : null}
          </aside>
        </section>
      ) : null}
    </main>
  );
}
