import { api } from '@/lib/api';
import Link from 'next/link';

type GraphPerson = {
  id: string;
  slug: string;
  name: string;
  display_name: string;
};

type GraphNode = GraphPerson & {
  image_count: number;
  article_count: number;
  total_count: number;
  weight: number;
  last_article_id?: string;
  last_article_title?: string;
};

type InfluenceGraph = {
  center: GraphPerson;
  nodes: GraphNode[];
  edges: Array<{
    source: string;
    target: string;
    image_count: number;
    article_count: number;
    total_count: number;
    weight: number;
    last_article_id?: string;
    last_article_title?: string;
  }>;
  image_scope_count: number;
  article_scope_count: number;
};

async function loadGraph(slug: string) {
  return api.get<InfluenceGraph>(`/people/${slug}/influence-graph?limit=32`);
}

async function loadPerson(slug: string) {
  return api.get<{ display_name: string; name: string; slug: string }>(`/people/${slug}`);
}

function nodePosition(index: number, total: number, weight: number) {
  const centerX = 450;
  const centerY = 280;
  if (total === 1) {
    return { x: centerX + 220, y: centerY };
  }
  const ring = weight >= 8 ? 185 : weight >= 4 ? 215 : 245;
  const angle = -Math.PI / 2 + (index / total) * Math.PI * 2;
  return {
    x: centerX + Math.cos(angle) * ring,
    y: centerY + Math.sin(angle) * ring,
  };
}

function nodeRadius(weight: number) {
  return Math.max(24, Math.min(58, 22 + weight * 2.6));
}

function edgeWidth(weight: number) {
  return Math.max(2, Math.min(12, 1.5 + weight * 0.8));
}

function shortName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 2) {
    return name;
  }
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

export default async function PersonConnectionsPage({ params }: { params: { slug: string } }) {
  const [person, graph] = await Promise.all([
    loadPerson(params.slug).catch(() => null),
    loadGraph(params.slug).catch(() => null),
  ]);
  const name = person?.display_name || person?.name || graph?.center.display_name || params.slug;
  const nodes = graph?.nodes || [];
  const maxWeight = nodes.reduce((max, node) => Math.max(max, node.weight), 1);

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
            <p className="eyebrow">Grafo de influência</p>
            <h1 className="admin-title">Conexões de {name}</h1>
            {graph ? (
              <div className="profile-meta">
                <span className="badge">{graph.image_scope_count} fotos-base</span>
                <span className="badge">{graph.article_scope_count} matérias-base</span>
              </div>
            ) : null}
          </div>
          <Link className="button secondary" href={`/pessoa/${params.slug}`}>Voltar ao perfil</Link>
        </section>

        <section className="influence-layout">
          <div className="influence-graph-panel">
            {nodes.length === 0 ? (
              <p className="empty-panel">Nenhuma conexão pública aprovada ainda.</p>
            ) : (
              <svg className="influence-graph" viewBox="0 0 900 560" role="img" aria-label={`Grafo de conexões de ${name}`}>
                <defs>
                  <radialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#fffaf0" />
                    <stop offset="100%" stopColor="#f1d6aa" />
                  </radialGradient>
                </defs>
                {nodes.map((node, index) => {
                  const position = nodePosition(index, nodes.length, node.weight);
                  return (
                    <line
                      className="influence-edge"
                      key={`${node.slug}-edge`}
                      x1="450"
                      y1="280"
                      x2={position.x}
                      y2={position.y}
                      strokeWidth={edgeWidth(node.weight)}
                      opacity={0.28 + Math.min(0.42, node.weight / Math.max(1, maxWeight) / 2)}
                    />
                  );
                })}
                <g className="influence-center">
                  <circle cx="450" cy="280" r="76" />
                  <text x="450" y="272" textAnchor="middle">{shortName(name)}</text>
                  <text x="450" y="296" textAnchor="middle">{nodes.length} conexões</text>
                </g>
                {nodes.map((node, index) => {
                  const position = nodePosition(index, nodes.length, node.weight);
                  const radius = nodeRadius(node.weight);
                  return (
                    <a href={`/pessoa/${node.slug}`} key={node.slug}>
                      <g className="influence-node">
                        <circle cx={position.x} cy={position.y} r={radius} />
                        <text x={position.x} y={position.y - 4} textAnchor="middle">{shortName(node.display_name || node.name)}</text>
                        <text x={position.x} y={position.y + 17} textAnchor="middle">{node.total_count}</text>
                      </g>
                    </a>
                  );
                })}
              </svg>
            )}
          </div>

          <aside className="influence-side-panel">
            <div className="toolbar split">
              <div>
                <p className="eyebrow">Nós conectados</p>
                <h2>Relações mais fortes</h2>
              </div>
              <span className="badge">{nodes.length} nós</span>
            </div>

            <div className="connection-list">
              {nodes.map((item) => (
                <article className="connection-card influence-card" key={item.slug}>
                  <div>
                    <h2><Link href={`/pessoa/${item.slug}`}>{item.display_name || item.name}</Link></h2>
                    <p>
                      {item.image_count} {item.image_count === 1 ? 'foto' : 'fotos'} · {item.article_count} {item.article_count === 1 ? 'matéria' : 'matérias'}
                    </p>
                  </div>
                  <div className="influence-strength" style={{ ['--strength' as string]: `${Math.max(8, Math.min(100, (item.weight / maxWeight) * 100))}%` }}>
                    <span>{item.total_count}</span>
                  </div>
                  {item.last_article_id ? (
                    <Link className="button secondary" href={`/materia/${item.last_article_id}`}>
                      {item.last_article_title || 'Matéria recente'}
                    </Link>
                  ) : (
                    <span className="badge">sem matéria recente</span>
                  )}
                </article>
              ))}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
