// Les scénarios de bout en bout : de vrais navigateurs jouent contre un serveur qui tourne
// (make run, ou GAMES_URL). Chacun vérifie un parcours entier, vu par les joueurs.
//
//   npm run e2e              tous les scénarios
//   npm run e2e -- ono amis  ceux dont le nom contient « ono » ou « amis »
//
// Ils créent des comptes « e2e_… » : à lancer contre une base de développement.
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import axe from 'axe-core';

const BASE = process.env.GAMES_URL ?? 'http://localhost:3778';
if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(BASE)) throw new Error('E2E tests require an isolated loopback instance');
const SYSTEM = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? SYSTEM, args: ['--no-sandbox'] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = () => Math.random().toString(36).slice(2, 7);
function check(ok, what) {
  if (!ok) throw new Error(what);
}

// Une page : un joueur. Les erreurs de la page font échouer le scénario.
async function player({ width = 1366, height = 768, account = '' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, locale: 'fr-FR' });
  await context.addInitScript(() => { const Native = window.WebSocket; window.WebSocket = class extends Native { constructor(...args) { super(...args); window.testSocket = this; this.addEventListener('message', e => { const data = JSON.parse(e.data); if (data.t === 'state') window.roomState = data; }); } }; });
  const page = await context.newPage();
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
  async departSite() {
    const { code, players: [host, guest, third] } = await room('Ono', 3);
    await start(host);
    const seat = await guest.evaluate(() => window.roomState.seat);
    await guest.evaluate(() => window.testSocket.close());
    await guest.waitForFunction(() => window.testSocket.readyState === 1);
    check(await guest.evaluate(() => window.roomState.seat) === seat, 'une reconnexion perd la place du joueur');
    const extra = await guest.context().newPage();
    await extra.goto(`${BASE}/t/?code=${code}`);
    await extra.locator('.terre').waitFor();
    await guest.close();
    await extra.waitForTimeout(200);
    check(await host.evaluate(() => window.roomState.members.length) === 3, 'fermer un onglet retire le joueur encore connecté ailleurs');
    await extra.close();
    await host.waitForFunction(() => window.roomState.members.length === 2);
    check(await host.evaluate(() => window.roomState.phase) === 'playing', 'les deux joueurs restants ne continuent pas');
    await third.goto('about:blank');
    await host.waitForFunction(() => window.roomState.members.length === 1);
    check(await host.evaluate(() => window.roomState.void), 'un départ volontaire est compté comme une victoire normale');
  },

  async bombesMaintenues() {
    const { players: [host] } = await room('Bombermat', 2);
    await start(host);
    await host.locator('.pd-count').waitFor({ state: 'detached', timeout: 8000 });
    await host.keyboard.down('ArrowRight'); await sleep(350); await host.keyboard.up('ArrowRight');
    await host.keyboard.down('Space'); await host.locator('.pd-bomb').waitFor();
    const firstBomb = await host.evaluate(() => window.roomState.view.bombs[0].at);
    await host.keyboard.down('ArrowLeft'); await sleep(350); await host.keyboard.up('ArrowLeft');
    await host.keyboard.down('ArrowDown'); await sleep(350); await host.keyboard.up('ArrowDown');
    await host.waitForFunction(first => window.roomState.view.bombs.some(b => b.at !== first), firstBomb, { timeout: 6000 });
    check(await host.locator('.pd-player.me').count() > 0, 'le joueur n’a pas survécu dans son refuge');
    await host.keyboard.up('Space');
  },

  async indicesEtEquipes() {
    const { players } = await room('Codenoms', 4);
    await start(players[0]);
    await players[0].getByRole('button', { name: 'Commencer la partie', exact: true }).click();
    for (const p of players) await p.locator('.pav-grid').waitFor();
    const artist = (await players[0].locator('.pav-clue').count()) ? players[0] : players[1];
    const guesser = artist === players[0] ? players[2] : players[3];
    const currentTeam = await artist.locator('.pav-team.turn b').innerText();
    const revealed = await artist.locator('.known .word').evaluateAll(words => new Set(words.map(el => getComputedStyle(el).backgroundColor)).size);
    check(revealed >= 4, 'les mots des deux équipes, neutres et interdit ne sont pas assez distingués');
    check(await guesser.locator('.pav-grid .is-babord:not(.shown), .pav-grid .is-tribord:not(.shown), .pav-grid .is-interdit:not(.shown)').count() === 0, 'la couleur révèle les mots secrets aux joueurs qui devinent');
    await artist.locator('.pav-clue input').fill('Océan');
    await artist.getByRole('button', { name: 'Donner l’indice', exact: true }).click();
    for (const p of players) {
      const dialog = p.getByRole('dialog'); await dialog.waitFor();
      check((await dialog.innerText()).includes('Océan'), 'le popup ne montre pas l’indice reçu');
      if (p === artist) {
        for (const [width,height] of [[320,700],[390,844],[1366,768]]) {
          await p.setViewportSize({width,height});
          for (const colorScheme of ['light','dark']) {
            await p.emulateMedia({colorScheme,reducedMotion:'reduce'});
            await p.addScriptTag({content:axe.source});
            const issues = await p.evaluate(async () => (await axe.run()).violations.map(v => ({id:v.id,targets:v.nodes.map(n=>n.target)})));
            check(!issues.length, `popup indice ${width} ${colorScheme}: ${JSON.stringify(issues)}`);
            await p.screenshot({path:`/tmp/games-codenoms-clue-${width}-${colorScheme}.png`});
          }
        }
      }
      await p.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
      check((await p.locator('.clue-word').textContent()).includes('Océan'), 'l’indice disparaît après fermeture du popup');
    }
    for (const p of [artist,guesser]) {
      for (const [width,height] of [[320,700],[390,844],[1366,768]]) {
        await p.setViewportSize({width,height});
        for (const colorScheme of ['light','dark']) {
          await p.emulateMedia({colorScheme,reducedMotion:'reduce'});await p.addScriptTag({content:axe.source});
          const issues = await p.evaluate(async () => (await axe.run()).violations.map(v => ({id:v.id,targets:v.nodes.map(n=>n.target)})));
          check(!issues.length, `grille Codenoms ${width} ${colorScheme}: ${JSON.stringify(issues)}`);
          check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1), 'Codenoms déborde de l’écran');
          await p.screenshot({path:`/tmp/games-codenoms-${p===artist?'guide':'guesser'}-${width}-${colorScheme}.png`});
        }
      }
    }
    await guesser.getByRole('button', { name: 'Revoir l’indice', exact: true }).click();
    await guesser.getByRole('button', { name: 'Voir la grille', exact: true }).click();
    await guesser.getByRole('button', { name: 'Passer le tour', exact: true }).click();
    await guesser.waitForFunction(before => !document.querySelector('.pav-team.turn b').innerText.includes(before.split(' (')[0]), currentTeam);
    await guesser.locator('.game-announcement').filter({ hasText: 'Au tour de' }).waitFor();
    check(await guesser.getByRole('dialog').count() === 0, 'un ancien indice reste ouvert après le changement d’équipe');
  },

  async gartikManches() {
    const { players } = await room('Gartik Phone', 3);
    await start(players[0]);
    for (const p of players) {
      await p.getByRole('textbox', { name: 'Votre phrase' }).fill('Un chat sur un bateau');
      await p.getByRole('button', { name: 'Terminé', exact: true }).click();
    }
    for (const p of players) {
      await p.locator('.pad-tools').waitFor();
      await p.locator('.game-announcement').filter({ hasText: 'Manche 2' }).waitFor();
      await p.getByRole('button', { name: 'Couleur 4', exact: true }).click();
      await p.getByRole('button', { name: 'Remplir', exact: true }).click();
      await p.locator('canvas.pad').focus(); await p.keyboard.press('Space');
      check(await p.locator('canvas.pad').evaluate(el => Array.from(el.getContext('2d').getImageData(500,375,1,1).data).slice(0,3).join() === '255,107,94'), 'le remplissage clavier ne fonctionne pas dans Gartik');
    }
  },
  async onoPioche() {
    const { players } = await room('Ono', 2);
    for (const p of players) p.setDefaultTimeout(15000);
    await start(players[0]);
    for (const p of players) {
      await p.locator('.ono-table').waitFor();
      await p.locator('.ono-table.dealing').waitFor({ state: 'detached' });
      await p.evaluate(() => {
        window.onoIncoming = [];
        document.addEventListener('animationstart', (e) => {
          if (e.target.matches('.hand li, .ono-fly')) window.onoIncoming.push(e.animationName);
        });
      });
    }
    for (const [width, height] of [[1366, 768], [1280, 620], [390, 800]]) {
      for (const colorScheme of ['light', 'dark']) {
        for (const p of players) {
          await p.setViewportSize({ width, height });
          await p.emulateMedia({ colorScheme });
        }
        await sleep(1800); // Laisser finir les effets du coup précédent avant le suivant.
        const drawer = await players[0].locator('.deck').isEnabled() ? players[0] : players[1];
        const observer = players.find((p) => p !== drawer);
        const before = await drawer.locator('.hand li').count();
        const otherBefore = await observer.locator('.hand li').count();
        for (const p of players) await p.evaluate(() => { window.onoIncoming = []; });
        // La pioche obligatoire pulse : un vrai clic n'attend pas la fin de cette boucle.
        await drawer.locator('.deck').click({ force: true });
        await drawer.waitForFunction((n) => document.querySelectorAll('.hand li').length === n + 1, before);
        await sleep(900);
        check((await observer.locator('.hand li').count()) === otherBefore, 'la pioche change la main de l’adversaire');
        check(JSON.stringify(await drawer.evaluate(() => window.onoIncoming)) === '["ono-deal"]', `animation de pioche doublée dans la main en ${width}×${height}, ${colorScheme}`);
        const observed = await observer.evaluate(() => window.onoIncoming);
        check(observed.length <= 1 && observed.every((name) => name === 'ono-draw'), `vol de pioche rejoué chez l’adversaire en ${width}×${height}, ${colorScheme} : ${JSON.stringify(observed)}`);
        if (width === 1366) check(observed.length === 1, 'le vol vers l’adversaire a disparu sur la table ovale');
        for (const p of players) {
          check((await p.locator('.ono-pointer').count()) === 0, 'les trois flèches sont encore présentes');
          check(await p.locator('.rival.turn .seat-timer').isVisible() || await p.locator('.turn-info .timer').isVisible(), `la jauge a disparu en ${width}×${height}, ${colorScheme}`);
          const ring = await p.locator('.rival.turn .rival-who').evaluate((e) => getComputedStyle(e, '::before').backgroundImage);
          check(ring.includes('conic-gradient'), 'le cercle de tour a disparu');
          check((await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1, 'la table déborde en largeur');
        }
        const keep = drawer.getByRole('button', { name: /Garder la carte/ });
        if (await keep.count()) await keep.click();
      }
    }
    for (const p of players) await p.emulateMedia({ reducedMotion: 'reduce' });
    await sleep(1800);
    const drawer = await players[0].locator('.deck').isEnabled() ? players[0] : players[1];
    const before = await drawer.locator('.hand li').count();
    for (const p of players) await p.evaluate(() => { window.onoIncoming = []; });
    await drawer.locator('.deck').click({ force: true });
    await drawer.waitForFunction((n) => document.querySelectorAll('.hand li').length === n + 1, before);
    await sleep(900);
    for (const p of players) check((await p.evaluate(() => window.onoIncoming.length)) === 0, 'la pioche ignore la réduction des animations');
  },

  async skribouille() {
    const { code, players } = await room('Skribouille', 2);
    const [host] = players;
    await start(host);
    for (const p of players) await p.locator('.sk-choose').waitFor();
    const artist = (await players[0].locator('.sk-choose button').count()) ? players[0] : players[1];
    const guesser = players.find((p) => p !== artist);
    const choice = artist.locator('.sk-choose button').first();
    const word = await choice.innerText();
    await choice.click();
    await artist.locator('.pad-tools').waitFor();
    const pixel = async (page, rgb, x = 500, y = 375) => page.waitForFunction(({ rgb, x, y }) => {
      const ctx = document.querySelector('canvas.pad')?.getContext('2d');
      return ctx && Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3).join() === rgb.join();
    }, { rgb, x, y });
    const draw = async (points) => {
      const r = await artist.locator('canvas.pad').boundingBox();
      await artist.mouse.move(r.x + r.width * points[0][0], r.y + r.height * points[0][1]);
      await artist.mouse.down();
      for (const [x, y] of points.slice(1)) await artist.mouse.move(r.x + r.width * x, r.y + r.height * y, { steps: 6 });
      await artist.mouse.up();
    };
    const center = () => artist.locator('canvas.pad').click();
    await draw([[.25, .25], [.75, .25], [.75, .75], [.25, .75], [.25, .25]]);
    await artist.getByRole('button', { name: 'Couleur 4', exact: true }).click();
    await artist.getByRole('button', { name: 'Remplir', exact: true }).click();
    await center();
    for (const p of players) {
      await pixel(p, [255, 107, 94]);
      await pixel(p, [255, 255, 255], 100, 100);
    }
    await artist.getByRole('button', { name: 'Couleur 9', exact: true }).click();
    await center();
    await pixel(guesser, [20, 67, 214]);
    await artist.locator('.pad-tools').getByRole('button', { name: 'Annuler', exact: true }).click();
    await pixel(guesser, [255, 107, 94]);
    await artist.locator('.pad-tools').getByRole('button', { name: 'Annuler', exact: true }).click();
    await pixel(guesser, [255, 255, 255]);
    await artist.getByRole('button', { name: 'Couleur 4', exact: true }).click();
    await center();
    await pixel(guesser, [255, 107, 94]);
    await artist.evaluate(() => window.testSocket.close()); await artist.waitForFunction(() => window.testSocket.readyState === 1);
    await artist.locator('.pad-tools').waitFor();
    await pixel(artist, [255, 107, 94]);
    await artist.getByRole('button', { name: 'Crayon', exact: true }).click();
    await artist.getByRole('button', { name: 'Couleur 1', exact: true }).click();
    await draw([[.1, .1], [.2, .1]]);
    await pixel(guesser, [17, 23, 48], 150, 75);
    await pixel(guesser, [255, 107, 94]);
    const watcher = await player();
    await watcher.evaluate(() => localStorage.setItem('games.lang', 'en'));
    await watcher.goto(`${BASE}/t/?code=${code}`);
    await pixel(watcher, [255, 107, 94]);
    check((await watcher.locator('.pad-tools').count()) === 0, 'un spectateur voit les outils');
    check((await guesser.locator('.pad-tools').count()) === 0, 'le joueur qui devine voit les outils');
    for (const [width, height] of [[1366, 768], [1280, 620], [390, 844]]) {
      await artist.setViewportSize({ width, height });
      for (const colorScheme of ['light', 'dark']) {
        await artist.emulateMedia({ colorScheme });
        await artist.getByRole('button', { name: 'Remplir', exact: true }).click({ trial: true });
        check(await artist.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'les outils débordent de l’écran');
        await artist.screenshot({ path: `/tmp/games-skrib-draw-${width}-${colorScheme}.png` });
      }
    }
    await artist.setViewportSize({ width: 1366, height: 768 });
    await artist.getByRole('button', { name: 'Tout effacer', exact: true }).click();
    await pixel(guesser, [255, 255, 255]);
    await artist.getByRole('button', { name: 'Couleur 4', exact: true }).click();
    await artist.getByRole('button', { name: 'Remplir', exact: true }).click();
    await center();
    await pixel(guesser, [255, 107, 94]);
    await pixel(guesser, [255, 107, 94], 100, 100);
    await artist.locator('.pad-tools').getByRole('button', { name: 'Annuler', exact: true }).click();
    await pixel(guesser, [255, 255, 255]);
    await guesser.locator('.sk-guess input').fill(word);
    await guesser.locator('.sk-guess button').click();
    for (const p of players) {
      await p.getByRole('heading', { name: 'Fin de manche', exact: true }).waitFor();
      check(await p.locator('.sk-reveal-card > strong').innerText() === word, 'le résultat ne révèle pas le mot');
      check((await p.locator('.pad-tools').count()) === 0, 'les outils restent ouverts pendant le résultat');
    }
    await watcher.getByRole('heading', { name: 'Round over', exact: true }).waitFor();
    check(await artist.locator('.sk-reveal-card').innerText().then((s) => s.includes('+20 points gagnés')), 'les points du dessinateur ne sont pas affichés');
    for (const [width, height] of [[1366, 768], [1280, 620], [390, 844]]) {
      await guesser.setViewportSize({ width, height });
      for (const colorScheme of ['light', 'dark']) {
        await guesser.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        check(await guesser.locator('.sk-reveal-card').evaluate((el) => {
          const r = el.getBoundingClientRect();
          return r.x >= 0 && r.right <= innerWidth + 1 && r.y >= 0 && r.bottom <= innerHeight;
        }), 'le résultat sort de l’écran');
        await guesser.screenshot({ path: `/tmp/games-skrib-result-${width}-${colorScheme}.png` });
      }
    }
    for (const p of players) {
      await p.locator('.sk-reveal').waitFor({ state: 'detached', timeout: 8000 });
      await p.locator('.sk-choose').waitFor();
    }
    check((await guesser.locator('.sk-choose button').count()) === 3, 'la manche suivante ne change pas de dessinateur');
  },

  async nomDeCode() {
    const { players: [host, guest, third, fourth] } = await room('Codenoms', 4);
    for (const p of [host, guest, third, fourth]) p.setDefaultTimeout(15000);
    check((await guest.getByRole('button', { name: 'Lancer la partie', exact: true }).count()) === 0, 'un invité peut lancer depuis le salon');
    await start(host);
    for (const p of [host, guest, third, fourth]) await p.locator('.pav-teams').waitFor();

    await guest.locator('.pav-teams').waitFor();
    for (const p of [guest, third, fourth]) {
      check((await p.getByRole('button', { name: 'Commencer la partie', exact: true }).count()) === 0, 'un invité peut commencer après le choix des équipes');
      await p.getByText(/l’hôte, commencera la partie/).waitFor();
    }
    await guest.evaluate(() => window.testSocket.send(JSON.stringify({ t: 'act', a: { t: 'begin' } })));
    await guest.getByText("Seul l'hôte lance la partie", { exact: true }).waitFor();
    check(await host.locator('.pav-teams').isVisible(), 'la requête de l’invité a lancé la grille');
    await third.getByRole('button', { name: 'Donner les indices ici', exact: true }).first().click();
    await host.waitForFunction(() => document.querySelector('.pav-begin button')?.disabled);
    await third.getByRole('button', { name: 'Deviner ici', exact: true }).first().click();
    await host.waitForFunction(() => document.querySelector('.pav-begin button')?.disabled === false);
    await host.getByRole('button', { name: 'Commencer la partie', exact: true }).click();
    for (const p of [host, guest, third, fourth]) await p.locator('.pav-grid .word').first().waitFor();
  },

  async finBombermat() {
    const { code, players: [host, guest] } = await room('Bombermat', 2);
    const finish = async () => {
      await host.locator('.pd-count').waitFor({ state: 'detached', timeout: 8000 });
      await host.keyboard.press('Space');
      await host.locator('.outcome').waitFor({ timeout: 6000 });
      await guest.locator('.outcome-card strong', { hasText: 'Victoire explosive !' }).waitFor();
    };
    await start(host);
    await finish();
    check((await host.locator('.outcome-card strong').innerText()).includes('remporte la partie'), 'le perdant ne voit pas le gagnant');
    for (const [width, height] of [[1366, 768], [1280, 620], [390, 800]]) {
      await guest.setViewportSize({ width, height });
      for (const colorScheme of ['light', 'dark']) {
        await guest.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        await guest.locator('.outcome-card strong').scrollIntoViewIfNeeded();
        const front = await guest.evaluate(() => {
          const title = document.querySelector('.outcome-card strong');
          const r = title.getBoundingClientRect();
          const grid = document.querySelector('.pd-grid').getBoundingClientRect();
          const pawn = document.querySelector('.pd-player');
          // Le survivant reste au fond de l'arène (z-index élevé). On le place sous le
          // titre pour vérifier que sa couche ne peut jamais recouvrir le résultat.
          pawn.style.transform = `translate(${r.x + r.width / 2 - grid.x}px, ${r.y + r.height / 2 - grid.y}px)`;
          return !!document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.outcome-card');
        });
        check(front, `le pion passe devant le résultat en ${width}×${height}, ${colorScheme}`);
        check((await guest.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1, 'le résultat déborde en largeur');
        const back = guest.getByRole('button', { name: 'Retour au salon', exact: true });
        await back.scrollIntoViewIfNeeded();
        await back.click({ trial: true });
      }
    }
    await guest.setViewportSize({ width: 1366, height: 768 });
    await guest.getByRole('button', { name: 'Retour au salon', exact: true }).click();
    await guest.locator('.lobby').waitFor();
    check(new URL(guest.url()).searchParams.get('code') === code, 'le retour quitte le salon');
    check(await host.locator('.outcome').isVisible(), 'le retour d’un joueur ferme le résultat de l’hôte');
    const vote = guest.locator('.pick-game', { hasText: 'Ono' });
    await vote.click();
    await guest.locator('.pick-game.voted', { hasText: 'Ono' }).waitFor();
    const watcher = await player();
    await watcher.goto(`${BASE}/t/?code=${code}`);
    await watcher.locator('.outcome').waitFor();
    await watcher.getByRole('button', { name: 'Retour au salon', exact: true }).click();
    await watcher.locator('.lobby').waitFor();
    await watcher.getByRole('button', { name: 'Quitter le salon', exact: true }).click();
    await watcher.waitForURL(BASE + '/');
    await host.getByRole('button', { name: 'Rejouer', exact: true }).click();
    await guest.locator('.pd-count').waitFor();
    await guest.locator('.lobby').waitFor({ state: 'detached' });
    await finish();
    await host.getByRole('button', { name: 'Retour au salon', exact: true }).click();
    await host.locator('.lobby').waitFor();
    await guest.locator('.lobby').waitFor();
    check(await guest.locator('#lobby-crew-title', { hasText: '2 joueurs' }).isVisible(), 'le retour de l’hôte perd un joueur');
  },

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
    await p.getByRole('button', { name: 'Revenir aux codes', exact: true }).click();
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
    // Closing is always possible, with an explicit acknowledgement of code loss.
    await rotate.locator('input[name=password]').fill('recovered password');
    await rotate.getByRole('button', { name: 'Créer de nouveaux codes' }).click();
    await codesDialog.waitFor();
    await codesDialog.getByRole('button', { name: 'Fermer la fenêtre', exact: true }).click();
    const confirmation = p.getByRole('dialog', { name: 'Fermer sans enregistrer les codes ?' });
    await confirmation.waitFor();
    await p.keyboard.press('Escape');
    await confirmation.waitFor({ state: 'detached' });
    check(await codesDialog.isVisible(), 'annuler la fermeture a perdu les codes');
    await codesDialog.getByRole('button', { name: 'Fermer la fenêtre', exact: true }).click();
    await confirmation.getByRole('button', { name: 'Fermer sans les enregistrer', exact: true }).click();
    await codesDialog.waitFor({ state: 'detached' });
    check(await p.locator('dialog[open]').count() === 0, 'fenêtre restante après fermeture confirmée');
    check(await p.evaluate(() => document.body.style.overflow !== 'hidden'), 'défilement bloqué après fermeture des fenêtres imbriquées');
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
    const arena = await host.locator('.pd').getAttribute('data-arena');
    check(['classic', 'crossroads', 'bastions', 'rings'].includes(arena), `arène inconnue : ${arena}`);
    check(await guest.locator('.pd').getAttribute('data-arena') === arena, 'les joueurs ne partagent pas la même arène');
    check(await host.locator('.pd-scenery').getAttribute('data-scenery') === arena, 'le décor ne correspond pas à l’arène');
    // Every restored asset must really be served and decoded, rather than
    // silently receiving the SPA HTML fallback for a missing file.
    const assets = await host.evaluate(async () => {
      for (const arena of ['classic', 'crossroads', 'bastions', 'rings']) {
        for (const kind of ['background', 'sprites']) {
          const src = `/games/bombermat/${arena}-${kind}.webp`;
          const response = await fetch(src);
          if (!response.ok || !response.headers.get('content-type')?.includes('image/webp')) return false;
          const image = new Image(); image.src = src; await image.decode();
          if (!image.naturalWidth || !image.naturalHeight) return false;
        }
      }
      return true;
    });
    check(assets, 'un des huit visuels Bombermat est absent ou invalide');
    mkdirSync('/tmp/games-bombermat-preview', { recursive: true });
    for (const colorScheme of ['light', 'dark']) {
      await host.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      for (const [width, height] of [[320, 700], [390, 844], [1280, 620], [1366, 768]]) {
        await host.setViewportSize({ width, height });
        check(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Bombermat déborde à ${width}px`);
        check(await host.locator('.pd-fit').evaluate(e => {
          const frame = e.getBoundingClientRect(), grid = e.querySelector('.pd-grid').getBoundingClientRect();
          return grid.left >= frame.left - 1 && grid.right <= frame.right + 1 && grid.top >= frame.top - 1 && grid.bottom <= frame.bottom + 1;
        }), `le terrain Bombermat sort de son cadre à ${width}×${height}`);
        await host.screenshot({ path: `/tmp/games-bombermat-preview/${colorScheme}-${width}.png` });
      }
    }
    await host.setViewportSize({ width: 1366, height: 768 });
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
    const at = String(err.stack).split('\n').findLast((line) => line.includes('run.mjs:'))?.trim() ?? '';
    console.log(`ÉCHEC ${name} : ${String(err.message).split('\n')[0]} ${at}`);
  }
  for (const c of browser.contexts().slice(before)) await c.close();
}
await browser.close();
console.log(failed ? `${failed} scénario(s) en échec sur ${names.length}` : `${names.length} scénarios réussis`);
process.exit(failed ? 1 : 0);
