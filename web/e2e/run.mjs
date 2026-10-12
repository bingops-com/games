// Les scénarios de bout en bout : de vrais navigateurs jouent contre un serveur qui tourne
// (make run, ou GAMES_URL). Chacun vérifie un parcours entier, vu par les joueurs.
//
//   npm run e2e              tous les scénarios
//   npm run e2e -- ono amis  ceux dont le nom contient « ono » ou « amis »
//
// Ils créent des comptes « e2e_… » : à lancer contre une base de développement.
import { existsSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.GAMES_URL ?? 'http://localhost:3778';
const SYSTEM = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? SYSTEM, args: ['--no-sandbox'] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = () => Math.random().toString(36).slice(2, 7);
function check(ok, what) {
  if (!ok) throw new Error(what);
}

// Une page : un joueur. Les erreurs de la page font échouer le scénario.
async function player({ width = 1366, height = 768, account = '' } = {}) {
  const page = await (await browser.newContext({ viewport: { width, height }, locale: 'fr-FR' })).newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  await page.goto(BASE + '/');
  await page.getByRole('button', { name: /Créer un salon/ }).waitFor();
  if (account) {
    const status = await page.evaluate(async (n) => (await fetch('/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: n, password: 'long enough' }) })).status, account);
    check(status === 200, `inscription de ${account} : ${status}`);
    await page.reload();
    await page.locator('.who-name').waitFor({ state: 'attached' });
  }
  return page;
}

// Un salon sur un jeu, avec n joueurs ; le premier est l'hôte.
async function room(game, n, size = {}) {
  const host = await player(size);
  await host.getByRole('button', { name: /Créer un salon/ }).click();
  await host.waitForURL(/\/t\//);
  await host.locator('.lobby').waitFor();
  const code = new URL(host.url()).searchParams.get('code');
  const players = [host];
  for (let i = 1; i < n; i++) {
    const p = await player(size);
    await p.goto(`${BASE}/t/?code=${code}`);
    await p.locator('.lobby').waitFor();
    players.push(p);
  }
  await host.locator('.pick-game', { hasText: game }).click();
  await host.locator('.lobby-what h1', { hasText: game }).waitFor();
  return { code, players };
}
const start = async (host) => {
  await host.getByRole('button', { name: /Lancer la partie/ }).click();
  await host.locator('.guide').waitFor();
};
const openMenu = async (page) => {
  const toggle = page.locator('.menu-toggle');
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
};

const scenarios = {
  // Le code reste entier dans la bande ; le menu mobile garde navigation et compte accessibles.
  async navigation() {
    const { code, players: [p] } = await room('Ono', 1);
    const fitsSidebar = () => p.locator('.room-code').evaluate((button) => {
      const code = button.querySelector('strong');
      const side = button.closest('aside').getBoundingClientRect();
      const box = button.getBoundingClientRect();
      const text = code.getBoundingClientRect();
      return text.left >= box.left && text.right <= box.right && box.right <= side.right && code.scrollWidth <= code.clientWidth + 1;
    });
    check(await p.locator('.room-code strong').innerText() === code, 'code de salon incomplet');
    check(await fitsSidebar(), 'code hors de la sidebar sur PC');
    // Les huit caractères les plus larges doivent également tenir sans rognage.
    await p.locator('.room-code strong').evaluate((el) => { el.textContent = 'WWWWWWWW'; });
    check(await fitsSidebar(), 'code large hors de la sidebar sur PC');
    await p.locator('.room-code strong').evaluate((el, code) => { el.textContent = code; }, code);
    check(!await p.locator('.menu-toggle').isVisible(), 'burger affiché sur PC');
    for (const width of [320, 390, 768]) {
      await p.setViewportSize({ width, height: 800 });
      const toggle = p.locator('.menu-toggle');
      await toggle.waitFor();
      check(await toggle.getAttribute('aria-label') === 'Ouvrir le menu', 'libellé du burger incorrect');
      check(!await p.locator('#nav').isVisible() && !await p.locator('.who').isVisible(), 'menu non replié sur mobile');
      check(await p.locator('.room-code').isVisible() && await p.locator('.room-toggle').isVisible(), 'commandes du salon masquées par le burger');
      check((await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1, `débordement à ${width}px`);
      await toggle.focus();
      await p.keyboard.press('Enter');
      check(await toggle.getAttribute('aria-expanded') === 'true', 'état du menu ouvert incorrect');
      await p.keyboard.press('Tab');
      check(await p.locator('#nav a').first().evaluate((el) => document.activeElement === el), `navigation inaccessible au clavier à ${width}px : ${await p.evaluate(() => document.activeElement.outerHTML)}`);
      check(await p.locator('.who').getByRole('button', { name: 'Se connecter', exact: true }).isVisible(), 'connexion absente du menu mobile');
      check((await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1, `menu débordant à ${width}px`);
      await p.keyboard.press('Escape');
      check(await toggle.getAttribute('aria-expanded') === 'false' && await toggle.evaluate((el) => document.activeElement === el), 'Échap ne ferme pas le menu avec retour du focus');
      await toggle.click();
      await p.locator('#nav a').filter({ hasText: 'Amis' }).click();
      await p.waitForURL(BASE + '/amis/');
      check(await toggle.getAttribute('aria-expanded') === 'false', 'menu resté ouvert après navigation');
      await openMenu(p);
      await p.locator('.who').getByRole('button', { name: 'Se connecter', exact: true }).click();
      await p.getByRole('dialog', { name: 'Se connecter', exact: true }).waitFor();
      check(await toggle.getAttribute('aria-expanded') === 'false', 'menu resté ouvert derrière le dialogue');
      await p.keyboard.press('Escape');
      await p.goto(`${BASE}/t/?code=${code}`);
      await p.locator('.room-code').waitFor();
    }
    await openMenu(p);
    await p.setViewportSize({ width: 1366, height: 768 });
    check(await p.locator('#nav').isVisible() && await p.locator('.who').isVisible(), 'navigation PC masquée après redimensionnement');
    await p.setViewportSize({ width: 390, height: 800 });
    await p.waitForFunction(() => document.querySelector('.menu-toggle').getAttribute('aria-expanded') === 'false');
    await openMenu(p);
    await p.getByRole('button', { name: 'Read this site in English' }).click();
    check(await p.getByRole('button', { name: 'Close menu', exact: true }).getAttribute('aria-expanded') === 'true', 'changement de langue a fermé le menu');
    check(await p.locator('.who .lang').first().evaluate((el) => document.activeElement === el), 'changement de langue a perdu le focus');
    await p.getByRole('button', { name: 'Lire ce site en français' }).click();
    await p.locator('#view').click({ position: { x: 10, y: 10 } });
    check(await p.locator('.menu-toggle').getAttribute('aria-expanded') === 'false', 'clic extérieur sans fermeture');
  },

  // Inscription, sauvegarde des codes, récupération et rotation sur téléphone.
  async inscription() {
    const p = await player({ width: 390, height: 800 });
    const name = `e2e_${tag()}`;
    await openMenu(p);
    await p.getByRole('button', { name: /Créer un compte/ }).first().click();
    const form = p.locator('.dialog');
    check((await form.locator('input[name=email]').count()) === 0, 'adresse encore demandée');
    await form.locator('input[name=name]').fill(name);
    await form.locator('input[name=password]').fill('long enough');
    await form.getByRole('button', { name: /Créer le compte/ }).click();
    const codesDialog = p.locator('.recovery-dialog');
    await codesDialog.waitFor();
    const codes = await codesDialog.locator('code').allTextContents();
    check(codes.length === 10 && new Set(codes).size === 10, 'dix codes distincts attendus');
    check(await codesDialog.getByRole('button', { name: 'Continuer' }).isDisabled(), 'codes fermables sans confirmation');
    await p.keyboard.press('Escape');
    check(await codesDialog.isVisible(), 'Échap a perdu les codes avant sauvegarde');
    check((await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1, 'codes débordent sur téléphone');
    const downloading = p.waitForEvent('download');
    await codesDialog.getByRole('button', { name: 'Télécharger les codes' }).click();
    const download = await downloading;
    const content = readFileSync(await download.path(), 'utf8');
    check(codes.every((code) => content.includes(code)) && content.includes(name), 'fichier de récupération incomplet');
    await codesDialog.getByRole('checkbox').check();
    await codesDialog.getByRole('button', { name: 'Continuer' }).click();
    await codesDialog.waitFor({ state: 'detached' });
    const storage = await p.evaluate(() => JSON.stringify([localStorage, sessionStorage]));
    check(codes.every((code) => !storage.includes(code)), 'codes conservés dans le stockage navigateur');
    await p.reload();
    check((await p.locator('.recovery-dialog').count()) === 0, 'codes réaffichés après rechargement');
    const stale = await player();
    await stale.evaluate(async (n) => fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: n, password: 'long enough' }) }), name);
    await p.evaluate(() => fetch('/api/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
    await p.reload();
    await openMenu(p);
    await p.getByRole('button', { name: 'Se connecter', exact: true }).click();
    await p.getByRole('button', { name: 'Mot de passe oublié ?' }).click();
    const recover = p.locator('.dialog');
    await recover.locator('input[name=name]').fill(name);
    await recover.locator('input[name=code]').fill(codes[0]);
    await recover.locator('input[name=password]').fill('recovered password');
    await recover.locator('input[name=confirm]').fill('recovered password');
    await recover.getByRole('button', { name: 'Récupérer mon compte' }).click();
    await p.locator('.who-name', { hasText: name }).waitFor({ state: 'attached' });
    check(await stale.evaluate(async () => (await (await fetch('/api/me')).json()).user === null), 'ancienne session valide après récupération');
    check((await stale.evaluate(async (b) => (await fetch('/api/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).status, { name, code: codes[0], password: 'reused password' })) === 400, 'code réutilisable');
    await p.goto(BASE + '/compte/');
    await p.getByRole('status').filter({ hasText: '9 codes disponibles' }).waitFor();
    const rotate = p.locator('section').filter({ has: p.getByRole('heading', { name: 'Codes de récupération' }) });
    await rotate.locator('input[name=password]').fill('recovered password');
    await rotate.getByRole('button', { name: 'Créer de nouveaux codes' }).click();
    await codesDialog.waitFor();
    const replacements = await codesDialog.locator('code').allTextContents();
    check(replacements.length === 10 && replacements.every((code) => !codes.includes(code)), 'rotation n’a pas remplacé les codes');
    await codesDialog.getByRole('checkbox').check();
    await codesDialog.getByRole('button', { name: 'Continuer' }).click();
    check((await stale.evaluate(async (b) => (await fetch('/api/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).status, { name, code: codes[1], password: 'old set password' })) === 400, 'ancien code valide après rotation');
  },

  // Quitter un salon par mégarde, puis y retourner depuis la bande.
  async retour() {
    const { players: [host, guest] } = await room('Ono', 2);
    await guest.getByRole('button', { name: /Quitter le salon/ }).click();
    await guest.waitForURL(BASE + '/');
    await guest.locator('.resume .btn').click();
    await guest.locator('#lobby-crew-title', { hasText: '2 joueurs' }).waitFor();
    check((await host.locator('.member').count()) >= 2, 'l’hôte ne revoit pas le joueur revenu');
  },

  // La discussion : un message écrit par l'un arrive chez l'autre, dans une bulle.
  async discussion() {
    const { players: [host, guest] } = await room('Ono', 2);
    await guest.locator('.chat-form input').fill('Bonjour du bord');
    await guest.locator('.chat-form input').press('Enter');
    await host.locator('.chat-group:not(.mine) li', { hasText: 'Bonjour du bord' }).waitFor();
    await guest.locator('.chat-group.mine li', { hasText: 'Bonjour du bord' }).waitFor();
  },

  // Demande en ami : elle s'ouvre en fenêtre chez l'autre, et son acceptation apparaît sur
  // la page Amis du premier sans la recharger. Puis une invitation dans un salon.
  async amis() {
    const a = `e2e_a${tag()}`, b = `e2e_b${tag()}`;
    const pa = await player({ account: a }), pb = await player({ account: b });
    await pa.goto(BASE + '/amis/');
    await pa.locator('#pseudo').fill(b);
    await pa.getByRole('button', { name: /Envoyer l’invitation/ }).click();
    await pb.locator('.ask-dialog', { hasText: a }).waitFor({ timeout: 12000 });
    await pb.getByRole('button', { name: 'Accepter' }).click();
    await pa.locator('.people li', { hasText: 'Amis depuis' }).waitFor({ timeout: 12000 });
    await pa.goto(BASE + '/');
    await pa.getByRole('button', { name: /Créer un salon/ }).click();
    await pa.locator('.lobby').waitFor();
    await pa.locator('.pals summary').click();
    const invite = pa.locator('.pals .pill', { hasText: 'Inviter' });
    await invite.waitFor({ timeout: 12000 });
    const colour = await invite.evaluate((e) => getComputedStyle(e).color);
    check(colour !== 'rgb(255, 255, 255)', 'la pastille « Inviter » est blanche sur blanc');
    await invite.click();
    await pb.locator('.ask-dialog', { hasText: 'vous invite' }).waitFor({ timeout: 12000 });
    await pb.getByRole('button', { name: /Rejoindre le salon/ }).click();
    await pb.locator('#lobby-crew-title', { hasText: '2 joueurs' }).waitFor();
  },

  // Partie publique : un salon ouvert sur un jeu se voit dans la liste, avec ses places, et
  // se rejoint ; plein, il n'y est plus.
  async publique() {
    const host = await player();
    await host.getByRole('button', { name: /Partie publique/ }).click();
    await host.locator('.quick-game', { hasText: 'BoomParty' }).getByRole('button', { name: /Ouvrir un salon/ }).click();
    await host.locator('.lobby').waitFor();
    const name = await host.locator('.crew-chip.me b').innerText();
    for (let seats = Number(await host.locator('.lobby-limit b').innerText()); seats > 2; seats--) {
      await host.locator('.lobby-limit .btn').first().click();
      await host.locator('.lobby-limit b', { hasText: new RegExp(`^${seats - 1}$`) }).waitFor();
    }
    const guest = await player();
    await guest.getByRole('button', { name: /Partie publique/ }).click();
    const row = guest.locator('.quick-rooms li', { hasText: `Salon de ${name}` });
    await row.waitFor({ timeout: 8000 });
    check((await row.locator('.quick-seats b').innerText()) === '1/2', 'la liste ne dit pas 1/2');
    await row.getByRole('button', { name: 'Rejoindre' }).click();
    await guest.locator('#lobby-crew-title', { hasText: '2 joueurs' }).waitFor();
    const late = await player();
    await late.getByRole('button', { name: /Partie publique/ }).click();
    await late.locator('.quick-games').waitFor();
    await sleep(3500);
    check((await late.locator('.quick-rooms li', { hasText: `Salon de ${name}` }).count()) === 0, 'un salon plein est encore listé');
  },

  // Ono : une carte posée arrive sur le tas, et le tour passe.
  async ono() {
    const { players } = await room('Ono', 2);
    await start(players[0]);
    for (const p of players) await p.locator('.top-card').first().waitFor();
    let moves = 0;
    let played = 0;
    for (let turn = 0; turn < 12 && played < 2; turn++) {
      for (const p of players) {
        const colour = p.locator('.pick-color').first();
        const ok = p.locator('.card-btn.ok').first();
        const deck = p.locator('.deck:not(:disabled)');
        const keep = p.getByRole('button', { name: /Garder la carte/ });
        if (await colour.count()) await colour.click();
        else if (await ok.count()) {
          await ok.click();
          played++;
        } else if (await deck.count()) await deck.click();
        else if (await keep.count()) await keep.click();
        else continue;
        moves++;
        await sleep(450);
      }
    }
    check(moves >= 2, 'aucun coup n’a pu être joué');
    check(played === 0 || (await players[0].locator('.top-card').count()) >= 2, 'le tas ne garde pas les cartes posées');
  },

  // Bombermat : le pion part dès la touche enfoncée, s'arrête entre deux cases, et finit là
  // où le serveur le voit (ce que montre l'écran de l'autre joueur). Puis une bombe explose.
  async bombermat() {
    const { players: [host, guest] } = await room('Bombermat', 2);
    await start(host);
    await host.locator('.pd-count').waitFor({ state: 'detached', timeout: 8000 });
    const at = async (page, sel) => {
      const m = /translate\(([-\d.]+)%, ([-\d.]+)%/.exec(await page.locator(sel).evaluate((e) => e.style.transform));
      return { x: Number(m[1]) / 100, y: Number(m[2]) / 100 };
    };
    await host.keyboard.down('ArrowRight');
    await host.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
    check((await at(host, '.pd-player.me')).x > 0, 'le pion attend le serveur pour partir');
    await sleep(40);
    await host.keyboard.up('ArrowRight');
    await sleep(600);
    const mine = await at(host, '.pd-player.me');
    check(mine.x > 0 && mine.x < 1, `un appui bref mène à ${mine.x}, pas entre deux cases`);
    const seen = await at(guest, '.pd-player.seat-0');
    check(Math.abs(seen.x - mine.x) < 0.06 && Math.abs(seen.y - mine.y) < 0.06, `le pion est en ${mine.x} chez lui et en ${seen.x} chez l’autre`);
    // Un aller-retour tenu : à l'arrêt, les deux écrans sont encore d'accord.
    for (const key of ['ArrowLeft', 'ArrowDown', 'ArrowUp', 'ArrowRight']) {
      await host.keyboard.down(key);
      await sleep(350);
      await host.keyboard.up(key);
    }
    await sleep(600);
    const a = await at(host, '.pd-player.me'), b = await at(guest, '.pd-player.seat-0');
    check(Math.abs(a.x - b.x) < 0.06 && Math.abs(a.y - b.y) < 0.06, `après un aller-retour : ${a.x},${a.y} chez lui, ${b.x},${b.y} chez l’autre`);
    await host.keyboard.press('Space');
    await host.locator('.pd-bomb').waitFor();
    await host.locator('.pd-fire').first().waitFor({ timeout: 5000 });
  },

  // Le compte reste au pied de la bande sur toutes les pages, même dans une fenêtre basse.
  async pied() {
    const p = await player({ width: 1280, height: 620, account: `e2e_${tag()}` });
    for (const path of ['/', '/amis/', '/objectifs/', '/magasin/', '/compte/']) {
      await p.goto(BASE + path);
      await p.locator('.who-name').waitFor();
      await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const gap = await p.locator('.who').evaluate((e) => Math.abs(e.getBoundingClientRect().bottom - innerHeight));
      check(gap < 2, `sur ${path}, le compte est à ${Math.round(gap)} px du pied de la bande`);
    }
  },

  // Sur un téléphone : l'accueil et un salon tiennent dans la largeur de l'écran.
  async telephone() {
    const size = { width: 390, height: 800 };
    const { players: [host] } = await room('Ono', 2, size);
    const wide = () => host.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check((await wide()) <= 1, 'la salle d’attente déborde en largeur');
    await start(host);
    check((await wide()) <= 1, 'la partie déborde en largeur');
  },
};

const wanted = process.argv.slice(2);
const names = Object.keys(scenarios).filter((n) => wanted.length === 0 || wanted.some((w) => n.includes(w)));
let failed = 0;
for (const name of names) {
  const before = browser.contexts().length;
  const t0 = Date.now();
  try {
    await scenarios[name]();
    const errors = browser.contexts().slice(before).flatMap((c) => c.pages().flatMap((p) => p.errors ?? []));
    check(errors.length === 0, `erreurs dans la page : ${errors.join(' ; ')}`);
    console.log(`ok    ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (err) {
    failed++;
    const at = String(err.stack).split('\n').find((line) => line.includes('run.mjs:'))?.trim() ?? '';
    console.log(`ÉCHEC ${name} : ${String(err.message).split('\n')[0]} ${at}`);
  }
  for (const c of browser.contexts().slice(before)) await c.close();
}
await browser.close();
console.log(failed ? `${failed} scénario(s) en échec sur ${names.length}` : `${names.length} scénarios réussis`);
process.exit(failed ? 1 : 0);
