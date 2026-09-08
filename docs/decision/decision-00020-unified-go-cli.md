---
id: decision-00020-unified-go-cli
type: decision
status: active
constrains: [spec-00011-multi-workspace, design-00003-multi-workspace, design-00004-persimmon-cli, prd-00003-multi-workspace, plan-00033-persimmon-command]
---

# Decision: 一个 `persimmon` 命令——ainpt 并入本仓库 `cli/`，Go 二进制承担全部命令行入口，Node 只留白板服务

> 独立仓库 ainpt 的 `new` / `update` / `list-langs` 迁入本仓库 `cli/`，与今天
> `bin/persimmon.js` 里的 `add` / `remove` / `list` 与启动握手合成一个 Go
> 二进制，命令名 `persimmon`。npm 包改名为 host 包、让出 `persimmon` 这个
> bin 名，只提供白板服务本体；`persimmon` 命令以 `npx` 按钉死的版本启动它。
> ainpt 仓库归档。推翻 `spec-00011-FR-20`（包名、`npx @…/persimmon` 安装
> 形态）、`design-00003` §8「`ainpt new` 的登记属模板仓库」与 §10「命令是
> `bin/persimmon.js`」三处现状。

## 1. 需要做这个决定的原因

- 同一条流程今天分在三处入口：`ainpt new` 建项目（Go 二进制，`curl | sh`
  安装），`persimmon add` 登记与 `persimmon` 开板（npm bin），下一步白板界面
  里还要加 workspace 创建。三者互相依赖，命名却不指向同一个产品。
- `design-00003` §8 把「`ainpt new` 完成时登记」留给模板侧，`plan-00027`
  据此只保证 `persimmon add` 非交互幂等；模板 `template.json` 的 `post_create`
  至今只有 git 初始化两步（`git init`、`core.hooksPath`），登记从未落地——
  两个仓库互相等对方。
- ainpt 本体约 600 行实现 + 300 行测试、仅标准库、逻辑稳定（加语言只加分支，
  命令不改），迁移成本是一次复制加改命令名；其 goreleaser 配置与 `install.sh`
  可改几处坐标后复用。
- 域主于 2026-09-08 的评审对话中裁定：合并，用 Go，命令改名 `persimmon`；
  并确认四项形状（Node 服务保留、npm 包让名、`add` 双路径保留、一个 tag 同发
  两个产物）。§2 第 5、6、7 条与「保留 `AINPT_OWNER` / `AINPT_REPO` 环境变量
  名」是起草者在四项之外的判断，随本稿一并交域主确认。本决定没有可引的
  上游文档，故不写 `motivated_by`。

## 2. 决定

| # | 做法 | 理由 |
| --- | --- | --- |
| 1 | 本仓库新增 `cli/`（独立 `go.mod`，Go 1.24，仅标准库），ainpt 的 `main.go` 与 `internal/scaffold/`（含测试）迁入：**逻辑不改**，只改 import 路径与用户可见字串里的命令名（`ainpt list-langs` → `persimmon list-langs` 等四处，见 `design-00004` §6）；ainpt 仓库 README 改为一段指向本仓库的说明并归档，不再发布 `ainpt` 二进制 | 代码稳定、零依赖，复制即得；一个仓库一条发布线 |
| 2 | Go 二进制命名 `persimmon`，承担**全部**命令行入口：`new` / `update` / `list-langs` / `add` / `remove` / `list` / 无子命令（启动或接入）/ `version`；`bin/persimmon.js` 的探测、登记、子命令逻辑迁到 Go 后删除 | 一个名字、一个二进制、一份 usage；模板项目的用户只装一个东西 |
| 3 | npm 包改名 `@ryan-alexander-zhang/persimmon-host`，bin 改为 `persimmon-host`，入口只剩「监听端口、打印地址、处理信号」与一个只判可用性、印 JSON 即退的 `--judge` 查询模式（供无进程时的 `list` 用，`design-00004` §4）；`persimmon` 命令以 `npx -y @ryan-alexander-zhang/persimmon-host@<编译期钉死的版本>` 启动它，`PERSIMMON_HOST` 环境变量可指向本地检出以便开发 | 白板本体（约 30 个 TS 模块、Vite 前端、node-pty）不迁；`npx` 让 Node 侧的安装对用户不可见（`issue-00030` 已实测 npx 缓存下 pty 可起）；版本钉死使命令与 host 永远配对 |
| 4 | 一个版本号、一个 tag：推 `v*` tag 触发本仓库一条 workflow，先 `npm publish` host 包、再 goreleaser 出 Go 产物（linux/darwin/windows × amd64/arm64），两者版本同为 tag；`install.sh` 迁入本仓库，装的是 `persimmon`（仍只支持 linux/darwin，Windows 用户从 Release 页下载 zip） | 两个产物必须配对，一个 tag 是最省的配对方式 |
| 5 | `persimmon new` 在脚手架完成后**自己**登记新项目（走与 `add` 相同的路径）；模板 `post_create` 保持现状（只做 git 初始化）；创建标记文件名保留 `.ainpt.json` | 登记不再跨仓库等待；改标记文件名会让所有既有项目的 `update` 失效，零收益 |
| 6 | 注册表文件契约（`design-00003` §2）从此有两份实现：Go 走「无已运行进程」路径直接读写文件，TS 走 Host API 路径；契约的唯一来源仍是 `design-00003` §2，两侧测试引用同一组 `spec-00011` 需求项 | `add` 的双路径（`spec-00011-FR-13/14`）保留，用户手改文件的语义不变 |
| 7 | `config` 子命令与白板界面里的 workspace 创建**不在本决定范围**；后者到来时 Host 以子进程调 `persimmon new`，脚手架逻辑只存在于 Go 一处 | 先把入口合一；界面创建复用命令而不是再写一份脚手架 |
| 8 | 保留 `AINPT_OWNER` / `AINPT_REPO` 环境变量名 | 已有用户 shell 配置里的名字；改名只换来一次迁移成本 |

## 3. 考虑过的其他选项

| 选项 | 结论与理由 |
| --- | --- |
| 维持两仓库两命令，模板 `post_create` 调 `persimmon add` | **否决**。登记等了两轮没落地；用户仍要装两个东西、记两个名字；后续界面创建还要第三处调用脚手架 |
| 把 ainpt 移植成 TypeScript 并入 npm 包，只留 Node | **否决**。`new` 是项目还不存在、机器上未必有 Node 时跑的引导步骤；移植后 `new` 被 Node 与 node-pty 挡住。域主明确要 Go |
| `persimmon new` 只做薄包装，`spawn("ainpt")` | **否决**。仍是两个二进制、两条发布线，命名混乱原样保留 |
| 把 Node 服务也重写为 Go | **否决**。约 30 个服务端模块、PTY、WS、React 前端；不在讨论范围 |
| Go 二进制内嵌 host 包（`embed` 静态文件 + 要求全局 `node`） | **否决**。node-pty 是按平台的预编译原生模块，嵌入等于自己重做 npm 的事；`npx` 已经解决了下载与缓存 |
| `npm install -g` host 包作为前置步骤 | **否决**。多一步手工安装且版本不受命令控制；`npx` 带版本号即钉死配对 |

## 4. 后果

**接受的代价**

- 本仓库多一套工具链：Go 1.24、`gofmt` / `go vet` / `go test` 进入质量门，
  CI 多一个 job；根指南（`DEVELOPMENT.md` Commands、`TESTING.md`、
  `CODE_QUALITY.md` §2、`CODE_STYLE.md`）与 `ARCHITECTURE.md` 要补 Go 章节
  （与本设计冲突的既有文档清单见 `design-00004` §10，由 plan 落地）。
- 覆盖率：Go 工具链只出语句覆盖率，`TESTING.md` 的分支/函数两项在 Go 侧无
  工具；迁入的 `scaffold` 包现为 25.7% 语句覆盖，按 `CODE_QUALITY.md` §8
  作为 legacy 记债并逐步收紧，新写的 Go 代码（registry、hostproc、main）须
  达 90% 语句覆盖。`TESTING.md` 的 Go 口径由 plan 前的根指南填充定死。
- 第一次开板要经 `npx` 下载 host 包（无安装脚本、无原生构建，`issue-00030`
  §3.2），冷启动多几秒。
- 注册表读写在两种语言里各有一份（约百行），契约漂移只能靠文档与两侧测试
  引用同一组需求项来防。
- 已发布的 `@ryan-alexander-zhang/persimmon` 要 `npm deprecate` 并指向新名。
- 本机已装的 `/usr/local/bin/ainpt` 不再更新；用户改用 `persimmon new`。
- `spec-00011` 的 FR-20（包名、`npx` 安装形态）、FR-13/14（握手执行者）走
  修订轮（`rule-00001-BR-3`）；FR-21 的五态口径不变，无进程时由 host 包的
  `--judge` 模式供给（`design-00004` §4）。

**得到的**

- 一个二进制、一个名字、一条发布线、一套版本号贯通 `new` → 登记 → 开板。
- 登记在 `new` 里闭环，模板仓库再无需知道白板的存在。
- 白板界面日后的 workspace 创建有现成的可执行契约（调 `persimmon new`）。
- host 包不再带任何命令行逻辑，测试面缩小到服务本身。
- 本仓库自身（根有 `.ainpt.json`，`decision-00019` §2 第 1 条）今后用自己
  产出的 `persimmon update` 跟随模板骨架升级，自举关系延伸到命令。

**不变的**

- 白板服务的全部行为、HTTP/WS API、`whiteboard.config.yaml` 契约、
  `~/.persimmon/workspaces.json` 的格式与校验（`design-00003` §2）。
- `new` / `update` 的语义与参数（`--lang` / `--variant` / `--dir` / `--ref` /
  `--set`）、`.ainpt.json` 的内容与文件名。
- 模板仓库的 `template.json`。
- 无子命令启动的握手（`design-00003` §8 的流程图，含「端口被他人占用」的
  第三态）——执行者从 JS 变为 Go，判定与输出不变。

## 5. 这个决定约束什么

- `spec-00011-multi-workspace`：FR-20 的包名与 `npx @…/persimmon` 安装形态、
  FR-13/14 的握手执行者随修订轮改写；FR-21 内容不变。
- `design-00003-multi-workspace` §8「`ainpt new` 的登记属模板仓库」与 §10
  「命令是 `bin/persimmon.js`、包名 `@ryan-alexander-zhang/persimmon`」两处
  现状不再成立，随修订轮据实改写；§2 的注册表契约成为两份实现的共同来源，
  改它必须同时改两侧。
- `design-00004-persimmon-cli`：命令面、host 启动、代码位置与发布线的结构。
- `prd-00003-multi-workspace`：角色表里的 `ainpt`、功能需求 6「模板 `post_create`
  调登记、未装 `persimmon` 时静默跳过」、In scope「单命令启动」与功能需求 10 的
  包名与 `npx` 安装形态（并及风险与依赖里的模板依赖与发布依赖两条）随修订轮
  据实改写；本决定不扩大该 PRD 的范围。
- `decision-00019` §5 要求的「代码位置与启动方式的重构一并记录」由
  `design-00004` 承担，其 `constrains` 已回填。
- `ARCHITECTURE.md` §2 / §3 / §5 / §7 / §9 与四份根指南：由后续 plan 按
  `design-00004` §10 的冲突清单改写，plan 转 `open` 前必须完成（`AGENTS.md` §8）。
- ainpt 仓库与模板仓库 README 里的安装说明：指向本仓库的 `install.sh`。
- 后续任何命令行入口（含 `config`）只能加在 `cli/`；不得再在 npm 包里引入
  bin 逻辑，不得再写第二份脚手架。落在本决定之下的新文档回填 `constrains`。

## 第三十一轮追注（2026-09-08）

§4「不变的」与 §5 都写作 `spec-00011-FR-21`「五态口径不变」/「内容不变」。
`spec-00011` 的第三十一轮修订轮据其审计裁定，在此之外给 FR-21 **增了一条
`If` 分支**：无已运行进程、且本机取不到 host 包的判定（没有可用的 Node）时，
`list` 仍以 0 退出，只呈现命令自己算得出的三种不可用（目录不存在、不是 git
仓库、目录内无流程配置），一条也没命中的条目不断言「可用」、其可用性一列
显示 `-`，并打印一句「完整判定需要 Node」。这条分支不是新行为——它是
`design-00004` §4 早已写下的退让，本轮只是给它一个需求层的归属，否则
一个设计里的退让没有任何条目为它负责。

**有已运行进程时的五态口径确实不变**，本追注不触动 §2 的决定表；变的只是
判定从哪里来（有进程 → 它给；无进程 → host 包给，命令自算那三种）。

`help` / `-h` / `--help` 作为用法出口由 `spec-00012-persimmon-command` 补入
子命令集，§2 第 2 条的七项不变。

## plan 轮追注（2026-09-08）

§4「已发布的 `@ryan-alexander-zhang/persimmon` 要 `npm deprecate`」前提不实：
`npm view` 返回 404，该包从未发布过（`design-00003` §10 的包名是设计值，
`plan-00027` 未走到 publish）。因此没有旧包可弃用，host 包以新名首发即可；
首个 tag 取 `v0.2.0`——续本仓库 `package.json` 的 `0.1.0`，本仓库尚无任何 tag，
ainpt 自己的 `v0.3.2` 序列随其归档终止。
