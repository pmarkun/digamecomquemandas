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
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);

  const faces = result?.results[0]?.faces || [];

  const analyzeImage = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setFeedback('');
    setResult(null);

    try {
      const out = await api.post<AnalyzeResponse>('/extension/analyze-page', {
        page_url: withProbeNonce(articleUrl),
        title: 'Teste direto de imagem',
        images: [{ image_url: imageUrl }],
      });
      setResult(out);
      if (out.warnings.length > 0) {
        setFeedback(out.warnings.join(' '));
      }
    } catch (error: unknown) {
      setFeedback(error instanceof Error ? error.message : 'Falha ao analisar imagem.');
    } finally {
      setLoading(false);
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
                {faces.map((face) => (
                  <button
                    className="face-box"
                    key={face.face_id}
                    style={{
                      left: `${face.bbox.x}px`,
                      top: `${face.bbox.y}px`,
                      width: `${face.bbox.w}px`,
                      height: `${face.bbox.h}px`,
                    }}
                    type="button"
                    title={face.matches.length ? `${face.matches.length} match(es)` : 'Pessoa não identificada'}
                  >
                    {face.matches.length ? `${face.matches.length} match` : 'sem match'}
                  </button>
                ))}
              </div>

              <div className="panel">
                <h3>Resultado</h3>
                <p>{faces.length} face(s) detectada(s)</p>
                <a href={`/materia/${result.article_id}`}>Abrir matéria no sistema</a>
                <table className="table">
                  <tbody>
                    {faces.map((face) => (
                      <tr key={face.face_id}>
                        <td>{face.face_id.slice(0, 8)}</td>
                        <td>
                          x {Math.round(face.bbox.x)}, y {Math.round(face.bbox.y)}, w {Math.round(face.bbox.w)}, h{' '}
                          {Math.round(face.bbox.h)}
                        </td>
                        <td>
                          {face.matches.length === 0
                            ? 'Pessoa não identificada'
                            : face.matches.map((match) => `${match.name} ${match.score.toFixed(3)}`).join(', ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
