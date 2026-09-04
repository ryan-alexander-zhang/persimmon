---
id: idea-00004-multi-workspace
type: idea
status: active
---

# 多 workspace：一个白板进程，服务多个项目目录

## 问题陈述

白板与一个项目根目录一一绑定：从某个目录启动，向上找到最近的
`whiteboard.config.yaml`，就只看那个仓库的 `docs/`。用 `ainpt new` 建了几个
项目的人，要看几个板就要开几个终端、起几个进程、记几个端口。

- 三个项目并行时，桌面上是三个 `npm start` 和三个浏览器标签，通知来自哪个板
  要靠端口号辨认。
- 切换项目等于关掉一个进程再去另一个目录启动，会话历史、设置面板各自一套。
- 白板随模板分发时（迁出前）每个项目还各有一份源码副本，`decision-00019`
  已解决这一半；另一半——「一个进程看多个项目」——尚未解决。

## 产品设想

一个白板进程持有一张 workspace 注册表；每个 workspace 就是一个含
`whiteboard.config.yaml` 的项目根目录。界面顶层有切换器，切换只换当前
workspace 的图、导航栏与会话面板，进程与端口不变。项目级状态
（`.whiteboard/`、流程配置、agent 本地层）仍留在各项目目录里，白板自己只
多一张注册表。

### 1. 注册表

- 放在用户目录（如 `~/.persimmon/workspaces.json`），条目为 id、显示名、
  绝对路径；`ainpt new` 完成时自动追加一条，也可在界面里手动添加或移除。
- 缺失的目录、没有流程配置的目录，在切换器里标为不可用而不是消失。

### 2. 一进程多实例

- 服务端按 workspace id 各持一组现有服务（文档仓库、工作流引擎、会话管理、
  git 层、监听器），API 路由带 workspace 前缀。
- 会话并发上限、通知、监听都按 workspace 作用域计。

### 3. 启动方式

- 一条命令启动（形态参考 t3code 的 `npx t3@latest`），不再要求 cd 进项目。
- 在某个项目目录内启动时，该目录自动成为当前 workspace 并入注册表。

## 范围

**做**

- 注册表、切换器、按 workspace 分实例的服务端、单命令启动。

**不做**

- 多 workspace 同屏并排的合并视图（VS Code multi-root 那种）。
- 跨 workspace 的文档关系。
- 远程或多人访问；白板仍是本机单人工具。
- 把白板改成以终端为中心的 agent 编排台（orca、t3code 的主体形态）；只借其
  「一个后端、项目即注册目录」的外壳。

## 早期价值判断

- 拥有多个模板项目的人只需要一个白板进程与一个标签页，通知和会话面板集中。
- 白板成为「装一次、处处可用」的工具，和 `ainpt` 的地位对齐。

## 已定方向

1. **项目级状态留在项目里**：`.whiteboard/`、`whiteboard.config.yaml`、
   `.whiteboard/agents.json` 不搬进注册表（`decision-00017` 的两层不变）。
2. **以 Obsidian 的 vault 模型为参照**：一个目录一个 workspace，目录内隐藏
   状态目录，顶层切换器。

3. **注册表与命令名**：注册表在 `~/.persimmon/workspaces.json`；包名与 CLI
   命令名同仓库名 `persimmon`，以 `npx persimmon` 启动。
4. **代码提到仓库根**：本轮把代码从 `tools/whiteboard/` 提到仓库根以支持
   `npx` 启动；只改 living docs（根指南、spec、design 等）里的路径引用，
   issue / plan / record 等历史工作项保留旧路径——它们记录的是当时的事实。
5. **通知标识来源**：桌面通知（`spec-00004`）的标题前缀 workspace 显示名，
   点击切到该 workspace 并呈现对应会话。
