import { api } from '@/lib/api';
import Link from 'next/link';

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

async function loadPerson(slug: string): Promise<Person> {
  return api.get<Person>(`/people/${slug}`);
}

async function loadAppearances(slug: string) {
  return api.get<
    Array<{
      article_id: string;
      image_id: string;
      image_url: string;
      score: number;
      status: string;
    }>
  >(`/people/${slug}/appearances`);
}

export default async function PersonPage({ params }: { params: { slug: string } }) {
  const person = await loadPerson(params.slug);
  const isOptedOut = person.status === 'OPTOUT_LIMITED' || person.status === 'REMOVED';
  const appearances = isOptedOut ? [] : await loadAppearances(params.slug);

  return (
    <main style={{ padding: '2rem', background: '#F7F2E8', color: '#191919' }}>
      <h1>{person.display_name}</h1>
      <p>Status: {person.status}</p>
      <p>Categoria: {person.category}</p>
      {!isOptedOut && person.public_office && <p>Cargo: {person.public_office}</p>}
      {!isOptedOut && person.description && <p>{person.description}</p>}
      <Link href={`/pessoa/${params.slug}/conexoes`}>Ver coaparições</Link>
      {isOptedOut && (
        <p>
          As informações públicas agregadas deste perfil estão indisponíveis por solicitação da pessoa interessada ou
          representante autorizado. Mantemos apenas o registro mínimo necessário para evitar novas publicações
          automáticas e preservar a auditoria do pedido.
        </p>
      )}

      {!isOptedOut && (
        <>
          <h2>Aparições recentes</h2>
          <ul>
            {appearances.map((item) => (
              <li key={item.image_id}>
                <a href={`/materia/${item.article_id}`}>{item.image_url}</a> • score {item.score.toFixed(3)}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Aviso de identificação automatizada</h2>
      <p>Esta plataforma usa reconhecimento automatizado e o resultado não é confirmação absoluta.</p>
      <h2>Contestar este perfil</h2>
      <a href={`/pessoa/${params.slug}/contestar`}>Abrir formulário de contestação</a>
    </main>
  );
}
