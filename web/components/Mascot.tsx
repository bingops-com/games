// Le chat du logo, assis : tête ronde à mèche, oreilles doublées de bleu pâle, sourcil
// décidé, cache-œil navy sur l'œil gauche, collier menthe à médaille. Il cligne de l'œil,
// remue une oreille et balance la queue. Le même dessin que dans slots.
export default function Mascot() {
  return (
    <svg className="mascot" viewBox="0 0 132 150" aria-hidden="true">
      <path className="mascot-tail" d="M92 138c22 2 30-14 24-30-3-8-11-9-14-3" />
      <path className="mascot-fur" d="M32 150c-5-30 6-58 30-58s35 28 30 58z" />
      <g className="mascot-ear-l">
        <path className="mascot-fur" d="M27 48 31 13c1-5 5-6 9-3l20 18z" />
        <path className="mascot-inner" d="M33 41 36 21l13 11z" />
      </g>
      <g className="mascot-ear">
        <path className="mascot-fur" d="M97 48 93 13c-1-5-5-6-9-3L64 28z" />
        <path className="mascot-inner" d="M91 41 88 21 75 32z" />
      </g>
      <path className="mascot-fur" d="M54 27c3-8 9-10 15-10-3 3-3 6-2 9 4-3 8-3 11-2-4 3-5 7-5 11z" />
      <path className="mascot-fur" d="M22 60l-9 5 9 3-6 7 12 1zM102 60l9 5-9 3 6 7-12 1z" />
      <ellipse className="mascot-fur" cx="62" cy="57" rx="38" ry="31" />
      <path className="mascot-brow" d="M38 46 55 50" />
      <g className="mascot-eye">
        <circle className="mascot-ink" cx="47" cy="59" r="7.5" />
        <circle className="mascot-glint" cx="49.5" cy="56" r="2.4" />
      </g>
      <path className="mascot-strap" d="M31 40 99 66" />
      <path className="mascot-ink" d="M66 50h23v8a11.5 11.5 0 0 1-23 0z" />
      <path className="mascot-ink" d="M58 65h8l-4 4z" />
      <path className="mascot-mouth" d="M54 71q4 5 8 0q4 5 8 0" />
      <path className="mascot-collar" d="M36 84q26 13 52 0v8q-26 13-52 0z" />
      <circle className="mascot-tag" cx="62" cy="97" r="6.5" />
    </svg>
  );
}
