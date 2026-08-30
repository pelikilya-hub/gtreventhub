// Пустое состояние с выходом.
//
// Сквозной обход продукта всеми ролями показал одну и ту же поломку в
// шести местах: экран, на котором ничего нет, сообщал об этом — и на
// этом заканчивался. Гость нажимал «События», видел «афиши обновляются
// каждые шесть часов» и упирался в стену: ни кнопки, ни ссылки, ни
// намёка, куда идти. Формально это не ошибка — экран отработал верно.
// Практически это тупик, и таких тупиков в продукте было больше, чем
// работающих сценариев на тех же экранах.
//
// Правило простое: пустой экран обязан предложить следующий шаг. Не
// «загляните позже», а «вот куда пойти прямо сейчас». Отсюда общий
// компонент — чтобы шаг было некуда забыть.
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { ScreenId } from "./data/app-data";
import { Card } from "./ui";

export type EmptyAction = {
  label: string;
  /** Куда ведёт. Экран продукта — самый частый случай. */
  to?: ScreenId;
  /** Или своё действие: открыть форму, начать синхронизацию. */
  onClick?: () => void;
  /** Главный шаг рисуется красным: из двух выходов один всегда лучше. */
  primary?: boolean;
};

export const Empty = ({
  title,
  text,
  actions = [],
  compact,
}: {
  title: string;
  text?: string;
  actions?: EmptyAction[];
  /** Внутри карточки-панели, а не на весь экран: меньше воздуха. */
  compact?: boolean;
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const body = (
    <div style={{ display: "grid", gap: compact ? 8 : 11, justifyItems: "start" }}>
      <div style={{ font: `600 ${compact ? 13 : 14}px/1.5 'Golos Text',sans-serif`, color: "#fff" }}>
        {t(title)}
      </div>
      {text ? (
        <div
          style={{
            font: `500 ${compact ? 12.5 : 13}px/1.6 'Golos Text',sans-serif`,
            color: "var(--gtr-t2)",
            maxWidth: 520,
          }}
        >
          {t(text)}
        </div>
      ) : null}
      {actions.length ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
          {actions.map((a) => (
            <button
              key={a.label}
              className={`gtr-btn${a.primary ? " gtr-btn-red" : ""}`}
              style={{ padding: "7px 12px", fontSize: 12.5 }}
              onClick={() => {
                if (a.onClick) a.onClick();
                else if (a.to) navigate({ to: "/gtr/$screen", params: { screen: a.to } });
              }}
            >
              {t(a.label)} →
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
  return compact ? (
    <div style={{ padding: "18px 20px" }}>{body}</div>
  ) : (
    <Card style={{ padding: "22px 24px" }}>{body}</Card>
  );
};
