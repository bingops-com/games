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
  const realStats = await (
    await context.request.get(base + "/api/admin/analytics?days=30")
  ).json();
  check(
    realStats.participations === 4 &&
      realStats.activeAccounts === 1 &&
      realStats.newUsers === 1,
    "fixture game statistics not read from PostgreSQL",
  );
  for (const days of [7, 90, 30]) {
    await page
      .getByLabel("Période", { exact: true })
      .selectOption(String(days));
    await page
      .getByText("Chargement…", { exact: true })
      .waitFor({ state: "hidden" });
    await page
      .getByText(`Par jour, sur ${days} jours · dates UTC`, { exact: true })
      .waitFor();
    const slider = page.getByRole("slider", { name: "Explorer les jours" });
    await slider.focus();
    await page.keyboard.press("Home");
    check(
      (await slider.inputValue()) === "0",
      "chart cannot be explored with keyboard",
    );
    await page.keyboard.press("End");
    check(
      (await slider.inputValue()) === String(days - 1),
      "chart last day unreachable",
    );
  }
  await page.getByRole("button", { name: "Signalements", exact: true }).click();
  check(
    (await page
      .getByRole("img", { name: /Signalements reçus sur 30 jours/ })
      .count()) === 1,
    "chart metric not switched",
  );
  await page.getByRole("button", { name: "Inscriptions", exact: true }).click();
  await page
    .getByText("Voir les données du graphique", { exact: true })
    .click();
  check(
    (await page
      .getByRole("region", { name: "Données quotidiennes" })
      .locator("tbody tr")
      .count()) === 30,
    "chart data table incomplete",
  );
  await page
    .getByText("Voir les données du graphique", { exact: true })
    .click();
  await page.route("**/api/admin/analytics?*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Synthetic analytics outage" }),
    }),
  );
  await page.getByRole("button", { name: "Actualiser", exact: true }).click();
  await page
    .getByRole("alert")
    .getByText("Synthetic analytics outage", { exact: true })
    .waitFor();
  await page.getByText(/données précédentes, actualisation en échec/).waitFor();
  await page.unroute("**/api/admin/analytics?*");
  await page.getByRole("button", { name: "Actualiser", exact: true }).click();
  await page
    .getByText("Chargement…", { exact: true })
    .waitFor({ state: "hidden" });
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme });
    for (const [width, height] of [
      [320, 700],
      [390, 844],
      [844, 390],
      [1280, 620],
      [1366, 900],
    ]) {
      await page.setViewportSize({ width, height });
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
            path: `/tmp/games-admin-preview/overview-${colorScheme}-${width}.png`,
            fullPage: true,
          });
      }
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
    "Admin: real PKCE login, PostgreSQL charts, 7/30/90 days, keyboard exploration, outage handling, 50 accessible states, moderation, audited revocation and logout passed",
  );
} finally {
  await browser.close();
}
