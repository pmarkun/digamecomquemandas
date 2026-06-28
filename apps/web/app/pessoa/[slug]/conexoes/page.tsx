import { api } from '@/lib/api';
import Link from 'next/link';

type Connection = {
  slug: string;
  name: string;
  count: number;
  last_article_id?: string;
  last_article_title?: string;
};

async function loadConnections(slug: string) {
  return api.get<Connection[]>(`/people/${slug}/connections`);
}

async function loadPerson(slug: string) {
  return api.get<{ display_name: string; name: string; slug: string }>(`/people/${slug}`);
}

export default async function PersonConnectionsPage({ params }: { params: { slug: string } }) {
  const [person, data] = await Promise.all([
    loadPerson(params.slug).catch(() => null),
    loadConnections(params.slug).catch(() => []),
  ]);
  const name = person?.display_name || person?.name || params.slug;

  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/">Diga-me</Link>
        <nav className="navline">
          <Link href={`/pessoa/${params.slug}`}>Perfil</Link>
          <Link href={`/pessoa/${params.slug}/contestar`}>Contestar</Link>
        </nav>
      </header>

      <div className="page">
        <section className="profile-hero">
          <div>
            <p className="eyebrow">Coaparições públicas</p>
            <h1 className="admin-title">Conexões de {name}</h1>
          </div>
          <Link className="button secondary" href={`/pessoa/${params.slug}`}>Voltar ao perfil</Link>
        </section>

        <section className="profile-section">
          {data.length === 0 && <p className="empty-panel">Nenhuma conexão pública aprovada ainda.</p>}
          <div className="connection-list">
            {data.map((item) => (
              <article className="connection-card" key={item.slug}>
                <div>
                  <h2><Link href={`/pessoa/${item.slug}`}>{item.name}</Link></h2>
                  <p>{item.count} {item.count === 1 ? 'matéria em conjunto' : 'matérias em conjunto'}</p>
                </div>
                {item.last_article_id ? (
                  <Link className="button secondary" href={`/materia/${item.last_article_id}`}>
                    {item.last_article_title || 'Última matéria'}
                  </Link>
                ) : (
                  <span className="badge">sem matéria recente</span>
                )}
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
