#!/usr/bin/env python3
"""Prépare les images générées pour l'interface. À relancer après avoir remplacé une source.

Le logo (art/brand/src/logo.png) : une tuile bleue aux coins arrondis, déclinée pour
l'en-tête, l'onglet du navigateur et l'écran d'accueil d'un téléphone.

Les illustrations des jeux (art/games/src/<identifiant>.png, fond transparent, de la même
série que le logo) : recadrées sur le dessin, centrées dans un carré et réduites en WebP.

    python3 art/build.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
WEB = ROOT.parent / "web"

im = Image.open(ROOT / "brand" / "src" / "logo.png").convert("RGBA")
inset = round(im.width * 0.012)  # le générateur laisse un liseré clair au bord
im = im.crop((inset, inset, im.width - inset, im.height - inset))
mask = Image.new("L", im.size, 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius=round(im.width * 0.2), fill=255)
im.putalpha(mask)
(WEB / "public" / "brand").mkdir(parents=True, exist_ok=True)
for path, size in [
    (WEB / "public" / "brand" / "logo.webp", 160),
    (WEB / "public" / "brand" / "icon-192.png", 192),
    (WEB / "public" / "brand" / "icon-512.png", 512),
    (WEB / "app" / "icon.png", 96),
    (WEB / "app" / "apple-icon.png", 180),
]:
    im.resize((size, size), Image.LANCZOS).save(path)
    print(f"{path.relative_to(WEB)}  {path.stat().st_size // 1024} Ko")

# Les illustrations des jeux : le générateur cadre chaque dessin à sa façon, on les ramène
# toutes à un carré avec la même marge.
COVER = 640
(WEB / "public" / "games").mkdir(parents=True, exist_ok=True)
for src in sorted((ROOT / "games" / "src").glob("*.png")):
    art = Image.open(src).convert("RGBA")
    art = art.crop(art.getchannel("A").point(lambda a: 255 if a > 24 else 0).getbbox())
    side = round(max(art.size) / 0.9)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(art, ((side - art.width) // 2, (side - art.height) // 2))
    path = WEB / "public" / "games" / f"{src.stem}.webp"
    square.resize((COVER, COVER), Image.LANCZOS).save(path, quality=90, method=6)
    print(f"{path.relative_to(WEB)}  {path.stat().st_size // 1024} Ko")
    # La même en petit, pour les listes et les tuiles.
    small = path.with_name(f"{src.stem}-192.webp")
    square.resize((192, 192), Image.LANCZOS).save(small, quality=90, method=6)
