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
  }>;
};

type DetectedFacePayload = {
  x: number;
  y: number;
  w: number;
  h: number;
  score?: number;
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

const DEFAULT_IMAGE_URL =
  'https://f.i.uol.com.br/fotografia/2026/06/25/17824066766a3d5e1405be2_1782406676_3x2_rt.jpg';
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

async function detectFacesForImage(image: HTMLImageElement): Promise<DetectedFacePayload[]> {
  const faceapi = await import('face-api.js');
  if (!faceModelLoad) {
    faceModelLoad = faceapi.nets.tinyFaceDetector.loadFromUri('/models');
  }
  await faceModelLoad;

  const detections = await faceapi.detectAllFaces(
    image,
    new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.35 }),
  );
  const naturalWidth = image.naturalWidth || 1;
  const naturalHeight = image.naturalHeight || 1;

  return detections
    .map((detection: unknown) => {
      const candidate = detection as {
        box?: { x: number; y: number; width: number; height: number };
        score?: number;
        imageWidth?: number;
        imageHeight?: number;
      };
      const box = candidate.box;
      if (!box) {
        return null;
      }

      const sourceWidth = candidate.imageWidth || naturalWidth;
      const sourceHeight = candidate.imageHeight || naturalHeight;
      const scaleX = naturalWidth / sourceWidth;
      const scaleY = naturalHeight / sourceHeight;
      const x = Math.max(0, Number(box.x) * scaleX);
      const y = Math.max(0, Number(box.y) * scaleY);
      const w = Math.min(Math.max(0, Number(box.width) * scaleX), naturalWidth - x);
      const h = Math.min(Math.max(0, Number(box.height) * scaleY), naturalHeight - y);

      if (![x, y, w, h].every(Number.isFinite) || w < 18 || h < 18) {
        return null;
      }

      return {
        x,
        y,
        w,
        h,
        score: typeof candidate.score === 'number' ? candidate.score : undefined,
      };
    })
    .filter(Boolean) as DetectedFacePayload[];
}

export default function HomePage() {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [inputUrl, setInputUrl] = useState(DEFAULT_IMAGE_URL);
  const [submittedUrl, setSubmittedUrl] = useState('');
  const [articleUrl, setArticleUrl] = useState(DEFAULT_ARTICLE_URL);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [selectedFaceId, setSelectedFaceId] = useState<string | null>(null);
  const [suggestedName, setSuggestedName] = useState('');
  const [suggestionFeedback, setSuggestionFeedback] = useState('');
  const [feedback, setFeedback] = useState('');
  const [detectorStatus, setDetectorStatus] = useState('Cole uma URL de imagem para começar.');
  const [loading, setLoading] = useState(false);

  const faces = result?.results[0]?.faces || [];
  const selectedFace = faces.find((face) => face.face_id === selectedFaceId) || faces[0] || null;
  const currentImageSrc = useMemo(() => (submittedUrl ? proxiedImageUrl(submittedUrl) : ''), [submittedUrl]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const url = params.get('url');
    const article = params.get('article');
    if (article) {
      setArticleUrl(article);
    }
    if (url) {
      setInputUrl(url);
      setSubmittedUrl(url);
      setDetectorStatus('Carregando imagem...');
    }
  }, []);

  const analyzeLoadedImage = async () => {
    const image = imageRef.current;
    if (!image || !submittedUrl) {
      return;
    }

    setLoading(true);
    setFeedback('');
    setSuggestionFeedback('');
    setSuggestedName('');
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

  const submitUrl = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = inputUrl.trim();
    if (!trimmed) {
      setFeedback('Informe uma URL de imagem.');
      return;
    }

    const next = new URL(window.location.href);
    next.searchParams.set('url', trimmed);
    if (articleUrl.trim()) {
      next.searchParams.set('article', articleUrl.trim());
    }
    window.history.replaceState({}, '', next);

    setSubmittedUrl(trimmed);
    setNaturalSize({ width: 0, height: 0 });
    setResult(null);
    setFeedback('');
    setSuggestionFeedback('');
    setDetectorStatus('Carregando imagem...');
  };

  const suggestFace = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedFace || !suggestedName.trim()) {
      setSuggestionFeedback('Selecione uma face e informe um nome para sugerir.');
      return;
    }

    setSuggestionFeedback('Enviando sugestão...');
    try {
      await api.post(`/extension/faces/${selectedFace.face_id}/suggestions`, {
        suggested_name: suggestedName.trim(),
        comment: 'Sugestão criada pela bancada de imagem direta.',
      });
      setSuggestionFeedback('Sugestão enviada para curadoria.');
      setSuggestedName('');
    } catch (error: unknown) {
      setSuggestionFeedback(error instanceof Error ? error.message : 'Erro ao enviar sugestão.');
    }
  };

  return (
    <main className="review-shell">
      <header className="review-topbar">
        <Link className="brand" href="/">Diga-me</Link>
        <nav className="navline">
          <Link href="/admin">Admin</Link>
          <a href="chrome://extensions">Extensão</a>
        </nav>
      </header>

      <section className={`review-url-panel ${submittedUrl ? 'compact' : ''}`}>
        <p className="kicker">Bancada de marcação</p>
        <h1>Marcar e revisar faces em uma imagem</h1>
        <form className="review-url-form" onSubmit={submitUrl}>
          <label>
            URL da imagem
            <input
              className="input"
              value={inputUrl}
              onChange={(event) => setInputUrl(event.target.value)}
              placeholder="https://..."
            />
          </label>
          <button className="button" type="submit" disabled={loading}>
            {loading ? 'Analisando...' : 'Abrir imagem'}
          </button>
        </form>
        <details className="article-context">
          <summary>Contexto da matéria usado pela API</summary>
          <input
            className="input"
            value={articleUrl}
            onChange={(event) => setArticleUrl(event.target.value)}
            placeholder="URL da matéria permitida"
          />
        </details>
        <p className="muted">A URL fica em <code>?url=</code>, então o teste pode ser recarregado e compartilhado.</p>
      </section>

      {submittedUrl ? (
        <section className="review-workbench">
          <div className="review-stage-panel">
            <div className="review-stage-header">
              <div>
                <p className="eyebrow">Imagem</p>
                <strong>{detectorStatus}</strong>
              </div>
              <span className="face-count">{faces.length || 0} persistida(s)</span>
            </div>

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
                    setDetectorStatus('Não foi possível carregar a imagem.');
                    setFeedback('A URL da imagem não carregou pela bancada.');
                  }}
                />
                {faces.map((face, index) => (
                  <button
                    className={`face-box ${selectedFace?.face_id === face.face_id ? 'active' : ''} ${
                      face.matches.length ? 'matched' : 'unmatched'
                    }`}
                    key={face.face_id}
                    onClick={() => {
                      setSelectedFaceId(face.face_id);
                      setSuggestionFeedback('');
                    }}
                    style={bboxStyle(face, naturalSize)}
                    type="button"
                    title={face.matches.length ? `${face.matches.length} match(es)` : 'Pessoa não identificada'}
                  >
                    <span className="face-index">Face {index + 1}</span>
                    <span className="face-status">{face.matches.length ? `${face.matches.length} match` : 'sem match'}</span>
                  </button>
                ))}
              </div>
            </div>
            {feedback ? <p className="feedback">{feedback}</p> : null}
          </div>

          <aside className="panel correction-panel">
            <div className="correction-head">
              <div>
                <p className="eyebrow">Curadoria</p>
                <h2>Identificar face</h2>
              </div>
              {result ? <Link href={`/materia/${result.article_id}`}>Matéria</Link> : null}
            </div>

            {selectedFace ? (
              <>
                <div className="selected-face-card">
                  <div>
                    <strong>Face {faces.findIndex((face) => face.face_id === selectedFace.face_id) + 1}</strong>
                    <p className="muted">
                      {selectedFace.matches.length
                        ? 'Há candidatos automáticos para revisar.'
                        : 'Sem match automático. Sugira uma pessoa para curadoria.'}
                    </p>
                  </div>
                  <div className="bbox-chips" aria-label="Coordenadas da face">
                    <span>x {Math.round(selectedFace.bbox.x)}</span>
                    <span>y {Math.round(selectedFace.bbox.y)}</span>
                    <span>w {Math.round(selectedFace.bbox.w)}</span>
                    <span>h {Math.round(selectedFace.bbox.h)}</span>
                  </div>
                </div>

                {selectedFace.matches.length ? (
                  <div className="candidate-list">
                    {selectedFace.matches.map((match) => (
                      <div className="candidate-card" key={match.slug}>
                        <div>
                          <strong>{match.name}</strong>
                          <p className="muted">score {match.score.toFixed(3)}</p>
                        </div>
                        {match.profile_url ? <Link href={match.profile_url}>Perfil público</Link> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <form className="correction-form" onSubmit={suggestFace}>
                    <label>
                      Nome da pessoa
                      <input
                        className="input"
                        value={suggestedName}
                        onChange={(event) => setSuggestedName(event.target.value)}
                        placeholder="Ex.: Fernando Haddad"
                      />
                    </label>
                    <button className="button" type="submit">
                      Sugerir identificação
                    </button>
                  </form>
                )}

                {suggestionFeedback ? <p className="status-line">{suggestionFeedback}</p> : null}
              </>
            ) : (
              <p className="empty-state">
                {loading ? 'Aguardando detecção...' : 'Nenhuma face selecionada ou detectada nesta imagem.'}
              </p>
            )}

            {faces.length ? (
              <div className="face-list" aria-label="Faces detectadas">
                {faces.map((face, index) => (
                  <button
                    className={`face-list-button ${selectedFace?.face_id === face.face_id ? 'active' : ''}`}
                    key={face.face_id}
                    onClick={() => {
                      setSelectedFaceId(face.face_id);
                      setSuggestionFeedback('');
                    }}
                    type="button"
                  >
                    <span>Face {index + 1}</span>
                    <small>{face.matches.length ? `${face.matches.length} match` : 'sem match'}</small>
                  </button>
                ))}
              </div>
            ) : null}
          </aside>
        </section>
      ) : null}
    </main>
  );
}
