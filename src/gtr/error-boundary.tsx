// Экран, который упал, обязан сказать почему.
//
// Пустая страница вместо раздела — худший вид поломки: человек видит
// «не работает», а разработчик — три часа догадок. Одна незакрытая
// переменная в карточке роняла всю базу площадок, и понять это можно
// было только по слову «не работает» в переписке.
//
// Здесь падение перехватывается, текст ошибки показывается прямо на
// экране (команде — с местом в коде), а раздел можно перезапустить, не
// перезагружая приложение.
import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode; where: string; detailed?: boolean };
type State = { err: Error | null; stack?: string };

export class ScreenErrorBoundary extends Component<Props, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    this.setState({ stack: info.componentStack?.split("\n").slice(0, 4).join("\n") });
    // Пишем в тот же счётчик, что и остальные метрики продукта: молчаливое
    // падение у одного человека — это падение у всех, и узнавать о нём из
    // переписки поздно.
    void import("./kv-api")
      .then((m) => m.broLogFn({ data: { events: [`screen.crash.${this.props.where}`] } }))
      .catch(() => {});
  }

  render() {
    const { err, stack } = this.state;
    if (!err) return this.props.children;
    return (
      <div style={{ maxWidth: 720, margin: "40px auto", padding: 24 }}>
        <div
          style={{
            font: "700 11px/1 'JetBrains Mono',monospace",
            letterSpacing: "0.18em",
            color: "#E5231B",
            marginBottom: 12,
          }}
        >
          РАЗДЕЛ УПАЛ · {this.props.where.toUpperCase()}
        </div>
        <div style={{ font: "500 14px/1.6 'Golos Text',sans-serif", marginBottom: 16 }}>
          Экран не отрисовался. Остальное приложение работает — вернись назад или
          перезапусти раздел.
        </div>
        {this.props.detailed ? (
          <pre
            style={{
              font: "500 11px/1.5 'JetBrains Mono',monospace",
              color: "var(--gtr-t2)",
              background: "rgba(229,35,27,.08)",
              padding: 12,
              overflowX: "auto",
              whiteSpace: "pre-wrap",
              marginBottom: 16,
            }}
          >
            {err.message}
            {stack ? `\n${stack}` : ""}
          </pre>
        ) : null}
        <button className="gtr-btn gtr-btn-red" onClick={() => this.setState({ err: null })}>
          Перезапустить раздел
        </button>
      </div>
    );
  }
}
