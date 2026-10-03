# 第三方署名 · Third-Party Notices

本文件记录 **布丁桌宠（dsh-pudding-pet）** 中包含或参考的第三方代码及其许可证。
再分发本项目时，请保留本文件（见文末「重新分发注意事项」）。

This file records the third-party code that this project **contains** or **references**,
together with its licenses. If you redistribute this project, keep this file (see
"Redistribution notes" at the end).

---

## 1. Vendored 代码：`lib/edge-tts.js`

### 1.1 Vendored code: `lib/edge-tts.js`

| 项目 / Field | 值 / Value |
|---|---|
| 上游项目 / Upstream project | **dsh-tts-reader** |
| 上游 URL / Upstream URL | <https://github.com/lemonhall/dsh-tts-reader> |
| 上游文件 / Upstream file | `lib/edge-tts.js` |
| 许可证 / License | **MIT** |
| 版权归属 / Copyright notice | `Copyright (c) 2026 lemonhall` |
| 本仓库路径 / Path here | [`lib/edge-tts.js`](lib/edge-tts.js) |

**本仓库对该文件做了什么 / What this repository changed**

- **只加了一个 provenance（来源）头注释**：许可证、来源 URL、版权行、正文的 SHA-256，
  以及「为什么合成必须放在宿主侧」的说明。
- **正文逐字节未改**：头注释之后的全部内容是上游文件的原样拷贝，
  方便日后与上游 diff。因此上游的 MIT 条款、版权行和免责声明**原样适用**于该文件。
- 正文的 SHA-256 记录在文件头部，值为：
  `e6af84b15cd3604c5f33fc3535e8859f8a6a928cc30a19544f896b37777423b2`
  （可用 `tools/vendor-edge-tts.mjs` 重新生成并核对。）

- **Only a provenance header was added**: license, upstream URL, copyright line, the body's
  SHA-256, and a note on why synthesis has to happen on the host.
- **The body is byte-for-byte unchanged**: everything after the header is a verbatim copy of
  the upstream file, so diffing against upstream stays meaningful. The upstream MIT terms,
  copyright line and disclaimer therefore apply to that file unchanged.
- The recorded SHA-256 of the body is
  `e6af84b15cd3604c5f33fc3535e8859f8a6a928cc30a19544f896b37777423b2`
  (regenerate and check with `tools/vendor-edge-tts.mjs`).

### MIT 许可证全文 · Full MIT License Text

上游项目以上述版权行 + 标准 MIT 条款释出。以下为完整条款文本。

The upstream project is released under the copyright line above plus the standard MIT terms.
The complete text follows.

```text
MIT License

Copyright (c) 2026 lemonhall

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

> Edge TTS 客户端会连接微软的公开「朗读」端点。该服务**不是**本项目的组成部分，
> 也不由上游项目或本项目提供任何担保；请自行确认你的使用方式符合其条款。
>
> The Edge TTS client talks to Microsoft's public "Read Aloud" endpoint. That service is
> **not** part of this project and carries no warranty from the upstream project or from
> this one; satisfy yourself that your use complies with its terms.

---

## 2. 参考了设计模式，未复制代码 / Design reference, no code copied

| 项目 / Field | 值 / Value |
|---|---|
| 项目 / Project | **dsh-speech-plugin** |
| URL | <https://github.com/huangdejie/dsh-speech-plugin> |
| 许可证 / License | **MIT** |
| 用法 / Usage | 仅**参考**通用的宿主路由写法（`webServer.register` 精确路径 + 方法判定 + 状态码约定）；**未复制任何代码** |

宿主侧两条路由（`GET /pudding-pet/tts`、`GET /pudding-pet/voices`）需要防止被其他页面滥用
（合成会以用户的名义请求第三方服务）。与该项目**可核实的共同点**只是通用的宿主路由写法：

- 通过 `ctx.inject(['webServer'])` 取得服务，再以 `webServer.register({ kind: 'exact', path, handler })`
  注册**精确路径**路由；
- 在 handler 里先判方法，不匹配即回 `405`，并回一个带错误码的 JSON；
- 参数非法回 `400`，内容过长回 `413`，服务不可用回 `503`。

本仓库的 `localRejection()` 另有**两项该项目没有的检查** —— `Sec-Fetch-Site: cross-site`
拒绝与同源 `Origin` 校验（含应用自身自定义 scheme）—— 这两项是本项目自行添加的，
不是从该项目引入的。路由的实现语言与形态也不同：上游是 TypeScript + `ws`，
走云端 TTS 的 POST + JSON；本仓库是纯 JS + Node 内置 `node:https`，
走 Edge 朗读端点的 GET + query。

因为**没有复制代码**，本仓库不包含该项目的任何受版权保护的表达；列出它只为如实说明设计来源。

The host-side routes (`GET /pudding-pet/tts`, `GET /pudding-pet/voices`) must not be usable from
another page, because synthesis calls a third-party service on the user's behalf. What is
**verifiably shared** with that project is only the generic host-route idiom:

- acquire the service through `ctx.inject(['webServer'])` and register an **exact-path** route via
  `webServer.register({ kind: 'exact', path, handler })`;
- check the method first inside the handler, answer `405` otherwise, with a coded JSON error;
- `400` for bad parameters, `413` for over-long content, `503` when the service is unavailable.

This repository's `localRejection()` adds **two checks that project does not have** — a
`Sec-Fetch-Site: cross-site` refusal and a same-origin `Origin` check (including the app's own
custom scheme). Both are this project's own addition, not imported from that project. The
implementations also differ in language and shape: upstream is TypeScript + `ws` doing
cloud-TTS POST + JSON; this one is plain JS + Node's built-in `node:https` doing GET + query
against the Edge Read Aloud endpoint.

Because **no code was copied**, this repository contains no copyrightable expression from that
project; it is listed here only to state the design's provenance honestly.

---

## 3. 协议常量参考：`rany2/edge-tts` / Protocol-constant reference

| 项目 / Field | 值 / Value |
|---|---|
| 项目 / Project | **edge-tts**（Python 实现） |
| URL | <https://github.com/rany2/edge-tts> |
| 许可证 / License | **MIT（仅 `src/edge_tts/srt_composer.py`）+ LGPLv3（其余文件）** |
| 用法 / Usage | vendored 文件中的协议常量与 `Sec-MS-GEC` 算法**参考/对应**该项目；**未复制其源代码** |

[`lib/edge-tts.js`](lib/edge-tts.js) 的正文注释自述其常量「mirror `edge_tts/constants.py` 和
`edge_tts/drm.py`（7.2.8）」，即 `TRUSTED_CLIENT_TOKEN`、`Sec-MS-GEC` 版本串等
是**对照该 Python 项目**写出的。这些是微软朗读服务的**协议常量与公开算法**
（该 token 与 GEC 算法在多个独立实现中公开发表），本仓库未复制其 Python 源码，
而是以 Node 原生模块独立实现 WebSocket 帧编解码。

> **提请复核（上游许可为 LGPLv3）**：`rany2/edge-tts` 中除
> `src/edge_tts/srt_composer.py`（MIT）外的文件均为 **LGPLv3**。本项目**未链接、未分发**
> 该项目的任何文件，仅使用了服务端协议所需的常量与算法；若你认为「常量/算法对照」
> 已构成受版权保护的表达，请在使用前自行评估。此项如实列出，供下游判断。

The body of [`lib/edge-tts.js`](lib/edge-tts.js) states that its constants "mirror
`edge_tts/constants.py` and `edge_tts/drm.py` (7.2.8)". Those are protocol constants and a
publicly documented algorithm for Microsoft's Read Aloud service (published in several
independent implementations). No Python source was copied; the WebSocket frame codec here is
an independent Node implementation.

> **Flagged for review (upstream is LGPLv3)**: in `rany2/edge-tts`, every file except
> `src/edge_tts/srt_composer.py` (MIT) is **LGPLv3**. This project neither links nor
> distributes any file from that project and uses only the constants and algorithm the
> service's protocol requires. If you consider "mirrored constants/algorithm" to be
> copyrightable expression, assess that before use. It is listed here so downstream can judge.

---

## 4. 探测音频：`dev/voice-samples/` / Probe audio

| 项目 / Field | 值 / Value |
|---|---|
| 内容 / Content | 由**本仓库脚本**调用微软公开朗读端点生成的 MP3 探测样本 |
| 生成脚本 / Generator | [`tools/probe-edge-pitch-range.mjs`](tools/probe-edge-pitch-range.mjs) |
| 文本 / Text | 本项目自写的短句（`你好呀，我是布丁。今天想陪你一起干活。`） |
| 第三方素材 / Third-party assets | **无** —— 不含任何第三方录音、音乐或音效 |

这些文件是**合成产物**，不是第三方受版权保护的录音；其语音由微软服务生成，
使用条款请自行确认（与第 1 节末尾的说明相同）。目录体积与去留见 README 与审计报告。

These files are **synthesis output**, not third-party copyrighted recordings. No third-party
audio, music or sound effect is bundled.

---

## 5. 重新分发注意事项 / Redistribution notes

- 保留 [`lib/edge-tts.js`](lib/edge-tts.js) 头部的许可证、来源 URL、版权行和 SHA-256，
  **以及本文件**。MIT 要求保留版权声明和许可声明，这两者一起才构成完整声明。
- 如果你**修改**了 `lib/edge-tts.js` 的正文，请在头部注明你的改动，并更新或标注 SHA-256，
  以免读者误以为它仍是上游原样内容。
- 如果只是**参考**第 2 节的设计，没有复制代码，通常不产生署名义务；但仍建议保留本节，
  说明设计来源。
- 本项目的其余代码是 MIT、美术是 CC0-1.0，见 [`LICENSE`](LICENSE) 与
  [`LICENSE-ASSETS.md`](LICENSE-ASSETS.md)；vendored 文件按**上游 MIT** 授权，与本项目自身授权并行。

- Keep the license, upstream URL, copyright line and SHA-256 in the header of
  [`lib/edge-tts.js`](lib/edge-tts.js), **and keep this file**. MIT requires the copyright notice
  and the permission notice to be retained; together they form the complete notice.
- If you **modify** the body of `lib/edge-tts.js`, note your changes in the header and update or
  annotate the SHA-256, so a reader is not misled into thinking it is still verbatim upstream.
- If you only **reference** the design in section 2 without copying code, attribution is normally
  not required — but keeping that section is a good way to state the design's provenance.
- The rest of this project is MIT (code) and CC0-1.0 (art) — see [`LICENSE`](LICENSE) and
  [`LICENSE-ASSETS.md`](LICENSE-ASSETS.md). The vendored file stays under **upstream MIT**,
  alongside this project's own licensing.
