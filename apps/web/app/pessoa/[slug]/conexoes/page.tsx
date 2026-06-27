import { api } from '@/lib/api';

async function loadConnections(slug: string) {
  return api.get<
    Array<{
      slug: string;
      name: string;
      count: number;
      last_score: number;
      last_article_id?: string;
      last_article_title?: string;
    }>
  >(`/people/${slug}/connections`);
}

export default async function PersonConnectionsPage({ params }: { params: { slug: string } }) {
  const data = await loadConnections(params.slug);

  return (
    <main style={{ padding: '2rem', background: '#F7F2E8', color: '#191919' }}>
      <h1>Conexões de {params.slug}</h1>
      <ul>
        {data.map((item) => (
          <li key={item.slug}>
            <a href={`/pessoa/${item.slug}`}>{item.name}</a> — {item.count} matérias em conjunto (último score {item.last_score.toFixed(3)})
            {item.last_article_id ? ` — última em ` : ''}
            {item.last_article_id ? <a href={`/materia/${item.last_article_id}`}>{item.last_article_title || item.last_article_id}</a> : ''}
          </li>
        ))}
      </ul>
      {data.length === 0 && <p>Nenhuma conexão encontrada ainda.</p>}
    </main>
  );
}
