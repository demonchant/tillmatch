import "./landing.css";

export function meta() {
  return [
    { title: "Tillmatch - close the payout loop" },
    { name: "description", content: "Trace Paystack settlements to bank credits. Keep uncertain payout matches open for human review." },
  ];
}

const steps = [
  { number: "01", title: "Bring both records", text: "Read your Paystack settlement list or import its export. Add the matching bank statement credits." },
  { number: "02", title: "See the evidence", text: "Tillmatch compares currency, exact amount and posting date, then links each result to its source rows." },
  { number: "03", title: "Review what is uncertain", text: "Ambiguous, partial or missing credits stay open. A person checks the records before confirming a match." },
];

export default function LandingRoute() {
  return (
    <main className="landing">
      <header className="landing-header">
        <a className="landing-brand" href="/" aria-label="Tillmatch home"><span className="landing-mark">T</span>tillmatch</a>
        <nav aria-label="Primary navigation">
          <a href="#workflow">Workflow</a>
          <a href="#principles">Principles</a>
        </nav>
        <a className="landing-nav-cta" href="/dashboard">Open dashboard <span aria-hidden="true">-&gt;</span></a>
      </header>

      <section className="landing-hero">
        <div className="landing-copy">
          <p className="landing-kicker"><span className="landing-kicker-dot" /> PAYOUT CLOSEOUT, WITH THE RECEIPTS</p>
          <h1>Know what<br />actually <em>landed.</em></h1>
          <p className="landing-intro">Tie a Paystack settlement to the credit in your bank statement. Every suggestion points to its source. Anything uncertain stays yours to review.</p>
          <div className="landing-actions">
            <a className="landing-primary" href="/dashboard">Open the closeout desk <span aria-hidden="true">-&gt;</span></a>
            <a className="landing-secondary" href="#workflow">See how it works <span aria-hidden="true">&#8595;</span></a>
          </div>
          <p className="landing-trust"><span aria-hidden="true">&#9679;</span> Read-only Paystack access <span aria-hidden="true">/</span> No money movement <span aria-hidden="true">/</span> People confirm matches</p>
        </div>
        <div className="landing-visual" aria-label="A diagram of Paystack records and bank statement credits flowing into a human-reviewed closeout">
          <div className="landing-orbit landing-orbit-one" />
          <div className="landing-orbit landing-orbit-two" />
          <div className="landing-stamp">SOURCE<br />BEFORE<br />STATUS</div>
          <div className="landing-flow-card">
            <div className="landing-flow-head"><span>THE CLOSEOUT PATH</span><span>3 CHECKS</span></div>
            <div className="landing-source-row"><span className="landing-source-icon">P</span><div><strong>Paystack settlement</strong><small>Provider record</small></div><span className="landing-source-tag">SOURCE A</span></div>
            <div className="landing-flow-connector"><span /></div>
            <div className="landing-source-row"><span className="landing-source-icon landing-bank-icon">B</span><div><strong>Bank credit</strong><small>Statement row</small></div><span className="landing-source-tag">SOURCE B</span></div>
            <div className="landing-flow-rule"><span className="landing-rule-check">&#10003;</span><div><strong>Exact amount + currency</strong><small>Then check the posting window</small></div><span className="landing-rule-label">RULE-BASED</span></div>
            <div className="landing-flow-foot"><span className="landing-human-dot" /> A person confirms each match</div>
          </div>
          <p className="landing-visual-caption">A match is a claim. The source rows are the evidence.</p>
        </div>
      </section>

      <section className="landing-workflow" id="workflow">
        <div className="landing-section-heading"><p className="landing-kicker">A CLEARER CLOSEOUT</p><h2>From payout notice<br />to bank evidence.</h2></div>
        <div className="landing-steps">{steps.map((step) => <article className="landing-step" key={step.number}><span>{step.number}</span><h3>{step.title}</h3><p>{step.text}</p></article>)}</div>
      </section>

      <section className="landing-principles" id="principles">
        <div><p className="landing-kicker">A CAREFUL TOOL FOR MONEY WORK</p><h2>Show the gap.<br /><em>Never hide it.</em></h2></div>
        <div className="landing-principle-list">
          <article><span>01</span><div><h3>Sources stay visible</h3><p>Amounts, dates and status link back to the records they came from.</p></div></article>
          <article><span>02</span><div><h3>Uncertainty stays open</h3><p>No inferred fees, splits or batched payouts. Exceptions remain exceptions.</p></div></article>
          <article><span>03</span><div><h3>People own the decision</h3><p>The agent can explain stored evidence. Only a person confirms a financial match.</p></div></article>
        </div>
      </section>

      <footer className="landing-footer"><a className="landing-brand" href="/" aria-label="Tillmatch home"><span className="landing-mark">T</span>tillmatch</a><span>Source-linked payout closeout</span><a href="/dashboard">Go to dashboard <span aria-hidden="true">-&gt;</span></a></footer>
    </main>
  );
}
