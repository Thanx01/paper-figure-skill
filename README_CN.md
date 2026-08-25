<div align="center">

[English](README.md)

<img src="./assets/banner.svg" alt="Paper Figure Loom：从论文或母图生成细粒度素材、可编辑 PowerPoint 与视觉验收结果" width="100%" />

<br />

### 论文框架图应该真正可编辑，而不是披着 `.pptx` 外衣的截图。

**Paper Figure Loom** 把论文或母图转成细粒度透明素材、PowerPoint 原生对象和经过视觉验收的单页框架图——全部在一次可恢复的 Codex 任务中完成。

<br />

`论文 / 提示词 → 标准母图` &nbsp;·&nbsp; `母图 → 独立素材` &nbsp;·&nbsp; `素材 → 可编辑 PPTX` &nbsp;·&nbsp; `渲染 → 对比 → 修复`

<br />

<a href="https://github.com/Thanx01/paper-figure-loom/actions/workflows/ci.yml"><img src="https://github.com/Thanx01/paper-figure-loom/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
<img src="https://img.shields.io/badge/tests-21%20passing-brightgreen" alt="21 项测试通过" />
<img src="https://img.shields.io/badge/output-PPTX%20%C2%B7%20SVG%20%C2%B7%20PNG-7C3AED" alt="输出 PPTX SVG PNG" />
<img src="https://img.shields.io/badge/license-MIT-yellow" alt="MIT License" />

</div>

---

**[10 秒看懂](#10-秒看懂) · [工作流](#工作流) · [两种模式](#两种模式) · [快速开始](#快速开始) · [交付内容](#交付内容) · [质量门槛](#质量门槛)**

---

## 10 秒看懂

给 Skill 一篇**论文**或一张**母图**，它会完成整条制作链路：

- **只有论文？** 先锁定准确文字、模块和连接关系，生成三张完整候选图，淘汰缺项方案，并确定唯一母图。
- **已经有图？** 保留原图的构图、配色、比例和层级关系，不擅自重做版式。
- **需要真正可编辑？** 文字、面板和连线保留为原生对象；每个能独立成图的 UI、图标、插画和装饰都成为单独的透明素材。
- **需要交付前验收？** 自动渲染并生成并排图、叠加图、差异图、元素框图和素材总览，再定点修复未通过区域。
- **任务中断？** 原子保存状态，从下一项未完成动作继续，不丢弃已经验收的结果。

不需要反复发送“继续生成”，不需要手动转运下载包，也不会把整页截图藏进 PowerPoint。

---

## 工作流

![Paper Figure Loom 工作流：确定标准母图、生成细粒度透明素材、重组可编辑框架图、视觉验收与交付](docs/paper-figure-loom-workflow.svg)

| 阶段 | Skill 做什么 | 通过条件 |
|---|---|---|
| **1. 母图** | 接收一张完整母图，或从论文语义生成三张候选图 | 必需模块和连接关系全部出现 |
| **2. 盘点** | 先做语义盘点，再做残余细节扫描 | 图中没有无法解释的视觉元素 |
| **3. 素材** | 同时参考完整母图和局部裁剪，重生成每一种复杂元素 | 主体可见、透明有效、不合并相邻元素 |
| **4. 重组** | 恢复标准化位置、尺寸、层级、配色、文字和连线 | 原生对象可编辑；素材不拉伸、不漏项 |
| **5. 验收** | 渲染多种对比图，只对失败区域使用有限修复预算 | 达到声明的 QA 门槛，否则返回阻塞报告 |

---

## 为什么不只是“提示词 + 截图”

| 常见捷径 | Paper Figure Loom |
|---|---|
| 把原图直接铺在幻灯片上 | 用原生对象与透明素材重建场景 |
| 连背景一起裁下图标 | 为每个素材任务重生成一个有依据的前景对象 |
| 为减少调用合并相邻细节 | 保留细粒度素材清单和各自的位置实例 |
| 只看 `.pptx` 是否“像” | 同时检查渲染像素与 PowerPoint 结构 |
| 中断后从头开始 | 原子保存阶段状态和已验收产物 |
| 最佳努力结果也标成成功 | 未过门槛时返回可继续执行的阻塞包 |

---

## 两种模式

### 重建已有母图

附上原框架图并发送：

```text
使用 $rebuild-paper-figures 处理附件中的原框架图。

先尽可能细粒度且完整地识别图中所有能独立成图的 UI、图标、插画和装饰；
针对每一种不同的视觉元素，参考原图重新生成一张无底色、无背景的透明单图。
然后以原框架图为唯一布局母版，用这些细粒度素材 1:1 拼回一页可编辑 PowerPoint，
保持画布比例、元素比例、相对位置、层级、连线和配色一致。
文字、方框和连线必须是原生可编辑对象。完成自动对比和局部修复后，只交付最终文件。
```

`rebuild` 是当前发布重点，也是成熟度最高的路线。

### 从论文开始

附上论文和可选风格参考，然后发送：

```text
使用 $rebuild-paper-figures，根据附件论文制作一张单页方法框架图。

先锁定论文中的准确文字、模块和连接关系，再生成三张完整母图并选出结构完整的一张。
接着逐一重新生成母图中所有可独立成图的 UI、图标、插画和装饰为透明单图，
最后按选定母图的比例、位置、层级和配色拼成可编辑 PowerPoint。
自动完成视觉对比和局部修复，中间不需要我确认，只在最后让我验收。
```

选定母图以后，`author` 与 `rebuild` 使用相同的素材盘点、重组和 QA 流程。

### 中断后继续

```text
使用 $rebuild-paper-figures，继续 /absolute/path/to/run-directory 中的任务。
读取 run-state.json，保留已经通过的阶段和素材，从下一项继续。
```

---

## 快速开始

把仓库添加为个人 Codex 插件市场：

```bash
codex plugin marketplace add Thanx01/paper-figure-loom --ref main
```

重启 Codex Desktop，打开 **Plugins（插件）**，在 **personal（个人）** 市场中安装 **Paper Figure Loom**。

本地开发安装：

```bash
git clone https://github.com/Thanx01/paper-figure-loom.git
codex plugin marketplace add /absolute/path/to/paper-figure-loom
```

当前版本直接调用 Codex Desktop 内置图像生成，不需要 `OPENAI_API_KEY`，也不会自动操作 ChatGPT 网页版。

---

## 交付内容

| 输出 | 用途 |
|---|---|
| `framework.pptx` | 权威可编辑成品 |
| `framework.svg` / `framework.png` | 完整框架图导出 |
| `assets/png/` | 细粒度透明位图素材 |
| `assets/svg/` | 每个素材对应的 SVG；混合 SVG 会明确保留嵌入位图 |
| `assets-manifest.json` | 来源、生成策略、复用关系、透明度检查和可编辑级别 |
| `qa/` / `qa-report.json` | 并排图、叠加图、差异图、元素框和素材总览 |
| `paper-figure-loom-delivery.zip` | 完整可移交交付包 |

---

## 质量门槛

“1:1”指声明的结构、逐字文字、画布比例、位置、尺寸、层级、配色和原生几何关系都处于误差范围内；同时意味着**不漏图标、不拉伸素材、不用整页截图伪装可编辑性**。

重新生成的复杂插画按角色、轮廓、比例、配色和视觉重量验收，而不是承诺像素复制。如果有限修复预算耗尽，任务会返回可恢复的阻塞包，而不是给出虚假通过结果。

---

## 当前边界

- 每次运行处理一张单页框架图和一页 PowerPoint。
- PowerPoint 是可编辑成品的事实源，暂不输出 VSDX。
- 默认预算覆盖 32 种不同的复杂素材，每种最多尝试两次。
- 实时图像生成在 Codex Desktop 中执行；CI 使用静态测试、单元测试和录制回放。
- `rebuild` 是当前发布重点；`author` 的论文解析和母图筛选仍会继续加强。

<details>
<summary><strong>贡献者命令与架构</strong></summary>

Skill 位于 `plugins/paper-figure-loom/skills/rebuild-paper-figures`，公开契约位于 [`contracts/`](contracts/) 中。

Codex 正常使用时会自动驱动唯一入口 `forge.mjs`。诊断命令包括 `init`、`next`、`record`、`validate`、`build`、`qa` 和 `package`。不要手动修改 `run-state.json`。

```bash
<bundled-node> plugins/paper-figure-loom/skills/rebuild-paper-figures/scripts/forge.mjs init \
  --request /absolute/path/to/request.json \
  --run-dir /absolute/path/to/run

<bundled-node> plugins/paper-figure-loom/skills/rebuild-paper-figures/scripts/forge.mjs next \
  --run-dir /absolute/path/to/run
```

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm run validate
```

公开测试使用原创合成母图和录制素材，不调用实时图像生成。发布检查还会运行官方 Skill/Plugin 校验，并在 Codex Desktop 中构建真实 PPTX。

</details>

---

## 许可证

代码采用 MIT License。用户提供的论文、母图、风格参考和生成产物保留各自的来源与权利边界。
