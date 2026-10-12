// Run only against a development instance: this creates synthetic accounts and rooms.
import { existsSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
import axe from "axe-core";

const base = process.env.GAMES_URL ?? "http://localhost:3778";
const executablePath =
  process.env.CHROMIUM ??
  [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].find(existsSync);
const browser = await chromium.launch({
  executablePath,
  args: ["--no-sandbox"],
});
const findings = [];
let checks = 0;
const check = (ok, text) => {
  if (!ok) throw new Error(text);
};
async function audit(page, label) {
  await page.evaluate(() => document.fonts.ready);
  await page.addScriptTag({ content: axe.source });
  const issues = await page.evaluate(async () =>
    (
      await axe.run(document, {
        runOnly: {
          type: "tag",
          values: [
            "wcag2a",
            "wcag2aa",
            "wcag21aa",
            "wcag22aa",
            "best-practice",
          ],
        },
      })
    ).violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth + 1,
  );
  if (overflow) issues.push({ id: "horizontal-overflow", nodes: [] });
  checks++;
  if (issues.length) findings.push({ label, issues });
  console.log(
    `${issues.length ? "FAIL" : "ok"} ${label}: ${issues.map((v) => v.id).join(", ")}`,
  );
}
async function menu(page) {
  const toggle = page.locator(".menu-toggle");
  if (
    (await toggle.isVisible()) &&
    (await toggle.getAttribute("aria-expanded")) === "false"
  )
    await toggle.click();
}
async function dialog(page, label, open, method = "button") {
  await open();
  const box = page.locator("dialog[open]").last();
  await box.waitFor();
  await audit(page, label);
  await box
    .getByRole("button", { name: "Fermer la fenêtre", exact: true })
    .focus();
  await page.keyboard.press("Shift+Tab");
  check(
    await box.evaluate((el) => el.contains(document.activeElement)),
    `${label}: focus sorti de la modale`,
  );
  for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
  check(
    await box.evaluate((el) => el.contains(document.activeElement)),
    `${label}: Tab quitte la modale`,
  );
  if (method === "escape") await page.keyboard.press("Escape");
  else if (method === "backdrop") await page.mouse.click(2, 2);
  else await box.getByRole("button", { name: "Fermer la fenêtre", exact: true }).click();
  await box.waitFor({ state: "detached" });
  check(
    !(await page.locator("dialog[open]").count()),
    `${label}: modale non fermée`,
  );
}

try {
  for (const [viewport, colorScheme] of [
    [{ width: 320, height: 700 }, "light"],
    [{ width: 390, height: 844 }, "light"],
    [{ width: 844, height: 390 }, "light"],
    [{ width: 1366, height: 900 }, "light"],
    [{ width: 320, height: 700 }, "dark"],
    [{ width: 1366, height: 900 }, "dark"],
  ]) {
    const context = await browser.newContext({
      viewport,
      colorScheme,
      locale: "fr-FR",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const size = `${viewport.width}x${viewport.height} ${colorScheme}`;
    await page.goto(base);
    await page.getByRole("button", { name: /Créer un salon/ }).waitFor();
    for (const path of [
      "/",
      "/amis/",
      "/objectifs/",
      "/magasin/",
      "/compte/",
      "/reinitialiser/",
      "/u/?n=Introuvable",
      "/uikit/",
      "/introuvable/",
    ]) {
      await page.goto(base + path);
      await page.locator("#view").waitFor();
      await audit(page, `${size} invité ${path}`);
    }
    await page.goto(base);
    await dialog(page, `${size} connexion`, async () => {
      await menu(page);
      await page
        .locator(".who")
        .getByRole("button", { name: "Se connecter", exact: true })
        .click();
    });
    await dialog(page, `${size} inscription`, async () => {
      await menu(page);
      await page
        .locator(".who")
        .getByRole("button", { name: "Créer un compte", exact: true })
        .click();
    });
    await dialog(page, `${size} mot de passe oublié`, async () => {
      await menu(page);
      await page.locator(".who").getByRole("button", { name: "Se connecter", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Mot de passe oublié ?", exact: true }).click();
    }, "escape");
    await dialog(page, `${size} avatar`, async () => {
      await page
        .getByRole("button", { name: "Modifier mon avatar", exact: true })
        .click();
    }, "backdrop");
    await dialog(page, `${size} parties publiques`, async () => {
      await page
        .getByRole("button", { name: "Partie publique", exact: true })
        .click();
    });
    const name = `e2e_${Math.random().toString(36).slice(2, 10)}`;
    const registration = await page.evaluate(
      async (name) =>
        (
          await fetch("/api/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name,
              password: "synthetic audit password",
            }),
          })
        ).status,
      name,
    );
    check(registration === 200, "synthetic registration failed");
    for (const path of [
      "/",
      "/amis/",
      "/objectifs/",
      "/magasin/",
      "/compte/",
      `/u/?n=${name}`,
    ]) {
      await page.goto(base + path);
      await page.locator(".who-name").waitFor({ state: "attached" });
      await audit(page, `${size} compte ${path.split("?")[0]}`);
    }
    await context.close();
  }
  // Every game's lobby, rules and active stage, plus quitting with a collapsed sidebar.
  for (const game of [
    "terre",
    "pavillons",
    "meche",
    "poudriere",
    "skrib",
    "gartik",
  ]) {
    const contexts = [];
    const players = [];
    try {
      for (let i = 0; i < 4; i++) {
        const ctx = await browser.newContext({
          viewport: { width: 390, height: 844 },
          locale: "fr-FR",
          reducedMotion: "reduce",
        });
        contexts.push(ctx);
        players.push(await ctx.newPage());
      }
      const host = players[0];
      await host.goto(base);
      const result = await host.evaluate(
        async (game) =>
          await (
            await fetch("/api/tables", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ game }),
            })
          ).json(),
        game,
      );
      check(typeof result.code === "string", `unknown game ${game}`);
      for (const p of players) {
        await p.goto(`${base}/t/?code=${result.code}`);
        await p.locator(".lobby").waitFor();
      }
      await audit(host, `390 lobby ${game}`);
      await dialog(host, `390 règles ${game}`, async () =>
        host
          .getByRole("button", { name: "Lire les règles", exact: true })
          .click(),
      );
      await host
        .getByRole("button", { name: "Lancer la partie", exact: true })
        .click();
      await host.locator(".guide").waitFor();
      await audit(host, `390 partie ${game}`);
      await host.setViewportSize({ width: 1366, height: 900 });
      await audit(host, `1366 partie ${game}`);
      if (game === "skrib" || game === "gartik") {
        let artist = host;
        if (game === "skrib") {
          for (const p of players) {
            if (await p.locator(".sk-choose button").first().isVisible()) {
              artist = p;
              await p.locator(".sk-choose button").first().click();
              break;
            }
          }
        } else {
          for (const p of players) {
            await p.getByRole("textbox", { name: "Votre phrase" }).fill("Un chat sur un bateau");
            await p.getByRole("button", { name: "Terminé", exact: true }).click();
          }
        }
        const sheet = artist.locator("canvas.live");
        await sheet.waitFor();
        await artist.setViewportSize({ width: 390, height: 844 });
        await audit(artist, `390 dessin ${game}`);
        await sheet.focus();
        await artist.keyboard.press("Space");
        await artist.keyboard.press("ArrowRight");
        await artist.keyboard.press("Space");
        check(await sheet.evaluate((el) => el.getContext("2d").getImageData(505, 375, 1, 1).data[0] < 100), `${game}: le clavier ne dessine pas`);
        await artist.getByRole("button", { name: "Annuler le trait", exact: true }).click();
        check(await sheet.evaluate((el) => el.getContext("2d").getImageData(505, 375, 1, 1).data[0] === 255), `${game}: annulation du dessin impossible`);
        await artist.setViewportSize({ width: 1366, height: 900 });
        await audit(artist, `1366 dessin ${game}`);
      }
      await host
        .getByRole("button", { name: "Pleine fenêtre", exact: true })
        .click();
      await host
        .getByRole("button", { name: "Quitter le salon", exact: true })
        .click();
      await host.waitForURL(base + "/");
      const guest = players[1];
      await guest
        .getByRole("button", { name: "Quitter le salon", exact: true })
        .click();
      await guest.waitForURL(base + "/");
    } finally {
      for (const ctx of contexts) await ctx.close();
    }
  }
} finally {
  await browser.close();
  writeFileSync(
    process.env.GAMES_A11Y_REPORT ?? "/tmp/games-accessibility-report.json",
    JSON.stringify({ checks, findings }, null, 2),
  );
}
console.log(
  `${checks} accessibility states checked, ${findings.length} failing states`,
);
process.exitCode = findings.length ? 1 : 0;
