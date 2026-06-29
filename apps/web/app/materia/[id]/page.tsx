import Link from 'next/link';
import { api } from '@/lib/api';
import ArticlePublicView from './ArticlePublicView';
import type { PublicArticle } from './ArticlePublicView';

async function loadArticle(id: string) {
  return api.get<PublicArticle>(`/articles/${id}`);
}

export default async function ArticlePage({ params }: { params: { id: string } }) {
  const article = await loadArticle(params.id).catch(() => null);

  if (!article) {
    return (
      <main className="shell">
        <header className="topbar">
          <Link className="brand" href="/">Diga-me</Link>
          <nav className="navline">
            <Link href="/">Home</Link>
          </nav>
        </header>
        <div className="page">
          <section className="article-empty">
            <p className="eyebrow">Matéria</p>
            <h1 className="admin-title">Matéria não encontrada</h1>
            <p>Não encontramos uma análise pública para este endereço.</p>
            <Link className="button" href="/">Voltar para a home</Link>
          </section>
        </div>
      </main>
    );
  }

  return <ArticlePublicView article={article} />;
}
