"use client";

/* eslint-disable @next/next/no-img-element */

import Link from 'next/link';
import { useMemo, useState } from 'react';

type PublicMatch = {
  person_id: string;
  name: string;
  slug: string;
  score: number;
  status: string;
};

type PublicFace = {
  face_id: string;
  bbox: { x: number; y: number; w: number; h: number };
  matches: PublicMatch[];
};

type PublicImage = {
  image_id: string;
  image_url: string;
  width?: number | null;
  height?: number | null;
  faces: PublicFace[];
};

export type PublicArticle = {
  id: string;
  url: string;
  domain: string;
  title?: string | null;
  captured_at?: string | null;
  published_at?: string | null;
  images: PublicImage[];
};

type PersonAppearance = {
  person: PublicMatch;
  image: PublicImage;
  face: PublicFace;
};

function proxiedImageUrl(url: string) {
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString('pt-BR') : null;
}

function bboxStyle(face: PublicFace, image: PublicImage, naturalSize?: { width: number; height: number }) {
  const width = Number(image.width || naturalSize?.width || 1);
  const height = Number(image.height || naturalSize?.height || 1);
  const left = Math.max(0, (face.bbox.x / width) * 100);
  const top = Math.max(0, (face.bbox.y / height) * 100);
  const boxWidth = Math.min(100 - left, (face.bbox.w / width) * 100);
  const boxHeight = Math.min(100 - top, (face.bbox.h / height) * 100);
  return {
    left: `${left}%`,
    top: `${top}%`,
    width: `${boxWidth}%`,
    height: `${boxHeight}%`,
  };
}

function confirmedFaces(image: PublicImage) {
  return image.faces.filter((face) => face.matches.length > 0);
}

export default function ArticlePublicView({ article }: { article: PublicArticle }) {
  const initialImageId = article.images.find((image) => confirmedFaces(image).length > 0)?.image_id || article.images[0]?.image_id || '';
  const [activeImageId, setActiveImageId] = useState(initialImageId);
  const [activeFaceId, setActiveFaceId] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [naturalSizes, setNaturalSizes] = useState<Record<string, { width: number; height: number }>>({});

  const people = useMemo<PersonAppearance[]>(() => {
    const seen = new Set<string>();
    const rows: PersonAppearance[] = [];
    for (const image of article.images) {
      for (const face of confirmedFaces(image)) {
        const match = face.matches[0];
        if (seen.has(match.person_id)) continue;
        seen.add(match.person_id);
        rows.push({ person: match, image, face });
      }
    }
    return rows;
  }, [article.images]);

  const activeImage = article.images.find((image) => image.image_id === activeImageId) || article.images[0] || null;
  const activeFaces = activeImage ? confirmedFaces(activeImage) : [];
  const capturedAt = formatDate(article.captured_at);
  const publishedAt = formatDate(article.published_at);

  const selectAppearance = (appearance: PersonAppearance) => {
    setActiveImageId(appearance.image.image_id);
    setActiveFaceId(appearance.face.face_id);
  };

  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/">Diga-me</Link>
        <nav className="navline">
          <Link href="/">Home</Link>
          <a href={article.url} target="_blank" rel="noreferrer">Matéria original</a>
        </nav>
      </header>

      <div className="page article-public-page">
        <section className="article-public-hero">
          <div>
            <p className="eyebrow">{article.domain}</p>
            <h1 className="admin-title">{article.title || 'Matéria sem título'}</h1>
            <div className="article-public-meta">
              {publishedAt ? <span>Publicado em {publishedAt}</span> : null}
              {capturedAt ? <span>Processado em {capturedAt}</span> : null}
              <span>{article.images.length} foto(s) processada(s)</span>
              <span>{people.length} pessoa(s) confirmada(s)</span>
            </div>
          </div>
          <a className="button" href={article.url} target="_blank" rel="noreferrer">Abrir matéria original</a>
        </section>

        <section className="article-public-layout">
          <div className="article-gallery-panel">
            {activeImage ? (
              <>
                <div className="article-main-image">
                  {failedImages[activeImage.image_id] ? (
                    <div className="article-image-placeholder">
                      <span>Imagem indisponível</span>
                    </div>
                  ) : (
                    <img
                      src={proxiedImageUrl(activeImage.image_url)}
                      alt=""
                      onError={() => setFailedImages((current) => ({ ...current, [activeImage.image_id]: true }))}
                      onLoad={(event) => {
                        const image = event.currentTarget;
                        setNaturalSizes((current) => ({
                          ...current,
                          [activeImage.image_id]: {
                            width: image.naturalWidth,
                            height: image.naturalHeight,
                          },
                        }));
                      }}
                    />
                  )}
                  {!failedImages[activeImage.image_id] && activeFaces.map((face) => {
                    const match = face.matches[0];
                    return (
                      <button
                        className={`article-face-marker ${activeFaceId === face.face_id ? 'active' : ''}`}
                        key={face.face_id}
                        onClick={() => setActiveFaceId(face.face_id)}
                        style={bboxStyle(face, activeImage, naturalSizes[activeImage.image_id])}
                        title={match.name}
                        type="button"
                      >
                        <span>{match.name}</span>
                      </button>
                    );
                  })}
                </div>

                {article.images.length > 1 ? (
                  <div className="article-thumb-strip" aria-label="Fotos processadas">
                    {article.images.map((image) => (
                      <button
                        className={image.image_id === activeImage.image_id ? 'active' : ''}
                        key={image.image_id}
                        onClick={() => {
                          setActiveImageId(image.image_id);
                          setActiveFaceId(confirmedFaces(image)[0]?.face_id || null);
                        }}
                        type="button"
                      >
                        {failedImages[image.image_id] ? (
                          <span className="article-thumb-fallback" />
                        ) : (
                          <img
                            src={proxiedImageUrl(image.image_url)}
                            alt=""
                            onError={() => setFailedImages((current) => ({ ...current, [image.image_id]: true }))}
                          />
                        )}
                        <small>{confirmedFaces(image).length} pessoa(s)</small>
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="article-image-placeholder">
                <span>Nenhuma foto processada nesta matéria.</span>
              </div>
            )}
          </div>

          <aside className="article-people-panel">
            <div>
              <p className="eyebrow">Identificações confirmadas</p>
              <h2>Quem aparece na matéria</h2>
            </div>
            {people.length === 0 ? (
              <p className="empty-panel">Nenhuma figura pública confirmada nesta matéria ainda.</p>
            ) : (
              <div className="article-person-list">
                {people.map((appearance) => (
                  <article
                    className={`article-person-card ${activeFaceId === appearance.face.face_id ? 'active' : ''}`}
                    key={appearance.person.person_id}
                  >
                    <button type="button" onClick={() => selectAppearance(appearance)}>
                      <strong>{appearance.person.name}</strong>
                      <span>Ver na foto</span>
                    </button>
                    <div>
                      <Link href={`/pessoa/${appearance.person.slug}`}>Perfil</Link>
                      <Link href={`/pessoa/${appearance.person.slug}/contestar`}>Contestar</Link>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </aside>
        </section>
      </div>
    </main>
  );
}
