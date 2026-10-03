#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""recon-apk.py -- 只读 APK 资源侦察管线。

目的：判断一个 APK 里是否存在"可用的角色美术资源"（网格 + 骨骼 + 贴图），
从而决定桌宠路线是「3D 自渲染」还是「回到视频抠像」。

设计原则：
  * 只读。绝不修改 APK 或任何输入文件；解包只读 zip 流，落盘副本仅到临时目录。
  * 类型判定以**文件头魔数**为准，扩展名只作参考，扩展名与魔数冲突会被单独列出。
  * 任何异常都带文件名与原因打印，**不静默跳过**。

用法：
    python tools/recon-apk.py <apk路径> [--json 报告.json] [--quiet]
                              [--max-files N] [--sample-limit N]
                              [--no-unitypy] [--keep-extract] [--extract-dir DIR]
                              [--no-hash]

退出码：0 成功 / 2 输入文件不可用 / 3 侦察过程致命错误。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import shutil
import sys
import tempfile
import time
import zipfile
from collections import Counter, OrderedDict

SCHEMA = "recon-apk/1"
VERSION = "1.0.0"

# ---------------------------------------------------------------- UnityPy 探测
UNITYPY_AVAILABLE = False
UNITYPY_VERSION = None
UNITYPY_ERROR = None
try:
    import UnityPy  # type: ignore

    UNITYPY_AVAILABLE = True
    UNITYPY_VERSION = getattr(UnityPy, "__version__", None) or "unknown"
except Exception as exc:  # noqa: BLE001 - 缺依赖必须如实报告
    UNITYPY_ERROR = f"{type(exc).__name__}: {exc}"


# ------------------------------------------------------------------ 魔数表
# 分成两档：强魔数（足够长/足够特异）与弱魔数（短或易与 Unity 序列化头撞车）。
# 必须"强魔数 -> Unity 序列化头自洽性 -> 弱魔数"这个顺序：
# 一个 metadata_size=256 的 Unity 序列化文件，前 4 字节正好是 00 00 01 00，
# 与 ICO 魔数完全相同 —— 若把弱魔数放前面就会误判（自测已复现该 bug）。
STRONG_MAGIC_TABLE = [
    (b"UnityFS\x00", "unity_bundle", "AssetBundle/UnityFS", "LZ4/LZMA/无压缩"),
    (b"UnityWeb", "unity_bundle", "AssetBundle/UnityWeb", "LZMA 压缩"),
    (b"UnityRaw", "unity_bundle", "AssetBundle/UnityRaw", "未压缩"),
    (b"UnityArchive", "unity_bundle", "AssetBundle/UnityArchive", "归档"),
    (b"PK\x03\x04", "zip", "ZIP", "可能是 .obb / 嵌套包 / 普通资产包"),
    (b"dex\n", "dex", "Dalvik DEX", ""),
    (b"\x7fELF", "native_lib", "ELF", "Linux/Android 原生库"),
    (b"MZ", "pe", "PE", "Mono 托管 DLL 或 exe"),
    (b"\x89PNG\r\n\x1a\n", "image", "PNG", ""),
    (b"\xff\xd8\xff", "image", "JPEG", ""),
    (b"GIF87a", "image", "GIF", ""),
    (b"GIF89a", "image", "GIF", ""),
    (b"\xabKTX", "texture_compressed", "KTX/KTX2", "GPU 压缩纹理容器"),
    (b"\x13\xab\xa1\x5c", "texture_compressed", "ASTC", "ASTC 原始纹理"),
    (b"DDS ", "texture_compressed", "DDS", ""),
    (b"PVR\x03", "texture_compressed", "PVR v3", "PowerVR"),
    (b"PKM ", "texture_compressed", "PKM", "ETC1/ETC2"),
    (b"OggS", "audio", "Ogg", "Vorbis/Opus"),
    (b"fLaC", "audio", "FLAC", ""),
    (b"ID3", "audio", "MP3", "带 ID3 标签"),
    (b"\x1a\x45\xdf\xa3", "video", "Matroska/WebM", "EBML"),
    (b"DKIF", "video", "IVF", "VP8/VP9"),
    (b"OTTO", "font", "OpenType (CFF)", ""),
    (b"ttcf", "font", "TrueType Collection", ""),
    (b"\x03\x00\x08\x00", "android_binary_xml", "Android 二进制 XML", ""),
    (b"\x02\x00\x0c\x00", "android_arsc", "Android resources.arsc", ""),
]

# 弱魔数：短、通用，或与 Unity 序列化文件头字段空间重叠。
WEAK_MAGIC_TABLE = [
    (b"\x00\x00\x01\x00", "image", "ICO", "弱魔数，与 Unity 序列化头撞车"),
    (b"BM", "image", "BMP", "弱魔数"),
    (b"\x00\x01\x00\x00", "font", "TrueType", "弱魔数"),
    (b"true", "font", "TrueType", "弱魔数"),
    (b"sB", "texture_compressed", "Basis", "弱魔数，Basis Universal"),
    (b"CRN", "texture_compressed", "CRN", "弱魔数，Crunch"),
    (b"\xff\xfb", "audio", "MP3", "弱魔数，无 ID3 的帧同步字"),
    (b"\xff\xf3", "audio", "MP3", "弱魔数，无 ID3 的帧同步字"),
    (b"\xff\xf2", "audio", "MP3", "弱魔数，无 ID3 的帧同步字"),
]

# ISO-BMFF：ftyp 固定在偏移 4，box size 可变，故单独用函数判定
FTYP_OFFSET = 4

# 扩展名兜底：这类格式在 APK 里常常**没有文件头魔数**（裸码流、Unity 内嵌贴图原始数据），
# 只能靠扩展名判断 —— 必须标 confidence="ext"，不能伪装成魔数确认。
# 典型受害者：ffmpeg 抽出来的 animation.vp8（裸 VP8 码流，无 IVF 容器头）。
EXT_KIND_FALLBACK = {
    ".vp8": ("video", "原始 VP8 码流", "裸 VP8 码流无文件头，只能按扩展名判定"),
    ".vp9": ("video", "原始 VP9 码流", "裸 VP9 码流无文件头，只能按扩展名判定"),
    ".webm": ("video", "WebM", "魔数缺失，按扩展名判定"),
    ".mkv": ("video", "Matroska", "魔数缺失，按扩展名判定"),
    ".mp4": ("video", "MP4", "ftyp 头缺失，按扩展名判定"),
    ".mov": ("video", "QuickTime", "魔数缺失，按扩展名判定"),
    ".avi": ("video", "AVI", "魔数缺失，按扩展名判定"),
    ".mp3": ("audio", "MP3", "魔数缺失，按扩展名判定"),
    ".wav": ("audio", "WAV", "魔数缺失，按扩展名判定"),
    ".ogg": ("audio", "Ogg", "魔数缺失，按扩展名判定"),
    ".flac": ("audio", "FLAC", "魔数缺失，按扩展名判定"),
    ".m4a": ("audio", "M4A", "魔数缺失，按扩展名判定"),
    ".aac": ("audio", "AAC", "魔数缺失，按扩展名判定"),
    ".opus": ("audio", "Opus", "魔数缺失，按扩展名判定"),
    ".png": ("image", "PNG", "魔数缺失，按扩展名判定"),
    ".jpg": ("image", "JPEG", "魔数缺失，按扩展名判定"),
    ".jpeg": ("image", "JPEG", "魔数缺失，按扩展名判定"),
    ".webp": ("image", "WebP", "魔数缺失，按扩展名判定"),
    ".tga": ("image", "TGA", "TGA 无魔数，只能按扩展名判定"),
    ".astc": ("texture_compressed", "ASTC", "无容器头，按扩展名判定"),
    ".ktx": ("texture_compressed", "KTX", "魔数缺失，按扩展名判定"),
    ".ktx2": ("texture_compressed", "KTX2", "魔数缺失，按扩展名判定"),
    ".pvr": ("texture_compressed", "PVR", "魔数缺失，按扩展名判定"),
    ".pkm": ("texture_compressed", "PKM", "魔数缺失，按扩展名判定"),
    ".basis": ("texture_compressed", "Basis", "魔数缺失，按扩展名判定"),
    ".dds": ("texture_compressed", "DDS", "魔数缺失，按扩展名判定"),
    ".cubemap": ("unity_other", "Unity Cubemap", "按扩展名判定"),
    ".anim": ("unity_other", "Unity AnimationClip 文本", "按扩展名判定"),
    ".controller": ("unity_other", "Unity AnimatorController", "按扩展名判定"),
}

# 扩展名 -> 期望类型（仅用于"扩展名 vs 魔数"冲突检测）
EXT_EXPECT = {
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".webp": "image",
    ".gif": "image", ".bmp": "image", ".tga": "image",
    ".mp3": "audio", ".ogg": "audio", ".wav": "audio", ".flac": "audio",
    ".m4a": "audio", ".aac": "audio", ".opus": "audio",
    ".mp4": "video", ".webm": "video", ".mkv": "video", ".vp8": "video",
    ".vp9": "video", ".avi": "video", ".mov": "video", ".ivf": "video",
    ".so": "native_lib", ".dll": "pe", ".exe": "pe", ".dex": "dex",
    ".json": "text", ".txt": "text", ".xml": "android_binary_xml",
    ".obb": "zip", ".zip": "zip", ".apk": "zip",
    ".unity3d": "unity_bundle", ".bundle": "unity_bundle", ".ab": "unity_bundle",
}

UNITY_SERIALIZED_HINTS = ("level", "sharedassets", "globalgamemanagers",
                          "resources.assets", "mainData")
UNITY_EXTS = (".assets", ".unity3d", ".bundle", ".ab", ".resource", ".ress")

CATEGORY_LABEL = {
    "unity_bundle": "Unity AssetBundle（按魔数识别）",
    "unity_serialized": "Unity 序列化文件（level*/sharedassets*/*.assets）",
    "unity_stream": "Unity 流式资源（.resS/.resource）",
    "unity_managed": "Unity 托管程序集 / IL2CPP 元数据",
    "unity_other": "Unity 其它文件",
    "zip": "ZIP 容器（obb / 嵌套包）",
    "dex": "Dalvik 字节码",
    "native_lib": "原生库 (.so)",
    "pe": "PE 二进制",
    "image": "图像",
    "texture_compressed": "GPU 压缩纹理容器",
    "audio": "音频",
    "video": "视频",
    "font": "字体",
    "android_binary_xml": "Android 二进制 XML",
    "android_arsc": "resources.arsc",
    "text": "文本/配置",
    "other": "其它",
}

# 需要深扫的对象类型（Unity 类名）
INTERESTING_TYPES = {
    "Mesh", "SkinnedMeshRenderer", "Texture2D", "AnimationClip", "AudioClip",
    "GameObject", "Material", "Shader", "Animator", "AnimatorController",
    "RenderTexture", "Sprite", "Texture2DArray", "Cubemap",
}


# ------------------------------------------------------------------ 工具函数
def u32_be(buf: bytes, off: int = 0) -> int:
    return int.from_bytes(buf[off:off + 4], "big")


def u32_le(buf: bytes, off: int = 0) -> int:
    return int.from_bytes(buf[off:off + 4], "little")


def human_bytes(n) -> str:
    try:
        n = float(n)
    except (TypeError, ValueError):
        return "?"
    for unit in ("B", "KiB", "MiB", "GiB"):
        if n < 1024 or unit == "GiB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024.0
    return f"{n:.1f} GiB"


def looks_like_unity_serialized(head: bytes, real_size: int):
    """Unity 序列化文件没有魔数，靠头部字段自洽性判断。返回 (bool, reason)。"""
    if len(head) < 20:
        return False, "头部不足 20 字节，无法判断"
    meta = u32_be(head, 0)
    file_size = u32_be(head, 4)
    ver = u32_be(head, 8)
    data_off = u32_be(head, 12)
    if not (5 <= ver <= 22):
        return False, f"version={ver} 不在 Unity 支持范围 5..22"
    if meta == 0 or meta > 8 * 1024 * 1024:
        return False, f"metadata_size={meta} 不合理"
    if data_off < meta:
        return False, f"data_offset={data_off} < metadata_size={meta}"
    if file_size < data_off:
        return False, f"file_size={file_size} < data_offset={data_off}"
    if real_size and file_size > real_size:
        return False, f"file_size={file_size} > 实际长度={real_size}"
    return True, f"version={ver}, metadata={meta}, data_offset={data_off}, file_size={file_size}"


def sniff(head: bytes, name: str, size: int):
    """按魔数判定类型。返回 (kind, fmt, note, confidence)。

    判定顺序（关键）：
      1) 强魔数
      2) Unity 序列化文件头部自洽性（无魔数，必须优先于弱魔数）
      3) 弱魔数
      4) 路径/扩展名兜底
    """
    low = name.lower()
    ext = os.path.splitext(low)[1]

    # --- 1) 强魔数 ---
    for magic, kind, fmt, note in STRONG_MAGIC_TABLE:
        if head.startswith(magic):
            return kind, fmt, note, "magic"

    # RIFF 细化
    if head[:4] == b"RIFF" and len(head) >= 12:
        sub = head[8:12]
        if sub == b"WEBP":
            return "image", "WebP", "RIFF/WEBP", "magic"
        if sub == b"WAVE":
            return "audio", "WAV", "RIFF/WAVE", "magic"
        return "riff", f"RIFF/{sub.decode('ascii', 'replace')}", "", "magic"

    # ISO-BMFF (mp4/mov/m4a)：偏移 4 处是 'ftyp'
    if len(head) >= 12 and head[FTYP_OFFSET:FTYP_OFFSET + 4] == b"ftyp":
        brand = head[8:12].decode("ascii", "replace")
        return "video", f"ISO-BMFF/{brand}", f"ftyp 位于偏移 {FTYP_OFFSET}", "magic"

    # --- 2) Unity 序列化文件（无魔数，靠头部字段自洽）---
    ok, reason = looks_like_unity_serialized(head, size)
    if ok:
        return "unity_serialized", "Unity SerializedFile", reason, "heuristic"

    # --- 3) 弱魔数 ---
    for magic, kind, fmt, note in WEAK_MAGIC_TABLE:
        if head.startswith(magic):
            return kind, fmt, note, "weak-magic"

    # --- 4) 路径 / 扩展名兜底（名字命中 Unity 但仍要报原因）---
    base = os.path.basename(low)
    if base.startswith(UNITY_SERIALIZED_HINTS) or ext in (".assets", ".resource"):
        return "unity_serialized_maybe", "疑似 Unity 序列化文件", f"头部不自洽：{reason}", "weak"

    if low.endswith((".ress", ".res_s")) or ext in (".ress", ".resource", ".res_s"):
        return "unity_stream", "Unity 流式资源", "无魔数，按扩展名判断", "ext"

    if low.startswith("assets/bin/data/managed/") and ext == ".dll":
        return "unity_managed", "Mono 托管程序集", "按路径判断", "path"
    if low.endswith("global-metadata.dat"):
        return "unity_managed", "IL2CPP 全局元数据", "按路径判断", "path"

    if ext in (".json", ".txt", ".cfg", ".config", ".csv", ".ini", ".yml", ".yaml",
               ".xml", ".properties", ".plist"):
        return "text", "文本/配置", "", "ext"

    if head.startswith(b"<"):
        return "text", "XML/文本", "", "magic"

    # 扩展名兜底（无魔数格式），显式降级置信度
    fb = EXT_KIND_FALLBACK.get(ext)
    if fb:
        kind, fmt, note = fb
        return kind, fmt, note, "ext"

    return "other", "未知", f"前 8 字节: {head[:8].hex(' ')}", "none"


def detect_engine(records, dir_index):
    """根据清点结果推测引擎。返回 (engine, evidence[])。"""
    evidence = []
    engine = "unknown"

    def has(substr):
        return any(substr in r["name"] for r in records)

    def has_dir(substr):
        return any(d.startswith(substr) for d in dir_index)

    unity_hits = []
    if has_dir("assets/bin/Data/"):
        unity_hits.append("存在 assets/bin/Data/（Unity 数据目录）")
    if has("libunity.so"):
        unity_hits.append("存在 libunity.so")
    if has("globalgamemanagers"):
        unity_hits.append("存在 globalgamemanagers")
    if any(r["kind"] == "unity_bundle" for r in records):
        unity_hits.append("按魔数识别到 AssetBundle（UnityFS/UnityWeb）")
    if any(r["kind"].startswith("unity_serialized") for r in records):
        unity_hits.append("按头部自洽性识别到 Unity 序列化文件")
    if has("unity3d"):
        unity_hits.append("存在 *.unity3d")

    cocos_hits = []
    if any("cocos" in r["name"].lower() for r in records):
        cocos_hits.append("存在 cocos2d-x 相关文件")
    if has_dir("assets/src/") or has_dir("assets/res/"):
        cocos_hits.append("存在 assets/src/ 或 assets/res/（cocos 资源布局）")

    unreal_hits = []
    if any("libUE4" in r["name"] or "libUnreal" in r["name"] for r in records):
        unreal_hits.append("存在 libUE4/libUnreal")
    if any(r["name"].lower().endswith(".pak") or ".pak" in r["name"].lower() for r in records):
        unreal_hits.append("存在 *.pak（Unreal 资产包）")
    if has_dir("assets/ue4/") or has_dir("assets/ue/"):
        unreal_hits.append("存在 Unreal 资源目录")

    if unity_hits:
        engine = "unity"
        evidence = unity_hits + unreal_hits + cocos_hits
        if has("libil2cpp.so") or has("global-metadata.dat"):
            evidence.append("检测到 IL2CPP（libil2cpp.so / global-metadata.dat）")
        if has_dir("assets/bin/Data/Managed/"):
            evidence.append("检测到 Mono 托管目录（assets/bin/Data/Managed/）")
    elif unreal_hits:
        engine = "unreal"
        evidence = unreal_hits
    elif cocos_hits:
        engine = "cocos2d-x"
        evidence = cocos_hits
    else:
        evidence = ["未发现 Unity / Unreal / Cocos 特征文件",
                    "可能是自研引擎、纯原生或壳 APK"]
    return engine, evidence


# ------------------------------------------------------------------ APK 清点
def scan_apk(apk_path, sample_limit=8):
    records = []
    errors = []
    dir_index = set()

    with zipfile.ZipFile(apk_path) as zf:
        infos = zf.infolist()
        for info in infos:
            if info.is_dir():
                dir_index.add(info.filename)
                continue
            name = info.filename
            parent = os.path.dirname(name)
            if parent:
                dir_index.add(parent + "/")
            head = b""
            read_error = None
            try:
                with zf.open(info) as fh:
                    head = fh.read(64)
            except Exception as exc:  # noqa: BLE001
                read_error = f"{type(exc).__name__}: {exc}"
                errors.append({"name": name, "stage": "read-header", "error": read_error})
            kind, fmt, note, conf = sniff(head, name, info.file_size)
            records.append({
                "name": name,
                "size": info.file_size,
                "compressed_size": info.compress_size,
                "crc": f"{info.CRC:08x}",
                "kind": kind,
                "format": fmt,
                "note": note,
                "confidence": conf,
                "read_error": read_error,
            })
    return records, errors, sorted(dir_index)


def build_inventory(records, sample_limit):
    inv = OrderedDict()
    for rec in records:
        cat = rec["kind"]
        bucket = inv.setdefault(cat, {"category": cat, "label": CATEGORY_LABEL.get(cat, cat),
                                      "count": 0, "bytes": 0, "ext_only": 0, "samples": []})
        bucket["count"] += 1
        bucket["bytes"] += rec["size"]
        if rec["confidence"] in ("ext", "weak", "none"):
            bucket["ext_only"] += 1
        if len(bucket["samples"]) < sample_limit:
            bucket["samples"].append({
                "name": rec["name"],
                "size": rec["size"],
                "format": rec["format"],
                "note": rec["note"],
                "confidence": rec["confidence"],
            })
    for bucket in inv.values():
        bucket["human_bytes"] = human_bytes(bucket["bytes"])
    return inv


def find_extension_mismatches(records, limit=40):
    """扩展名暗示的类型 与 魔数实测类型 冲突 —— 混淆/改名的直接证据。"""
    out = []
    for rec in records:
        ext = os.path.splitext(rec["name"].lower())[1]
        expected = EXT_EXPECT.get(ext)
        if not expected:
            continue
        actual = rec["kind"]
        if actual in (expected, expected + "_maybe"):
            continue
        # 允许的宽容：zip 里含 png 数据等
        if expected == "video" and actual == "other":
            continue
        out.append({
            "name": rec["name"],
            "expected_by_ext": expected,
            "actual_by_magic": actual,
            "actual_format": rec["format"],
        })
        if len(out) >= limit:
            break
    return out


# --------------------------------------------------------------- Unity 深扫
def collect_unity_candidates(records, max_files):
    """挑出值得交给 UnityPy 的文件。"""
    cands = []
    for rec in records:
        name = rec["name"]
        low = name.lower()
        kind = rec["kind"]
        score = None
        if kind == "unity_bundle":
            score = 0
        elif kind == "unity_serialized":
            score = 1
        elif kind == "unity_serialized_maybe":
            score = 2
        elif kind == "unity_managed":
            score = 5
        elif low.startswith("assets/bin/data/") and not low.endswith((".ress", ".resource")):
            score = 3
        elif low.endswith(UNITY_EXTS):
            score = 2
        if score is not None:
            cands.append((score, rec))
    cands.sort(key=lambda t: (t[0], t[1]["name"]))
    return [rec for _, rec in cands[:max_files]]


def extract_candidates(apk_path, candidates, extract_dir):
    """把候选文件解到临时目录（只读源 APK，写副本）。返回 [(rec, local_path)]。"""
    out = []
    failed = []
    with zipfile.ZipFile(apk_path) as zf:
        for rec in candidates:
            name = rec["name"]
            safe = name.replace("\\", "/").lstrip("/")
            target = os.path.join(extract_dir, safe.replace("/", os.sep))
            try:
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with zf.open(rec["name"]) as src, open(target, "wb") as dst:
                    shutil.copyfileobj(src, dst, 1024 * 1024)
                out.append((rec, target))
            except Exception as exc:  # noqa: BLE001
                failed.append({"name": name, "stage": "extract",
                               "error": f"{type(exc).__name__}: {exc}"})
    return out, failed


def _tt(obj):
    try:
        data = obj.read_typetree()
        if isinstance(data, dict):
            return data
    except Exception:  # noqa: BLE001
        pass
    try:
        data = obj.read()
        out = {}
        for key in ("m_Name", "m_Width", "m_Height", "m_TextureFormat",
                    "m_VertexCount", "m_Bones", "m_Legacy", "m_SampleRate",
                    "m_Length", "m_Mesh", "m_AnimationType"):
            if hasattr(data, key):
                out[key] = getattr(data, key)
        return out
    except Exception:  # noqa: BLE001
        return {}


class _UnityLogCapture(logging.Handler):
    """UnityPy 内部异常会被它自己 log 掉而不抛出。这里全部收集，拒绝静默失败。"""

    def __init__(self):
        super().__init__(level=logging.DEBUG)
        self.messages = []

    def emit(self, record):
        try:
            self.messages.append(self.format(record))
        except Exception:  # noqa: BLE001
            self.messages.append(str(getattr(record, "msg", "")))


def unity_deep_scan(extracted, errors, detail_limit=25, fallback_version=None):
    """逐个文件用 UnityPy 解析，统计对象类型。"""
    type_counter = Counter()
    texture_formats = Counter()
    details = OrderedDict()
    scanned = []
    if not UNITYPY_AVAILABLE:
        errors.append({"name": "<unitypy>", "stage": "import",
                       "error": f"UnityPy 不可用：{UNITYPY_ERROR}"})
        return {"objects": {}, "texture_formats": {}, "details": {}, "scanned": [], "errors": errors}

    logger = None
    capture = _UnityLogCapture()
    try:
        logger = logging.getLogger("UnityPy")
        logger.addHandler(capture)
        if fallback_version:
            UnityPy.config.FALLBACK_UNITY_VERSION = fallback_version
    except Exception as exc:  # noqa: BLE001
        errors.append({"name": "<unitypy>", "stage": "logging-setup",
                       "error": f"{type(exc).__name__}: {exc}"})

    for rec, local in extracted:
        entry = {"file": rec["name"], "size": rec["size"], "objects": {}, "container": [],
                 "ok": False, "error": None, "unity_version": None}
        log_before = len(capture.messages)
        try:
            env = UnityPy.load(local)
        except Exception as exc:  # noqa: BLE001
            entry["error"] = f"UnityPy.load 失败: {type(exc).__name__}: {exc}"
            errors.append({"name": rec["name"], "stage": "unitypy-load", "error": entry["error"]})
            scanned.append(entry)
            continue

        try:
            entry["unity_version"] = getattr(getattr(env, "files", None) and
                                             list(env.files.values())[0], "unity_version", None) \
                if getattr(env, "files", None) else None
        except Exception:  # noqa: BLE001
            entry["unity_version"] = None

        path_by_ref = {}
        try:
            container = getattr(env, "container", None) or {}
            for cpath, cobj in container.items():
                try:
                    key = (getattr(cobj.assets_file, "name", "?"), cobj.path_id)
                    path_by_ref[key] = cpath
                    entry["container"].append(cpath)
                except Exception:  # noqa: BLE001
                    continue
        except Exception as exc:  # noqa: BLE001
            errors.append({"name": rec["name"], "stage": "container",
                           "error": f"{type(exc).__name__}: {exc}"})

        try:
            objects = list(env.objects)
        except Exception as exc:  # noqa: BLE001
            entry["error"] = f"env.objects 失败: {type(exc).__name__}: {exc}"
            errors.append({"name": rec["name"], "stage": "unitypy-objects", "error": entry["error"]})
            scanned.append(entry)
            continue

        local_counter = Counter()
        for obj in objects:
            try:
                cname = obj.type.name
            except Exception:  # noqa: BLE001
                cname = str(getattr(obj, "type", "Unknown"))
            type_counter[cname] += 1
            local_counter[cname] += 1
            if cname not in INTERESTING_TYPES:
                continue
            try:
                tt = _tt(obj)
            except Exception as exc:  # noqa: BLE001
                errors.append({"name": rec["name"], "stage": f"typetree:{cname}",
                               "error": f"{type(exc).__name__}: {exc}"})
                continue
            info = OrderedDict()
            info["file"] = rec["name"]
            info["type"] = cname
            info["name_field"] = _as_str(tt.get("m_Name"))
            try:
                key = (getattr(obj.assets_file, "name", "?"), obj.path_id)
                info["asset_path"] = path_by_ref.get(key)
            except Exception:  # noqa: BLE001
                info["asset_path"] = None
            if cname == "Texture2D":
                fmt = tt.get("m_TextureFormat")
                fmt_name = getattr(fmt, "name", None) or _fmt_enum(fmt)
                info["format"] = fmt_name
                info["width"] = tt.get("m_Width")
                info["height"] = tt.get("m_Height")
                texture_formats[str(fmt_name)] += 1
            elif cname in ("Mesh",):
                vd = tt.get("m_VertexData") or {}
                info["vertex_count"] = tt.get("m_VertexCount") or (
                    vd.get("m_VertexCount") if isinstance(vd, dict) else None)
                comps = tt.get("m_CompressedMesh") or {}
                info["compressed"] = bool(comps) if isinstance(comps, dict) else None
            elif cname == "SkinnedMeshRenderer":
                bones = tt.get("m_Bones")
                info["bone_count"] = len(bones) if isinstance(bones, (list, tuple)) else None
                mesh = tt.get("m_Mesh")
                if isinstance(mesh, dict):
                    info["mesh_pptr"] = mesh.get("m_PathID")
            elif cname == "AnimationClip":
                info["legacy"] = tt.get("m_Legacy")
                info["sample_rate"] = tt.get("m_SampleRate")
                info["animation_type"] = _as_str(tt.get("m_AnimationType"))
            elif cname == "AudioClip":
                info["length"] = tt.get("m_Length")
            details.setdefault(cname, [])
            if len(details[cname]) < detail_limit:
                details[cname].append(info)

        entry["objects"] = dict(local_counter)
        entry["ok"] = True

        # 文件被接受但一个对象都没解析出来 —— 必须显式报因（典型：Unity 版本无法识别、
        # 加密/魔改 bundle、或文件本身是占位数据）。
        if not local_counter:
            tail = [m for m in capture.messages[log_before:] if m.strip()]
            entry["error"] = "UnityPy 打开了文件但未解析出任何对象（0 objects）"
            errors.append({
                "name": rec["name"], "stage": "unitypy-zero-objects",
                "error": entry["error"],
                "unitypy_log": tail[:3] or None,
                "hint": "常见原因：Unity 版本无法识别（可试 --unity-version）、"
                        "bundle 被加密/魔改、或该文件只是占位/损坏数据",
            })
        scanned.append(entry)

    # UnityPy 在扫描期间自己 log 出来的所有异常，全部并入报告
    for msg in capture.messages:
        if msg.strip():
            errors.append({"name": "<unitypy-log>", "stage": "unitypy-log", "error": msg})
    if logger is not None:
        try:
            logger.removeHandler(capture)
        except Exception:  # noqa: BLE001
            pass

    return {
        "objects": dict(type_counter.most_common()),
        "texture_formats": dict(texture_formats.most_common()),
        "details": {k: v for k, v in details.items()},
        "scanned": scanned,
        "errors": errors,
    }


def _as_str(v):
    if v is None:
        return None
    if isinstance(v, bytes):
        try:
            return v.split(b"\x00", 1)[0].decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            return repr(v[:32])
    return str(v)


def _fmt_enum(v):
    if v is None:
        return "Unknown"
    try:
        from UnityPy.enums import TextureFormat  # type: ignore
        return TextureFormat(int(v)).name
    except Exception:  # noqa: BLE001
        return str(v)


# ------------------------------------------------------------------ 判定
def build_verdict(engine, records, inventory, unity):
    objs = unity.get("objects") or {}
    mesh = int(objs.get("Mesh", 0))
    smr = int(objs.get("SkinnedMeshRenderer", 0))
    tex = int(objs.get("Texture2D", 0))
    clip = int(objs.get("AnimationClip", 0))
    audio = int(objs.get("AudioClip", 0))
    animator = int(objs.get("Animator", 0))

    videos = [r for r in records if r["kind"] == "video"]
    ext_only_videos = [r for r in videos if r.get("confidence") in ("ext", "weak", "none")]
    has_video = len(videos) > 0
    unity_data = any(r["kind"].startswith("unity_") for r in records)

    reasons = []
    has_mesh = mesh > 0
    has_skinned = smr > 0
    has_skeleton_anim = clip > 0

    if engine != "unity":
        reasons.append(f"引擎判定为 {engine}，非 Unity：UnityPy 深扫结果不适用")
    if not unity_data and engine == "unity":
        reasons.append("引擎特征像 Unity，但没有可解析的序列化文件/AssetBundle "
                       "→ 可能是 split APK（分包）、壳 APK，或真资源在 .obb 中")

    if has_skinned and has_skeleton_anim and tex > 0:
        route = "3d_render"
        reasons.append(f"检出 SkinnedMeshRenderer×{smr} + AnimationClip×{clip} + Texture2D×{tex}"
                       " → 可走 3D 自渲染路线（自渲染自带 alpha，绕开抠像）")
    elif has_mesh and (has_skinned or has_skeleton_anim):
        route = "3d_render_partial"
        reasons.append(f"检出网格(Mesh×{mesh}, SkinnedMeshRenderer×{smr})与动画(AnimationClip×{clip})"
                       "但组合不完整 → 3D 路线可行但需人工确认")
    elif has_mesh or tex > 0:
        route = "3d_render_partial"
        reasons.append(f"只有静态网格/贴图(Mesh×{mesh}, Texture2D×{tex})，没有骨骼动画"
                       " → 可渲染静态角色，但无法生成说话动作")
    elif has_video:
        route = "video_matte"
        reasons.append(f"未检出可解析的 Unity 网格/动画，但存在视频 {len(videos)} 个"
                       " → 只能回到视频抠像路线")
    else:
        route = "unknown"
        reasons.append("既没有可解析的网格/动画，也没有视频 → 需人工进一步分析")

    if has_video and route.startswith("3d_render"):
        reasons.append(f"注意：同时存在 {len(videos)} 个视频文件，可用作对照或回退")
    if ext_only_videos:
        reasons.append(f"其中 {len(ext_only_videos)} 个视频没有文件头魔数，仅凭扩展名判定"
                       "（如裸 .vp8 码流）—— 结论可信度相应降低")
    if audio:
        reasons.append(f"检出 AudioClip×{audio}（语音素材可能可直接复用）")
    if animator:
        reasons.append(f"检出 Animator×{animator}（状态机；骨骼动画的组织者）")

    return OrderedDict([
        ("engine", engine),
        ("has_character_mesh", has_skinned),
        ("has_static_mesh", has_mesh),
        ("has_skeleton_animation", has_skeleton_anim),
        ("has_texture", tex > 0),
        ("has_video", has_video),
        ("counts", {"Mesh": mesh, "SkinnedMeshRenderer": smr, "Texture2D": tex,
                    "AnimationClip": clip, "AudioClip": audio, "Animator": animator}),
        ("route", route),
        ("reasons", reasons),
    ])


ROUTE_LABEL = {
    "3d_render": "✅ 可走 3D 自渲染路线",
    "3d_render_partial": "⚠️ 部分具备，需人工确认",
    "video_matte": "❌ 只能回到视频抠像路线",
    "unknown": "❓ 无法判定，需人工分析",
}


# ------------------------------------------------------------------ 主流程
def recon(apk_path, args):
    started = time.time()
    report = OrderedDict()
    report["schema"] = SCHEMA
    report["tool"] = {"name": "recon-apk.py", "version": VERSION,
                      "unitypy": {"available": UNITYPY_AVAILABLE,
                                  "version": UNITYPY_VERSION,
                                  "error": UNITYPY_ERROR}}
    report["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")

    abs_apk = os.path.abspath(apk_path)
    apk_meta = OrderedDict([
        ("path", abs_apk),
        ("size_bytes", os.path.getsize(abs_apk)),
        ("size_human", human_bytes(os.path.getsize(abs_apk))),
        ("mtime", time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(os.path.getmtime(abs_apk)))),
    ])
    if not args.no_hash:
        h = hashlib.sha256()
        with open(abs_apk, "rb") as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                h.update(chunk)
        apk_meta["sha256"] = h.hexdigest()
    report["apk"] = apk_meta

    records, zip_errors, dir_index = scan_apk(abs_apk, args.sample_limit)
    report["entry_count"] = len(records)

    inventory = build_inventory(records, args.sample_limit)
    report["inventory"] = inventory
    report["extension_mismatches"] = find_extension_mismatches(records)

    engine, evidence = detect_engine(records, dir_index)
    report["engine"] = OrderedDict([("guess", engine), ("evidence", evidence)])

    # Unity 深扫
    unity = {"objects": {}, "texture_formats": {}, "details": {}, "scanned": [], "errors": []}
    errors = list(zip_errors)
    if args.no_unitypy:
        errors.append({"name": "<unitypy>", "stage": "skipped",
                       "error": "用户以 --no-unitypy 跳过深扫"})
    elif engine == "unity" or any(r["kind"].startswith("unity_") for r in records):
        candidates = collect_unity_candidates(records, args.max_files)
        report["unity_candidates"] = [{"name": c["name"], "kind": c["kind"], "size": c["size"]}
                                      for c in candidates]
        if candidates:
            extract_dir = args.extract_dir or tempfile.mkdtemp(
                prefix="recon-apk-", dir=os.environ.get("TEMP") or None)
            os.makedirs(extract_dir, exist_ok=True)
            extracted, extract_failed = extract_candidates(abs_apk, candidates, extract_dir)
            errors.extend(extract_failed)
            unity = unity_deep_scan(extracted, errors, fallback_version=args.unity_version)
            report["extract_dir"] = extract_dir
            if args.keep_extract:
                report["extract_kept"] = True
            else:
                try:
                    shutil.rmtree(extract_dir, ignore_errors=True)
                except Exception:  # noqa: BLE001
                    pass
        else:
            errors.append({"name": "<unity>", "stage": "candidates",
                           "error": "未找到可交给 UnityPy 的 Unity 文件（可能是 split APK / obb / 壳）"})
    else:
        errors.append({"name": "<unitypy>", "stage": "skipped",
                       "error": f"引擎判定为 {engine}，跳过 Unity 深扫"})

    report["unity"] = OrderedDict([
        ("object_counts", unity.get("objects", {})),
        ("texture_formats", unity.get("texture_formats", {})),
        ("objects", unity.get("details", {})),
        ("scanned_files", unity.get("scanned", [])),
    ])

    verdict = build_verdict(engine, records, inventory, unity)
    report["verdict"] = verdict

    # obb 检查（同目录兄弟文件）
    obb_dir = os.path.dirname(abs_apk)
    obbs = []
    try:
        for fn in sorted(os.listdir(obb_dir)):
            if fn.lower().endswith(".obb"):
                p = os.path.join(obb_dir, fn)
                obbs.append({"path": p, "size": os.path.getsize(p),
                             "size_human": human_bytes(os.path.getsize(p))})
    except Exception as exc:  # noqa: BLE001
        errors.append({"name": obb_dir, "stage": "obb-scan", "error": f"{type(exc).__name__}: {exc}"})
    report["obb_siblings"] = obbs
    if obbs:
        verdict["reasons"].append(
            f"同目录发现 {len(obbs)} 个 .obb 扩展包 → 真资源可能不在 APK 内，需单独侦察 obb")
    if engine == "unity" and not any(r["kind"].startswith("unity_") for r in records) and not obbs:
        verdict["reasons"].append(
            "引擎像 Unity 但 APK 内无 Unity 资源，且同目录无 obb → 考虑 split APK（需一并侦察 base+split）")

    report["errors"] = errors
    report["timing_seconds"] = round(time.time() - started, 2)
    return report


# ------------------------------------------------------------------ 摘要输出
def print_summary(report):
    out = sys.stdout
    apk = report["apk"]
    print("=" * 78, file=out)
    print(f"APK 资源侦察报告  {report['generated_at']}", file=out)
    print("=" * 78, file=out)
    print(f"文件    : {apk['path']}", file=out)
    print(f"体积    : {apk['size_human']}  ({apk['size_bytes']} B)", file=out)
    if apk.get("sha256"):
        print(f"sha256  : {apk['sha256']}", file=out)
    print(f"条目数  : {report['entry_count']}", file=out)

    up = report["tool"]["unitypy"]
    if up["available"]:
        print(f"UnityPy : 可用 v{up['version']}", file=out)
    else:
        print(f"UnityPy : 不可用 -> {up['error']}  （降级为纯魔数侦察）", file=out)

    print("", file=out)
    print(f"[引擎判定] {report['engine']['guess']}", file=out)
    for line in report["engine"]["evidence"]:
        print(f"           - {line}", file=out)

    print("", file=out)
    print("[资源清点]（按魔数分类）", file=out)
    inv = report["inventory"]
    if not inv:
        print("           （APK 内无文件条目）", file=out)
    for cat, bucket in sorted(inv.items(), key=lambda kv: -kv[1]["bytes"]):
        ext_note = f"  [其中 {bucket['ext_only']} 个仅凭扩展名判定]" if bucket.get("ext_only") else ""
        print(f"  {bucket['label']:<46} {bucket['count']:>6} 个  {bucket['human_bytes']:>10}{ext_note}",
              file=out)
        for s in bucket["samples"][:3]:
            conf = "" if s.get("confidence") in ("magic", "heuristic", "path") else \
                f", {s.get('confidence')}"
            print(f"        · {s['name']}  ({s['format']}, {human_bytes(s['size'])}{conf})", file=out)
        if bucket["count"] > len(bucket["samples"]):
            print(f"        · ... 其余 {bucket['count'] - len(bucket['samples'])} 个见 JSON", file=out)

    mism = report.get("extension_mismatches") or []
    if mism:
        print("", file=out)
        print(f"[扩展名 vs 魔数 冲突] {len(mism)} 条 —— 改名/混淆的直接证据", file=out)
        for m in mism[:8]:
            print(f"  ! {m['name']}  扩展名暗示 {m['expected_by_ext']} / 实测 {m['actual_format']}"
                  f" ({m['actual_by_magic']})", file=out)

    u = report["unity"]
    if u["object_counts"] or u["scanned_files"]:
        print("", file=out)
        print("[Unity 深扫] 对象类型统计", file=out)
        for k, v in u["object_counts"].items():
            star = "  ★" if k in ("Mesh", "SkinnedMeshRenderer", "AnimationClip") else ""
            print(f"  {k:<28} {v:>6}{star}", file=out)
        if u["texture_formats"]:
            print("  贴图格式分布: " + ", ".join(f"{k}×{v}" for k, v in u["texture_formats"].items()),
                  file=out)
        for cname in ("SkinnedMeshRenderer", "Mesh", "AnimationClip"):
            rows = (u["objects"] or {}).get(cname) or []
            if rows:
                print(f"  -- {cname} 明细（前 {min(len(rows), 5)} 条）:", file=out)
                for r in rows[:5]:
                    extra = []
                    if r.get("name_field") is not None:
                        extra.append(f"name={r['name_field']!r}")
                    if r.get("bone_count") is not None:
                        extra.append(f"bones={r['bone_count']}")
                    if r.get("vertex_count") is not None:
                        extra.append(f"verts={r['vertex_count']}")
                    if r.get("width"):
                        extra.append(f"{r['width']}x{r['height']}")
                    if r.get("asset_path"):
                        extra.append(f"path={r['asset_path']}")
                    print(f"       {r['type']}: " + ", ".join(extra), file=out)
        ok_files = [s for s in u["scanned_files"] if s.get("ok") and s.get("objects")]
        bad_files = [s for s in u["scanned_files"] if not s.get("ok") or not s.get("objects")]
        print(f"  深扫文件: 成功解析 {len(ok_files)} / 交给 UnityPy {len(u['scanned_files'])}"
              f"（其余 {len(bad_files)} 个见下方异常）", file=out)
        for s in bad_files[:5]:
            first = ""
            for e in (report.get("errors") or []):
                if e["name"] == s["file"] and e["stage"] == "unitypy-zero-objects":
                    first = "（见异常：0 objects）"
                    break
            print(f"       × {s['file']}  解析对象数 0{first}", file=out)

    v = report["verdict"]
    print("", file=out)
    print("=" * 78, file=out)
    print(f"[核心结论] {ROUTE_LABEL.get(v['route'], v['route'])}", file=out)
    print(f"  角色网格(SkinnedMeshRenderer) : {'有' if v['has_character_mesh'] else '无'}"
          f"  (×{v['counts']['SkinnedMeshRenderer']})", file=out)
    print(f"  网格(Mesh)                    : {'有' if v['has_static_mesh'] else '无'}"
          f"  (×{v['counts']['Mesh']})", file=out)
    print(f"  骨骼动画(AnimationClip)       : {'有' if v['has_skeleton_animation'] else '无'}"
          f"  (×{v['counts']['AnimationClip']})", file=out)
    print(f"  贴图(Texture2D)               : {'有' if v['has_texture'] else '无'}"
          f"  (×{v['counts']['Texture2D']})", file=out)
    print(f"  视频文件                      : {'有' if v['has_video'] else '无'}", file=out)
    for line in v["reasons"]:
        print(f"  · {line}", file=out)

    errs = report.get("errors") or []
    print("", file=out)
    if errs:
        print(f"[异常] 共 {len(errs)} 条（不静默跳过，全部列出）：", file=out)
        for e in errs[:25]:
            print(f"  ! [{e['stage']}] {e['name']}: {e['error']}", file=out)
        if len(errs) > 25:
            print(f"  ! ... 其余 {len(errs) - 25} 条见 JSON", file=out)
    else:
        print("[异常] 无", file=out)
    print(f"[耗时] {report['timing_seconds']}s", file=out)
    print("=" * 78, file=out)


def build_argparser():
    p = argparse.ArgumentParser(
        prog="recon-apk.py",
        description="只读 APK 资源侦察：判断是否存在可用的角色网格/骨骼动画。"
                    "不修改任何输入文件。",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="示例:\n"
               "  python tools/recon-apk.py _inbox\\game.apk\n"
               "  python tools/recon-apk.py _inbox\\game.apk --json report.json --keep-extract\n")
    p.add_argument("apk", help="APK 路径")
    p.add_argument("--json", metavar="PATH", help="把完整 JSON 报告写入 PATH（'-' 表示打印到 stdout）")
    p.add_argument("--quiet", action="store_true", help="只输出 JSON/结论，不输出人类摘要")
    p.add_argument("--max-files", type=int, default=400,
                   help="最多交给 UnityPy 的文件数（默认 400）")
    p.add_argument("--sample-limit", type=int, default=8,
                   help="每类最多保留的样本数（默认 8）")
    p.add_argument("--no-unitypy", action="store_true", help="跳过 Unity 深扫（纯魔数侦察）")
    p.add_argument("--unity-version", metavar="VER",
                   help="强制指定 Unity 版本（如 2019.4.0f1），用于处理无法自动识别版本的 bundle")
    p.add_argument("--no-hash", action="store_true", help="跳过 sha256 计算")
    p.add_argument("--keep-extract", action="store_true", help="保留临时解包目录")
    p.add_argument("--extract-dir", metavar="DIR", help="指定解包临时目录")
    p.add_argument("--version", action="version", version=f"recon-apk {VERSION}")
    return p


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

    args = build_argparser().parse_args(argv)

    apk = args.apk
    if not os.path.exists(apk):
        print(f"[错误] 找不到 APK: {os.path.abspath(apk)}", file=sys.stderr)
        print("       请把 APK 放到 _inbox\\ 下，或传入正确路径。", file=sys.stderr)
        hint = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_inbox")
        hint = os.path.normpath(hint)
        if os.path.isdir(hint):
            try:
                entries = os.listdir(hint)
                print(f"       当前 {hint} 内容: {entries if entries else '（空）'}", file=sys.stderr)
            except Exception:  # noqa: BLE001
                pass
        return 2
    if os.path.isdir(apk):
        print(f"[错误] {apk} 是目录，不是文件。", file=sys.stderr)
        return 2
    if not zipfile.is_zipfile(apk):
        print(f"[错误] {apk} 不是有效 ZIP/APK（ZIP 魔数 PK\\x03\\x04 缺失）。", file=sys.stderr)
        print("       可能下载未完成、被加密或本身不是 APK。", file=sys.stderr)
        return 2

    try:
        report = recon(apk, args)
    except Exception as exc:  # noqa: BLE001
        import traceback
        print(f"[致命错误] {type(exc).__name__}: {exc}", file=sys.stderr)
        traceback.print_exc()
        return 3

    if args.json == "-":
        print(json.dumps(report, ensure_ascii=False, indent=2))
    elif args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(report, fh, ensure_ascii=False, indent=2)
        if not args.quiet:
            print(f"[JSON 报告] {os.path.abspath(args.json)}", file=sys.stderr)
    elif args.quiet:
        print(json.dumps(report["verdict"], ensure_ascii=False, indent=2))

    if not args.quiet and args.json != "-":
        print_summary(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
