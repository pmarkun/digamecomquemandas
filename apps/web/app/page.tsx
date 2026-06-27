import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/">Diga-me</Link>
        <nav className="navline">
          <Link href="/admin">Admin</Link>
          <a href="chrome://extensions">Extensão</a>
        </nav>
      </header>

      <div className="page">
        <section className="home-hero">
          <div>
            <p className="kicker">Arquivo civil de aparições públicas</p>
            <h1 className="home-title">Diga-me com quem tu andas</h1>
            <p className="lede">
              Uma ferramenta jornalística para registrar possíveis identificações de figuras públicas em imagens de
              notícias, sempre com aviso de incerteza, contestação visível e curadoria humana.
            </p>
          </div>
          <aside className="notice-box">
            <strong>Reconhecimento automatizado pode errar.</strong>
            <p>
              O MVP só opera em domínios autorizados e compara imagens contra uma base curada de pessoas públicas.
            </p>
          </aside>
        </section>

        <section className="home-grid">
          <article className="panel">
            <p className="eyebrow">Fluxo</p>
            <h2>Extensão</h2>
            <p>Detecta imagens candidatas em portais permitidos e exibe marcadores discretos sobre faces analisadas.</p>
          </article>
          <article className="panel">
            <p className="eyebrow">Consulta</p>
            <h2>Perfis</h2>
            <p>Reúne aparições, coaparições, status do perfil e caminho claro para contestação ou opt-out.</p>
          </article>
          <article className="panel">
            <p className="eyebrow">Curadoria</p>
            <h2>Painel admin</h2>
            <p>Revisa matches, sugestões manuais, pessoas públicas, allowlist e pedidos de contestação.</p>
          </article>
        </section>
      </div>
    </main>
  );
}
