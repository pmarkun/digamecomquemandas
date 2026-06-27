import { api } from '@/lib/api';

type Props = {
  params: {
    slug: string;
  };
};

async function sendContest(formData: FormData, slug: string) {
  'use server';
  await api.post(`/people/${slug}/contest`, {
    requester_name: String(formData.get('requester_name') || ''),
    requester_email: String(formData.get('requester_email') || ''),
    relationship: String(formData.get('relationship') || ''),
    message: String(formData.get('message') || ''),
  });
}

export default async function ContestPage({ params }: Props) {
  return (
    <main style={{ padding: '2rem', background: '#F7F2E8', color: '#191919' }}>
      <h1>Contestar perfil</h1>
      <p>Use os dados abaixo para registrar uma contestação.</p>
      <form
        action={async (formData: FormData) => {
          await sendContest(formData, params.slug);
        }}
      >
        <div>
          <label>Nome</label>
          <br />
          <input name="requester_name" />
        </div>
        <div>
          <label>E-mail</label>
          <br />
          <input name="requester_email" />
        </div>
        <div>
          <label>Relação</label>
          <br />
          <input name="relationship" placeholder="self" />
        </div>
        <div>
          <label>Mensagem</label>
          <br />
          <textarea name="message" cols={50} rows={4} />
        </div>
        <button type="submit">Enviar</button>
      </form>
    </main>
  );
}
