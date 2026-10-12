"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Dialog, Ic } from "./ui";
import AdminDashboard, {
  adminGameNames,
  type Analytics,
} from "./AdminDashboard";
import type { IconName } from "../lib/icons";

type Room = {
  code: string;
  game: string;
  phase: string;
  public: boolean;
  players: number;
  online: number;
};
type User = { id: string; name: string; since: number; credits: number };
type Report = {
  id: number;
  createdAt: number;
  reporter: string;
  target: string;
  room: string;
  reason: string;
  detail: string;
  status: string;
};
type Audit = {
  id: number;
  createdAt: number;
  actor: string;
  action: string;
  target: string;
  reason: string;
};
type Session = { username: string; csrf: string; expiresAt: number };
type Overview = {
  counts: { users: number; openReports: number };
  rooms: Room[];
};
type Section = "overview" | "rooms" | "users" | "reports" | "audit";
type Action =
  | { kind: "report"; report: Report; status: "resolved" | "dismissed" }
  | { kind: "revoke"; user: User };
const sections: [Section, string][] = [
  ["overview", "Vue d’ensemble"],
  ["rooms", "Salons"],
  ["users", "Joueurs"],
  ["reports", "Signalements"],
  ["audit", "Journal"],
];
const date = (timestamp: number) =>
  new Date(timestamp).toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
const gameNames = adminGameNames;
const sectionIcons: Record<Section, IconName> = {
  overview: "sliders",
  rooms: "home",
  users: "friends",
  reports: "flag",
  audit: "book",
};

export default function AdminPanel() {
  const [session, setSession] = useState<Session | null>(null);
  const [section, setSection] = useState<Section>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [days, setDays] = useState(30);
  const [updatedAt, setUpdatedAt] = useState(0);
  const requestGeneration = useRef(0);
  const mainContent = useRef<HTMLElement>(null);
  const [reportsMore, setReportsMore] = useState(false);
  const [auditMore, setAuditMore] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [userNext, setUserNext] = useState("");
  const [status, setStatus] = useState("open");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<Action | null>(null);
  const [menu, setMenu] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  const api = useCallback(
    async <T,>(path: string, body?: object): Promise<T> => {
      const response = await fetch("/api/admin/" + path, {
        cache: "no-store",
        credentials: "same-origin",
        headers: body
          ? {
              "Content-Type": "application/json",
              "X-Admin-CSRF": session?.csrf ?? "",
            }
          : {},
        ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
      });
      if (response.status === 401 || response.status === 403) {
        window.location.replace("/admin/connexion/?erreur=acces");
        throw new Error("Session administrateur terminée.");
      }
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Impossible de charger ces données.");
      return result as T;
    },
    [session?.csrf],
  );

  useEffect(() => {
    let stale = false;
    void fetch("/api/admin/me", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          window.location.replace("/admin/connexion/");
          return;
        }
        if (!response.ok)
          throw new Error(
            "La vérification Authentik est indisponible. Réessayez.",
          );
        const data = (await response.json()) as Session;
        if (!stale) setSession(data);
      })
      .catch((err) => {
        if (!stale) {
          setError((err as Error).message);
          setLoading(false);
        }
      });
    return () => {
      stale = true;
    };
  }, []);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(
      () => window.location.replace("/admin/connexion/"),
      Math.max(0, session.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [session]);
  const reload = useCallback(async () => {
    if (!session) return;
    const generation = ++requestGeneration.current;
    setLoading(true);
    setError("");
    try {
      if (section === "overview" || section === "rooms") {
        const [nextOverview, nextAnalytics] = await Promise.all([
          api<Overview>("overview"),
          section === "overview"
            ? api<Analytics>("analytics?days=" + days)
            : Promise.resolve(null),
        ]);
        if (generation !== requestGeneration.current) return;
        setOverview(nextOverview);
        if (nextAnalytics) setAnalytics(nextAnalytics);
      }
      if (section === "users") {
        const data = await api<{ users: User[]; next: string }>(
          "users?q=" + encodeURIComponent(query),
        );
        if (generation !== requestGeneration.current) return;
        setUsers(data.users);
        setUserNext(data.next);
      }
      if (section === "reports") {
        const data = await api<{ reports: Report[] }>(
          "reports?status=" + status,
        );
        if (generation !== requestGeneration.current) return;
        setReports(data.reports);
        setReportsMore(data.reports.length === 50);
      }
      if (section === "audit") {
        const data = await api<{ entries: Audit[] }>("audit");
        if (generation !== requestGeneration.current) return;
        setAudit(data.entries);
        setAuditMore(data.entries.length === 50);
      }
      setUpdatedAt(Date.now());
    } catch (err) {
      if (generation === requestGeneration.current)
        setError((err as Error).message);
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [session, section, query, status, days, api]);
  useEffect(() => {
    void reload();
    return () => {
      requestGeneration.current++;
    };
  }, [reload]);
  useEffect(() => {
    if (!menu) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) {
        setMenu(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [menu]);
  const more = async () => {
    if (busy || loading) return;
    const generation = requestGeneration.current;
    setBusy(true);
    setError("");
    try {
      if (section === "users") {
        const data = await api<{ users: User[]; next: string }>(
          `users?q=${encodeURIComponent(query)}&before=${encodeURIComponent(userNext)}`,
        );
        if (generation !== requestGeneration.current) return;
        setUsers((rows) => [...rows, ...data.users]);
        setUserNext(data.next);
      }
      if (section === "reports") {
        const data = await api<{ reports: Report[] }>(
          `reports?status=${status}&before=${reports.at(-1)?.id}`,
        );
        if (generation !== requestGeneration.current) return;
        setReports((rows) => [...rows, ...data.reports]);
        setReportsMore(data.reports.length === 50);
      }
      if (section === "audit") {
        const data = await api<{ entries: Audit[] }>(
          `audit?before=${audit.at(-1)?.id}`,
        );
        if (generation !== requestGeneration.current) return;
        setAudit((rows) => [...rows, ...data.entries]);
        setAuditMore(data.entries.length === 50);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!action || busy) return;
    setBusy(true);
    setError("");
    const reason = String(
      new FormData(event.currentTarget).get("reason"),
    ).trim();
    try {
      await api(
        action.kind === "report"
          ? `reports/${action.report.id}`
          : `users/${action.user.id}/revoke`,
        {
          reason,
          ...(action.kind === "report" ? { status: action.status } : {}),
        },
      );
      setAction(null);
      setNotice("Action enregistrée dans le journal.");
      await reload();
      setOverview(await api<Overview>("overview"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    try {
      await api("logout", {});
      window.location.assign("/admin/connexion/");
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const navigate = (next: Section) => {
    setSection(next);
    setMenu(false);
    setNotice("");
    setAction(null);
    mainContent.current?.focus();
  };
  const roomTable = (rooms: Room[]) => (
    <div
      className="admin-table-wrap"
      tabIndex={0}
      role="region"
      aria-label="Liste des salons ouverts"
    >
      <table>
        <caption className="sr">Salons ouverts</caption>
        <thead>
          <tr>
            <th scope="col">Salon</th>
            <th scope="col">Jeu</th>
            <th scope="col">État</th>
            <th scope="col">Joueurs</th>
            <th scope="col">Visibilité</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((room) => (
            <tr key={room.code}>
              <th scope="row">
                <span className="admin-room-code">{room.code}</span>
              </th>
              <td>{gameNames[room.game] ?? room.game}</td>
              <td>
                <span
                  className={`admin-state ${room.phase === "playing" ? "is-playing" : ""}`}
                >
                  {room.phase === "playing"
                    ? "En partie"
                    : room.phase === "over"
                      ? "Terminée"
                      : "En attente"}
                </span>
              </td>
              <td>
                {room.online} en ligne / {room.players}
              </td>
              <td>{room.public ? "Public" : "Sur invitation"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="admin-app">
      <a className="skip-link" href="#admin-content">
        Aller au contenu
      </a>
      <aside className={`admin-side${menu ? " is-open" : ""}`}>
        <Link className="admin-brand" href="/">
          <img src="/brand/logo.webp" alt="" width={40} height={40} />
          <span>
            lab.bingo <strong>games</strong>
          </span>
        </Link>
        <button
          ref={menuButton}
          className="admin-menu"
          type="button"
          aria-label={menu ? "Fermer le menu" : "Ouvrir le menu"}
          aria-expanded={menu}
          aria-controls="admin-navigation"
          onClick={() => setMenu((open) => !open)}
        >
          ☰
        </button>
        <p className="admin-side-label">Administration</p>
        <nav id="admin-navigation" aria-label="Administration">
          {sections.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-current={section === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <span>
                <Ic name={sectionIcons[id]} />
                {label}
              </span>
              {id === "reports" && !!overview?.counts.openReports && (
                <span className="pill count">
                  {overview.counts.openReports}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="admin-access">
          <Ic name="lock" />
          <div>
            <b>Accès restreint</b>
            <span>Administrateur Authentik</span>
          </div>
        </div>
        <Link className="admin-back" href="/">
          <Ic name="leave" />
          Revenir aux jeux
        </Link>
      </aside>
      <div className="admin-main">
        <header className="admin-header">
          <span className="admin-location">
            Games <span>/</span> Administration
          </span>
          <div className="admin-account">
            <span>
              <Ic name="lock" />
              {session
                ? `${session.username} · Authentik`
                : "Vérification de l’accès…"}
            </span>
            {session && (
              <button className="btn quiet small" onClick={logout}>
                Se déconnecter
              </button>
            )}
          </div>
        </header>
        <main id="admin-content" ref={mainContent} tabIndex={-1}>
          <div className="admin-heading">
            <div>
              <h1>{sections.find(([id]) => id === section)?.[1]}</h1>
              <p>
                {section === "overview"
                  ? "L’activité de Games, des premières inscriptions aux salons en cours."
                  : section === "rooms"
                    ? "Les salons ouverts, sans messages privés ni secrets de partie."
                    : section === "users"
                      ? "Les comptes joueurs et leurs sessions."
                      : section === "reports"
                        ? "Examinez les faits avant de classer un signalement."
                        : "Les actions administrateur, avec leur motif."}
              </p>
            </div>
            <div className="admin-toolbar">
              {section === "overview" && (
                <div className="admin-period">
                  <label htmlFor="admin-period-select">Période</label>
                  <select
                    id="admin-period-select"
                    value={days}
                    disabled={loading}
                    onChange={(event) => setDays(Number(event.target.value))}
                  >
                    <option value={7}>7 jours</option>
                    <option value={30}>30 jours</option>
                    <option value={90}>90 jours</option>
                  </select>
                </div>
              )}
              <button
                className="btn quiet small"
                disabled={!session || loading || busy}
                onClick={() => void reload()}
              >
                <Ic name="again" />
                Actualiser
              </button>
            </div>
          </div>
          {updatedAt > 0 && (
            <p className="admin-updated">
              Dernier chargement à{" "}
              {new Date(updatedAt).toLocaleTimeString("fr-FR", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
              {error
                ? " · données précédentes, actualisation en échec"
                : " · actualisation manuelle"}
            </p>
          )}
          {error && (
            <p className="notice" role="alert">
              {error}
              {!session && (
                <a href="/admin/connexion/"> Revenir à la connexion</a>
              )}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          {loading && <p role="status">Chargement…</p>}
          {session && (
            <>
              {section === "overview" && overview && analytics && (
                <AdminDashboard
                  data={analytics}
                  rooms={overview.rooms}
                  roomTable={roomTable}
                  navigate={navigate}
                />
              )}
              {section === "rooms" &&
                overview &&
                (overview.rooms.length ? (
                  roomTable(overview.rooms)
                ) : (
                  <p>Aucun salon ouvert pour l’instant.</p>
                ))}
              {section === "users" && (
                <>
                  <form
                    className="admin-search"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setQuery(search.trim());
                    }}
                  >
                    <label>
                      Rechercher un pseudo
                      <input
                        value={search}
                        maxLength={16}
                        onChange={(e) => setSearch(e.target.value)}
                        type="search"
                      />
                    </label>
                    <button className="btn primary">Rechercher</button>
                  </form>
                  <ul className="admin-users">
                    {users.map((user) => (
                      <li key={user.id}>
                        <div>
                          <b>{user.name}</b>
                          <small>
                            Créé le {date(user.since)} · {user.credits} crédits
                            fictifs
                          </small>
                        </div>
                        <button
                          className="btn quiet small"
                          onClick={() => setAction({ kind: "revoke", user })}
                        >
                          Déconnecter {user.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {!loading && !users.length && (
                    <p>Aucun joueur correspondant.</p>
                  )}
                  {userNext && (
                    <button
                      className="btn quiet"
                      disabled={busy || loading}
                      onClick={() => void more()}
                    >
                      Afficher la suite
                    </button>
                  )}
                </>
              )}
              {section === "reports" && (
                <>
                  <label className="admin-filter">
                    Afficher
                    <select
                      value={status}
                      onChange={(event) => setStatus(event.target.value)}
                    >
                      <option value="open">À examiner</option>
                      <option value="resolved">Traités</option>
                      <option value="dismissed">Classés sans suite</option>
                    </select>
                  </label>
                  <ul className="admin-reports">
                    {reports.map((report) => (
                      <li key={report.id}>
                        <div className="admin-report-title">
                          <h2>Signalement #{report.id}</h2>
                          <time
                            dateTime={new Date(report.createdAt).toISOString()}
                          >
                            {date(report.createdAt)}
                          </time>
                        </div>
                        <p>
                          <b>{report.reason}</b> · Salon {report.room}
                        </p>
                        <dl>
                          <div>
                            <dt>Émetteur</dt>
                            <dd>{report.reporter}</dd>
                          </div>
                          <div>
                            <dt>Joueur signalé</dt>
                            <dd>{report.target}</dd>
                          </div>
                        </dl>
                        <details>
                          <summary>Voir le contexte transmis</summary>
                          <pre>{report.detail}</pre>
                        </details>
                        {report.status === "open" && (
                          <div className="row-actions">
                            <button
                              className="btn primary small"
                              onClick={() =>
                                setAction({
                                  kind: "report",
                                  report,
                                  status: "resolved",
                                })
                              }
                            >
                              Marquer comme traité
                            </button>
                            <button
                              className="btn quiet small"
                              onClick={() =>
                                setAction({
                                  kind: "report",
                                  report,
                                  status: "dismissed",
                                })
                              }
                            >
                              Classer sans suite
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                  {!loading && !reports.length && (
                    <p>Aucun signalement dans cette liste.</p>
                  )}
                  {reportsMore && (
                    <button
                      className="btn quiet"
                      disabled={busy || loading}
                      onClick={() => void more()}
                    >
                      Afficher la suite
                    </button>
                  )}
                </>
              )}
              {section === "audit" && (
                <>
                  <ol className="admin-audit">
                    {audit.map((entry) => (
                      <li key={entry.id}>
                        <time
                          dateTime={new Date(entry.createdAt).toISOString()}
                        >
                          {date(entry.createdAt)}
                        </time>
                        <div>
                          <b>
                            {entry.action === "sessions.revoked"
                              ? "Sessions révoquées"
                              : entry.action === "report.resolved"
                                ? "Signalement traité"
                                : "Signalement classé"}
                          </b>
                          <p>
                            {entry.target} · {entry.actor}
                          </p>
                          <p>{entry.reason}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                  {!loading && !audit.length && (
                    <p>Aucune action administrateur enregistrée.</p>
                  )}
                  {auditMore && (
                    <button
                      className="btn quiet"
                      disabled={busy || loading}
                      onClick={() => void more()}
                    >
                      Afficher la suite
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </main>
      </div>
      {action && (
        <Dialog
          title={
            action.kind === "report"
              ? `Traiter le signalement #${action.report.id}`
              : `Déconnecter ${action.user.name} ?`
          }
          onClose={() => setAction(null)}
          onSubmit={submit}
        >
          <p>
            {action.kind === "report"
              ? "Votre décision et votre motif seront conservés dans le journal."
              : "Toutes les sessions de ce joueur seront fermées, y compris ses connexions aux salons. Il pourra se reconnecter avec ses identifiants. Cette action ne bannit pas le compte."}
          </p>
          <label>
            Motif de l’action
            <textarea
              name="reason"
              required
              minLength={5}
              maxLength={500}
              rows={4}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <button className="btn primary" disabled={busy}>
            Confirmer l’action
          </button>
          <button
            type="button"
            className="btn quiet"
            onClick={() => setAction(null)}
          >
            Annuler
          </button>
        </Dialog>
      )}
    </div>
  );
}
