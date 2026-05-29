function renderLegalPage(title: string, description: string, body: string): Response {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} | Oilor Studio</title>
    <meta name="description" content="${description}" />
    <style>
      :root {
        color-scheme: light;
        --bg: #f7f8fb;
        --panel: #ffffff;
        --text: #151823;
        --muted: #5f6b85;
        --border: #d9deea;
        --accent: #1f4dff;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: linear-gradient(180deg, #f9fbff 0%, var(--bg) 100%);
        color: var(--text);
      }
      main {
        max-width: 860px;
        margin: 48px auto;
        padding: 0 20px 48px;
      }
      .card {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 24px;
        padding: 32px;
        box-shadow: 0 16px 40px rgba(17, 24, 39, 0.08);
      }
      h1 {
        margin: 0 0 8px;
        font-size: clamp(2rem, 4vw, 3rem);
        line-height: 1.05;
      }
      p, li {
        color: var(--muted);
        font-size: 1rem;
        line-height: 1.7;
      }
      h2 {
        margin-top: 28px;
        font-size: 1.1rem;
      }
      a { color: var(--accent); }
      .eyebrow {
        display: inline-block;
        margin-bottom: 12px;
        font-size: 0.8rem;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--accent);
      }
      footer {
        margin-top: 28px;
        padding-top: 20px;
        border-top: 1px solid var(--border);
      }
      ul {
        padding-left: 20px;
      }
      code {
        padding: 0.15rem 0.35rem;
        border-radius: 0.35rem;
        background: #eff3ff;
        color: #2140aa;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <span class="eyebrow">Oilor Studio Legal</span>
        <h1>${title}</h1>
        <p>${description}</p>
        ${body}
        <footer>
          <p>Questions about this policy can be sent to <a href="mailto:adilet.melisov@gmail.com">adilet.melisov@gmail.com</a>.</p>
        </footer>
      </section>
    </main>
  </body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export function handleLegalPage(pathname: string): Response | null {
  if (pathname === "/legal/privacy") {
    return renderLegalPage(
      "Privacy Policy",
      "How Oilor Studio handles account credentials, publishing metadata, and support requests for its dashboard and connected social integrations.",
      `
        <h2>Information we collect</h2>
        <p>Oilor Studio stores only the information needed to run the dashboard and publish social content on your behalf. This can include account usernames, connected platform tokens, scheduled post content, publishing history, and support contact details you provide.</p>
        <h2>How we use information</h2>
        <ul>
          <li>To authenticate you into the dashboard and keep your workspace settings available.</li>
          <li>To publish or schedule content to platforms you explicitly connect, such as Threads, X, or Reddit.</li>
          <li>To troubleshoot delivery issues, sync connected agents, and respond to support requests.</li>
        </ul>
        <h2>Data sharing</h2>
        <p>We do not sell your personal information. Data is shared only with the third-party platforms you connect for the purpose of publishing, moderating, or retrieving account-related content that you requested.</p>
        <h2>Data retention</h2>
        <p>Connected account credentials and scheduled content remain stored until you remove the account, delete the content, or request deletion. Operational logs may be retained for security, fraud prevention, and service reliability.</p>
        <h2>Your choices</h2>
        <p>You can disconnect connected social accounts from the dashboard at any time and request deletion of related account data by following the instructions at <a href="/legal/data-deletion">/legal/data-deletion</a>.</p>
      `,
    );
  }

  if (pathname === "/legal/terms") {
    return renderLegalPage(
      "Terms of Service",
      "The core terms governing use of the Oilor Studio dashboard and its connected publishing tools.",
      `
        <h2>Use of the service</h2>
        <p>Oilor Studio may be used only for lawful publishing, scheduling, research, and account-management workflows. You are responsible for content sent through any connected platform account.</p>
        <h2>Connected platform accounts</h2>
        <p>By connecting a third-party platform account, you confirm that you have permission to use that account and authorize Oilor Studio to publish or retrieve information needed to perform the actions you request.</p>
        <h2>Acceptable use</h2>
        <ul>
          <li>No unlawful, fraudulent, abusive, or infringing use of the platform.</li>
          <li>No attempts to bypass platform rules, rate limits, or access restrictions.</li>
          <li>No use of the service to distribute malware, spam, or deceptive content.</li>
        </ul>
        <h2>Service changes</h2>
        <p>Features, integrations, and platform support may change over time. We may suspend or limit access if needed to protect the service, comply with legal obligations, or respond to misuse.</p>
        <h2>Termination</h2>
        <p>You may stop using the service at any time. We may suspend or terminate access for violations of these terms or to protect the integrity and security of the platform.</p>
      `,
    );
  }

  if (pathname === "/legal/data-deletion") {
    return renderLegalPage(
      "Data Deletion Instructions",
      "How to request removal of Oilor Studio account data and connected platform credentials.",
      `
        <h2>Delete data from the dashboard</h2>
        <p>To remove connected platform credentials, sign in to the Oilor Studio dashboard and disconnect the relevant account from the Social Agents section. This removes the stored access credentials used for publishing.</p>
        <h2>Request full data deletion</h2>
        <p>If you want your workspace data removed entirely, email <a href="mailto:adilet.melisov@gmail.com">adilet.melisov@gmail.com</a> with the subject line <code>Data Deletion Request</code> and include the account email or platform username associated with your workspace.</p>
        <h2>What will be deleted</h2>
        <ul>
          <li>Connected social account credentials and tokens</li>
          <li>Scheduled and draft social posts stored in the dashboard</li>
          <li>Workspace settings that are no longer required for legal, billing, or security obligations</li>
        </ul>
        <h2>Processing timeline</h2>
        <p>We aim to process deletion requests within 30 days, subject to any information we must retain temporarily for security, fraud prevention, or legal compliance.</p>
      `,
    );
  }

  return null;
}
