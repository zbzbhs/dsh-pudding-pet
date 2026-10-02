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
| 版权归属 / Copyright notice | `Copyright (c) the dsh-tts-reader authors` |
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

Copyright (c) the dsh-tts-reader authors

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
| 用法 / Usage | 仅**参考**安全围栏的检查项思路；**未复制任何代码** |

宿主侧两条路由（`GET /pudding-pet/tts`、`GET /pudding-pet/voices`）需要防止被其他页面滥用
（合成会以用户的名义请求第三方服务），其检查项思路参考了该项目：

- **只接受 GET / HEAD**（拒绝其他方法）；
- **拒绝跨站请求**（`Sec-Fetch-Site: cross-site`）；
- **同源 `Origin` 校验**（应用自身的自定义 scheme，或同 host 的 http 来源）。

因为**没有复制代码**，本仓库不包含该项目的任何受版权保护的表达；列出它只为如实说明设计来源。

The host-side routes (`GET /pudding-pet/tts`, `GET /pudding-pet/voices`) must not be usable from
another page, because synthesis calls a third-party service on the user's behalf. The checklist
below is **modelled on** that project:

- **GET / HEAD only** (other methods are refused);
- **cross-site requests refused** (`Sec-Fetch-Site: cross-site`);
- **same-origin `Origin` check** (the app's own custom scheme, or a same-host http origin).

Because **no code was copied**, this repository contains no copyrightable expression from that
project; it is listed here only to state the design's provenance honestly.

---

## 3. 重新分发注意事项 / Redistribution notes

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
