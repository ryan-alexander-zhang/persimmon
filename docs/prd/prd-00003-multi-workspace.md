---
id: prd-00003-multi-workspace
type: prd
status: active
parent: idea-00004-multi-workspace
---

# 多 workspace PRD

第三十二轮修订（2026-09-09，[decision-00020-unified-go-cli](../decision/decision-00020-unified-go-cli.md)
的原地修订）：上一轮所据的「用 Go、两个产物、npm 包让出 bin 名改称 host 包、
一个 tag 同发」形态被域主推翻，改为**单一 npm 产物**——命令 `persimmon` 就是
本包 `@ryan-alexander-zhang/persimmon` 的 bin，脚手架是本包的一个 TypeScript
模块。**当前裁定是暂不发布任何版本**；这不是「不分发」：分发形态是本包的
npm bin（全局安装与 `npx` 两种），「暂不」也不是「永不」。本轮只据实改写因此
不再为真的几处——角色表里的「同一个二进制」、In scope 的「单命令启动」与
「代码位置」、功能需求 1 / 6 / 10、风险与依赖里的发布依赖，以及本轮审计指出的
一句话概述里的「host 进程」括注（`CONTEXT.md` 的「已运行进程」词条不含它，
也不再有第二个包可称 host）——**不扩大本 PRD 的范围**。「入口合一」与「登记由 `persimmon new` 自己做」两项结论不变。

第三十一轮修订（2026-09-08，[decision-00020-unified-go-cli](../decision/decision-00020-unified-go-cli.md)）
**——其所据的实现与分发形态已由第三十二轮推翻，本段保留作历史记录**：
命令行入口合成一个名为 `persimmon` 的独立二进制（ainpt 的 `new` / `update` /
`list-langs` 并入），npm 包让出这个 bin 名、改为只提供服务本体的 host 包
`@ryan-alexander-zhang/persimmon-host`；新项目的登记由 `persimmon new` **自己**
做，不再等模板侧调用。本轮只据实改写因此不再为真的几处——一句话概述里持有
注册表的那个进程、愿景与目标两条（以 `ainpt` 为参照物、登记的归属）、角色、
In scope 的「单命令启动」与「代码位置」的理由、功能需求 1 / 6 / 10、
风险与依赖两条——**不扩大本 PRD 的范围**：
脚手架子命令（`new` / `update` / `list-langs`）与 `new` 的登记闭环由
`spec-00013-persimmon-scaffold` 持有；命令自身的形态、启动、`version` 与分发由
`spec-00012-persimmon-command` 持有。本 PRD 不覆盖它们。

## 一句话概述

一个已运行进程、一个浏览器标签页，服务用户机器上任意多个基于模板的
项目：每个含 `whiteboard.config.yaml` 的项目根目录是一个 workspace，顶栏切换器
在它们之间切换，项目级状态仍留在各项目目录里。

## 愿景与目标

白板今天与一个仓库一一绑定：从某目录启动，向上找到最近的流程配置，只看那个
仓库。有几个项目就要几个进程、几个端口、几个标签页；通知来自哪个板要靠端口号
辨认。`decision-00019` 把白板独立成仓、解决了「每个项目一份源码」的那一半；
本 PRD 解决另一半——「一个进程看多个项目」——让白板成为「装一次、处处可用」
的工具（第三十一轮据实校正：原句以 `ainpt` 为参照物，而 `ainpt` 已并入本仓库、
与白板同一个命令，`decision-00020`）。参照 Obsidian 的 vault 模型：一个目录一个
workspace，目录内隐藏状态目录，顶层切换器。

- 用户对全部项目只维护一个白板进程与一个标签页。
- 切换项目不重启进程、不换端口、不丢其他项目里运行中的会话。
- 一条命令从任何目录启动；`persimmon new` 建好的项目不用手动登记就出现在
  切换器里（第三十一轮改名并改归属：登记由 `persimmon new` 自己做，
  `decision-00020` §2 第 7 条 ②）。
- 每个项目的 `docs/`、流程配置、`.whiteboard/` 与 agent 本地层原地不动，
  今天单项目下成立的一切行为在每个 workspace 内逐一成立。

## 角色

- **文档负责人**（唯一人类角色）：登记与移除 workspace，在切换器里切换，
  在当前 workspace 上做今天白板的全部事情；离场时按通知回到对应 workspace
  的会话。
- **agent**（Claude Code / Codex 等本地 CLI）：与今天相同，在被发起的那个
  workspace 的 `docs/` 内受限写作；不感知 workspace 概念。
- **`persimmon` 命令的脚手架子命令**：`persimmon new` 建项目时把新项目登记为
  workspace——同一个命令里的一步，不是第三方参与者（第三十一轮据
  `decision-00020` 改写：原条把 `ainpt`（独立的模板脚手架）列为一个角色；
  该子命令的行为由 `spec-00013-persimmon-scaffold` 持有。第三十二轮据该决定的
  回退把「同一个二进制」改为「同一个命令」——命令是本 npm 包的 bin，脚手架是
  本包的一个 TypeScript 模块，两者同属一个产物这一点不变）。

## 范围

### In scope（MVP）

- **workspace 与注册表**：workspace 即一个含 `whiteboard.config.yaml` 的项目
  根目录；注册表在用户目录 `~/.persimmon/workspaces.json`，条目为 id、显示名、
  绝对路径；界面与命令行都能添加、移除。
- **一进程多实例**：服务端按 workspace 各持一组今天的服务（文档仓库、工作流
  引擎、会话管理、git 层、监听器、答疑与标注存储、agent 两层设置）；会话并发
  上限、通知、监听都按 workspace 作用域计。
- **切换器**：顶栏顶层入口，列出全部已登记 workspace，切换只换当前 workspace
  的图、导航栏、会话面板与设置面板；重载页面回到原 workspace。缺失的目录、
  没有或非法流程配置的目录、不是 git 仓库的目录标为不可用而不消失。
- **单命令启动**：命令名 `persimmon`，从任何目录启动；在某个项目目录内启动
  时该目录成为当前 workspace 并入注册表；已运行进程在监听时不再起第二个进程，
  而是经它登记目录后指向它。命令是本包 `@ryan-alexander-zhang/persimmon`
  （npm 上的 `persimmon` 已被无关包占用）的 bin，全局安装或
  `npx @ryan-alexander-zhang/persimmon` 都得到它。（第三十一轮曾据两产物形态
  改写为「命令已是独立二进制、不经 npm 分发，npm 包改为 host 包
  `@ryan-alexander-zhang/persimmon-host`」；第三十二轮据 `decision-00020` §2
  第 2、6 条改回本包本名与这两种安装形态——当前裁定是暂不发布任何版本，故这
  两种形态今天只在本地打包下成立。命令怎么装、怎么起服务由
  `spec-00012-persimmon-command` 持有，本 PRD 只要「一条命令」这件事。）
- **通知标识来源**：桌面通知标题前缀 workspace 显示名，点击切到该 workspace
  并呈现对应会话。
- **代码位置**：代码从 `tools/whiteboard/` 提到仓库根，以支持 `npx` 形态；
  living docs 的路径引用随之更新，issue / plan / record 等历史工作项保留旧路径。
  （第三十一轮曾据当时的让名校正为「经 `npx` 取得的是 host 包
  `@ryan-alexander-zhang/persimmon-host`」；第三十二轮据 `decision-00020` §2
  第 2 条改回：本包收回 bin 名后，这条理由说的又是**命令自己**的 `npx` 形态，
  仓库根即本包的包根。「提到仓库根」这个结论三轮不变。）

### Out of scope

- 多 workspace 同屏并排的合并视图（VS Code multi-root 那种）——切换器一次
  只呈现一个 workspace。
- 跨 workspace 的文档关系、检索或覆盖率汇总。
- 远程或多人访问；白板仍是本机单人、`localhost` 工具。
- 把白板改成以终端为中心的 agent 编排台（orca、t3code 的主体形态）；只借其
  「一个后端、项目即注册目录」的外壳。
- 一个 workspace 内的任何行为变化：本 PRD 不改动 `prd-00001` / `prd-00002`
  列出的能力，只把它们的作用域从「本进程」收窄为「当前 workspace」。
- 把 `.whiteboard/`、流程配置、agent 本地层搬进注册表或用户目录
  （`decision-00017` 的两层不变）。

## 功能需求

1. **workspace 注册表**：白板在用户目录维护一份注册表，每条含唯一 id、显示名
   与项目根目录的绝对路径。用户可在界面里添加一个目录（id 由目录名派生、
   同名目录自动区分，显示名缺省同 id）、移除一条；命令行提供同样的添加、
   移除与列出入口，添加走的那条路径也是 `persimmon new` 自己登记新项目时走的
   （第三十一轮：原作「添加入口供 `ainpt new` 调用」，`ainpt` 已并入，调用方
   是同一个命令内的一步；第三十二轮把「二进制」改为「命令」，`decision-00020`
   的回退）。移除只删登记，不动项目目录
   里的任何文件；有运行中会话的 workspace 不能被移除。
2. **不可用 workspace**：登记的目录不存在、没有流程配置、不是 git 仓库或
   流程配置非法时，该条在切换器里呈现为不可用并说明原因，不从注册表消失；
   修好后无需重启即可用。今天「配置缺失或非法则拒绝启动」的语义随之从进程级
   变为 workspace 级；已经打开的 workspace 按打开时的配置继续工作。
3. **切换器**：顶栏提供切换器，列出全部 workspace、标出当前一个；选择另一个
   即整页换到那个 workspace 的图、导航栏、会话面板、设置面板、异常与诊断计数，
   进程与端口不变。另一个 workspace 里运行中的会话不受切换影响。
4. **逐 workspace 的状态与作用域**：文档解析、监听、刷新、会话（发起、并发
   上限、面板、历史）、答疑线程、标注、agent 有效列表与本地层，全部按当前
   workspace 计，落盘位置仍是该项目目录（`.whiteboard/` 与 `docs/`）。呈现
   状态里跨页面重载保持的类型组与目录组展开态按 workspace 分别记住；导航栏
   开合、主题、通知开关与面板尺寸是用户偏好，全局一份。
5. **单命令启动**：`persimmon` 从任何目录启动一个进程。在某个项目目录内启动
   时，该目录成为当前 workspace，未登记则自动登记，该项目不可用时页面呈现其
   原因而不是进程退出；在项目目录外启动时打开上次所在的 workspace，没有则打开
   注册表第一条可用的，都没有则呈现「添加第一个 workspace」的空态而不是报错
   退出。已运行进程在监听时，第二次执行不起新进程：经它登记当前目录（若在
   项目内），打印它的地址后退出；端口被别的程序占用时报错退出。
6. **`persimmon new` 自动登记**：`persimmon new` 在脚手架完成后**自己**登记
   新项目，走第 1 条的同一条路径；模板 `template.json` 的 `post_create` 保持
   现状（只做 git 初始化），模板仓库不必知道白板的存在。（第三十一轮据当轮
   决定表第 5 条改写，该裁定第三十二轮存续为 `decision-00020` §2 第 7 条 ②：原作「模板在建项目收尾时调用第 1 条的
   命令行入口登记新项目；机器上未安装 `persimmon` 时该步静默跳过」——那条
   跨仓库通路等了两轮未落地，且脚手架与登记现在同属一个命令（第三十二轮：
   第三十一轮此处写「同属一个二进制」，回退后是同一个 npm 包里的同一个 bin），
   「未安装 `persimmon`」这一情形不复存在。登记的成败处置由
   `spec-00013-persimmon-scaffold` 持有。）
7. **正常关停**：进程关停时对每个 workspace 的每个运行中会话执行今天的终止
   收尾（结束进程、commit、历史落盘）。
8. **通知标识来源**：桌面通知的标题以 workspace 显示名为前缀；点击通知先切到
   该 workspace，再按今天的规则呈现对应会话。通知内容仍只含 workspace 显示名、
   会话种类、文档 id 与状态。
9. **切换器上的会话信号**：切换器每条呈现该 workspace 运行中与等待输入的会话
   计数，让用户在当前 workspace 里也知道别的 workspace 在等他；不呈现会话内容。
10. **代码提到仓库根**：仓库根即 npm 包根，该包是
    `@ryan-alexander-zhang/persimmon`，白板服务本体与命令 `persimmon`（它的
    bin）同在其中；`npm install / test / build / start` 在仓库根执行。
    （第三十一轮曾据两产物形态把包名改为 host 包
    `@ryan-alexander-zhang/persimmon-host`、把命令的代码位置指到 `cli/`；
    第三十二轮据 `decision-00020` §2 第 1、2 条改回本包本名，命令的代码位置
    是本包的 `bin/persimmon.js` 与 `src/`，`cli/` 随本轮删除。）

## 用户体验期望

- 切换 workspace 的感受接近换标签页而非重启：不超过一次页面加载的等待，切回
  时选中、下钻、终端滚动位置等呈现状态按 id 保持。
- 通知一眼可辨来自哪个项目；点一下就落在那个项目的那个会话上。
- 添加 workspace 只需要一个目录路径；选错了目录（不是项目根）得到说明而不是
  一个空板。
- 从任何终端敲 `persimmon` 都得到同一个白板，不需要先 `cd` 进项目。

## 风险与依赖

- ~~**依赖**：模板仓库的 `template.json` 增加 `post_create` 步骤调用登记
  命令~~——**第三十一轮消解**：登记由 `persimmon new` 自己做（功能需求 6），
  跨仓库依赖不再存在，模板 `post_create` 不动（`decision-00020` §2 第 7 条 ②）。
- **依赖**：本包 `@ryan-alexander-zhang/persimmon` 以 npm bin 分发——全局安装
  与 `npx` 两种形态；`node-pty` 原生模块在这两条安装路径下的构建与权限须各
  实测一次。**当前裁定是暂不发布任何版本**（`decision-00020` §2 第 6 条），
  故这两条路径今天以本地 `npm pack` 出的 tarball 验；「暂不」不是「永不」，
  真要发布时也只有一个产物，不存在版本配对、校验和策略与两步发布顺序。
  （第三十一轮此处写的是「host 包的发布 + `persimmon` 命令经 `install.sh` /
  GitHub Release 分发 + 两个产物的版本配对」，随第三十二轮的回退整条作废。）
- **注册表与项目目录漂移**：目录被移走、重命名或删除后注册表条目失效——以
  「不可用而不消失」承接，用户自行移除或修路径。
- **内存与句柄随 workspace 数线性增长**：每个 workspace 一组监听器与解析好的
  图；单人机器上十来个项目量级可接受，不做惰性加载以外的优化。
- **端口占用即「已运行进程」的判定风险**：占着端口的可能不是 persimmon；第二次
  启动须确认对方确实是白板再指向它，否则报端口冲突。
- **嵌套的 workspace**（已知边界）：一个已登记目录之下的子目录若自己也是
  git 仓库（submodule、嵌套 `git init`），登记它照常放行——两者各有自己的
  git 仓库与 `docs/`，逐 workspace 隔离本就成立，不为此加祖先关系判定。同一
  仓库内的子目录被「不是 git 仓库」那条判为不可用，不在此列。
- **代码位置迁移的文档面**：199 处 `tools/whiteboard/` 引用只改 living docs，
  历史工作项保留旧路径——读历史文档的人须知道路径已变，由 `ARCHITECTURE.md`
  的一句话承接。

