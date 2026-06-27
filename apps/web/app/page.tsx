import Link from 'next/link';

export default function HomePage() {
  return (
    <main style={{ fontFamily: 'Georgia, serif', background: '#F7F2E8', minHeight: '100vh', padding: '2rem', color: '#191919' }}>
      <h1 style={{ marginBottom: '0.5rem' }}>Quem Tá Na Foto? (diga-me)</h1>
      <p style={{ maxWidth: 760 }}>
        Extensão para mapear possíveis identificações de figuras públicas em portais de notícias autorizados.
        Todo resultado é apresentado como <strong>possível identificação</strong>.
      </p>
      <section style={{ marginTop: '1rem', border: '1px solid #2B2B2B', padding: '1rem', background: '#fff' }}>
        <h2>Como funciona</h2>
        <ol>
          <li>Abra a página em portal permitido com a extensão ativa.</li>
          <li>A página coleta imagens candidatas e consulta o backend.</li>
          <li>Possíveis identificações aparecem em overlay discreto.</li>
          <li>Use a página pública para revisar aparições e coaparições.</li>
        </ol>
      </section>
      <div style={{ marginTop: '1rem' }}>
        <Link href="/admin">Ir para painel admin</Link>
      </div>
      <p style={{ marginTop: '1rem', color: '#D94A38' }}>Identificação automatizada pode conter erros.</p>
    </main>
  );
}
