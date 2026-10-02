# 布丁桌宠 · Pudding Pet 🐱

> 一只住在 **DeepSeek Harness** 窗口里的猫。它会**朗读助手的回复**、用搞怪的升调复述，
> 可以拖着走，形象还能换成你自己的。

[![License: MIT](https://img.shields.io/badge/code-MIT-blue.svg)](LICENSE)
[![Art: CC0](https://img.shields.io/badge/art-CC0--1.0-green.svg)](LICENSE-ASSETS.md)

<p align="center">
  <img src="docs/states.png" alt="布丁的 10 个状态：idle / listen / think / work / waiting / talk / happy / sad / sleep / poke" width="820">
</p>

**形象是原创的**：奶油白身体 + 焦糖色头顶斑 + 薄荷绿围巾。
美术以 **CC0** 释出，代码以 **MIT** 释出 —— 可自由使用、修改、分发、商用。
与任何现有商业角色无关，详见[素材授权声明](LICENSE-ASSETS.md)。

---

## 功能

- **朗读助手回复** —— 助手一边写，布丁一边念（监听模型输出的原始流，声音比屏幕上的字还早一点）。
- **朗读你的输入** —— 可选，默认关闭。
- **搞怪变声** —— 把音高拉到 2.00，就是那种欠揍的卡通嗓；可一键关掉变回正常嗓音。
- **会朗读给人听的版本** —— 代码块整块丢掉、表格用「，」连、链接只念文字，不会把反引号和星号念出来。
- **可拖动 + 位置记忆** —— 拖到哪儿，下次打开还在哪儿。
- **点击摸头** —— 布丁会缩一下身子。
- **右键设置** —— 音色、变声强度、语速、音量、大小、开关，全部实时生效。
- **10 个状态动画** —— 待机呼吸/眨眼、聆听、思考、干活、等确认、说话、开心、难过、睡觉、被戳。
- **眼珠跟随鼠标** —— 鼠标移动时瞳孔跟着转；悬停时会竖耳。
- **跟随明暗主题** —— 用 DSH 的主题令牌，不用自己适配。
- **形象可替换** —— 视觉层是一个独立接口，换角色不用动语音和交互逻辑。

**零依赖**：不需要 API Key、不联网、不调用云服务、不发起任何模型请求。
语音来自浏览器内置的 Web Speech API。

---

## 安装

### 从本地目录安装（推荐）

```sh
git clone https://github.com/zbzbhs/dsh-pudding-pet.git
dsh plugin --profile <你的profile> add ./dsh-pudding-pet
```

`<你的profile>` 通常是 `desktop`（桌面版）或 `web`。当前 profile 名可以在 DSH 里看到，
或读环境变量 `DSH_PROFILE`。

装完**需要重启 DSH** —— bundle 的层栈是在启动时组合的。

### 从 GitHub 直接安装

```sh
dsh plugin --profile desktop add github:zbzbhs/dsh-pudding-pet
```

### 装完怎么确认

打开 DSH，布丁应该出现在窗口右下角。右键点它能看到设置面板。
如果没出现，先确认 profile 里有这一条：

```sh
dsh plugin --profile desktop list
```

---

## 用法

| 操作 | 效果 |
|---|---|
| **按住拖动** | 移动位置（自动记住） |
| **单击** | 摸头，布丁缩一下 |
| **右键** | 打开设置面板 |
| **鼠标在窗口里移动** | 布丁的眼珠跟着你 |
| **鼠标悬停到布丁身上** | 竖耳、睁大眼 |

设置面板里可以调：

- **朗读** —— 助手回复 / 我的输入（两个独立开关）、搞怪变声、音色、变声强度、语速、音量
- **外观** —— 大小、字幕气泡、轻微动作
- **行为** —— 点击反应、重置位置、收起布丁

收起后右下角会出现一个 🐱 按钮，点它把布丁叫回来。

---

## 改代码

```
dsh-pudding-pet/
├── package.json           # 插件清单（dsh.bundle.patch + dsh.client.platform）
├── cordis.patch.yml       # 插入插件行
├── lib/
│   ├── client.template.js # ★ 浏览器侧源码，改这个
│   ├── client.js          # 构建产物（含烘焙的素材），不要手改
│   └── index.js           # 宿主侧（目前是空壳，见下）
├── assets/
│   ├── pudding.svg        # ★ 形象，美术的唯一事实来源
│   ├── pudding.css        # ★ 10 个状态的动画
│   ├── pudding.js         # 形象控制器（含内联 SVG）
│   └── icon.svg           # 插件管理器图标
├── locale/{zh,en}.json    # 文案
├── tools/build.mjs        # 构建：把素材烘焙进 client.js
└── dev/                   # 本地开发与验证（不参与运行）
```

### 构建

素材必须烘焙进 `lib/client.js`：DSH 通过 `/plugins/<id>/<file>` 投递浏览器代码，
而这个路由**只接受 `client.*.js` 命名的文件**，所以 `assets/` 下的东西在运行时取不到。

```sh
node tools/build.mjs           # 生成 lib/client.js
node tools/build.mjs --check   # 检查产物是否是最新的（CI 用）
```

构建是纯文本替换 + 一次语法校验，产物保持可读。

### 改完之后怎么生效

| 改了哪里 | 生效方式 |
|---|---|
| `lib/client.template.js`、`assets/*` | 跑一次 `node tools/build.mjs`，然后**刷新页面** |
| `package.json`、`cordis.patch.yml` | **重启 DSH** |

**注意**：`lib/index.js`（宿主侧）目前是个空壳，只为了让这个包成为合法 bundle。
本插件的全部功能都在浏览器侧完成 —— 读会话事件、朗读、渲染 —— 所以改功能**不需要重启**。
将来若要加需要宿主的能力（例如 Edge TTS，它的合成必须走宿主），那部分改动才需要重启。

### 换成你自己的形象

视觉层是 [lib/client.template.js](lib/client.template.js) 里的 `PuddingVisual` 对象，
只要实现这几个方法就能替换：

```js
{
  id: 'my-character',
  label: '我的角色',
  mount: function (host, options) {
    // 往 host 里塞你的 DOM
    return {
      setState: function (name) {},  // idle/listen/think/work/waiting/talk/happy/sad/sleep/poke
      poke: function () {},
      setScale: function (px) {},
      setTalkRate: function (ms) {},  // 可选：说话时嘴巴的开合速度
      freeze: function (on) {},       // 可选：冻结动画
      destroy: function () {}
    };
  }
}
```

语音、拖动、设置、位置记忆都跟形象解耦，**换形象不用动这些**。

---

## 本地开发与验证

`dev/` 目录里有几个不参与运行的工具：

```sh
# 语音实验室：试听音色和变声强度（改参数前先听）
node dev/serve.mjs
# 打开 http://127.0.0.1:8791/dev/voice-lab.html

# 契约测试：在真实 Chromium 里跑插件的真实代码（mock 的是 DSH，不是插件）
chrome-headless-shell --headless --disable-gpu --no-sandbox \
  --virtual-time-budget=14000 --dump-dom \
  "file:///<绝对路径>/dev/test-contract.html"
# 读 document.title 拿结果：RESULT:{"pass":35,"fail":0}
```

`dev/test-contract.html` 用一个最小化的 DSH 替身（模块加载器、两阶段 React、
slots 服务、locale 服务、假的会话事件流）来驱动真实插件代码，覆盖 35 项断言：
挂载、指针事件、`sessions.retain` 调用、朗读触发、Markdown 清洗、销毁清理。

**验证的边界（如实说明）**：headless 环境下 `requestAnimationFrame` 不触发，
所以**动画的运动过程无法用截图证明** —— 能证明的是静态姿势、状态切换、
样式注入、以及朗读链路正确。动画观感请在真实浏览器里看 `dev/` 之外的
`assets/pudding.js` 或上游形象的 `preview.html`。

---

## 工作原理

```
        助手输出
           │
           ▼
   agent/assistant-stream          ← 模型输出的原始流，比 DOM 早
           │
           ▼
   sessions.retain(sessionId)      ← 客户端会话控制器，不需要宿主路由
           │
           ▼
   Markdown 清洗                    ← 念"给人听"的版本
           │
           ▼
   逐句队列 → Web Speech API        ← 升调 = 汤姆式的搞怪嗓
           │
           ▼
   布丁张嘴 + 字幕气泡
```

**为什么全部放在浏览器侧**：这样改功能只需要刷新页面，不用重启 DSH。
DSH 的客户端会话控制器已经暴露了读取事件窗口所需的一切
（`sessions.retain` → `eventSource.getSnapshot()/subscribe()`），
不需要额外的宿主路由。

**只念该念的**：只读 `assistant/message` 的 `stream`（可见正文）和
`assistant/chunk` 的文本增量。**推理过程和工具调用参数永远不念。**

---

## 兼容性

- 面向 **DSH Desktop 0.2.0-rc.2**（Electron 44 / Chromium 151）开发与验证。
- DSH 还在快速演进，其他版本**未做通用认证**。
- 语音依赖浏览器的 `speechSynthesis`。没有中文语音时会回退到其他语言并提示。
- 变声上限是 **2.00** —— 这是 Web Speech API 规范里 `pitch` 的上界。

---

## 授权

- **代码**（`lib/`、`tools/`、`dev/`）：**MIT** —— 见 [LICENSE](LICENSE)
- **美术**（`assets/` 及布丁形象本身）：**CC0-1.0** —— 见 [LICENSE-ASSETS.md](LICENSE-ASSETS.md)

美术选 CC0 是因为桌宠形象会被内联、截图、改色、做成表情包，
署名义务在这种场景下很难被实际遵守；CC0 让下游零负担。

本项目是个人开源作品，**不是 DeepSeek 官方产品**。
