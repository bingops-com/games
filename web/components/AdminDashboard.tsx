"use client";

import { useId, useState, type ReactNode } from "react";
import { Ic } from "./ui";

export const adminGameNames: Record<string, string> = {
  terre: "Ono",
  pavillons: "Codenoms",
  meche: "BoomParty",
  poudriere: "Bombermat",
  skrib: "Skribouille",
  gartik: "Gartik Phone",
};
export type Analytics = {
  days: number;
  generatedAt: number;
  users: number;
  newUsers: number;
  previousNewUsers: number;
  activeAccounts: number;
  sessionAccounts: number;
  participations: number;
  openReports: number;
  resolvedReports: number;
  dismissedReports: number;
  periodReports: number;
  series: { date: string; registrations: number; reports: number }[];
  games: { game: string; played: number; won: number; players: number }[];
};
export type AdminRoom = {
  code: string;
  game: string;
  phase: string;
  public: boolean;
  players: number;
  online: number;
};
const number = (n: number) => n.toLocaleString("fr-FR");
const dayLabel = (day: string) =>
  new Date(day + "T00:00:00Z").toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

function ActivityChart({ data }: { data: Analytics }) {
  const [metric, setMetric] = useState<"registrations" | "reports">(
    "registrations",
  );
  const [selected, setSelected] = useState<number | null>(null);
  const id = useId();
  const series = data.series;
  const index = Math.min(selected ?? series.length - 1, series.length - 1);
  const point = series[index];
  const total = series.reduce((sum, item) => sum + item[metric], 0);
  const ceiling = Math.max(
    4,
    Math.ceil(Math.max(0, ...series.map((item) => item[metric])) / 4) * 4,
  );
  const x = (i: number) => 42 + (i * 670) / Math.max(1, series.length - 1);
  const y = (v: number) => 194 - (v * 160) / ceiling;
  const path = series
    .map((item, i) => `${i ? "L" : "M"}${x(i)},${y(item[metric])}`)
    .join(" ");
  const label =
    metric === "registrations" ? "Inscriptions" : "Signalements reçus";
  return (
    <section className="admin-chart admin-surface" aria-labelledby={id}>
      <div className="admin-block-heading">
        <div>
          <h2 id={id}>Évolution de la communauté</h2>
          <p>Par jour, sur {data.days} jours · dates UTC</p>
        </div>
        <div
          className="admin-segments"
          role="group"
          aria-label="Indicateur du graphique"
        >
          <button
            type="button"
            aria-pressed={metric === "registrations"}
            onClick={() => setMetric("registrations")}
          >
            Inscriptions
          </button>
          <button
            type="button"
            aria-pressed={metric === "reports"}
            onClick={() => setMetric("reports")}
          >
            Signalements
          </button>
        </div>
      </div>
      <div className="admin-chart-total">
        <strong>{number(total)}</strong>
        <span>{label.toLowerCase()} sur la période</span>
      </div>
      <div className="admin-plot">
        <svg
          viewBox="0 0 740 230"
          preserveAspectRatio="none"
          role="img"
          aria-labelledby={`${id}-title ${id}-description`}
          onPointerMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const relative =
              ((event.clientX - bounds.left) / bounds.width) * 740;
            setSelected(
              Math.max(
                0,
                Math.min(
                  series.length - 1,
                  Math.round(((relative - 42) / 670) * (series.length - 1)),
                ),
              ),
            );
          }}
        >
          <title id={`${id}-title`}>
            {label} sur {data.days} jours
          </title>
          <desc id={`${id}-description`}>
            {total} au total. Les valeurs exactes sont disponibles dans le
            tableau et avec le curseur sous le graphique.
          </desc>
          {[0, 1, 2, 3, 4].map((step) => (
            <g key={step} className="admin-gridline">
              <line
                x1="42"
                x2="712"
                y1={y((step * ceiling) / 4)}
                y2={y((step * ceiling) / 4)}
              />
            </g>
          ))}
          {series.length > 0 && (
            <>
              <path
                d={`${path} L712,194 L42,194 Z`}
                className="admin-chart-area"
              />
              <path d={path} className="admin-chart-line" />
              <line
                x1={x(index)}
                x2={x(index)}
                y1="28"
                y2="194"
                className="admin-chart-guide"
              />
              <circle
                cx={x(index)}
                cy={y(point[metric])}
                r="5"
                className="admin-chart-point"
              />
            </>
          )}
        </svg>
        <div className="admin-axis-labels" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((step) => (
            <span
              key={step}
              className="admin-axis-y"
              style={{ top: `${(y((step * ceiling) / 4) / 230) * 100}%` }}
            >
              {number((step * ceiling) / 4)}
            </span>
          ))}
          {series.length > 0 && (
            <>
              <span className="admin-axis-first">
                {dayLabel(series[0].date)}
              </span>
              <span className="admin-axis-last">
                {dayLabel(series.at(-1)!.date)}
              </span>
            </>
          )}
        </div>
      </div>
      {point && (
        <div className="admin-chart-inspect">
          <label htmlFor={`${id}-day`}>Explorer les jours</label>
          <input
            id={`${id}-day`}
            type="range"
            min="0"
            max={series.length - 1}
            value={index}
            aria-valuetext={`${dayLabel(point.date)} : ${point[metric]} ${label.toLowerCase()}`}
            onChange={(event) => setSelected(Number(event.target.value))}
          />
          <output htmlFor={`${id}-day`}>
            {dayLabel(point.date)} <b>{number(point[metric])}</b>
          </output>
        </div>
      )}
      {total === 0 && (
        <p className="admin-chart-empty">
          Aucune{" "}
          {metric === "registrations"
            ? "inscription"
            : "réception de signalement"}{" "}
          sur cette période.
        </p>
      )}
      <details className="admin-data-details">
        <summary>Voir les données du graphique</summary>
        <div
          className="admin-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Données quotidiennes"
        >
          <table>
            <caption className="sr">
              Inscriptions et signalements reçus par jour UTC
            </caption>
            <thead>
              <tr>
                <th scope="col">Date UTC</th>
                <th scope="col">Inscriptions</th>
                <th scope="col">Signalements</th>
              </tr>
            </thead>
            <tbody>
              {series.map((item) => (
                <tr key={item.date}>
                  <th scope="row">{dayLabel(item.date)}</th>
                  <td>{number(item.registrations)}</td>
                  <td>{number(item.reports)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function GameStats({ data }: { data: Analytics }) {
  const known = Object.keys(adminGameNames).map(
    (game) =>
      data.games.find((item) => item.game === game) ?? {
        game,
        played: 0,
        won: 0,
        players: 0,
      },
  );
  const games = [
    ...known,
    ...data.games.filter((item) => !adminGameNames[item.game]),
  ].sort((a, b) => b.played - a.played || a.game.localeCompare(b.game));
  const max = Math.max(1, ...games.map((item) => item.played));
  return (
    <section
      className="admin-games admin-surface"
      aria-labelledby="admin-games-title"
    >
      <div className="admin-block-heading">
        <div>
          <h2 id="admin-games-title">Les jeux les plus joués</h2>
          <p>Participations de comptes · depuis l’ouverture</p>
        </div>
        <Ic name="cup" />
      </div>
      <ol className="admin-game-ranking">
        {games.map((item) => (
          <li key={item.game}>
            <div className="admin-game-label">
              <span>{adminGameNames[item.game] ?? item.game}</span>
              <strong>{number(item.played)}</strong>
            </div>
            <div className="admin-bar" aria-hidden="true">
              <span style={{ width: `${(item.played / max) * 100}%` }} />
            </div>
            <small>
              {number(item.players)} compte{item.players === 1 ? "" : "s"} ·{" "}
              {number(item.won)} victoire{item.won === 1 ? "" : "s"}
            </small>
          </li>
        ))}
      </ol>
      <p className="admin-footnote">
        Une partie à quatre comptes compte pour quatre participations. Les
        invités ne sont pas comptabilisés.
      </p>
    </section>
  );
}

export default function AdminDashboard({
  data,
  rooms,
  roomTable,
  navigate,
}: {
  data: Analytics;
  rooms: AdminRoom[];
  roomTable: (rooms: AdminRoom[]) => ReactNode;
  navigate: (section: "rooms" | "reports" | "users") => void;
}) {
  const online = rooms.reduce((sum, room) => sum + room.online, 0);
  const playing = rooms.filter((room) => room.phase === "playing").length;
  const reportsTotal =
    data.openReports + data.resolvedReports + data.dismissedReports;
  const difference = data.newUsers - data.previousNewUsers;
  return (
    <div className="admin-dashboard">
      <section className="admin-performance" aria-label="Chiffres clés">
        <div className="admin-performance-lead">
          <Ic name="play" />
          <span>Participations enregistrées</span>
          <strong>{number(data.participations)}</strong>
          <p>Depuis l’ouverture, tous jeux confondus.</p>
        </div>
        <dl className="admin-metrics">
          <div>
            <dt>Comptes joueurs</dt>
            <dd>{number(data.users)}</dd>
            <dd className="admin-metric-note">
              {number(data.newUsers)} inscription
              {data.newUsers === 1 ? "" : "s"} sur {data.days} jours
            </dd>
          </div>
          <div>
            <dt>Comptes ayant joué</dt>
            <dd>{number(data.activeAccounts)}</dd>
            <dd className="admin-metric-note">
              Au moins une partie terminée sur {data.days} jours
            </dd>
          </div>
          <div>
            <dt>Nouvelles inscriptions</dt>
            <dd>
              {difference > 0 ? "+" : difference < 0 ? "−" : ""}
              {number(Math.abs(difference))}
            </dd>
            <dd className="admin-metric-note">
              Écart avec les {data.days} jours précédents ; aujourd’hui en cours
            </dd>
          </div>
        </dl>
      </section>
      <div className="admin-dashboard-grid">
        <ActivityChart key={data.days} data={data} />
        <section
          className="admin-live admin-surface"
          aria-labelledby="admin-live-title"
        >
          <div className="admin-block-heading">
            <h2 id="admin-live-title">Dans les salons</h2>
            <span className="admin-live-label">Instantané</span>
          </div>
          <div className="admin-live-number">
            <strong>{number(online)}</strong>
            <span>
              présence{online === 1 ? "" : "s"} connectée
              {online === 1 ? "" : "s"}
            </span>
          </div>
          <dl className="admin-live-stats">
            <div>
              <dt>Salons ouverts</dt>
              <dd>{rooms.length}</dd>
            </div>
            <div>
              <dt>Parties en cours</dt>
              <dd>{playing}</dd>
            </div>
            <div>
              <dt>Salons publics</dt>
              <dd>{rooms.filter((room) => room.public).length}</dd>
            </div>
            <div>
              <dt>Comptes avec session valide</dt>
              <dd>{data.sessionAccounts}</dd>
            </div>
          </dl>
          <p className="admin-footnote">
            Les présences incluent les invités et spectateurs, comptés par
            salon. Une session valide ne signifie pas être connecté.
          </p>
          <button className="btn quiet" onClick={() => navigate("rooms")}>
            Explorer les salons <Ic name="enter" />
          </button>
        </section>
        <GameStats data={data} />
        <section
          className="admin-moderation admin-surface"
          aria-labelledby="admin-moderation-title"
        >
          <div className="admin-block-heading">
            <h2 id="admin-moderation-title">Modération</h2>
            <Ic name="flag" />
          </div>
          <h3>
            {data.openReports
              ? `${number(data.openReports)} signalement${data.openReports === 1 ? "" : "s"} à examiner`
              : "Aucun signalement en attente"}
          </h3>
          <p>
            {data.periodReports} reçu{data.periodReports === 1 ? "" : "s"} sur
            les {data.days} derniers jours.
          </p>
          <div className="admin-report-meter" aria-hidden="true">
            {reportsTotal > 0 && (
              <>
                <span style={{ flex: data.openReports }} />
                <span style={{ flex: data.resolvedReports }} />
                <span style={{ flex: data.dismissedReports }} />
              </>
            )}
          </div>
          <dl className="admin-report-stats">
            <div>
              <dt>À examiner</dt>
              <dd>{number(data.openReports)}</dd>
            </div>
            <div>
              <dt>Traités</dt>
              <dd>{number(data.resolvedReports)}</dd>
            </div>
            <div>
              <dt>Sans suite</dt>
              <dd>{number(data.dismissedReports)}</dd>
            </div>
          </dl>
          <p className="admin-footnote">
            Répartition de tous les signalements conservés.
          </p>
          <button className="btn primary" onClick={() => navigate("reports")}>
            Voir les signalements <Ic name="enter" />
          </button>
        </section>
      </div>
      <section
        className="admin-surface admin-room-preview"
        aria-labelledby="admin-rooms-title"
      >
        <div className="admin-block-heading">
          <div>
            <h2 id="admin-rooms-title">Salons ouverts</h2>
            <p>Les huit premiers salons de l’instantané.</p>
          </div>
          <button className="btn quiet small" onClick={() => navigate("rooms")}>
            Tout voir
          </button>
        </div>
        {rooms.length ? (
          roomTable(rooms.slice(0, 8))
        ) : (
          <div className="admin-empty">
            <Ic name="home" />
            <p>Aucun salon ouvert pour l’instant.</p>
            <span>Les salons apparaissent ici dès leur création.</span>
          </div>
        )}
      </section>
      <details className="admin-data-details admin-sources">
        <summary>Comment lire ces statistiques ?</summary>
        <p>
          Les inscriptions et signalements proviennent des données PostgreSQL,
          regroupées par jour UTC. La journée courante est incomplète. « Comptes
          ayant joué » compte les comptes dont la dernière partie terminée se
          situe dans la période. Les participations et victoires sont des totaux
          cumulés de comptes, sans historique quotidien et sans les invités. Les
          salons correspondent à la mémoire du serveur au dernier chargement ;
          leur contenu privé n’est jamais affiché.
        </p>
      </details>
    </div>
  );
}
