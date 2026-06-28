"use client";

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

type Props = {
  params: {
    slug: string;
  };
};

export default function ContestPage({ params }: Props) {
  const [requesterName, setRequesterName] = useState('');
  const [requesterEmail, setRequesterEmail] = useState('');
  const [relationship, setRelationship] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [feedback, setFeedback] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!requesterName.trim() || !requesterEmail.trim() || !message.trim()) {
      setStatus('error');
      setFeedback('Preencha nome, e-mail e uma mensagem explicando a contestação.');
      return;
    }

    setStatus('sending');
    setFeedback('');
    try {
      await api.post(`/people/${params.slug}/contest`, {
        requester_name: requesterName.trim(),
        requester_email: requesterEmail.trim(),
        relationship: relationship.trim(),
        message: message.trim(),
      });
      setStatus('success');
      setFeedback('Contestação registrada. A equipe vai revisar o perfil e pode usar este contato para confirmar informações.');
      setRequesterName('');
      setRequesterEmail('');
      setRelationship('');
      setMessage('');
    } catch (_error: unknown) {
      setStatus('error');
      setFeedback('Não foi possível enviar agora. Revise os dados e tente novamente.');
    }
  };

  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/">Diga-me</Link>
        <nav className="navline">
          <Link href={`/pessoa/${params.slug}`}>Perfil</Link>
          <Link href={`/pessoa/${params.slug}/conexoes`}>Conexões</Link>
        </nav>
      </header>

      <div className="page">
        <section className="profile-hero">
          <div>
            <p className="eyebrow">Correção e privacidade</p>
            <h1 className="admin-title">Contestar perfil</h1>
          </div>
        </section>

        <section className="contest-layout">
          <div className="panel profile-note">
            <h2>Como a revisão funciona</h2>
            <p>
              Use este formulário para pedir correção, remoção limitada ou revisão de identidade. A solicitação fica
              registrada para auditoria e será analisada por curadoria humana antes de qualquer alteração sensível.
            </p>
            <p>Inclua links ou contexto que ajudem a verificar o pedido. Não envie documentos sensíveis por este campo.</p>
          </div>

          <form className="panel contest-form" onSubmit={submit}>
            <label>
              Nome
              <input className="input" value={requesterName} onChange={(event) => setRequesterName(event.target.value)} required />
            </label>
            <label>
              E-mail
              <input className="input" type="email" value={requesterEmail} onChange={(event) => setRequesterEmail(event.target.value)} required />
            </label>
            <label>
              Relação com o perfil
              <input className="input" value={relationship} onChange={(event) => setRelationship(event.target.value)} placeholder="Própria pessoa, assessoria, representante..." />
            </label>
            <label>
              Mensagem
              <textarea className="input wide-input" value={message} onChange={(event) => setMessage(event.target.value)} required />
            </label>
            {feedback && <p className={status === 'success' ? 'success-line' : 'feedback'}>{feedback}</p>}
            <button className="button" type="submit" disabled={status === 'sending'}>
              {status === 'sending' ? 'Enviando...' : 'Enviar contestação'}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
