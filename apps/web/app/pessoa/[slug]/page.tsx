import { api } from '@/lib/api';
import Link from 'next/link';
import { notFound } from 'next/navigation';

/* eslint-disable @next/next/no-img-element */

type Person = {
  id: string;
  slug: string;
  name: string;
  display_name: string;
  category: string;
  description?: string;
  public_office?: string;
  status: string;
};

type Appearance = {
  article_id: string;
  article_title?: string;
  article_url?: string;
  article_domain?: string;
  captured_at?: string;
  image_id: string;
  image_url: string;
  status: string;
};

async function loadPerson(slug: string): Promise<Person> {
  return api.get<Person>(`/people/${slug}`);
}

async function loadAppearances(slug: string) {
  return api.get<Appearance[]>(`/people/${slug}/appearances`);
}

function statusLabel(status: string) {
  if (status === 'ACTIVE') return 'Perfil ativo';
  if (status === 'UNDER_REVIEW') return 'Em revisão';
  if (status === 'OPTOUT_LIMITED') return 'Perfil limitado por solicitação';
  if (status === 'REMOVED') return 'Perfil removido';
  return status;
}

function matchStatusLabel(status: string) {
  if (status === 'APPROVED_MANUAL') return 'Aprovado por curadoria';
  if (status === 'AUTO_APPROVED') return 'Aprovado automaticamente';
  if (status === 'APPROVED') return 'Aprovado';
  return status;
}

function compactDate(value?: string) {
  return value ? new Date(value).toLocaleDateString('pt-BR') : 'data indisponível';
}

export default async function PersonPage({ params }: { params: { slug: string } }) {
  const person = await loadPerson(params.slug).catch(() => null);
  if (!person) {
    notFound();
  }
  const isOptedOut = person.status === 'OPTOUT_LIMITED' || person.status === 'REMOVED';
  const appearances = isOptedOut ? [] : await loadAppearances(params.slug).catch(() => []);

  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/">Diga-me</Link>
        <nav className="navline">
          <Link href="/">Home</Link>
          <Link href={`/pessoa/${params.slug}/conexoes`}>Conexões</Link>
          <Link href={`/pessoa/${params.slug}/contestar`}>Contestar</Link>
        </nav>
      </header>

      <div className="page">
        <section className="profile-hero">
          <div>
            <p className="eyebrow">{person.category}</p>
            <h1 className="admin-title">{person.display_name || person.name}</h1>
            <div className="profile-meta">
              <span className="badge">{statusLabel(person.status)}</span>
              {!isOptedOut && person.public_office && <span>{person.public_office}</span>}
            </div>
          </div>
          <Link className="button secondary" href={`/pessoa/${params.slug}/contestar`}>Contestar perfil</Link>
        </section>

        {isOptedOut ? (
          <section className="panel profile-note">
            <h2>Informações indisponíveis</h2>
            <p>
              As informações públicas agregadas deste perfil estão indisponíveis por solicitação da pessoa interessada
              ou representante autorizado. Mantemos apenas o registro mínimo necessário para evitar novas publicações
              automáticas e preservar a auditoria do pedido.
            </p>
          </section>
        ) : (
          <>
            <section className="profile-summary">
              <div>
                <h2>Resumo</h2>
                <p>{person.description || 'Ainda não há resumo editorial para este perfil.'}</p>
              </div>
              <div className="profile-actions">
                <Link className="button" href={`/pessoa/${params.slug}/conexoes`}>Ver coaparições</Link>
                <Link className="button secondary" href={`/pessoa/${params.slug}/contestar`}>Solicitar correção</Link>
              </div>
            </section>

            <section className="profile-section">
              <div className="toolbar split">
                <div>
                  <p className="eyebrow">Aparições públicas</p>
                  <h2>Aparições recentes</h2>
                </div>
                <span className="badge">{appearances.length} registros</span>
              </div>
              {appearances.length === 0 && <p className="empty-panel">Nenhuma aparição pública aprovada ainda.</p>}
              <div className="appearance-grid">
                {appearances.map((item) => (
                  <article className="appearance-card" key={item.image_id}>
                    <img src={item.image_url} alt="" />
                    <div>
                      <span className="badge">{matchStatusLabel(item.status)}</span>
                      <h3><Link href={`/materia/${item.article_id}`}>{item.article_title || 'Matéria sem título'}</Link></h3>
                      <p>{item.article_domain || item.article_url || 'Fonte não informada'} · {compactDate(item.captured_at)}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}

        <section className="panel profile-note">
          <h2>Aviso de identificação automatizada</h2>
          <p>Esta plataforma usa reconhecimento automatizado, curadoria humana e contestação pública. Um registro aprovado não é confirmação absoluta de identidade.</p>
        </section>
      </div>
    </main>
  );
}
