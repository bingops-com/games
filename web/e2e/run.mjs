// Les scénarios de bout en bout : de vrais navigateurs jouent contre un serveur qui tourne
// (make run, ou GAMES_URL). Chacun vérifie un parcours entier, vu par les joueurs.
//
//   npm run e2e              tous les scénarios
//   npm run e2e -- ono amis  ceux dont le nom contient « ono » ou « amis »
//
// Ils créent des comptes « e2e_… » : à lancer contre une base de développement.
import { existsSync } from 'node:fs';
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
    const status = await page.evaluate(async (n) => (await fetch('/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: n, password: 'long enough', email: `${n}@e2e.test` }) })).status, account);
    check(status === 200, `inscription de ${account} : ${status}`);
    await page.reload();
    await page.locator('.who-name').waitFor();
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

const scenarios = {
  // Un compte se crée avec une adresse e-mail, et pas sans.
  async inscription() {
    const p = await player();
    const name = `e2e_${tag()}`;
    const post = (body) => p.evaluate(async (b) => (await fetch('/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).status, body);
    check((await post({ name, password: 'long enough' })) === 400, 'un compte se crée sans adresse');
    await p.getByRole('button', { name: /Créer un compte/ }).first().click();
    const form = p.locator('.dialog');
    await form.locator('input[name=name]').fill(name);
    await form.locator('input[name=email]').fill(`${name}@e2e.test`);
    await form.locator('input[name=password]').fill('long enough');
    await form.getByRole('button', { name: /Créer le compte/ }).click();
    await p.locator('.who-name', { hasText: name }).waitFor();
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
    const name = await host.locator('.member.me > :is(a, b)').first().innerText();
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

  // Bombermat : on avance librement, on s'arrête entre deux cases, une bombe explose.
  async bombermat() {
    const { players: [host] } = await room('Bombermat', 2);
    await start(host);
    await host.locator('.pd-count').waitFor({ state: 'detached', timeout: 8000 });
    const x = async () => Number(/translate\(([-\d.]+)%/.exec(await host.locator('.pd-player.me').evaluate((e) => e.style.transform))[1]) / 100;
    await host.keyboard.down('ArrowRight');
    await sleep(60);
    await host.keyboard.up('ArrowRight');
    await sleep(500);
    const stopped = await x();
    check(stopped > 0 && stopped < 1, `un appui bref mène à ${stopped}, pas entre deux cases`);
    await host.keyboard.press('Space');
    await host.locator('.pd-bomb').waitFor();
    await host.locator('.pd-fire').first().waitFor({ timeout: 5000 });
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
    console.log(`ÉCHEC ${name} : ${String(err.message).split('\n')[0]}`);
  }
  for (const c of browser.contexts().slice(before)) await c.close();
}
await browser.close();
console.log(failed ? `${failed} scénario(s) en échec sur ${names.length}` : `${names.length} scénarios réussis`);
process.exit(failed ? 1 : 0);
