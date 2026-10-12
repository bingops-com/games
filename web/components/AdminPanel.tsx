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
const gameNames: Record<string, string> = {
  terre: "Ono",
  pavillons: "Codenoms",
  meche: "BoomParty",
  poudriere: "Bombermat",
  skrib: "Skribouille",
  gartik: "Gartik Phone",
};

export default function AdminPanel() {
  const [session, setSession] = useState<Session | null>(null);
  const [section, setSection] = useState<Section>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
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
    setLoading(true);
    setError("");
    try {
      if (section === "overview" || section === "rooms")
        setOverview(await api<Overview>("overview"));
      if (section === "users") {
        const data = await api<{ users: User[]; next: string }>(
          "users?q=" + encodeURIComponent(query),
        );
        setUsers(data.users);
        setUserNext(data.next);
      }
      if (section === "reports")
        setReports(
          (await api<{ reports: Report[] }>("reports?status=" + status))
            .reports,
        );
      if (section === "audit")
        setAudit((await api<{ entries: Audit[] }>("audit")).entries);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [session, section, query, status, api]);
  useEffect(() => {
    void reload();
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
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (section === "users") {
        const data = await api<{ users: User[]; next: string }>(
          `users?q=${encodeURIComponent(query)}&before=${encodeURIComponent(userNext)}`,
        );
        setUsers((rows) => [...rows, ...data.users]);
        setUserNext(data.next);
      }
      if (section === "reports") {
        const data = await api<{ reports: Report[] }>(
          `reports?status=${status}&before=${reports.at(-1)?.id}`,
        );
        setReports((rows) => [...rows, ...data.reports]);
      }
      if (section === "audit") {
        const data = await api<{ entries: Audit[] }>(
          `audit?before=${audit.at(-1)?.id}`,
        );
        setAudit((rows) => [...rows, ...data.entries]);
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
  const roomTable = (rooms: Room[]) => (
    <div className="admin-table-wrap" tabIndex={0} role="region" aria-label="Salons ouverts">
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
              <th scope="row">{room.code}</th>
              <td>{gameNames[room.game] ?? room.game}</td>
              <td>
                {room.phase === "playing"
                  ? "En partie"
                  : room.phase === "over"
                    ? "Terminée"
                    : "En attente"}
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
          lab.bingo <span>games</span>
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
        <p>Administration</p>
        <nav id="admin-navigation" aria-label="Administration">
          {sections.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-current={section === id ? "page" : undefined}
              onClick={() => {
                setSection(id);
                setMenu(false);
                setNotice("");
                setAction(null);
              }}
            >
              {label}
              {id === "reports" && !!overview?.counts.openReports && (
                <span className="pill count">
                  {overview.counts.openReports}
                </span>
              )}
            </button>
          ))}
        </nav>
        <Link className="admin-back" href="/">
          Revenir aux jeux
        </Link>
      </aside>
      <div className="admin-main">
        <header className="admin-header">
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
        </header>
        <main id="admin-content" tabIndex={-1}>
          <div className="admin-heading">
            <div>
              <h1>{sections.find(([id]) => id === section)?.[1]}</h1>
              <p>
                {section === "overview"
                  ? "Gardez un œil sur les parties et les situations à examiner."
                  : section === "rooms"
                    ? "Les salons ouverts, sans messages privés ni secrets de partie."
                    : section === "users"
                      ? "Les comptes joueurs et leurs sessions."
                      : section === "reports"
                        ? "Examinez les faits avant de classer un signalement."
                        : "Les actions administrateur, avec leur motif."}
              </p>
            </div>
            <button
              className="btn quiet small"
              disabled={!session || loading}
              onClick={() => void reload()}
            >
              <Ic name="again" />
              Actualiser
            </button>
          </div>
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
              {section === "overview" && overview && (
                <>
                  <dl className="admin-summary">
                    <div>
                      <dt>Salons ouverts</dt>
                      <dd>{overview.rooms.length}</dd>
                    </div>
                    <div>
                      <dt>Joueurs en ligne dans les salons</dt>
                      <dd>
                        {overview.rooms.reduce(
                          (sum, room) => sum + room.online,
                          0,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Comptes joueurs</dt>
                      <dd>{overview.counts.users}</dd>
                    </div>
                  </dl>
                  <section className="admin-priority">
                    <div>
                      <h2>
                        {overview.counts.openReports
                          ? `${overview.counts.openReports} signalement${overview.counts.openReports > 1 ? "s" : ""} à examiner`
                          : "Aucun signalement en attente"}
                      </h2>
                      <p>
                        {overview.counts.openReports
                          ? "Consultez le contexte et consignez votre décision."
                          : "Les nouveaux signalements apparaîtront ici."}
                      </p>
                    </div>
                    <button
                      className="btn primary"
                      onClick={() => setSection("reports")}
                    >
                      Voir les signalements
                    </button>
                  </section>
                  <h2>Salons ouverts</h2>
                  {overview.rooms.length ? (
                    roomTable(overview.rooms.slice(0, 8))
                  ) : (
                    <p>Aucun salon ouvert pour l’instant.</p>
                  )}
                </>
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
                      disabled={busy}
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
                  {reports.length > 0 && reports.length % 50 === 0 && (
                    <button
                      className="btn quiet"
                      disabled={busy}
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
                  {audit.length > 0 && audit.length % 50 === 0 && (
                    <button
                      className="btn quiet"
                      disabled={busy}
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
