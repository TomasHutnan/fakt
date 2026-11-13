#!/usr/bin/env python3
"""Count words/phrases in the Dano Drevo subtitles (reproducible counts for the quiz).

Usage: python3 -I scripts/dano-drevo-counts.py [srt_dir] [--show <term label prefix>]
Default srt_dir: reference/Dano Drevo (owner's subtitles, not in git)

Rules:
- Only subtitle text lines count (cue numbers and timestamp lines are dropped).
- Song-title tags in square brackets, e.g. "[Miro Žbirka - Biely kvet]", are removed first.
- Matching is case-insensitive, Unicode-aware; every regex match is one occurrence
  (a cue with "Gábor! Gábor!" counts twice). Duplicate cues in the .srt count as they are.
"""
import re
import sys
from pathlib import Path

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
SHOW = sys.argv[sys.argv.index("--show") + 1] if "--show" in sys.argv else None
if SHOW: ARGS.remove(SHOW)
DIR = Path(ARGS[0]) if ARGS else Path(__file__).resolve().parent.parent / "reference" / "Dano Drevo"
FILMS = {
    "komnata": DIR / "Dano Drevo a tajomna komnata 1080p.sk.srt",
    "turnaj": DIR / "Dano Drevo a turnaj Mekyho Žbirku.sk.srt",
}

B = r"(?<![\w])"  # word start
E = r"(?![\w])"   # word end

TERMS = {
    # neutral
    "kôň (kôň, koňa, koňom, kone, koní, koňmi…)": B + r"(kôň|koň(a|ovi|om|mi|och|u)?|kone|koní)" + E,
    "Synek (Synek, Syneka, Synekom, Synekovi, Sinek…)": B + r"s[yi]nek\w*",
    "inžinier* (inžinieri, inžinierov…)": B + r"inžinier\w*",
    "Rokfort* (Rokfort, Rokforte, Rokfortu, rokfortský…)": B + r"rokfort\w*",
    "Žbirk* (Žbirka, Žbirku, Žbirkov…; bez názvov skladieb)": B + r"žbirk\w*",
    "Gábor* (Gábor, Gábora, Gáborov…)": B + r"gábor\w*",
    "ryšav* (ryšavé, ryšavec, ryšavci, ryšavka…)": B + r"ryšav\w*",
    "ryšavé prasa / ryšavé prasce / ryšavých prasatách": B + r"ryšav\w*\s+pras\w*",
    "prasa* (prasa, prasce, prasatá, prasiak, prasiatko…)": B + r"pras(a|ce|at|ia|ač|ac|iat)\w*",
    "Paťo (Paťo, Paťa, Paťovi, Paťom…)": B + r"pať(o|a|ovi|om|ov\w*)" + E,
    # spicy
    "kurv* (kurva, kurvy, kurvu, kurví, kurvinej…; bez skurv-)": B + r"kurv\w*",
    "skurv* (skurvený, skurvysyn…)": B + r"skurv\w*",
    "kokot* (kokot, kokota, kokoti, kokotiny…)": B + r"kokot\w*",
    "pič* (piča, piče, piči, pičovina, pičus…)": B + r"pič\w*",
    "*jeb* (jebem, jebo, najebal, vyjebaný…)": r"\w*jeb\w*",
    "hovn*/hovien/hován (hovno, hovná, hovien, hován…)": B + r"(hovn\w*|hovien|hován\w*)",
    "Cigán* / Cigoš* (Cigán, Cigáň, cigánsky, Cigánky, Cigoš…)": B + r"(cig[aá][nň]\w*|cigoš\w*)",
    "Róm* (Róm, Rómom, Romák, rómsky, Rómovia…; bez roman-)": B + r"r[oó]m(?!an)\w*",
    "Maďar* (Maďar, Maďari, maďarský, maďarčina…)": B + r"maďar\w*",
    "Žid* (Žid, Židia, Židov, židovský, židoboľševik…)": B + r"žid\w*",
    "černoch* / černosi": B + r"čern(och|osi|oš)\w*",
    "buzerant* / buzna / buzny": B + r"(buzerant\w*|buzn\w*)",
    "Starý Jano (všetky pády, aj „Starý Jánoš“)": B + r"star\w*\s+j[aá]n\w*",
    "Šlota* (Šlota, Šlotu, Šlotovi…)": B + r"šlot\w*",
    "fajč*/fajk*/vyfaj* — fajčenie v zmysle orálneho sexu sa nedá oddeliť; neuvádzané": None,
}


def lines(path: Path):
    txt = path.read_text(encoding="utf-8-sig").replace("\r", "")
    out = []
    for ln in txt.split("\n"):
        s = ln.strip()
        if not s or re.fullmatch(r"\d+", s) or "-->" in s:
            continue
        s = re.sub(r"\[[^\]]*\]", " ", s)  # drop song-title tags
        out.append(s)
    return out


def main():
    text = {k: lines(p) for k, p in FILMS.items()}
    print(f"{'term':66} {'komnata':>8} {'turnaj':>7} {'spolu':>6}")
    for label, rx in TERMS.items():
        if rx is None:
            continue
        r = re.compile(rx, re.IGNORECASE)
        c = {k: sum(len(r.findall(l)) for l in ls) for k, ls in text.items()}
        print(f"{label:66} {c['komnata']:>8} {c['turnaj']:>7} {c['komnata'] + c['turnaj']:>6}")
    if SHOW:  # --show <label prefix>: list every matching line
        label = next(l for l in TERMS if l.startswith(SHOW))
        pat = re.compile(TERMS[label], re.IGNORECASE)
        for k, ls in text.items():
            for l in ls:
                m = [x.group(0) for x in pat.finditer(l)]
                if m:
                    print(k, "|", ", ".join(m), "|", l)


if __name__ == "__main__":
    main()
