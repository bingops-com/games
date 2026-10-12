// Invoked by TestAdminBrowser against its isolated PostgreSQL and signed fake OIDC issuer.
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import axe from "axe-core";
const base = process.env.GAMES_URL;
if (!base || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base))
  throw new Error("This fixture requires the isolated loopback test server");
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM ??
    ["/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync),
  args: ["--no-sandbox"],
});
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
try {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: "fr-FR",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/admin/");
  await page.waitForURL(base + "/admin/connexion/");
  await page
    .getByRole("button", { name: "Se connecter avec Authentik" })
    .click();
  await page.waitForURL(base + "/admin/");
  await page
    .getByRole("heading", { name: "Vue d’ensemble", exact: true })
    .waitFor();
  await page
    .getByText("Aucun signalement en attente", { exact: true })
    .waitFor({ state: "hidden" });
  await page
    .getByRole("heading", { name: "1 signalement à examiner", exact: true })
    .waitFor();
  const storage = await page.evaluate(() =>
    JSON.stringify([localStorage, sessionStorage]),
  );
  check(
    !storage.includes("synthetic-access-token") && !storage.includes("csrf"),
    "OIDC credentials in browser storage",
  );
  mkdirSync("/tmp/games-admin-preview", { recursive: true });
  for (const width of [320, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of [
      "Vue d’ensemble",
      "Salons",
      "Joueurs",
      "Signalements",
      "Journal",
    ]) {
      const toggle = page.locator(".admin-menu");
      if (
        (await toggle.isVisible()) &&
        (await toggle.getAttribute("aria-expanded")) === "false"
      )
        await toggle.click();
      await page
        .locator("#admin-navigation")
        .getByRole("button", { name: new RegExp("^" + name) })
        .click();
      await page.getByRole("heading", { name, exact: true }).waitFor();
      await page
        .getByText("Chargement…", { exact: true })
        .waitFor({ state: "hidden" });
      await page.addScriptTag({ content: axe.source });
      const issues = await page.evaluate(async () =>
        (await axe.run()).violations.map((v) => ({
          id: v.id,
          targets: v.nodes.map((n) => n.target),
        })),
      );
      check(
        !issues.length,
        `admin ${name} ${width}: ${JSON.stringify(issues)}`,
      );
      check(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `admin overflow ${name} ${width}`,
      );
      if (name === "Vue d’ensemble")
        await page.screenshot({
          path: `/tmp/games-admin-preview/overview-${width}.png`,
        });
    }
  }
  await page
    .locator("#admin-navigation")
    .getByRole("button", { name: /^Signalements/ })
    .click();
  await page
    .getByRole("button", { name: "Marquer comme traité", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("textbox", { name: "Motif de l’action" })
    .fill("Synthetic review completed");
  await dialog
    .getByRole("button", { name: "Confirmer l’action", exact: true })
    .click();
  await dialog.waitFor({ state: "detached" });
  await page
    .getByText("Aucun signalement dans cette liste.", { exact: true })
    .waitFor();
  await page
    .locator("#admin-navigation")
    .getByRole("button", { name: "Joueurs", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Déconnecter BrowserPlayer", exact: true })
    .click();
  await dialog
    .getByRole("textbox", { name: "Motif de l’action" })
    .fill("Synthetic session revocation");
  await dialog
    .getByRole("button", { name: "Confirmer l’action", exact: true })
    .click();
  await dialog.waitFor({ state: "detached" });
  await page
    .locator("#admin-navigation")
    .getByRole("button", { name: "Journal", exact: true })
    .click();
  await page.getByText("Synthetic review completed", { exact: true }).waitFor();
  await page
    .getByText("Synthetic session revocation", { exact: true })
    .waitFor();
  check(errors.length === 0, `admin browser errors: ${errors.join(", ")}`);
  await page
    .getByRole("button", { name: "Se déconnecter", exact: true })
    .click();
  await page.waitForURL(base + "/admin/connexion/");
  check(
    (await context.request.get(base + "/api/admin/overview")).status() === 401,
    "admin session survived logout",
  );
  console.log(
    "Admin: real PKCE login, 10 accessible page states, report moderation, audited revocation and logout passed",
  );
} finally {
  await browser.close();
}
