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
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
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

# --------------------------------------------------------------------------
# Talk repair
#
# All three extracted mouth-shape clips are damaged, and the aggregate audit does
# not show how badly. Measured per frame (_research/_talk_repair_sweep.py):
#
#   clip         usable frames   longest contiguous run
#   talk02_IC       1 / 17       [16]           -> unusable
#   talk04_IC       4 / 17       [14,15,16]     -> unusable
#   talk04_DC      14 / 17       [0..7]         -> the only viable source
#
# The defect is `face_ghosted`: the matte under-estimated alpha across the whole
# head (median ~130 where the baseline is 255) and left no enclosed holes to fill.
# The RGB underneath is still the real face for talk04_DC, so restoring a solid
# alpha brings the face back. That is measured, not assumed — colour distance from
# the baseline face is 3.8-31 for talk04_DC and 70-108 for the unusable clips,
# where the background bleeds through instead.
#
# So the talk animation is rebuilt from talk04_DC's contiguous good run with a
# binary alpha, and the other two clips are dropped.
# --------------------------------------------------------------------------
# --------------------------------------------------------------------------
# Alpha repair for every clip
#
# The matte under-estimated alpha across the whole sprite set, not just the talk
# clips. Measured per clip (_research/_audit_all_clips2.py), the share of each
# character that renders semi-transparent:
#
#   blink 8.6%   talk 0.0%      <- sound
#   iceCream 24.6%   chilli 25.6%   pokeKnockout 34.7%   pokeHead 36.7%
#   hungry 49.4%
#
# and the worst of them are visibly wrong, not merely imperfect: `pokeHead` as
# shipped has an opaque-character colour 81 away from the clean baseline.
#
# The repair is a solid alpha — the character is an opaque object, so a pixel is
# present or absent — with the RGB untouched.
#
# The threshold was measured on two axes at once (_research/_threshold_final.py),
# because either alone can be gamed:
#
#   purity    the pixels the repair promotes must look more like the character
#             than like the background. Purity alone always favours a high cut,
#             which punches holes in the character.
#   coverage  kept / present, measured against the clip's OWN matte. Comparing
#             against another clip's pixel count is invalid — poses differ, and a
#             knocked-out character legitimately occupies less of the frame.
#
# Both earlier metrics were wrong in exactly those ways before being corrected.
# At 30 every repairable clip keeps 98-99% of its character with a purity margin
# of 19-58. Two clips fail both bars at every threshold and are dropped instead
# of shipped: `chilli` and `pokeHead` (see UNREPAIRABLE below).
GHOST_THRESHOLD = 30
GHOST_SEMI_MIN = 0.15     # repair only when this share of the character is semi

# The colour behind the character in the source video, sampled from its border
# (the camera is static and the wall never moves there). Measured once with
# _research/_promoted_pixels.py; it is a property of the footage, not a guess.
SOURCE_BACKGROUND_RGB = np.array([87.4, 61.7, 44.4])

# Clips the alpha repair cannot fix, at any threshold.
#
# Their promoted pixels sit closer to the background than to the character at every
# cut tried, which means the RGB underneath is wall, not character — no alpha
# threshold can recover that. States that used them are remapped to clips that were
# verified clean, so every state still resolves to artwork that is visually sound.
UNREPAIRABLE = {
    "chilli": "promoted pixels match the background, not the character",
    "pokeHead": "promoted pixels match the background, not the character",
}

TALK_SOURCE = "talk04_DC"
TALK_FRAMES = (0, 8)          # half-open: the longest contiguous usable run
TALK_ALPHA_THRESHOLD = GHOST_THRESHOLD
TALK_MIN_OPAQUE_FACE = 12000  # a healthy frame keeps about the baseline's share

# state -> clip, how to play it, and what it stands for.
#
#   loop   the animation repeats
#   still  hold one pose (uses the generated PNG, since <img> cannot pause a WebP)
#   breath a slow CSS scale, so a held pose still reads as alive
STATES = {
    # Clips used here are only the ones the audit verified: blink, listen, hungry,
    # iceCream, pokeKnockout, talk. `chilli` and `pokeHead` are dropped because
    # their alpha cannot be repaired, and every state that used them is remapped so
    # no state can resolve to a ghosted face.
    "idle":     {"clip": "blink",        "loop": True,  "breath": True,  "why": "眨眼循环，最接近待机"},
    "listen":   {"clip": "listen",       "still": True, "breath": True,  "why": "专注倾听（单帧）"},
    "think":    {"clip": "hungry",       "still": True, "breath": True,  "why": "期待的神情，用作思考"},
    "work":     {"clip": "blink",        "still": True, "breath": True,  "why": "中性站姿，用作忙碌"},
    "waiting":  {"clip": "hungry",       "loop": True,                   "why": "等待 / 期待"},
    "talk":     {"clip": "talk",         "loop": True,                   "why": "说话口型（已修复 alpha）"},
    "happy":    {"clip": "iceCream",     "loop": True,                   "why": "吃冰淇淋，用作开心"},
    "eat":      {"clip": "iceCream",     "loop": True,                   "why": "吃东西（原用 chilli，已换）"},
    "sad":      {"clip": "pokeKnockout", "still": True,                  "why": "被戳晕的呆滞，用作低落"},
    "sleep":    {"clip": "blink",        "still": True, "breath": True,  "why": "闭眼帧，用作睡眠"},
    "poke":     {"clip": "pokeKnockout", "loop": True,                   "why": "被戳的反应（原用 pokeHead，已换）"},
    "knockout": {"clip": "pokeKnockout", "loop": True,                   "why": "被戳晕（完整动作）"},
    "hungry":   {"clip": "hungry",       "loop": True,                   "why": "饥饿"},
}

# Mouth shapes used while speaking.
#
# The three raw mouth-shape clips are all damaged, so the rotation is a single
# repaired clip: `talk`, rebuilt from talk04_DC's contiguous good run (see the
# talk-repair notes above). Listing the damaged originals here would put a ghosted
# face on screen a third of the time.
TALK_VARIANTS = ["talk"]


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
# The band of the canvas that holds the head, in rows. Derived from the baseline
# clip's silhouette, which starts at about row 59 and reaches the shoulders by 200.
FACE_BAND = (60, 200)


def face_reference() -> np.ndarray | None:
    """The baseline face colour, taken from the one clip known to be clean.

    `blink` is fully opaque (its audit reports 100% clean frames), so the mean
    colour of its opaque head pixels is what a correct face looks like.
    """
    path = SRC / "blink.webp"
    if not path.is_file():
        return None
    try:
        with Image.open(path) as im:
            im.seek(0)
            arr = np.array(im.convert("RGBA"))
    except Exception as exc:  # noqa: BLE001
        print(f"  note: could not read {path.name}: {type(exc).__name__}: {exc}")
        return None
    band = slice(FACE_BAND[0], FACE_BAND[1])
    solid = arr[band, :, 3] >= 251
    if not solid.any():
        return None
    return arr[band, :, :3][solid].astype(np.float64).mean(axis=0)


def face_stats_from_array(arr: np.ndarray, baseline: np.ndarray) -> dict:
    """Opaque head pixels and how far the face colour drifted from the baseline.

    The distance is the discriminator that matters: a repaired frame whose face
    colour is still close to the baseline had a wrong alpha over a real face,
    whereas a large distance means background is showing through instead.
    """
    band = slice(FACE_BAND[0], FACE_BAND[1])
    solid = arr[band, :, 3] >= 251
    count = int(solid.sum())
    if count == 0:
        return {"opaqueFace": 0, "distance": 999.0}
    rgb = arr[band, :, :3][solid].astype(np.float64).mean(axis=0)
    return {"opaqueFace": count, "distance": float(np.linalg.norm(rgb - baseline))}


def check_alpha(path: Path, label: str) -> bool:
    """Whether an image keeps a transparent background and an opaque subject.

    Applied to every produced artifact, because losing the alpha channel is the
    failure mode that turns the pet into an opaque rectangle — and a lossy WebP
    re-encode is exactly where that can happen silently.
    """
    try:
        with Image.open(path) as im:
            rgba = im.convert("RGBA")
            total = rgba.size[0] * rgba.size[1]
            hist = rgba.getchannel("A").histogram()
    except Exception as exc:  # noqa: BLE001
        print(f"    FAIL {label}: unreadable ({type(exc).__name__}: {exc})")
        return False

    clear = hist[0] / total
    solid = hist[255] / total
    ok = clear >= ALPHA_CLEAR_MIN and solid >= ALPHA_SOLID_MIN
    print(f"    alpha {label}: clear={clear * 100:.1f}%  solid={solid * 100:.1f}%")
    if not ok:
        print(f"    FAIL {label}: alpha out of range "
              f"(clear>={ALPHA_CLEAR_MIN * 100:.0f}%, solid>={ALPHA_SOLID_MIN * 100:.0f}%)")
    return ok


def semi_fraction(arr: np.ndarray) -> float:
    """Share of the character that is neither absent nor fully opaque.

    This is the ghosting metric, and it is pose-independent: it is measured over
    whatever pixels are present, so a clip where the character lies down scores the
    same way as one where it stands. A fixed region of the canvas cannot do that —
    an earlier audit applied to `pokeKnockout` reported the contradictory pair
    "0% semi-transparent, 0 opaque pixels" because the head had moved out of the
    assumed band.
    """
    a = arr[:, :, 3]
    present = a > 8
    if not present.any():
        return 0.0
    return float(((a > 8) & (a <= 251)).sum() / present.sum())


def install_clip(name: str, source: Path, dest: Path) -> dict | None:
    """Copy a clip, repairing its alpha when the matte under-estimated it.

    A clip whose alpha is already sound is copied through untouched — binarising a
    good alpha would only make a soft edge jagged.

    A repair is only accepted if the pixels it promoted look more like the character
    than like the background. That check is what catches an unfixable clip: for
    `chilli` and `pokeHead` the promoted pixels match the wall at every threshold,
    meaning the RGB underneath is background and no alpha cut can recover it. Those
    are refused rather than shipped, and their states are remapped.

    @returns a manifest entry, or None when the clip cannot be produced.
    """
    if not source.is_file():
        print(f"  FAIL {name}: {source.name} not found")
        return None

    frames: list[np.ndarray] = []
    try:
        with Image.open(source) as im:
            for index in range(getattr(im, "n_frames", 1)):
                im.seek(index)
                frames.append(np.array(im.convert("RGBA")))
    except Exception as exc:  # noqa: BLE001
        print(f"  FAIL {name}: unreadable ({type(exc).__name__}: {exc})")
        return None

    if not frames:
        print(f"  FAIL {name}: no frames")
        return None

    median_semi = float(np.median([semi_fraction(f) for f in frames]))
    repaired = median_semi > GHOST_SEMI_MIN

    if repaired:
        # Measure before repairing: the promotion check needs the original alpha to
        # know which pixels the cut is about to make opaque.
        promoted_rgbs = []
        character_rgbs = []
        for arr in frames:
            a = arr[:, :, 3]
            promoted = (a >= GHOST_THRESHOLD) & (a <= 251)
            if promoted.sum() > 50:
                promoted_rgbs.append(arr[:, :, :3][promoted].astype(np.float64).mean(axis=0))
            if (a >= 251).sum() > 50:
                character_rgbs.append(arr[:, :, :3][a >= 251].astype(np.float64).mean(axis=0))

        if promoted_rgbs:
            promoted = np.mean(promoted_rgbs, axis=0)
            character = np.mean(character_rgbs, axis=0) if character_rgbs else np.zeros(3)
            char_dist = float(np.linalg.norm(promoted - character))
            bg_dist = float(np.linalg.norm(promoted - SOURCE_BACKGROUND_RGB))
            margin = bg_dist - char_dist
            if margin < 0:
                print(f"  REFUSE {name}: the repair would paint background in "
                      f"(promoted colour is {char_dist:.1f} from the character but "
                      f"{bg_dist:.1f} from the background)")
                return None
            print(f"    {name}: promoted pixels {char_dist:.1f} from the character, "
                  f"{bg_dist:.1f} from the background (margin {margin:+.1f})")

        # Solid alpha only; the RGB is untouched, so no colour is invented.
        for arr in frames:
            arr[:, :, 3] = np.where(arr[:, :, 3] >= GHOST_THRESHOLD, 255, 0)

    work = Path(tempfile.mkdtemp(prefix=f"clip-{name}-"))
    for index, arr in enumerate(frames):
        Image.fromarray(arr, "RGBA").save(work / f"f{index:04d}.png")

    cmd = [
        "ffmpeg", "-v", "error",
        "-framerate", "30",
        "-i", str(work / "f%04d.png"),
        "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", "78",
        "-loop", "0", "-an", "-f", "webp",
        str(dest), "-y",
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0 or not dest.is_file() or dest.stat().st_size <= 0:
        detail = proc.stderr.decode(errors="replace").strip()[:160]
        print(f"  FAIL {name}: encode failed ({detail or 'no stderr'})")
        return None

    if dest.exists() and not check_alpha(dest, dest.name):
        dest.unlink(missing_ok=True)
        return None

    with Image.open(dest) as im:
        encoded = getattr(im, "n_frames", 1)

    marker = "repaired" if repaired else "as-is"
    print(f"  {dest.name:<22} {dest.stat().st_size / 1024:>6.1f} KB  "
          f"{encoded:>3} frames  semi {median_semi * 100:>5.1f}% -> {marker}")

    return {
        "file": dest.name,
        "frames": encoded,
        "fps": 30,
        "durationSec": round(encoded / 30, 4),
        "static": encoded <= 1,
        "width": frames[0].shape[1],
        "height": frames[0].shape[0],
        "bytes": dest.stat().st_size,
        **({"repaired": f"binary alpha, threshold {GHOST_THRESHOLD}",
            "srcSemiMedian": round(median_semi, 4)} if repaired else {}),
    }


def build_repaired_talk() -> dict | None:
    """Rebuild the speaking animation from the one viable source clip.

    The raw mouth-shape clips are unusable as shipped: the matte under-estimated
    alpha across the whole head, so the face renders as a semi-transparent ghost.
    Frames were measured individually, and only `talk04_DC` keeps a long enough run
    of frames whose face colour survives a solid-alpha repair.

    Two properties are asserted rather than assumed:
      - the repaired frames keep enough opaque face pixels to look like a face
      - the face colour stays close to the baseline, which is what distinguishes
        "alpha was wrong but the face is there" from "background bleeds through"

    @returns a clip entry for the manifest, or None when the repair does not hold.
    """
    src_webp = SRC / f"{TALK_SOURCE}.webp"
    if not src_webp.is_file():
        print(f"  FAIL talk repair: {src_webp.name} not found")
        return None

    baseline_face = face_reference()
    if baseline_face is None:
        print("  FAIL talk repair: could not derive a baseline face colour")
        return None

    first, last = TALK_FRAMES
    work = Path(tempfile.mkdtemp(prefix="talk-repair-"))
    frames: list[Path] = []

    try:
        with Image.open(src_webp) as im:
            total = getattr(im, "n_frames", 1)
            if last > total:
                print(f"  FAIL talk repair: {src_webp.name} has {total} frames, "
                      f"needed {last}")
                return None
            for index in range(first, last):
                im.seek(index)
                rgba = im.convert("RGBA")
                arr = np.array(rgba)
                # Solid alpha: the character is an opaque object, so a pixel is
                # present or absent. This is the repair — the RGB is untouched.
                arr[:, :, 3] = np.where(arr[:, :, 3] >= TALK_ALPHA_THRESHOLD, 255, 0)

                face = face_stats_from_array(arr, baseline_face)
                if face["opaqueFace"] < TALK_MIN_OPAQUE_FACE or face["distance"] >= 45:
                    print(f"  FAIL talk repair: frame {index} unusable "
                          f"(opaqueFace={face['opaqueFace']} distance={face['distance']:.1f})")
                    return None

                out = work / f"f{len(frames):03d}.png"
                Image.fromarray(arr, "RGBA").save(out)
                frames.append(out)
    except Exception as exc:  # noqa: BLE001 - report, never fail silently
        print(f"  FAIL talk repair: {type(exc).__name__}: {exc}")
        return None

    if not frames:
        print("  FAIL talk repair: no frames survived")
        return None

    target = DEST / "talk.webp"
    cmd = [
        "ffmpeg", "-v", "error",
        "-framerate", "30",
        "-i", str(work / "f%03d.png"),
        "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", "78",
        "-loop", "0", "-an", "-f", "webp",
        str(target), "-y",
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0 or not target.is_file() or target.stat().st_size <= 0:
        detail = proc.stderr.decode(errors="replace").strip()[:200]
        print(f"  FAIL talk repair: encode failed ({detail or 'no stderr'})")
        return None

    # The encoded result must still be transparent — a lossy WebP encode is where
    # alpha would silently disappear, turning the pet into a rectangle.
    if not check_alpha(target, "talk.webp"):
        target.unlink(missing_ok=True)
        return None

    with Image.open(target) as im:
        encoded_frames = getattr(im, "n_frames", 1)
    print(f"  talk.webp  {target.stat().st_size / 1024:.1f} KB  "
          f"({len(frames)} frames from {TALK_SOURCE}[{first}..{last - 1}], "
          f"re-encoded as {encoded_frames}; face verified per frame)")

    return {
        "file": target.name,
        "frames": encoded_frames,
        "fps": 30,
        "durationSec": round(encoded_frames / 30, 4),
        "static": encoded_frames <= 1,
        "width": 322,
        "height": 430,
        "bytes": target.stat().st_size,
        "source": f"{TALK_SOURCE}.webm",
        "sourceRange": [first, last - 1],
        "repaired": "binary alpha, threshold %d" % TALK_ALPHA_THRESHOLD,
    }


def main() -> int:
    if not SRC.is_dir():
        raise SystemExit(f"converted clips not found: {SRC}")
    # NB: build the paths as UTF-8-safe strings; the manifest is written by Python
    # (never by a shell), so the Chinese labels below cannot be double-encoded.
    manifest_in = json.loads((SRC / "manifest.json").read_text(encoding="utf-8"))
    by_name = {c["name"]: c for c in manifest_in["clips"]}

    DEST.mkdir(parents=True, exist_ok=True)

    # Which clips the states need, plus every talk variant.
    needed = {spec["clip"] for spec in STATES.values()} | set(TALK_VARIANTS)

    # A state must never resolve to a clip whose alpha cannot be repaired; that is
    # how a ghosted face would reach the screen. Checked here so a future edit to
    # STATES fails loudly instead of shipping.
    misrouted = {s: spec["clip"] for s, spec in STATES.items()
                 if spec["clip"] in UNREPAIRABLE}
    if misrouted:
        print("FAIL: these states map to clips that cannot be repaired:")
        for state, clip in misrouted.items():
            print(f"  {state} -> {clip}  ({UNREPAIRABLE[clip]})")
        return 1

    # The speaking animation is rebuilt, not copied: the raw mouth-shape clips are
    # damaged and would put a ghosted face on screen. `talk` replaces them.
    print("building the talking animation")
    if build_repaired_talk() is None:
        print("  the talking animation could not be rebuilt — see the failure above")
        return 1
    talk_file = DEST / "talk.webp"
    with Image.open(talk_file) as im:
        talk_frames = getattr(im, "n_frames", 1)
    by_name["talk"] = {
        "file": talk_file.name,
        "frames": talk_frames,
        "fps": 30,
        "durationSec": round(talk_frames / 30, 4),
        "static": talk_frames <= 1,
        "width": 322,
        "height": 430,
        "bytes": talk_file.stat().st_size,
        "source": f"{TALK_SOURCE}.webm",
        "repaired": "binary alpha, threshold %d" % TALK_ALPHA_THRESHOLD,
    }
    print()

    # Copy the clips the states use, repairing alpha where the matte under-estimated
    # it. Copying everything would leave the three damaged mouth-shape clips on disk
    # as unreferenced orphans, and the manifest test rightly flags those.
    print("installing clips")
    copied = 0
    installed: dict[str, dict] = {}
    for name in sorted(needed):
        info = by_name.get(name)
        if not info:
            print(f"  MISSING clip: {name}")
            continue
        if name == "talk":
            continue  # already written by the repair step
        source = SRC / str(info.get("file", ""))
        entry = install_clip(name, source, DEST / str(info.get("file", "")))
        if entry is None:
            failed.append(name)
            continue
        # Carry the upstream provenance the manifest reports.
        for extra in ("still", "note"):
            if info.get(extra):
                entry[extra] = info[extra]
        installed[name] = entry
        copied += 1
    print()

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
        # `installed` holds what was actually written (with its measured frame count
        # and repair status); `by_name` is the fallback for entries that come from
        # the extraction manifest directly.
        entry = installed.get(name)
        if entry is None:
            if name not in by_name:
                print(f"  state references unknown clip: {name}")
                continue
            info = by_name[name]
            # `usedFrames`/`sourceFrames` are the upstream extraction manifest's
            # names; `frames` is this script's canonical one for entries it builds
            # itself. Reading only the upstream names silently reported the repaired
            # talk clip as a single frame.
            frame_count = info.get("usedFrames", info.get("sourceFrames", info.get("frames", 1)))
            entry = {
                "file": info["file"],
                "frames": frame_count,
                "fps": info.get("fps", 30),
                "durationSec": info.get("durationSec", 0),
                "static": info.get("static", False),
                "width": info.get("width", 322),
                "height": info.get("height", 430),
                "bytes": info.get("bytes", 0),
            }
            for extra in ("source", "repaired", "note"):
                if info.get(extra):
                    entry[extra] = info[extra]
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
