# APK 资源侦察

判断一个 APK 里**有没有可用的角色美术资源**（网格 + 骨骼 + 贴图），用来决定桌宠走
「3D 自渲染」还是退回「视频抠像」。

**只读**：不修改 APK，不修改任何输入文件。解包只读 zip 流，落盘的只有 `%TEMP%` 下的临时副本
（默认用完即删，`--keep-extract` 可保留）。

---

## 1. 用法

```powershell
$py = "C:\Users\MR\appdata\local\hermes\hermes-agent\venv\Scripts\python.exe"

# 基本：人类可读摘要打到 stdout
& $py tools\recon-apk.py _inbox\game.apk

# 附带完整 JSON 报告
& $py tools\recon-apk.py _inbox\game.apk --json _probe\recon-game.json

# 只要 JSON 结论（便于脚本消费）
& $py tools\recon-apk.py _inbox\game.apk --quiet --json -

# 只有魔数侦察，不碰 UnityPy
& $py tools\recon-apk.py _inbox\game.apk --no-unitypy

# bundle 版本识别失败时强制指定 Unity 版本
& $py tools\recon-apk.py _inbox\game.apk --unity-version 2019.4.0f1
```

| 参数 | 作用 |
|---|---|
| `--json PATH` | 完整 JSON 报告写到 PATH；`-` 表示打到 stdout |
| `--quiet` | 只输出结论，不输出人类摘要 |
| `--max-files N` | 最多交给 UnityPy 的文件数（默认 400） |
| `--sample-limit N` | 每类保留的样本数（默认 8） |
| `--no-unitypy` | 跳过深扫，纯魔数侦察（无 UnityPy 时自动等同于此） |
| `--unity-version VER` | 强制 Unity 版本（应对「No valid Unity version found」） |
| `--no-hash` | 跳过 sha256（APK 很大时提速） |
| `--keep-extract` / `--extract-dir DIR` | 保留 / 指定临时解包目录 |

退出码：`0` 成功 / `2` 输入文件不存在或不是 ZIP / `3` 侦察过程致命错误。

---

## 2. 它做什么

1. **解包**：用 Python `zipfile` 直接读流，不落地整包。
2. **引擎识别**：`assets/bin/Data/`、`libunity.so`、`globalgamemanagers`、UnityFS 魔数 →
   Unity；`libUE4`/`*.pak` → Unreal；`libcocos*` → Cocos；都没有 → 自研/壳。
   顺带报告 **IL2CPP**（`libil2cpp.so` + `global-metadata.dat`）还是 **Mono**（`Managed/*.dll`）。
3. **清点**：按类别给出数量与体积，**类型以文件头魔数判定，扩展名只作参考**。
   扩展名与魔数冲突的条目单独列出（「改名/混淆的直接证据」）。
4. **Unity 深扫**：把候选文件解到临时目录，逐个交给 UnityPy 解析，统计对象类型
   （`Mesh` / `SkinnedMeshRenderer` / `Texture2D` / `AnimationClip` / `AudioClip` / `Animator` …），
   并给出贴图格式分布（ASTC / ETC2 / RGBA32 …）、网格名与顶点数、骨骼渲染器的骨骼数。
5. **结论**：产出 `route` 与理由。

---

## 3. 结论对照表（核心）

| 检出情况 | `route` | 结论 |
|---|---|---|
| `SkinnedMeshRenderer` + `AnimationClip` + `Texture2D` | `3d_render` | ✅ 走 3D 自渲染，自渲染自带 alpha，绕开抠像 |
| 有 `Mesh`，有骨骼或动画但组合不完整 | `3d_render_partial` | ⚠️ 可行但需人工确认 |
| 只有 `Mesh`/`Texture2D`，没有 `AnimationClip` | `3d_render_partial` | ⚠️ 能渲静态角色，但**生成不了说话动作** |
| 没有可解析网格/动画，但有视频 | `video_matte` | ❌ 只能回到视频抠像路线 |
| 什么都查不到 | `unknown` | ❓ 需人工分析（多半是 split APK / obb / 加密） |

`route` 之外的强信号：
- `AudioClip×N` → 语音素材可能可直接复用（省掉 TTS 或另找音源）。
- `Animator×N` → 存在状态机，骨骼动画的组织者，值得进一步挖。
- 同目录 `*.obb` → 真资源可能不在 APK 内，需**单独侦察 obb**。
- 引擎像 Unity 但 APK 内无 Unity 资源且同目录无 obb → 考虑 **split APK**（要一并侦察 base + split）。

---

## 4. 局限与不确定项（务必知情）

- **加密 / 魔改 bundle**：UnityPy 能读标准 UnityFS；被加密（如部分国产网游的
  XXTEA/AES 自研加密）或经过反提取改造的 bundle 会解析失败。脚本**不会静默跳过**，
  会以 `unitypy-load` / `unitypy-zero-objects` 记录失败与原因（含 UnityPy 内部日志），
  此时 `route` 可能是 `unknown` —— **这等于"没测出来"，不等于"没有资源"**。
- **`--unity-version`**：UnityPy 无法从 bundle 推断版本时会报
  `No valid Unity version found`；用该参数强制版本可能解析成功，也可能因类型树不匹配
  导致对象数虚高/虚低，结论需复核。
- **AssetBundle 可能分散**：资源可能在多个 `*.assets` / 多个 bundle 里，
  默认最多深扫 400 个文件（`--max-files` 调整）。
- **`AnimationClip` 可能藏在 MonoBehaviour 里**：某些游戏把动画数据塞进自定义
  序列化结构，UnityPy 只能看到 `MonoBehaviour` 而看不到 `AnimationClip` —— 会漏报。
- **`Texture2D` 格式**取自序列化对象，不是文件魔数；贴图原始数据可能落在
  `.resS`/`.resource` 流式文件里，清点会分别列出。
- **无魔数格式靠扩展名**：裸 `.vp8` 码流、`.tga`、Unity 内嵌原始贴图没有文件头。
  这类条目置信度标为 `ext`，摘要里单列「其中 N 个仅凭扩展名判定」，**不要当成魔数确认**。
- **`.obb`**：只检查 APK 同目录的兄弟 `*.obb`；设备上的 obb 路径
  （`Android/obb/<pkg>/main.<ver>.<pkg>.obb`）需要另行传入侦察。
- **不含动态行为**：本脚本是静态侦察，不运行 APK、不反编译 dex、不解 IL2CPP 元数据。

---

## 5. 自测

测试数据与自测运行器在 `%TEMP%` 下（**没有**放进 `_inbox`）：

```powershell
& $py "$env:TEMP\recon-apk-selftest.py"
```

覆盖：假 Unity APK、视频-only APK、魔数混淆 APK、Cocos APK、APK 不存在、非 ZIP、
`--no-unitypy` 降级、JSON 结构、`build_verdict` 五个分支，以及用真实 Unity
AssetBundle（`%TEMP%\recon-apk-selftest\samples\`）做的正向验证。
当前结果：**15 项全部 PASS**。

真实样本缺失时，「真实样本正向验证」会记为 SKIP（离线环境仍可跑其余 14 项）。
