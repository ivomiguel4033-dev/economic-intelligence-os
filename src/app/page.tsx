const modules = [
  ["Company Brain", "Persistent organizational intelligence and context."],
  ["AI Board", "Multi-model deliberation for high-value decisions."],
  ["Market Intelligence", "Signals, scenarios and real-time market analysis."],
  ["Execution Engine", "Turn decisions into controlled workflows and actions."],
];

export default function Home() {
  return (
    <main>
      <header className="hero">
        <span className="eyebrow">ECONOMIC INTELLIGENCE OS · v0.1</span>
        <h1>Decision intelligence built to execute.</h1>
        <p>
          One operating layer for company knowledge, multi-model AI, economic signals,
          strategic decisions and measurable execution.
        </p>
        <div className="actions">
          <button>Open Command Center</button>
          <button className="secondary">View Intelligence</button>
        </div>
      </header>

      <section className="grid" aria-label="Core modules">
        {modules.map(([title, description]) => (
          <article key={title}>
            <span>CORE MODULE</span>
            <h2>{title}</h2>
            <p>{description}</p>
          </article>
        ))}
      </section>

      <section className="status">
        <div><strong>System</strong><span>Foundation online</span></div>
        <div><strong>Architecture</strong><span>Modular / AI-native</span></div>
        <div><strong>Security</strong><span>Policy-first</span></div>
      </section>
    </main>
  );
}
