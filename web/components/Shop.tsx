'use client';

import { useEffect, useState } from 'react';
import { App, useApp, useT } from '@/lib/app';
import { Avatar, PartIcon, encode, parse, randomLook } from '@/lib/avatar';
import { Name, describe, fxName, type ShopItem } from '@/lib/shop';
import { Bar, Ic } from './ui';

interface ShopData {
  items: ShopItem[];
  catalog: ShopItem[];
  next: number;
}

const two = (n: number) => String(n).padStart(2, '0');

// Le temps qu'il reste avant le prochain tirage, à la seconde.
function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, Math.floor((until - now) / 1000));
  return <time className="shop-clock" role="timer">{two(Math.floor(left / 3600))}:{two(Math.floor((left % 3600) / 60))}:{two(left % 60)}</time>;
}

// Le magasin : à gauche la bourse du joueur, comment la remplir et l'effet que porte son
// pseudo ; à droite les quatre articles du jour, les mêmes pour tout le monde, puis toute
// la collection, pour voir ce qui reviendra un autre jour.
export default function Shop() {
  const { ready, account, avatar, name } = useApp();
  const t = useT();
  const [shop, setShop] = useState<(ShopData & { until: number }) | null>(null);
  const [busy, setBusy] = useState('');
  useEffect(() => {
    App.api<ShopData>('/api/shop').then((s) => setShop({ ...s, until: Date.now() + s.next * 1000 })).catch((err: Error) => App.toast(err.message));
  }, []);
  if (!ready) return null;
  const look = parse(avatar) ?? randomLook();
  const credits = account?.credits ?? 0;
  const owned = account?.items ?? [];
  const fxOwned = owned.filter((i) => i.startsWith('fx:')).map((i) => i.slice(3));
  const today = new Set(shop?.items.map((i) => i.id));
  const catalog = shop?.catalog ?? [];
  const have = catalog.filter((i) => owned.includes(i.id)).length;
  const buy = async (item: ShopItem) => {
    setBusy(item.id);
    try {
      await App.buy(item.id);
      App.toast(t(`${describe(item.id, t).name} : acheté !`, `${describe(item.id, t).name}: bought!`));
    } catch (err) {
      App.toast((err as Error).message);
    }
    setBusy('');
  };
  const wear = (fx: string) => App.setFx(fx).catch((err: Error) => App.toast(err.message));

  return (
    <div className="profile shop">
      <section className="paper">
        <h1>{t('Magasin', 'Shop')}</h1>
        <p className="pitch">{t('Quatre articles par jour, les mêmes pour tout le monde, payés avec les crédits gagnés en jouant.', 'Four items a day, the same for everyone, paid with the credits you earn by playing.')}</p>

        <div className="panel purse">
          <p className="purse-total">
            <span className="purse-coin chip-sea"><Ic name="coin" /></span>
            <strong>{credits}</strong>
            <span>{t(`crédit${credits > 1 ? 's' : ''}`, `credit${credits === 1 ? '' : 's'}`)}</span>
          </p>
          {account ? (
            <div className="purse-day">
              <p><span>{t('Gagnés aujourd’hui', 'Earned today')}</span><b>{account.earnedToday} / {account.dailyCap}</b></p>
              <Bar value={account.earnedToday} max={account.dailyCap} label={t('Crédits gagnés aujourd’hui', 'Credits earned today')} />
            </div>
          ) : (
            <div className="purse-day">
              <p className="hint">{t('Il faut un compte pour gagner des crédits et acheter.', 'You need an account to earn credits and buy.')}</p>
              <button className="btn primary" onClick={() => App.openModal('register')}>{t('Créer un compte', 'Create an account')}</button>
            </div>
          )}
        </div>

        <h2>{t('Gagner des crédits', 'Earning credits')}</h2>
        <ul className="rows earn">
          <li><span>{t('Une victoire', 'A win')}</span><b className="pill">+10</b></li>
          <li><span>{t('Une partie jouée jusqu’au bout', 'A game played to the end')}</span><b className="pill">+2</b></li>
          <li><span>{t('Au plus, par jour', 'At most, per day')}</span><b className="pill">{account?.dailyCap ?? 150}</b></li>
        </ul>

        {account && (
          <>
            <h2>{t('L’effet de votre pseudo', 'Your name effect')}</h2>
            {fxOwned.length === 0 ? (
              <p className="hint">{t('Vous n’en avez pas encore. Ils passent au magasin de temps en temps.', 'You have none yet. They come up in the shop now and then.')}</p>
            ) : (
              <ul className="fx-list" aria-label={t('Effet du pseudo', 'Name effect')}>
                {['', ...fxOwned].map((fx) => (
                  <li key={fx || 'none'}>
                    <button aria-pressed={account.fx === fx} className={account.fx === fx ? 'on' : undefined} onClick={() => wear(fx)}>
                      <b><Name name={name} fx={fx} /></b>
                      <small>{fx ? fxName(fx, t) : t('Sans effet', 'No effect')}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="sea sheet shop-sea">
        <header className="shop-head">
          <h2 id="shop-today">{t('Aujourd’hui', 'Today')}</h2>
          <p>{t('Nouveaux articles dans', 'New items in')} {shop ? <Countdown until={shop.until} /> : '…'}</p>
        </header>
        <ul className="shop-list" aria-labelledby="shop-today">
          {shop?.items.map((item, i) => {
            const d = describe(item.id, t);
            const has = owned.includes(item.id);
            const short = item.price - credits;
            return (
              <li key={item.id} className={has ? 'shop-item has' : 'shop-item'} style={{ animationDelay: `${i * 60}ms` }}>
                <span className="pill shop-kind">{d.kind}</span>
                <div className="shop-show">
                  {d.fx ? <b className="shop-name"><Name name={name} fx={d.fx} /></b> : <Avatar code={encode({ ...look, [d.slot!]: d.part! })} />}
                  {!d.fx && <span className="shop-part"><PartIcon slot={d.slot!} id={d.part!} /></span>}
                </div>
                <div className="shop-text">
                  <b>{d.name}</b>
                  <small>{d.fx ? t('Votre pseudo, partout où il s’affiche', 'Your name, wherever it shows') : t('Essayé ici sur votre avatar', 'Tried here on your avatar')}</small>
                </div>
                {has ? (
                  <strong className="pill shop-owned"><Ic name="check" />{t('Acheté', 'Bought')}</strong>
                ) : (
                  <button className="btn white" disabled={!account || short > 0 || busy === item.id} onClick={() => buy(item)} aria-label={t(`Acheter ${d.name} pour ${item.price} crédits`, `Buy ${d.name} for ${item.price} credits`)}>
                    <Ic name="coin" />{item.price}
                  </button>
                )}
                {!has && account && short > 0 && (
                  <p className="shop-short">
                    <Bar value={credits} max={item.price} />
                    <small>{t(`Il vous manque ${short} crédit${short > 1 ? 's' : ''}.`, `You are ${short} credit${short === 1 ? '' : 's'} short.`)}</small>
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        <header className="shop-head">
          <h2 id="shop-all">{t('Toute la collection', 'The whole collection')}</h2>
          {account && catalog.length > 0 && <p>{t(`${have} sur ${catalog.length} à vous`, `${have} of ${catalog.length} yours`)}</p>}
        </header>
        <ul className="shop-all" aria-labelledby="shop-all">
          {catalog.map((item) => {
            const d = describe(item.id, t);
            const has = owned.includes(item.id);
            const on = today.has(item.id);
            return (
              <li key={item.id} className={has ? 'has' : on ? 'on' : 'away'}>
                {d.fx ? <span className="shop-part shop-aa"><Name name="Aa" fx={d.fx} /></span> : <span className="shop-part"><PartIcon slot={d.slot!} id={d.part!} /></span>}
                <b>{d.name}</b>
                <small>
                  {has ? <><Ic name="check" />{t('À vous', 'Yours')}</> : on ? t(`En vente, ${item.price} crédits`, `On sale, ${item.price} credits`) : <><Ic name="lock" />{t(`Un autre jour, ${item.price} crédits`, `Another day, ${item.price} credits`)}</>}
                </small>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
