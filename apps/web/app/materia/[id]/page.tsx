import { api } from '@/lib/api';

async function loadArticle(id: string) {
  return api.get<{
    id: string;
    url: string;
    domain: string;
    title?: string;
    captured_at?: string;
    published_at?: string;
    images: Array<{
      image_id: string;
      image_url: string;
      faces: Array<{
        face_id: string;
        matches: Array<{
          person_id: string;
          name: string;
          slug: string;
          score: number;
          status: string;
        }>;
      }>;
    }>;
  }>(`/articles/${id}`);
}

export default async function ArticlePage({ params }: { params: { id: string } }) {
  const article = await loadArticle(params.id).catch(() => null);

  return (
    <main style={{ padding: '2rem', background: '#F7F2E8', color: '#191919' }}>
      <h1>Página da matéria</h1>
      {!article && <p>Matéria não encontrada.</p>}
      {article && (
        <>
          <h2>{article.title || 'Sem título'}</h2>
          <p>Veículo: {article.domain}</p>
          <p>URL original: {article.url}</p>
          <p>Capturado em: {article.captured_at ? new Date(article.captured_at).toLocaleString('pt-BR') : 'desconhecido'}</p>
          <p>Publicado em: {article.published_at ? new Date(article.published_at).toLocaleString('pt-BR') : 'não informado'}</p>
          <a href={article.url} target="_blank" rel="noreferrer">Abrir matéria original</a>
          <h3 style={{ marginTop: '1rem' }}>Pessoas possivelmente identificadas</h3>
          <ul>
            {article.images.flatMap((image) =>
              image.faces.flatMap((face) =>
                face.matches.map((match) => (
                  <li key={`${image.image_id}-${face.face_id}-${match.person_id}`}>
                    <a href={`/pessoa/${match.slug}`}>{match.name}</a> (score {match.score.toFixed(3)})
                    {' '}
                    [{match.status}]
                  </li>
                )),
              ),
            )}
          </ul>
          <h3 style={{ marginTop: '1rem' }}>Imagens processadas</h3>
          <ul>
            {article.images.map((image) => (
              <li key={image.image_id}>
                {image.image_url} — {image.faces.length} face(s)
                {image.faces.some((face) => face.matches.length > 0) && (
                  <span> (há possíveis identificações)</span>
                )}
              </li>
            ))}
          </ul>
          {article.images.every((image) => image.faces.length === 0) && <p>Nenhuma identificação nesta matéria ainda.</p>}
        </>
      )}
    </main>
  );
}
