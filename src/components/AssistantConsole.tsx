import { useMemo, useState } from "react";
import { api } from "../lib/api";
import type { AssistantContext, AssistantMessage } from "../lib/types";
import "../styles/assistant-page.css";

type AssistantConsoleProps = {
  variant: "floating" | "modal";
  onMinimize?: () => void;
  onOpenModal?: () => void;
  onDock?: () => void;
};

const starterPrompts = [
  "Summarize what is happening across my dashboard right now.",
  "Which trading strategies look strongest based on current stats?",
  "Give me 5 content ideas based on my current trading focus.",
];

export function AssistantConsole({
  variant,
  onMinimize,
  onOpenModal,
  onDock,
}: AssistantConsoleProps) {
  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      role: "assistant",
      content:
        "Ask me about your articles, Reddit campaigns, trading strategies, or ideas to publish next.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [context, setContext] = useState<AssistantContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionSummary, setActionSummary] = useState<string | null>(null);

  const contextCards = useMemo(() => {
    if (!context) {
      return [];
    }

    return [
      { label: "Sites", value: context.overview.total_sites },
      { label: "Articles", value: context.overview.total_articles },
      { label: "Reddit", value: context.overview.reddit_campaigns },
      { label: "Strategies", value: context.overview.trading_strategies },
    ];
  }, [context]);

  async function submitMessage(content: string) {
    const trimmed = content.trim();
    if (!trimmed || loading) {
      return;
    }

    const nextMessages: AssistantMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setDraft("");
    setLoading(true);
    setError(null);

    try {
      const response = await api.chatWithAssistant(nextMessages.slice(-12));
      setContext(response.context);
      setActionSummary(
        response.action_results && response.action_results.length > 0
          ? response.action_results.map((item) => item.message).join(" ")
          : null,
      );
      setMessages((current) => [...current, { role: "assistant", content: response.message }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assistant request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`assistant-shell assistant-shell--${variant}`}>
      <section className="panel assistant-panel assistant-panel--widget">
        <div className="panel__title-row assistant-header">
          <div>
            <p className="assistant-kicker">AI Workspace</p>
            <h2>Assistant</h2>
          </div>
          <div className="assistant-header__actions">
            {variant === "floating" ? (
              <>
                <button
                  type="button"
                  className="button-secondary assistant-header__button"
                  onClick={onOpenModal}
                  aria-label="Open Assistant in modal"
                  title="Open in modal"
                >
                  Expand
                </button>
                <button
                  type="button"
                  className="button-secondary assistant-header__button"
                  onClick={onMinimize}
                  aria-label="Minimize Assistant"
                  title="Minimize"
                >
                  Minimize
                </button>
              </>
            ) : (
              <button
                type="button"
                className="button-secondary assistant-header__button"
                onClick={onDock}
                aria-label="Dock Assistant"
                title="Dock"
              >
                Dock
              </button>
            )}
          </div>
        </div>

        <p className="assistant-intro">
          This assistant reads your live dashboard context and can help with planning, Reddit operations, and trading analysis.
        </p>
        {actionSummary ? <p className="assistant-action-banner">{actionSummary}</p> : null}

        <div className="assistant-prompts">
          {starterPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="assistant-chip"
              onClick={() => void submitMessage(prompt)}
              disabled={loading}
            >
              {prompt}
            </button>
          ))}
        </div>

        {contextCards.length ? (
          <div className="assistant-stats assistant-stats--compact">
            {contextCards.map((card) => (
              <div key={card.label} className="assistant-stat-card">
                <span>{card.label}</span>
                <strong>{card.value}</strong>
              </div>
            ))}
          </div>
        ) : null}

        <div className="assistant-thread">
          {messages.map((message, index) => (
            <article
              key={`${message.role}-${index}`}
              className={`assistant-bubble assistant-bubble--${message.role}`}
            >
              <div className="assistant-bubble__role">
                {message.role === "assistant" ? "Assistant" : "You"}
              </div>
              <p>{message.content}</p>
            </article>
          ))}
          {loading ? (
            <article className="assistant-bubble assistant-bubble--assistant">
              <div className="assistant-bubble__role">Assistant</div>
              <p>Thinking through the latest dashboard context…</p>
            </article>
          ) : null}
        </div>

        <form
          className="assistant-compose"
          onSubmit={(event) => {
            event.preventDefault();
            void submitMessage(draft);
          }}
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask for ideas, summaries, or strategy analysis..."
            rows={variant === "floating" ? 3 : 4}
          />
          <div className="assistant-compose__actions">
            {error ? <p className="error">{error}</p> : <span />}
            <button type="submit" disabled={loading || draft.trim().length === 0}>
              Send
            </button>
          </div>
        </form>
      </section>

      {variant === "modal" ? (
        <aside className="assistant-sidebar">
          <section className="panel">
            <div className="panel__title-row">
              <h2>Snapshot</h2>
            </div>
            {contextCards.length === 0 ? (
              <p className="assistant-empty">Send a message to load live dashboard context.</p>
            ) : (
              <div className="assistant-stats">
                {contextCards.map((card) => (
                  <div key={card.label} className="assistant-stat-card">
                    <span>{card.label}</span>
                    <strong>{card.value}</strong>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel__title-row">
              <h2>Recent Articles</h2>
            </div>
            {context?.recent_articles?.length ? (
              <div className="assistant-list">
                {context.recent_articles.map((article) => (
                  <div key={`${article.title}-${article.updated_at}`} className="assistant-list__item">
                    <strong>{article.title}</strong>
                    <span>
                      {article.status} • {new Date(article.updated_at).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="assistant-empty">No article context loaded yet.</p>
            )}
          </section>

          <section className="panel">
            <div className="panel__title-row">
              <h2>Scheduler</h2>
            </div>
            {context?.planner_items?.length ? (
              <div className="assistant-list">
                {context.planner_items.map((item) => (
                  <div key={item.id} className="assistant-list__item">
                    <strong>{item.title}</strong>
                    <span>
                      {item.platform} • {item.status}
                      {item.scheduled_for ? ` • ${new Date(item.scheduled_for).toLocaleString()}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="assistant-empty">No scheduler items loaded yet.</p>
            )}
          </section>

          <section className="panel">
            <div className="panel__title-row">
              <h2>Trading</h2>
            </div>
            {context?.trading_strategies?.length ? (
              <div className="assistant-list">
                {context.trading_strategies.map((strategy) => (
                  <div key={`${strategy.name}-${strategy.symbol}`} className="assistant-list__item">
                    <strong>
                      {strategy.name} • {strategy.symbol}
                    </strong>
                    <span>
                      {strategy.status} • {strategy.total_trades} trades •{" "}
                      {(strategy.win_rate * 100).toFixed(1)}% win rate
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="assistant-empty">No trading context loaded yet.</p>
            )}
          </section>
        </aside>
      ) : null}
    </div>
  );
}
