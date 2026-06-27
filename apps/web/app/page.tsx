"use client";

/* eslint-disable @next/next/no-img-element */

import { FormEvent, useState } from 'react';
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

type AnalyzeResponse = {
  article_id: string;
  results: Array<{
    image_url: string;
    image_id: string;
    faces: Face[];
  }>;
  warnings: string[];
};

function withProbeNonce(url: string) {
  const parsed = new URL(url);
  parsed.searchParams.set('diga_probe', String(Date.now()));
  return parsed.toString();
}

export default function HomePage() {
  const [articleUrl, setArticleUrl] = useState('https://www1.folha.uol.com.br/poder/2026/06/haddad-tera-franca-como-vice-na-disputa-pelo-governo-de-sp-com-tebet-e-marina-para-o-senado.shtml');
  const [imageUrl, setImageUrl] = useState('https://f.i.uol.com.br/fotografia/2026/06/25/17824066766a3d5e1405be2_1782406676_3x2_rt.jpg');
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [selectedFaceId, setSelectedFaceId] = useState<string | null>(null);
  const [suggestedName, setSuggestedName] = useState('');
  const [suggestionFeedback, setSuggestionFeedback] = useState('');
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);

  const faces = result?.results[0]?.faces || [];
  const selectedFace = faces.find((face) => face.face_id === selectedFaceId) || faces[0] || null;

  const analyzeImage = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setFeedback('');
    setSuggestionFeedback('');
    setSuggestedName('');
    setSelectedFaceId(null);
    setResult(null);

    try {
      const out = await api.post<AnalyzeResponse>('/extension/analyze-page', {
        page_url: withProbeNonce(articleUrl),
        title: 'Teste direto de imagem',
        images: [{ image_url: imageUrl }],
      });
      setResult(out);
      setSelectedFaceId(out.results[0]?.faces[0]?.face_id || null);
      if (out.warnings.length > 0) {
        setFeedback(out.warnings.join(' '));
      }
    } catch (error: unknown) {
      setFeedback(error instanceof Error ? error.message : 'Falha ao analisar imagem.');
    } finally {
      setLoading(false);
    }
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
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/">Diga-me</Link>
        <nav className="navline">
          <Link href="/admin">Admin</Link>
          <a href="chrome://extensions">Extensão</a>
        </nav>
      </header>

      <div className="page">
        <section className="home-hero">
          <div>
            <p className="kicker">Arquivo civil de aparições públicas</p>
            <h1 className="home-title">Diga-me com quem tu andas</h1>
            <p className="lede">
              Uma ferramenta jornalística para registrar possíveis identificações de figuras públicas em imagens de
              notícias, sempre com aviso de incerteza, contestação visível e curadoria humana.
            </p>
          </div>
          <aside className="notice-box">
            <strong>Reconhecimento automatizado pode errar.</strong>
            <p>
              O MVP só opera em domínios autorizados e compara imagens contra uma base curada de pessoas públicas.
            </p>
          </aside>
        </section>

        <section className="home-grid">
          <article className="panel">
            <p className="eyebrow">Fluxo</p>
            <h2>Extensão</h2>
            <p>Detecta imagens candidatas em portais permitidos e exibe marcadores discretos sobre faces analisadas.</p>
          </article>
          <article className="panel">
            <p className="eyebrow">Consulta</p>
            <h2>Perfis</h2>
            <p>Reúne aparições, coaparições, status do perfil e caminho claro para contestação ou opt-out.</p>
          </article>
          <article className="panel">
            <p className="eyebrow">Curadoria</p>
            <h2>Painel admin</h2>
            <p>Revisa matches, sugestões manuais, pessoas públicas, allowlist e pedidos de contestação.</p>
          </article>
        </section>

        <section className="panel probe-panel">
          <div>
            <p className="eyebrow">Bancada de detecção</p>
            <h2>Imagem direta</h2>
            <p>
              Cole uma URL de matéria permitida e uma URL de imagem para validar as marcações antes de voltar para a
              extensão.
            </p>
          </div>

          <form className="probe-form" onSubmit={analyzeImage}>
            <label>
              URL da matéria
              <input className="input full" value={articleUrl} onChange={(event) => setArticleUrl(event.target.value)} />
            </label>
            <label>
              URL da imagem
              <input className="input full" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} />
            </label>
            <button className="button" type="submit" disabled={loading}>
              {loading ? 'Analisando...' : 'Analisar imagem'}
            </button>
          </form>

          {feedback && <p className="feedback">{feedback}</p>}

          {result && (
            <div className="probe-result">
              <div className="probe-image-wrap">
                <img src={imageUrl} alt="" />
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
                    style={{
                      left: `${face.bbox.x}px`,
                      top: `${face.bbox.y}px`,
                      width: `${face.bbox.w}px`,
                      height: `${face.bbox.h}px`,
                    }}
                    type="button"
                    title={face.matches.length ? `${face.matches.length} match(es)` : 'Pessoa não identificada'}
                  >
                    <span className="face-index">Face {index + 1}</span>
                    <span className="face-status">{face.matches.length ? `${face.matches.length} match` : 'sem match'}</span>
                  </button>
                ))}
              </div>

              <aside className="panel correction-panel">
                <div className="correction-head">
                  <div>
                    <p className="eyebrow">Curadoria</p>
                    <h3>Identificar face</h3>
                  </div>
                  <span className="face-count">{faces.length} face(s)</span>
                </div>
                <p className="muted">
                  Artigo #{result.article_id} · <a href={`/materia/${result.article_id}`}>abrir matéria no sistema</a>
                </p>

                {selectedFace ? (
                  <>
                    <div className="selected-face-card">
                      <div>
                        <strong>
                          Face {faces.findIndex((face) => face.face_id === selectedFace.face_id) + 1}
                        </strong>
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
                  <p className="empty-state">Nenhuma face detectada nesta imagem.</p>
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
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
