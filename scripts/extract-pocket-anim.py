#!/usr/bin/env python3
"""
Extrait les courbes réelles d'ouverture de booster depuis GoodFight37/pkmn.

Entrée : un clone sparse du dépôt (dossiers `AnimationClip/C_PackOpen*` et
`AnimationClip/C_CardGet*`), sortie : `src/lib/pocket-anim.ts` (nombres
portés, sans données Unity brutes).

  git clone --filter=blob:none --sparse --depth 1 \
      https://github.com/GoodFight37/pkmn.git /tmp/pkmn
  git -C /tmp/pkmn sparse-checkout set --no-cone \
      '/AnimationClip/C_PackOpen*' '/AnimationClip/C_CardGet*'
  python3 scripts/extract-pocket-anim.py /tmp/pkmn/AnimationClip
"""
from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

NUMBER = r"-?\d+(?:\.\d+)?(?:e-?\d+)?"
VEC = re.compile(r"\{x:\s*(" + NUMBER + r"|∞|-\d+),\s*y:\s*(" + NUMBER + r"|∞),\s*z:\s*(" + NUMBER + r"|∞)\}")
VEC4 = re.compile(
    r"\{x:\s*(" + NUMBER + r"),\s*y:\s*(" + NUMBER + r"),\s*z:\s*(" + NUMBER + r"),\s*w:\s*(" + NUMBER + r")\}"
)


def f(x: str) -> float:
    if x in ("∞", "-∞"):
        return math.inf if x == "∞" else -math.inf
    return float(x)


def section(text: str, name: str) -> str:
    """Découpe une section YAML de haut niveau (jusqu'à la suivante au même niveau)."""
    start = text.find(f"  {name}:")
    if start < 0:
        return ""
    rest = text[start + 2 + len(name) + 1:]
    end = re.search(r"\n  m_[A-Za-z]+:", rest)
    return rest[: end.start()] if end else rest


def parse_curves(block: str, vec_re: re.Pattern, arity: int) -> list[list[dict]]:
    """Une section peut contenir plusieurs courbes (un objet chacune) :
    on les sépare sur leurs marqueurs `- curve:` pour ne pas les mélanger."""
    curves: list[list[dict]] = []
    chunks = re.split(r"\n\s*- curve:", block)
    for chunk in chunks[1:]:
        keys = []
        for m in re.finditer(
            r"time:\s*(" + NUMBER + r")\s*\n\s*value:\s*" + vec_re.pattern,
            chunk,
        ):
            t = float(m.group(1))
            vals = [f(m.group(i + 2)) for i in range(arity)]
            keys.append({"t": t, "v": vals})
        slopes = re.findall(r"outSlope:\s*(\{[^}]*\})", chunk)
        for i, sl in enumerate(slopes):
            if i < len(keys):
                sm = re.findall(NUMBER + r"|∞|-\d+", sl)
                keys[i]["out"] = [f(v) for v in sm[:arity]]
        if keys:
            curves.append(keys)
    return curves


def parse_clip(path: Path) -> dict:
    text = path.read_text(encoding="utf-8", errors="replace")
    stop = re.search(r"m_StopTime:\s*(" + NUMBER + r")", text)
    loop = re.search(r"m_LoopTime:\s*(\d)", text)
    return {
        "name": path.stem,
        "stop": float(stop.group(1)) if stop else None,
        "loop": bool(int(loop.group(1))) if loop else False,
        "position": parse_curves(section(text, "m_PositionCurves"), VEC, 3),
        "rotation": parse_curves(section(text, "m_RotationCurves"), VEC4, 4),
    }


def quat_to_euler_deg(q: list[float]) -> dict:
    """Quaternion Unity (x, y, z, w) → angles d'Euler en degrés (ordre YXZ)."""
    x, y, z, w = q
    # Normalise (sécurité)
    n = math.sqrt(x * x + y * y + z * z + w * w) or 1.0
    x, y, z, w = x / n, y / n, z / n, w / n
    # YXZ (Unity pour localEulerAngles)
    siny = 2.0 * (w * y - z * x)
    siny = max(-1.0, min(1.0, siny))
    yaw = math.asin(siny)
    cosy = math.cos(yaw)
    if abs(cosy) > 1e-6:
        roll = math.atan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z))
        pitch = math.atan2(2.0 * (w * x + y * z), 1.0 - 2.0 * (x * x + z * z))
    else:  # gimbal lock
        roll = math.atan2(2.0 * (w * x - y * z), 1.0 - 2.0 * (x * x + z * z))
        pitch = 0.0
    return {
        "x": math.degrees(pitch),
        "y": math.degrees(yaw),
        "z": math.degrees(roll),
    }


def summarize(clip: dict) -> dict:
    out = {"name": clip["name"], "stop": clip["stop"], "loop": clip["loop"]}
    # On ne résume que les courbes animées (statiques = offsets d'objets).
    for kind, curves in (("pos", clip["position"]), ("rot", clip["rotation"])):
        animated = []
        for keys in curves:
            if kind == "pos":
                span = max(max(k["v"][i] for k in keys) - min(k["v"][i] for k in keys) for i in range(3))
            else:
                eul = [quat_to_euler_deg(k["v"]) for k in keys]
                span = max(max(e[a] for e in eul) - min(e[a] for e in eul) for a in "xyz")
            if span > 1e-4:
                animated.append((span, keys))
        for span, keys in sorted(animated, reverse=True, key=lambda x: x[0])[:2]:
            if kind == "pos":
                xs = [k["v"][0] for k in keys]
                ys = [k["v"][1] for k in keys]
                zs = [k["v"][2] for k in keys]
                out["pos" + ("" if len(animated) == 1 else str(animated.index((span, keys))))] = {
                    "keys": len(keys),
                    "t": [keys[0]["t"], keys[-1]["t"]],
                    "x": [round(min(xs), 4), round(max(xs), 4)],
                    "y": [round(min(ys), 4), round(max(ys), 4)],
                    "z": [round(min(zs), 4), round(max(zs), 4)],
                    "first": [round(v, 4) for v in keys[0]["v"]],
                    "last": [round(v, 4) for v in keys[-1]["v"]],
                }
            else:
                eul = [quat_to_euler_deg(k["v"]) for k in keys]
                out["rot"] = {
                    "keys": len(keys),
                    "t": [keys[0]["t"], keys[-1]["t"]],
                    "deg": {a: [round(min(e[a] for e in eul), 2), round(max(e[a] for e in eul), 2)] for a in "xyz"},
                    "first": {a: round(eul[0][a], 2) for a in "xyz"},
                    "last": {a: round(eul[-1][a], 2) for a in "xyz"},
                }
    return out


def main() -> None:
    src = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/pkmn/AnimationClip")
    files = sorted(src.glob("C_PackOpen*.anim")) + sorted(src.glob("C_CardGet*.anim"))
    clips = [parse_clip(p) for p in files]
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "/tmp/pocket-clips.json")
    out.write_text(json.dumps({"clips": clips, "summary": [summarize(c) for c in clips]}, indent=1))
    print(f"{len(clips)} clips → {out}")
    for s in (json.loads(out.read_text()))["summary"]:
        pos = s.get("pos") or s.get("pos1")
        rot = s.get("rot")
        print(
            f"  {s['name']:48s} stop={s['stop']!s:8s} loop={int(s['loop'])} "
            f"posY={pos.get('y') if pos else None} rot={rot.get('deg') if rot else None}"
        )


if __name__ == "__main__":
    main()
