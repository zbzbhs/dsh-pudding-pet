"""Install the locally-extracted character art into the plugin's local art dir.

The artwork is game-derived and must never reach the public repository. This
script is the *loader*, not the source: it converts and copies the clips into a
git-ignored directory inside the package, then writes the state mapping the
client reads at runtime.

Design notes
------------
* The client bundle cannot fetch arbitrary assets (DSH's client route only serves
  `client.*.js`), so clips are served by a **host** route and the client points
  `<img>` tags at it.
* `assets/local/` is git-ignored, so the public repository keeps shipping only the
  original character. Anyone can drop their own clips there.
* An animated WebP in an `<img>` cannot be paused or seeked, so a state that
  should hold one pose gets a still PNG as well as the animation.
* **Stills are cut from the already-generated animated WebP, not re-decoded from
  the source WebM** (see `extract_still` for the full reasoning). The WebM decode
  is kept only as a fallback when the WebP is missing.
* Every step here is idempotent: re-running overwrites in place, and a still that
  fails its alpha self-check is deleted rather than left behind as a trap for the
  next run.

Run `python tools/install-local-art.py` to install, or
`python tools/install-local-art.py --audit` to alpha-audit `assets/local/`
without touching anything.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

SRC = Path(r"D:\Deepseek Harness file\_assets\tom-webp")
SOURCE_WEBM = Path(r"D:\Deepseek Harness file\_assets\r1\clips")
MANIFEST_IN = Path(r"D:\Deepseek Harness file\_assets\r1\manifest.json")
PKG = Path(r"D:\Deepseek Harness file\dsh-pudding-pet")
DEST = PKG / "assets" / "local"

# A usable still must keep a transparent background and some opaque character.
# Without the first, alpha was lost and the pose renders as an opaque rectangle;
# without the second, the "frame" is a blank or fully-transparent image.
ALPHA_CLEAR_MIN = 0.30   # fraction of alpha == 0 (transparent background)
ALPHA_SOLID_MIN = 0.05   # fraction of alpha == 255 (fully opaque character)

# state -> clip, how to play it, and what it stands for.
#
#   loop   the animation repeats
#   still  hold one pose (uses the generated PNG, since <img> cannot pause a WebP)
#   breath a slow CSS scale, so a held pose still reads as alive
STATES = {
    "idle":     {"clip": "blink",        "loop": True,  "breath": True,  "why": "眨眼循环，最接近待机"},
    "listen":   {"clip": "listen",       "still": True, "breath": True,  "why": "专注倾听（单帧）"},
    "think":    {"clip": "hungry",       "still": True, "breath": True,  "why": "期待的神情，用作思考"},
    "work":     {"clip": "talk04_DC",    "loop": True,                   "why": "嘴部持续动作，用作忙碌"},
    "waiting":  {"clip": "hungry",       "loop": True,                   "why": "等待 / 期待"},
    "talk":     {"clip": "talk04_IC",    "loop": True,                   "why": "说话口型主选"},
    "happy":    {"clip": "iceCream",     "loop": True,                   "why": "吃冰淇淋，用作开心"},
    "sad":      {"clip": "pokeKnockout", "still": True,                  "why": "被戳晕的呆滞，用作低落"},
    "sleep":    {"clip": "blink",        "still": True, "breath": True,  "why": "闭眼帧，用作睡眠"},
    "poke":     {"clip": "pokeHead",     "loop": True,                   "why": "被戳头的反应"},
    "eat":      {"clip": "chilli",       "loop": True,                   "why": "吃东西的剧烈反应"},
    "hungry":   {"clip": "hungry",       "loop": True,                   "why": "饥饿"},
    "knockout": {"clip": "pokeKnockout", "loop": True,                   "why": "被戳晕（完整动作）"},
    "spicy":    {"clip": "chilli",       "loop": True,                   "why": "被辣到"},
}

# Mouth shapes the client rotates through while speaking, so a long reply does not
# repeat one shape.
TALK_VARIANTS = ["talk04_IC", "talk02_IC", "talk04_DC"]


# --------------------------------------------------------------------------- #
# manifest helpers
# --------------------------------------------------------------------------- #
def good_range(name: str, fallback_frames: int) -> tuple[int, int]:
    """The clip's cleanest frame range as *inclusive* (first, last).

    A static clip legitimately declares `longestGoodRange: [0, 0]` — one frame,
    which used to be rejected by a `last > first` guard and replaced with a bogus
    `(0, 30)` fallback. That fallback then asked ffmpeg for frame 15 of a 1-frame
    clip, which matches nothing. Accept the degenerate range instead.
    """
    try:
        manifest = json.loads(MANIFEST_IN.read_text(encoding="utf-8"))
        for clip in manifest.get("clips", []):
            if clip.get("name") == name:
                rng = (clip.get("playback") or {}).get("longestGoodRange")
                if isinstance(rng, list) and len(rng) == 2:
                    first, last = int(rng[0]), int(rng[1])
                    if 0 <= first <= last:
                        return first, last
    except Exception:
        pass
    return 0, max(0, fallback_frames - 1)


def still_frame_index(n_frames: int) -> int:
    """Middle of the clip: the frame least likely to be a transition blend."""
    return max(0, (n_frames - 1) // 2)


# --------------------------------------------------------------------------- #
# alpha helpers
# --------------------------------------------------------------------------- #
def alpha_stats(path: Path) -> tuple[float, float]:
    """(fraction of alpha == 0, fraction of alpha == 255) for one image file."""
    with Image.open(path) as im:
        rgba = im.convert("RGBA")
        total = rgba.size[0] * rgba.size[1]
        hist = rgba.getchannel("A").histogram()
    return hist[0] / total, hist[255] / total


def check_still(path: Path, label: str | None = None) -> bool:
    """Self-check a freshly written still's alpha, loudly.

    Returns False (and prints a WARNING) when the transparent background was lost
    or when there is no opaque character left.
    """
    label = label or path.name
    clear, solid = alpha_stats(path)
    print(f"    alpha {label}: clear={clear * 100:.1f}%  solid={solid * 100:.1f}%")
    ok = True
    if clear <= ALPHA_CLEAR_MIN:
        ok = False
        print(f"    WARNING: {label} is mostly opaque "
              f"(clear={clear * 100:.1f}% <= {ALPHA_CLEAR_MIN * 100:.0f}%) — alpha was lost")
    if solid <= ALPHA_SOLID_MIN:
        ok = False
        print(f"    WARNING: {label} has almost no opaque pixels "
              f"(solid={solid * 100:.1f}% <= {ALPHA_SOLID_MIN * 100:.0f}%) — blank frame?")
    return ok


# --------------------------------------------------------------------------- #
# still extraction
# --------------------------------------------------------------------------- #
def extract_still_pil(webp_path: Path, out_path: Path) -> bool:
    """Export the middle frame of an animated WebP as a transparent PNG."""
    if not webp_path.is_file():
        print(f"    FAIL {out_path.name}: source animation missing ({webp_path})")
        return False
    try:
        with Image.open(webp_path) as im:
            n_frames = getattr(im, "n_frames", 1)
            index = still_frame_index(n_frames)
            im.seek(index)
            im.convert("RGBA").save(out_path, "PNG")
    except Exception as exc:  # noqa: BLE001 - report anything PIL throws
        print(f"    FAIL {out_path.name}: PIL could not export from "
              f"{webp_path.name}: {type(exc).__name__}: {exc}")
        return False
    if not out_path.is_file():
        print(f"    FAIL {out_path.name}: PIL returned without writing a file")
        return False
    if out_path.stat().st_size <= 0:
        print(f"    FAIL {out_path.name}: PNG was created but is empty (0 bytes)")
        return False
    return True


def extract_still_ffmpeg(name: str, out_path: Path, frames: int) -> bool:
    """Fallback: decode one frame straight out of the source WebM."""
    source = SOURCE_WEBM / f"{name}.webm"
    if not source.is_file():
        print(f"    FAIL {out_path.name}: source clip missing ({source})")
        return False

    cmd = [
        "ffmpeg", "-v", "error",
        # The alpha-preserving decoder flag is not optional: without it every
        # pixel comes back opaque and the pose renders as a rectangle.
        "-c:v", "libvpx-vp9",
        "-i", str(source),
    ]
    if frames <= 1:
        # A 1-frame clip has no frame n=K for any K>0, so a select filter can only
        # match by accident. Take the only frame that exists.
        cmd += ["-frames:v", "1"]
    else:
        start, end = good_range(name, frames)
        frame = start + max(0, (end - start) // 2)
        cmd += ["-vf", f"select=eq(n\\,{frame})", "-frames:v", "1"]
    cmd += ["-pix_fmt", "rgba", str(out_path), "-y"]

    try:
        proc = subprocess.run(cmd, capture_output=True)
    except FileNotFoundError as exc:
        print(f"    FAIL {out_path.name}: ffmpeg is not runnable: {exc}")
        return False
    if proc.returncode != 0:
        detail = proc.stderr.decode(errors="replace").strip()[:200]
        print(f"    FAIL {out_path.name}: ffmpeg exit {proc.returncode} ({detail or 'no stderr'})")
        return False
    if not out_path.is_file():
        # ffmpeg exits 0 when a select filter matches nothing — the old silent loss.
        print(f"    FAIL {out_path.name}: ffmpeg exit 0 but wrote no file "
              f"({name} has {frames} frame(s))")
        return False
    if out_path.stat().st_size <= 0:
        print(f"    FAIL {out_path.name}: ffmpeg wrote an empty file")
        return False
    return True


def extract_still(name: str, out_path: Path, frames: int, webp_path: Path) -> bool:
    """Write one representative frame as a transparent PNG.

    Primary path: export the frame out of the **already-generated animated WebP**
    with PIL. Reasons, in order of importance:

    1. `select=eq(n\\,K)` cannot express "the only frame" of a single-frame clip.
       `listen` is frames=1 / static=true, and every K>0 matches nothing — ffmpeg
       still exits 0 and writes no file. That is exactly how `listen.still.png`
       went missing without a single word of complaint. PIL frame indexing has no
       such failure mode.
    2. The WebP is already the alpha-verified artifact: it was produced through the
       mandatory `-c:v libvpx-vp9` decode and its per-frame alpha was checked when
       the sprite set was built. Reusing it cannot reintroduce the "opaque
       rectangle" bug, and no second decode of the source is needed.
    3. The WebP holds exactly the clip's clean range (`playback.longestGoodRange`),
       so indexing its middle is the same "middle of the cleanest range" the old
       ffmpeg path was aiming for.

    The WebM/ffmpeg decode stays as a fallback for when the WebP is missing. Any
    failure prints a reason; nothing returns False silently.
    """
    if out_path.exists():
        out_path.unlink()  # never leave a stale still sitting behind a failure

    if webp_path.is_file():
        ok = extract_still_pil(webp_path, out_path)
        method = f"{webp_path.name}[frame {still_frame_index(_nframes(webp_path))}] via PIL"
    else:
        print(f"    note: {webp_path.name} not found — falling back to the source WebM")
        ok = extract_still_ffmpeg(name, out_path, frames)
        method = f"{name}.webm via ffmpeg"

    if not ok:
        if out_path.exists():
            out_path.unlink()
        return False

    if not check_still(out_path):
        print(f"    FAIL {out_path.name}: alpha self-check rejected this still — removed")
        out_path.unlink(missing_ok=True)
        return False

    print(f"  {out_path.name}  {out_path.stat().st_size / 1024:.1f} KB  ({method})")
    return True


def _nframes(webp_path: Path) -> int:
    with Image.open(webp_path) as im:
        return getattr(im, "n_frames", 1)


# --------------------------------------------------------------------------- #
# audit
# --------------------------------------------------------------------------- #
def audit_local() -> int:
    """Alpha-audit every image in `assets/local/`. Read-only.

    Per file the verdict follows the stated rule on the first frame: alpha == 0
    must cover > ALPHA_CLEAR_MIN (transparent background) and alpha == 255 must
    cover > ALPHA_SOLID_MIN (an opaque character is actually drawn). A still has
    exactly one frame, so its only frame is also its first.

    Animated WebPs additionally get *every* frame walked, because one broken frame
    is invisible behind 30 healthy ones. Two frame-level defects are called out:
      * near-empty frame — alpha == 0 covers >= 99% of the frame (the pose is gone)
      * opaque frame     — alpha == 0 covers 0% (alpha was lost on that frame)
    """
    if not DEST.is_dir():
        print(f"nothing to audit: {DEST} does not exist")
        return 1

    files = sorted(
        p for p in DEST.iterdir() if p.is_file() and p.suffix.lower() in {".webp", ".png"}
    )
    if not files:
        print(f"nothing to audit: no images in {DEST}")
        return 1

    print(f"alpha audit of {DEST}")
    print(f"per-file rule (first frame): alpha=0% > {ALPHA_CLEAR_MIN * 100:.0f}"
          f" and alpha=255% > {ALPHA_SOLID_MIN * 100:.0f}")
    print()
    header = (f"{'file':<22}{'size':>10}{'px':>10}{'frames':>7}{'first a=0%':>11}"
              f"{'first a=255%':>13}{'min a=0%':>10}{'min a=255%':>11}  verdict")
    print(header)
    print("-" * len(header))

    failures: list[str] = []
    notes: list[str] = []

    for path in files:
        with Image.open(path) as im:
            n_frames = getattr(im, "n_frames", 1)
            width, height = im.size
        total = width * height
        first_clear, first_solid = alpha_stats(path)

        min_clear, min_solid = first_clear, first_solid
        if n_frames > 1:
            min_clear, min_solid = 1.0, 1.0
            near_empty: list[int] = []
            opaque_frames: list[int] = []
            sparse: list[tuple[int, float, float]] = []
            with Image.open(path) as im:
                for i in range(n_frames):
                    im.seek(i)
                    hist = im.convert("RGBA").getchannel("A").histogram()
                    c, s = hist[0] / total, hist[255] / total
                    min_clear = min(min_clear, c)
                    min_solid = min(min_solid, s)
                    if c >= 0.99:
                        near_empty.append(i)
                    if c == 0.0:
                        opaque_frames.append(i)
                    if s < ALPHA_SOLID_MIN:
                        sparse.append((i, c, s))
            if near_empty:
                notes.append(f"{path.name}: frame(s) {near_empty} are near-empty "
                             f"(alpha=0 >= 99%) — that pose is gone")
            if opaque_frames:
                notes.append(f"{path.name}: frame(s) {opaque_frames} are fully opaque "
                             f"(alpha=0 == 0%) — **alpha lost**, the rectangle bug")
            if sparse:
                shown = ", ".join(
                    f"f{i} (a=0 {c * 100:.1f}% / a=255 {s * 100:.1f}%)" for i, c, s in sparse
                )
                notes.append(f"{path.name}: {len(sparse)}/{n_frames} frame(s) below the "
                             f"alpha=255 floor — {shown}")

        verdict = "PASS"
        if first_clear <= ALPHA_CLEAR_MIN:
            verdict = "FAIL"
            notes.append(f"{path.name}: first frame alpha=0 {first_clear * 100:.1f}% "
                         f"<= {ALPHA_CLEAR_MIN * 100:.0f}% — background is not transparent")
        if first_solid <= ALPHA_SOLID_MIN:
            verdict = "FAIL"
            notes.append(f"{path.name}: first frame alpha=255 {first_solid * 100:.1f}% "
                         f"<= {ALPHA_SOLID_MIN * 100:.0f}% — no opaque character")
        if verdict == "FAIL":
            failures.append(path.name)

        print(f"{path.name:<22}{path.stat().st_size / 1024:>7.1f} KB"
              f"{f'{width}x{height}':>10}{n_frames:>7}"
              f"{first_clear * 100:>10.1f}%{first_solid * 100:>12.1f}%"
              f"{min_clear * 100:>9.1f}%{min_solid * 100:>10.1f}%  {verdict}")

    print()
    if notes:
        print()
        print("frame-level findings:")
        for note in notes:
            print(f"  - {note}")
    print()
    print(f"{len(files) - len(failures)}/{len(files)} files PASS the alpha rule")
    if failures:
        print(f"FAILING: {', '.join(failures)}")
        return 1
    return 0


# --------------------------------------------------------------------------- #
# install
# --------------------------------------------------------------------------- #
def main() -> int:
    if not SRC.is_dir():
        raise SystemExit(f"converted clips not found: {SRC}")
    # NB: build the paths as UTF-8-safe strings; the manifest is written by Python
    # (never by a shell), so the Chinese labels below cannot be double-encoded.
    manifest_in = json.loads((SRC / "manifest.json").read_text(encoding="utf-8"))
    by_name = {c["name"]: c for c in manifest_in["clips"]}

    DEST.mkdir(parents=True, exist_ok=True)

    # Copy the animated clips (never the preview or the helper scripts).
    copied = 0
    for clip in manifest_in["clips"]:
        source = SRC / clip["file"]
        if not source.is_file():
            print(f"  MISSING {clip['file']}")
            continue
        shutil.copy2(source, DEST / clip["file"])
        copied += 1

    # Which clips the states need, plus every talk variant.
    needed = {spec["clip"] for spec in STATES.values()} | set(TALK_VARIANTS)

    # A still for every clip that some state wants to hold.
    want_still = {spec["clip"] for spec in STATES.values() if spec.get("still")}
    stills: dict[str, str] = {}
    failed: list[str] = []
    if want_still:
        print(f"extracting stills for: {', '.join(sorted(want_still))}")
    for name in sorted(want_still):
        out = DEST / f"{name}.still.png"
        info = by_name.get(name, {})
        frames = int(info.get("usedFrames") or info.get("sourceFrames") or 1)
        webp_path = DEST / info.get("file", f"{name}.webp")
        if extract_still(name, out, frames, webp_path):
            stills[name] = out.name
        else:
            failed.append(out.name)
            print(f"    {out.name} NOT produced")

    clips = {}
    for name in sorted(needed):
        if name not in by_name:
            print(f"  state references unknown clip: {name}")
            continue
        info = by_name[name]
        entry = {
            "file": info["file"],
            "frames": info.get("usedFrames", info.get("sourceFrames", 1)),
            "fps": info.get("fps", 30),
            "durationSec": info.get("durationSec", 0),
            "static": info.get("static", False),
            "width": info.get("width", 322),
            "height": info.get("height", 430),
            "bytes": info.get("bytes", 0),
        }
        if name in stills:
            entry["still"] = stills[name]
        clips[name] = entry

    out = {
        "schema": "dsh-pudding-pet/art@1",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "character": {
            "id": "tom",
            "label": "汤姆猫 / Tom",
            "credit": "素材来自本机提取，仅供本地个人使用；不得分发。",
        },
        "canvas": {"width": 322, "height": 430},
        "clips": clips,
        "states": STATES,
        "talkVariants": TALK_VARIANTS,
    }
    (DEST / "manifest.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    files = sorted(p.name for p in DEST.iterdir() if p.is_file())
    total = sum(p.stat().st_size for p in DEST.iterdir() if p.is_file())
    print()
    print(f"copied {copied} clips, {len(stills)} stills -> {DEST}")
    print(f"  files: {len(files)}   total: {total / 1024 / 1024:.2f} MB")
    print()
    print("states -> clips:")
    for state, spec in STATES.items():
        mode = "loop" if spec.get("loop") else ("still" if spec.get("still") else "?")
        extra = " +breath" if spec.get("breath") else ""
        print(f"  {state:<9} {spec['clip']:<14} {mode}{extra}")

    if failed:
        print()
        print(f"ERROR: {len(failed)} still(s) were not produced: {', '.join(failed)}")
        return 1
    return 0


if __name__ == "__main__":
    if "--audit" in sys.argv[1:]:
        raise SystemExit(audit_local())
    raise SystemExit(main())
