"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Ic } from "./ui";

export default function AdminLogin() {
  const [error, setError] = useState("");
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("erreur");
    if (code)
      setError(
        code === "indisponible"
          ? "Authentik est indisponible. Réessayez dans un instant."
          : code === "acces"
            ? "Ce compte n’est pas autorisé à administrer Games."
            : "La connexion a expiré ou n’a pas pu être vérifiée. Recommencez.",
      );
  }, []);
  return (
    <main className="admin-login">
      <Link href="/" className="admin-brand">
        lab.bingo <span>games</span>
      </Link>
      <section aria-labelledby="admin-login-title">
        <Ic name="lock" />
        <h1 id="admin-login-title">Administration Games</h1>
        <p>
          Salons, joueurs et signalements, réunis dans un espace réservé à
          l’administrateur du lab.
        </p>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        <form action="/api/admin/login" method="post">
          <button className="btn primary">Se connecter avec Authentik</button>
        </form>
        <p className="hint">
          Utilisez votre compte administrateur Authentik. La session dure au
          maximum 15 minutes.
        </p>
      </section>
      <Link href="/">Revenir aux jeux</Link>
    </main>
  );
}
