---
id: plan-00033-persimmon-command
type: plan
status: open
implements: [spec-00012-persimmon-command, spec-00013-persimmon-scaffold, spec-00011-FR-2, spec-00011-FR-3, spec-00011-FR-4, spec-00011-FR-13, spec-00011-FR-14, spec-00011-FR-15, spec-00011-FR-18, spec-00011-FR-20, spec-00011-FR-21, design-00004-persimmon-cli]
---

# Plan: 一个 `persimmon` 命令——ainpt 并入 `cli/`，npm 包让名成为 host 包

> 落地 `decision-00020`：ainpt 的 `main.go` 与 `internal/scaffold/` 迁入本仓库
> `cli/`（逻辑不改，五处已知偏离各经一份 `docs/issue` 先红后改），新写 Go 侧的
> 注册表、探测与拉起 host；`bin/persimmon.js` 的命令行逻辑迁走后瘦身为
> `bin/host.js`，npm 包改名 `@ryan-alexander-zhang/persimmon-host`；一个 `v*`
> tag（首个为 `v0.2.0`）出两个配对产物。交付 `spec-00012` 全部 11 条 FR、
> `spec-00013` 全部 14 条 FR，与 `spec-00011` 的 FR-2/3/4/13/14/15/18/20/21。

## Design

Links only——设计本身在 [`design/`](../design/README.md)：

- [design-00004-persimmon-cli](../design/design-00004-persimmon-cli.md) ——
  §1 三个参与者与边界；§2 命令面（七个子命令 + `help` + 无子命令，标准库
  `flag` 两趟解析）；§3 拉起 host（`npx` 钉死版本、`PERSIMMON_HOST` 开发覆盖、
  找不到 `npx`、`PERSIMMON_WORKSPACE`、EADDRINUSE 兜底、**追注：`PORT` 的缺省
  只在命令一处**）；§4 注册表的第二份实现与 `--judge` 查询模式（**追注：Go 侧
  算得出的是三种不可用，不是三种「态」，「四态」一律按「三种不可用 + 未断言」
  读**）；§5 `new` 的登记闭环与失败处置；§6 代码位置与迁入时的穷举改动
  （**追注：`install.sh` 的校验和口径是有意偏离，不照抄**）；§7 npm 包改名与
  开发命令（**追注：`go -C cli`，仓库根无 `go.mod`**）；§8 发布线；§9 握手与
  API 的不变项；§10 冲突文档清单与实测义务（**追注：覆盖率门随本 plan 落地**）；
  §11 Trade-offs。
- [design-00003-multi-workspace](../design/design-00003-multi-workspace.md) ——
  §2 注册表文件契约（Go 侧实现的唯一来源）；§3 可用性判定次序；§5 API 契约
  （`GET /api/instance`、`POST /api/workspaces`、`DELETE /api/workspaces/:id`）；
  §8 启动握手的三态判定表与子命令段；§10 代码位置（`cli/` 与 `bin/host.js`）。

`decision-00020` 是本 plan 的结构来源；它不进 `implements`（`plan` 的
`implements` 只收 spec / rule / design / report 与需求项 id，
[docs/README.md](../README.md) 关系规则），`spec-00012` 与 `spec-00013` 已各自
`implements` 它，它的 `constrains` 已回填本 plan。

## 交付范围

`implements` 里 `spec-00012` 与 `spec-00013` 两个整份文档 id 把两份 spec 的
**全部**条目（11 + 14 条 FR、32 + 70 条 AC）纳入交付范围。`spec-00011` 纳入
九条 FR：

- **本轮改写的五条**：FR-13（`AC-13.1`…`13.7`）、FR-14（`AC-14.1`…`14.3`）、
  FR-15（`AC-15.1`…`15.4`）、FR-20（`AC-20.1`、`AC-20.4`）、
  FR-21（`AC-21.1`…`21.4`）。`AC-20.2` 与 `AC-20.3` 自第三十一轮起不计入验收
  集，本 plan 不收。
- **Go 侧本轮写出第二份实现的四条**：FR-2（`AC-2.1`…`2.7`）、
  FR-3（`AC-3.1`…`3.4`）、FR-4（`AC-4.1`…`4.5`）、FR-18（`AC-18.1`…`18.3`）。
  Go 侧的验收本来就要写（`design-00004` §4 要求两侧引用同一组用例名），纳入
  范围只是把它记在账上。**其中七条 AC 的 When 是切换器而不是命令**
  （`AC-2.7`、`AC-3.1`、`AC-4.1` … `AC-4.5`）：它们是 TS/UI 侧行为，本轮一字
  未改，T10 的 record 以既有的通过测试为证据原样列出——是重列一条仍绿的断言，
  不是重写一份实现。

`spec-00011-FR-6`（可用性判定）**不在**范围内：它要的是流程配置校验器本身，
Go 侧不复刻（`design-00004` §4），无进程时经 host 包的 `--judge` 取得。
`spec-00011-FR-5` 的「有运行中会话则拒绝」在无进程路径下空成立，同样不产生
Go 侧实现或测试。

**编号**：五份 issue（T2 四份 + T8 一份）按 `rule-00001-BR-18`（该类型现有
最大编号加一）依次取 issue 类型的 34 … 38 号。32 号是 issue 类型的既有空号
（当时被别的类型占了号），**不回填**——BR-18 只说取最大加一，从不说填空。
（此处写作号而不是完整 id：那五份文档还不存在，写成 id 会在白板上成为一条
指不到的引用。）

## Tasks

T1 先行，其后 T2 与 T3 互相独立、可并行；T2b 依赖 T1、T2；T4 依赖 T3；
T5 依赖 T2b、T3、T4；T6 依赖 T3、T4；T7 依赖 T4、T5、T6（它删掉
`bin/persimmon.js`，删之前 Go 侧必须已覆盖它的全部职责）；T8 依赖 T1、T7；
T9 依赖 T7、T8；T10 收口。

**每个任务落地后全仓必须仍绿**：`npm test`、`npm run typecheck`、
`go -C cli test ./...`、`gofmt -l cli`（空输出）、`go -C cli vet ./...` 五条
退出码 0，覆盖率门不下调。跨任务的一处不对称由 stub 兜住：T6 的 `list` 调
`persimmon-host --judge`，而真的 `--judge` 到 T7 才落地——T6 的 Go 测试以
`PERSIMMON_HOST` 指向一份 stub 检出（其 `bin/host.js` 只印固定 JSON）证明命令
侧的读法，真假配对由 T7 的测试证明。T4 同理：开发态构建下 `PERSIMMON_HOST`
本就是开板的前置（`spec-00012-FR-6` / `FR-8`），测试用 stub 是产品形态而不是
测试特例。

**交付范围内每一条 AC 恰出现在一个任务的清单里**；`spec-00013` 的 70 条按
T1（迁入测试已讨到的 7 条）、T2（缺陷修正 5 条）、T2b（余下 47 条）、
T5（登记闭环 11 条）四处分完，7 + 5 + 47 + 11 = 70，无重无漏。

- **T1 — `cli/` 模块与迁入**（`spec-00012-FR-1`、`FR-9`；`spec-00013-FR-1`…
  `FR-3`、`FR-5`、`FR-9`、`FR-10`、`FR-12`、`FR-14` 的迁入半边）：
  - 文件：新增 `cli/go.mod`（`module
    github.com/ryan-alexander-zhang/persimmon/cli`、`go 1.24`、零依赖，ainpt
    无 `go.sum`，无需补）、`cli/main.go`、`cli/internal/scaffold/scaffold.go`、
    `cli/internal/scaffold/scaffold_test.go`（自 ainpt 逐字复制，随行 9 个
    测试）；`.goreleaser.yaml`、`install.sh`（自 ainpt 迁入）；新增
    `.github/workflows/ci.yml`；改 `.gitignore`。
  - **`.gitignore`**：加 `/cli/persimmon` 与 `/cli/cli`（手敲
    `go build -o persimmon` 或 `go build .` 在 `cli/` 里留下的产物，后者取模块
    末段为名）与 `build/`（下一条的 goreleaser 输出目录）。
  - **穷举改动**（`design-00004` §6，脚手架**逻辑**一行不改）：
    - `main.go`：import 路径；`usage()` 与 `version` 打印里的 `ainpt` 字样
      （`:1` 文件头注释、`:45` `fmt.Println("ainpt", version)`、`:56` 标题、
      `:59`…`:62` 四条 `Usage:` 行、`:105` `cmdNew` 的 usage 串）。
      **`main.go:72` 不在此列**——那一行里的 `ainpt` 是文件名 `.ainpt.json`。
    - `scaffold.go` 四处用户可见字串：`:55` 提示 `persimmon list-langs`、
      `:331` 提示 `persimmon update`、`:374`「was this project created by
      persimmon?」、`:113` 临时目录前缀 `persimmon-*`。
    - **注释里的三处也一并改**（顺手、零风险）：`:317`–`:318`
      「Written as .ainpt.json …」那段提到工具名之处、`:451`「second
      `ainpt update` of a real project」。
    - **不改**：文件名 `.ainpt.json` 的 **9 处**（`scaffold.go` 8 处 —— `:318`
      注释、`:342` 写、`:372` 读、`:374`/`:378`/`:381`/`:385` 四条错误信息、
      `:420` 改写；`main.go` 1 处 —— `:72` 的帮助正文），`decision-00020` §2
      第 5 条；`AINPT_OWNER` / `AINPT_REPO` 3 处（同 §2 第 8 条）；模板仓库
      缺省坐标 `ai-native-project-template`。
    - **`usage()` 的内容本任务只做改名，尚不是终态**：`add` / `remove` /
      `list` / 无子命令四行由 T6 补入，`spec-00012-AC-1.2` 在 T6 才成立。
      本任务的「逻辑一行不改」说的是脚手架三条子命令的行为，不是 usage 文本。
  - `.goreleaser.yaml`：`project_name: persimmon`；`builds[].dir: cli` 与显式
    `binary: persimmon`（迁入源无 `dir` / `main` / `binary`，全靠 goreleaser
    默认，这是唯一需要新内容而非查改的一处）；**`dist: build/goreleaser`**——
    goreleaser 缺省输出 `./dist` 而 `--clean` 会先清空它，而 `./dist/web` 是
    Vite 的产物，照缺省会被抹掉；`before.hooks` 的 `go mod tidy` 改为在 `cli/`
    内执行（仓库根无 `go.mod`，原样会失败）；`release.github.name: persimmon`；
    `ldflags` 仍注入 `main.version` / `main.owner` / `main.repo`；三平台 ×
    两架构矩阵与归档名模板不变。
  - `install.sh`：`REPO="persimmon"`、`BIN="persimmon"`、头部 curl 注释里的
    raw URL；仍只支持 linux / darwin。**校验和逻辑此任务按迁入源原样落地**
    （尽力而为、校验不过只告警），它与 `spec-00012-FR-11` 的偏离由 T8 的
    issue 先红后改——`AGENTS.md` §8 不许绕过立案直接改。
  - `.github/workflows/ci.yml`：`push` / `pull_request` 上跑两个 job——
    `node`（`npm ci`、`npm run build`、`npm run typecheck`、`npm test`）与
    `go`（`setup-go 1.24`、`gofmt -l cli` 须空、`go -C cli vet ./...`、
    `go -C cli test ./...`）。`git` 在 runner 上现成，`scaffold_test.go` 的
    `git merge-file` 用例因此可跑。覆盖率门到 T8 才加进这个 job。
  - **本任务讨到的 AC**：`spec-00013-AC-9.1`、`AC-9.7`、`AC-10.1`、`AC-10.3`、
    `AC-10.4`、`AC-10.5`、`AC-10.6`（迁入的 9 个测试即这 7 条的证据：三方合并
    保住本地改动、基准里没有的上游文件算新增、基准有而项目已删不重建、
    `exclude` 命中目录整棵跳过、符号链接的三种走法）；
    `spec-00012-AC-1.1`（PATH 上没有 `ainpt` 也能 `persimmon list-langs`）、
    `AC-9.2`（`-v` / `--version` 与 `version` 同输出）、`AC-9.3`（未发布构建
    打印 `dev`）。
  - verify：`go -C cli build ./...`、`go -C cli test ./...`（9 个迁入测试全过）、
    `gofmt -l cli` 空、`go -C cli vet ./...`、`npm test`、
    **`goreleaser release --snapshot --clean`**（本机；`build` 子命令不出归档
    与 checksums，验不到 `install.sh` 要的那两样）；`ls dist/web` 仍在
    （证明 `dist:` 改对了）。
  - 实测义务：**goreleaser `builds[].dir` 与 `before.hooks` 的工作目录**——
    本任务以 `goreleaser release --snapshot --clean` 在仓库内实测，不留给
    发布轮。

- **T2 — 迁入源四处已知缺陷：先立案、先写红，再改**（`spec-00013-FR-4`、
  `FR-11`、`FR-13`）：四份 `docs/issue`（issue 的 34 … 37 号，
  `blocks` 指向本 plan），每份先有一个失败的测试，再改代码。**四份各自独立，
  因为四处根因互不相同**：
  1. 创建标记的模板坐标校验（`scaffold.go:385` 用 `SplitN` 只查段数，`/repo`
     一类空段可通过）→ 恰一个斜杠、两段都非空。讨 `spec-00013-AC-11.4`、
     `AC-11.5`。
  2. `list-langs` 给「只有变体、没有 `lang/<l>` 基础分支」的语言照印一行不存在
     的 `--lang <l>`（`main.go` `cmdLangs` 的分组打印）→ 不印该行，改在组头
     标注。讨 `spec-00013-AC-13.3`。
  3. `list-langs` 只取 GitHub branches API 的第一页 100 条即止 → 跟随分页取尽。
     讨 `spec-00013-AC-13.4`。
  4. `new` 静默丢弃第二个位置参数（两趟 `flag` 解析的后果）→ 拒绝并打印用法。
     讨 `spec-00013-AC-4.4`。（`spec-00013-AC-1.8`「旗标在位置参数之前结果
     相同」因这一修才真正成立，但它列在 T2b 的 FR-1 组里，不在此重列。）
  - 文件：`cli/main.go`、`cli/internal/scaffold/scaffold.go`、
    `cli/internal/scaffold/scaffold_test.go`、新增 `cli/main_test.go`
    （`cmdLangs` 与 `new` 的参数解析，GitHub API 以 `httptest` stub）。
  - verify：`go -C cli test ./...`；四个新测试各带 issue id 与 AC id 溯源标注；
    四份 issue 状态到 `resolved`。

- **T2b — 补齐 scaffold 验收集**（`spec-00013-FR-1` … `FR-5`、`FR-9` …
  `FR-14`；`spec-00012-FR-7` 的 `update` 半边）：迁入源只随行 9 个测试
  （25.7% 语句覆盖），`spec-00013` 的验收集是收紧目标（`CODE_QUALITY.md` §8
  的棘轮）。本任务**只写测试、不改行为**——任何在此发现的行为偏差都是新缺陷，
  按 `AGENTS.md` §8 另立 issue，不在本任务里顺手改。逐 FR 的 AC 清单：
  - FR-1（分支取法、`--dir`、`--set` 可重复、`AINPT_OWNER`/`AINPT_REPO`、旗标
    位置）：`AC-1.1` … `AC-1.8`（8 条）
  - FR-2（`exclude`、`.git` 与 `template.json` 永不复制、变量定值与 `default`
    自身替换、`substitute`、`post_create` 顺序与 `when_lang`/`when_variant`
    门控、列出但不存在的文件跳过）：`AC-2.1` … `AC-2.8`（8 条）
  - FR-3（创建标记的内容与既有项目免迁移）：`AC-3.1` … `AC-3.3`（3 条）
  - FR-4（参数不合式的三种，第四种在 T2）：`AC-4.1`、`AC-4.2`、`AC-4.3`
  - FR-5（目标已存在、分支取不到、必需变量缺值、`post_create` 失败不回滚不写
    标记、提交号取不到时的警告与空基准）：`AC-5.1` … `AC-5.6`（6 条）
  - FR-9（冲突标记、留冲突以 0 退出、基准推进的两种、项目自有文件不动、
    上游新增与项目已有同路径、已是最新、`--dir`）：`AC-9.2` … `AC-9.6`、
    `AC-9.8`、`AC-9.9`、`AC-9.10`（8 条；`AC-9.1` 与 `AC-9.7` 在 T1）
  - FR-10（`exclude` 取本次上游那一份）：`AC-10.2`（1 条；其余五条在 T1）
  - FR-11（无标记、标记不是合法 JSON、基准为空）：`AC-11.1` … `AC-11.3`
    （3 条；坐标形态两条在 T2）
  - FR-12（缺 `git` 时在第一个需合并的文件上失败、基准不推进）：`AC-12.1`、
    `AC-12.2`
  - FR-13（基础模板一行 + 语言字典序、无 `lang/*` 时的说明）：`AC-13.1`、
    `AC-13.2`（2 条；两条缺陷相关的在 T2）
  - FR-14（请求发不出、非 200、应答不可解析）：`AC-14.1` … `AC-14.3`
  - 另讨 `spec-00012-AC-7.3`（无 Node 的机器上 `update` 照常合并、不检查 Node）
  - 文件：`cli/internal/scaffold/scaffold_test.go`、`cli/main_test.go`；模板
    仓库以 `httptest` stub（tarball 与 branches/commits API 各一个 handler），
    不打真网络。
  - verify：**`go -C cli test ./... -cover`**——本任务的 AC 分居两个包
    （FR-2 / FR-3 / FR-5 / FR-9 … FR-12 在 `internal/scaffold`，FR-1 / FR-4 /
    FR-13 / FR-14 那 16 条在 `cli/main_test.go` 即 `package main`），只跑
    `./internal/scaffold/` 会漏掉后者。两个覆盖率数字分开看：
    `cli/internal/scaffold` 较迁入时（25.7%）显著上行，写入
    `CODE_QUALITY.md` §3 作为新的棘轮记录值（**只升不降**，不因未及 90% 而
    下调任何门）；`package main` 是本轮新写的包，照 90% 语句覆盖的门收
    （T8 的脚本据此把关）。47 + 1 条 AC 各有一个带 id 标注的通过测试。

- **T3 — `cli/internal/registry` 与 `cli/internal/project`**
  （`spec-00011-FR-2`、`FR-3`、`FR-4`、`FR-18`；`FR-15` 的无进程半边；
  `spec-00013-FR-6` 的注册表侧）：按 `design-00004` §4 与 `design-00003` §2
  实现第二份文件路径：整份校验（`version == 1`、`id`/`name`/`path` 齐全、
  `id` 匹配 `[a-z0-9-]+` 且不重复、`path` 绝对；不合式即报错并指明文件路径与
  问题，**不改写文件**；文件不存在 = 空）、`MkdirAll` + `<path>.tmp` +
  `Rename` 原子写、`Add`（`EvalSymlinks` 后查重、幂等返回既有条目、`id` 派生、
  `name` 缺省取 `id`、可登记判定沿 `POST /api/workspaces` 的 422 口径：路径
  存在、是目录、有 `whiteboard.config.yaml`；配置非法与非 git 仓库不拒绝）、
  `Remove`（路径形态先 realpath 再查 `id`）、`Read`。
  - **`cli/internal/project`**：`design-00003` §8 的「cwd 向上找最近的
    `whiteboard.config.yaml`」由 Go 侧自己做（`design-00003` §10 末段）。它是
    约十五行、两个调用点（无子命令启动的目标判定、`add` 的缺省路径）的纯函数，
    既不属注册表也不属 hostproc，**单独一个包**：`FindRoot(dir) (string, error)`,
    找不到即返回一个可判别的「不在任何项目内」——那不是错误
    （`spec-00011-FR-13`）。
  - `spec-00011-FR-5` 的「有运行中会话则拒绝」在无进程路径下空成立（没有进程
    就没有会话），Go 侧不实现、不测试（`design-00004` §4）。
  - **本任务讨到的 AC**（Go 侧）：`spec-00011-AC-2.1` … `AC-2.6`、`AC-3.2`、
    `AC-3.3`、`AC-3.4`、`AC-18.1`、`AC-18.2`、`AC-18.3`；
    `spec-00011-AC-2.4` 同时是 `project.FindRoot` 的证据。切换器侧的
    `AC-2.7`、`AC-3.1`、`AC-4.1` … `AC-4.5` 本轮一字未改，由 T10 的 record
    以既有通过测试原样列出。
  - 文件：新增 `cli/internal/registry/registry.go`、`registry_test.go`、
    `cli/internal/project/project.go`、`project_test.go`。
  - verify：`go -C cli test ./internal/registry/ ./internal/project/ -cover`；
    两个包语句覆盖各 ≥ 90%；测试用例名与 TS 侧
    （`test/workspaceRegistry.test.ts`）对齐——同一组 AC id，漂移即一侧红。

- **T4 — `cli/internal/hostproc`**（`spec-00012-FR-3` … `FR-8`；
  `spec-00011-FR-13`、`FR-14`、`FR-15`）：按 `design-00004` §3 与
  `design-00003` §8——
  - 探测：`GET http://127.0.0.1:<PORT>/api/instance`、1s 超时，三态
    （`running` / `free` / `occupied`；超时、非 200、`app != persimmon` 一律
    `occupied`）。**`PORT` 的缺省 4173 只在命令这一处**，拉起 host 时把它显式
    写进子进程环境（`design-00004` §3 追注）。
  - 有进程：`POST /api/workspaces` 登记、命令自己拼地址打印、exit 0；422/500
    报出其 `error` 并非 0 退出、不起服务。版本只打印不判定
    （`design-00004` §9）。
  - 无进程：`registry.Add` 后拉起 host——发布构建走
    `npx -y @ryan-alexander-zhang/persimmon-host@<编译期版本>`；`PERSIMMON_HOST`
    已设则一律优先它（`node <dir>/bin/host.js`）；`version == dev` 且未设
    `PERSIMMON_HOST` 时一句话 + 非 0 退出，**不猜版本**（`spec-00012-FR-8`）。
  - `exec.LookPath("npx")` 失败：一句话 + 非 0 退出；`new` / `update` /
    `list-langs` / `version` / `add` / `remove` 不做这项检查
    （`spec-00012-FR-7`）。
  - stdio 原样透传、以子进程退出码退出；`PERSIMMON_WORKSPACE=<id>` 交给 host；
    `SIGINT` / `SIGTERM` 转发给子进程、自己不先退，同类信号第二次照样转发；
    **没有子进程时（接入路径）收到信号只让自己退出、不向任何进程转发**。
  - **`test/startup.test.ts` 的两个握手用例迁到本任务的 Go 测试，不迁到
    `bin/host.js`**：`:57` 的「cwd 不在任何项目内也起得来」
    （`spec-00011-AC-13.4`）与 `:122` 的「合法配置下起来并报出地址」
    （`spec-00011-AC-13.1`）判的都是**命令的握手**，host 自己没有握手可判。
    T7 因此不为它们在 TS 侧留替身。
  - **本任务讨到的 AC**：`spec-00012-AC-3.1` … `AC-3.4`、`AC-4.1` … `AC-4.4`、
    `AC-6.1`、`AC-6.2`、`AC-7.1`、`AC-8.1`；`spec-00011-AC-13.1` … `AC-13.7`、
    `AC-14.1` … `AC-14.3`、`AC-15.1`、`AC-15.2`、`AC-15.3`。
  - 文件：新增 `cli/internal/hostproc/hostproc.go`、`hostproc_test.go`；
    `cli/main.go` 接上无子命令路径。
  - verify：`go -C cli test ./internal/hostproc/ -cover`（`httptest` stub 服务器
    覆盖探测与 API 两半，`PERSIMMON_HOST` 指向 stub 检出覆盖拉起、透传、信号与
    退出码）；语句覆盖 ≥ 90%。
  - 实测义务：**stdio 与信号透传在无 TTY 下**——本任务的 Go 测试即无 TTY
    （`os/exec` 不给 pty），这一半在仓库内验证；**经 `npx` 的那一段（离线、
    冷缓存、是否把 stdio 与信号透传给 bin）留给人工实测**，它要一个真的已发布
    版本。

- **T5 — `new` 的登记闭环**（`spec-00013-FR-6`、`FR-7`、`FR-8`）：按
  `design-00004` §5——脚手架成功后取 `<dir>/<name>` 的 realpath，走与 `add`
  完全相同的路径（有进程经 API、无进程**或端口被他人占用**时直写文件，`FR-7`
  与 `spec-00011-FR-15` 有意不同）；末行打印已登记的 id 与「在项目内执行
  `persimmon` 打开」；脚手架失败不登记、登记失败不回滚项目、注册表文件不被
  改写；`--no-register` 一类旗标按未知旗标拒绝。
  - **本任务讨到的 AC**：`spec-00013-AC-6.1` … `AC-6.5`、`AC-7.1`、`AC-7.2`、
    `AC-8.1` … `AC-8.4`（11 条）；`spec-00012-AC-7.2`（无 Node 的机器上
    `persimmon new demo` 照常建出并登记、以 0 退出）。
  - 文件：`cli/main.go`（`cmdNew` 尾部）、`cli/main_test.go`。
  - verify：`go -C cli test ./...`；上列每条 AC 各有带 id 标注的测试。

- **T6 — `add` / `remove` / `list`、`usage()` 终态与 `--judge` 退让**
  （`spec-00011-FR-15`、`FR-20`、`FR-21`；`spec-00012-FR-1`、`FR-2`）：
  `design-00003` §8 子命令段原样，输出与退出码一字不改；三态探测（有进程经
  API；端口被他人占用时 `add` / `remove` 报「port N is already in use」exit 1，
  **`list` 退回读文件并以 0 退出**）。
  - **`usage()` 补入 `add` / `remove` / `list` 与无子命令四行**，使输出的子命令
    清单恰为 `spec-00012-FR-1` 那些、不多不少（`AC-1.2`）。T1 只改了名字，
    内容在这里定终态。
  - `list` 的可用性来源三分：
    - 无进程、取得到 host 包 → 调 `persimmon-host --judge` 并原样呈现五态；
    - 无进程、**取不到** host 包 → 命令自算**三种不可用**（目录不存在、不是
      git 仓库、目录内无流程配置），**没命中的条目不断言「可用」**、可用性
      一列显示 `-`，并打印一句「完整判定需要 Node」，仍以 0 退出
      （`spec-00011-FR-21` 的 `If` 分支）。
    - **开发态构建（`version == dev`）且未设 `PERSIMMON_HOST`** 落在上一支：
      本机有 Node，但没有可与之配对的已发布 host 包，所以判定**取不到**——
      `list` 不因此失败（`spec-00012-FR-8` 只拦无子命令的启动路径，
      `AC-8.2`），走同一条退让并打同一句提示。测试以 stub 与「不设
      `PERSIMMON_HOST`」两种环境各跑一次。
  - 子命令集封闭与未知子命令（含**像路径的第一参**）的拒绝：不建目录、不读写
    注册表。
  - **本任务讨到的 AC**：`spec-00011-AC-15.4`、`AC-20.4`（在本仓库根执行
    `persimmon add` → 本仓库被登记且判为可用）、`AC-21.1` … `AC-21.4`；
    `spec-00012-AC-1.2`、`AC-2.1`、`AC-2.2`、`AC-8.2`。
  - 文件：`cli/main.go`、`cli/main_test.go`、`cli/internal/hostproc`（`--judge`
    调用）。
  - verify：`go -C cli test ./...`；上列每条 AC 各有测试。`--judge` 的对端此时
    是 stub（见 Tasks 开头），真假配对在 T7。

- **T7 — host 侧瘦身与 npm 包改名**（`spec-00011-FR-20`；`spec-00012-FR-1` 的
  「不存在第二个命令行可执行体」；`spec-00011-FR-21` 的 `--judge` 供给端）：
  - 新增 `bin/host.js`（约 40 行）：`new Host({ registryPath, version })`、
    `listen(PORT)`（同一读法、缺省同为 4173）、`listening` 时按
    `PERSIMMON_WORKSPACE` 拼 `/w/<id>`（未设则 `/`）打印、`error` 报错
    （EADDRINUSE 时「port N is already in use」+ 非 0 退出）、
    `SIGINT`/`SIGTERM` → `host.shutdown()`；加 `--judge` 查询模式：读注册表、
    跑 `AvailabilityJudge`、以 JSON 印五态即退，**不监听**。
  - 删 `bin/persimmon.js`（其探测、登记、子命令逻辑已在 Go 侧）。
    `src/workspaceRegistry.ts`、`src/workspaceAvailability.ts`、`src/host.ts`
    **不改**——它们是 Host 自用的库，命令的迁走不碰它们
    （`design-00004` §4「TS 侧 `workspaceRegistry.ts` 不改」）。
  - `package.json`：`name` → `@ryan-alexander-zhang/persimmon-host`、
    `bin` → `{ "persimmon-host": "./bin/host.js" }`、`description` 改为服务
    本体、`start` → `node bin/host.js`、`version` → `0.0.0-dev` 占位
    （发布时由 tag 写入，`design-00004` §8）；`engines` 不变，`files` 的收窄
    在 T8。
  - 测试改写：`test/cli.test.ts` 里 19 个用例中属命令侧的全部随
    `bin/persimmon.js` 退役——**不是删掉，是已迁到 Go 侧**（T4/T5/T6 各自承接
    了对应 AC），本文件缩为 host 侧仍成立的部分或整体退役；
    `test/startup.test.ts` 的 4 个用例分两路——`:57` 与 `:122` 的握手两条**迁到
    T4 的 Go 测试**（不在 host 侧留替身），「handles SIGTERM itself」与
    「reports a port it cannot have」改指 `bin/host.js`、在 host 侧照样成立；
    `test/distribution.test.ts` 的 `PACKAGE` 常量随包名改、spawn 目标改为
    `bin/host.js --judge`（host 没有 `list`），其 `spec-00011-AC-20.1` 溯源
    标注改为 `issue-00029` + 本 plan（`AC-20.1` 的 Given 已改为「经 install.sh
    装入 PATH」，由 T8 承接）；`test/globalSetup.ts` 的注释与
    `scripts/test-install.js`（`test:install` 走的是已不复存在的两种安装形态）
    随之据实改或退役。
  - 新增 `test/host.test.ts` 覆盖 `--judge` 的输出形状与 `PERSIMMON_WORKSPACE`
    的地址拼装；`--judge` 与 T6 的读法在此配对成真。
  - verify：`npm test`、`npm run typecheck`、`npm run build`、
    `npm run test:coverage`（四个数字不低于阈值）；`npm start` 仍起板；
    `npm run build && PERSIMMON_HOST=$PWD go -C cli run .` 走通完整握手。
  - 实测义务：无（本任务全部在仓库内可测）。

- **T8 — 发布线、覆盖率门与 `install.sh` 的校验和偏离**（`spec-00012-FR-5`、
  `FR-10`、`FR-11`；`spec-00011-FR-20` 的包名半边）：
  - 新增 `.github/workflows/release.yml`：`on: push: tags: ['v*']`、
    **`permissions: contents: write`**（goreleaser 要建 Release 并上传归档；
    缺它整条线在最后一步失败），一个 job 按 `design-00004` §8 的先后——
    checkout（`fetch-depth: 0`，goreleaser 要历史）、setup-node 23、`npm ci`、
    `npm run build`、`npm test`、`npm version ${TAG#v} --no-git-tag-version`、
    `npm publish --access public`（`NPM_TOKEN`），**然后** setup-go 1.24、
    `goreleaser release --clean`（`GITHUB_TOKEN`）。npm 先、goreleaser 后：
    二进制钉死的版本必须在用户拿到二进制时已可 `npx` 到。goreleaser 的
    `dist: build/goreleaser`（T1 定）使 `--clean` 不碰 `dist/web`——而
    `dist/web` 正是同一 job 前半段 `npm run build` 的产物，两者同居 `./dist`
    会互相清掉。
  - 新增 `scripts/go-coverage.sh` 并接进 `ci.yml` 的 go job：
    `go -C cli test -coverprofile` 后逐包判语句覆盖。口径按
    [TESTING.md](../../TESTING.md) 的棘轮——`cli/`、`cli/internal/registry`、
    `cli/internal/project`、`cli/internal/hostproc` 四个新包须 ≥ 90%；
    `cli/internal/scaffold` 是 `CODE_QUALITY.md` §8 的 legacy 债，门为**不低于
    当前记录值**（迁入时 25.7%，T2b 之后是 T2b 达到的那个数），**只升不降**，
    不因它未及 90% 而下调任何门。
  - **`package.json` 的 `files` 由 `scripts/` 收窄为
    `scripts/fix-pty-permissions.js`**——这是对 `design-00004` §7「`files`
    不变」的**有意偏离**：`scripts/` 今天还装着 `sync-docs.sh`（模板骨架同步）
    与 `test-install.js`（本仓库的安装形态测试），本任务又要往里加
    `go-coverage.sh`，三者都是开发工具，没有一个该进用户的 `node_modules`；
    而 `postinstall` 要的只有 `fix-pty-permissions.js` 一个文件。
    `test/distribution.test.ts:39` 的 `['bin', 'lib', 'scripts', 'dist/web']`
    随之改为只搬那一个文件——它模拟的就是 `files` 的形状，两处必须同改。
  - `install.sh` 的校验和：**一份 `docs/issue`（issue 的 38 号，`blocks` 指向
    本 plan）先立案、先写红，再改**——迁入源在校验和不符、缺该归档那一行、
    那一行不合式三种情形下都继续安装，`spec-00012-FR-11` 要求中止且不在 PATH
    上留下二进制；只有**取不到校验和文件**或**本机既无 `sha256sum` 也无
    `shasum`** 才退让为一句警告并继续。测试：新增 `test/install.test.ts`，以
    一个本机 HTTP stub 冒充 Release 的下载基址、装到临时目录，覆盖五种情形。
  - **本任务讨到的 AC**：`spec-00012-AC-9.1`（`goreleaser release --snapshot`
    出的归档里的二进制 `persimmon version` 打印该次构建注入的版本号——
    `ldflags` 的证据）、`AC-10.1`、`AC-10.2`、`AC-10.3`、
    `AC-11.1` … `AC-11.5`、`AC-5.1`、`AC-5.2`（版本配对：命令拉起的 host 与
    命令同版本，仓库内证据是 `AC-9.1` 的 `ldflags` 注入加上 `npx …@<版本>`
    这条命令行的拼装）；`spec-00011-AC-20.1`（`persimmon` 经 `install.sh`
    装入 PATH 后在任意目录 `persimmon list` 可执行）。`AC-5.1` / `AC-5.2` /
    `AC-10.1` / `AC-10.2` / `AC-20.1` 的仓库内证据是 stub 与 snapshot 归档，
    **真机一次在人工实测**。
  - verify：`npm test`（含新的 install 用例）、`scripts/go-coverage.sh` 退出码
    0、`goreleaser release --snapshot --clean` 本机通过并产出 checksums、
    人工读 workflow。**发布本身不在本任务内**——见「须由人执行或授权的步骤」。
  - 实测义务：**`npm version … && npm publish` 在同一 job 里对「两产物配对」的
    保证**——仓库内只能读到 workflow 的形状，真凭据在第一次推 tag 时才有；
    **`install.sh` 在真实 linux 与 darwin 各一次**同理。

- **T9 — 文档收口**（无新条目，交付的是 `design-00004` §10 的冲突清单）：
  - `README.md`：Quick Start 今天只有开发形态三条（`npm install` /
    `npm run build` / `npm start`）、**没有用户安装段**；改为分两半——用户装
    命令是 `curl … install.sh | sh`，开发本仓库保留 `npm install` +
    `npm run build`，再加 `npm start`（只起服务）与
    `PERSIMMON_HOST=$PWD go -C cli run .`（完整握手）两条。
    「The `persimmon` command」一节补 `new` / `update` / `list-langs` /
    `version` / `help`。**`README.md:79`**「`remove` … it is refused while that
    workspace has a running session」须补一句：无已运行进程时命令直写文件，
    该拒绝空成立（`design-00004` §4），否则用户读到一条在命令路径上永不触发的
    规则。Repo Map 加 `cli/`；Notes 里 pty 那段随 `npx` 成为 host 包唯一取得
    路径据实改。
  - `ARCHITECTURE.md`：删掉三处「lands with plan」标注——`:46`（命令仍是
    `bin/persimmon.js`、脚手架子命令与模板仓库邻居「尚不存在」）、`:78`
    （`cli/` / `.goreleaser.yaml` / `install.sh` / `bin/host.js`「不在树里」）、
    `:119`（发布线「随其 plan 落地」与「No CI pipeline yet」——T1 起就有
    `ci.yml`）；§3 上下文图补命令节点与模板仓库邻居，§5 目录树补 `cli/`；
    `:164` 的风险行由「once decision-00020 lands」改为现状。
  - **`CODE_QUALITY.md` §2**：Go 覆盖率门那一行去掉「（lands with
    decision-00020's plan）」的括注（脚本已在 T8 落地），scope 据实写作
    「`cli/`，`cli/internal/scaffold` 以棘轮记录值为门」——现文写「less
    `cli/internal/scaffold`」读成排除，而它其实是有门的、门是记录值；§3 的
    棘轮记录值同轮更新为 T2b 达到的数。
  - **`DEVELOPMENT.md:103`** 的「Once decision-00020 lands, developing this
    repo has two Run forms…」改为现状陈述（已落地），Commands 段的 Go 三条
    照现状复核。
  - `CONTEXT.md`：**预期无需改动**——`persimmon 命令`、`host 包`、`版本配对`、
    `开发覆盖`、`模板仓库`、`创建标记`、`模板管辖文件`、`基准` 八个词条已在
    spec 轮写入；本任务只核对一遍，如有落差就地补。
  - **仓库外的两处（`ainpt` 仓库 README 指针与归档、模板仓库 README 的安装
    说明）不是本任务的产出**，见下节。
  - verify：`grep -rn 'lands with\|bin/persimmon\.js\|Once decision-00020\|No CI
    pipeline' README.md ARCHITECTURE.md DEVELOPMENT.md CODE_QUALITY.md
    TESTING.md` 命中为零（历史工作项与明确标注为原文引用的说明除外）；
    README 里的每条命令照着敲一遍；文档链接可解析。

- **T10 — 测试与验收收口**：五条命令（`npm test`、`npm run typecheck`、
  `go -C cli test ./...`、`gofmt -l cli`、`go -C cli vet ./...`）与两个覆盖率
  门全绿且不下调；每个测试带 AC id 溯源标注；按
  [docs/record/README.md](../record/README.md) 写 `record`（`parent` 指向本
  plan）。`verifies` 须列尽交付范围：`spec-00012` 的 32 条 AC、`spec-00013` 的
  70 条 AC，与 `spec-00011` 的 `AC-2.1`…`2.7` / `AC-3.1`…`3.4` /
  `AC-4.1`…`4.5` / `AC-13.1`…`13.7` / `AC-14.1`…`14.3` / `AC-15.1`…`15.4` /
  `AC-18.1`…`18.3` / `AC-20.1` / `AC-20.4` / `AC-21.1`…`21.4`——每行恰一个 id，
  切换器侧那七条以既有通过测试为证据。五份 issue（34 … 38 号）全部 `resolved`。**人工实测那几行在对应实测通过前不计已
  验证**（`spec-00012` §7），未过即写为缺口并阻塞 `resolved`。

## 实测义务（`design-00004` §10 · `spec-00012` §7）

| 义务 | 在仓库内验证 | 需要人在真机上 |
| --- | --- | --- |
| `npx -y <pkg>@<ver>` 在离线、无 TTY 下的行为，以及是否把 stdio / 信号透传给 bin | 命令→子进程这一段由 T4 的 Go 测试在无 TTY 下证明（`PERSIMMON_HOST` 指向 stub） | **是**：`npx` 那一层要一个真的已发布版本与一次真的冷缓存；离线一次、无 TTY 一次 |
| goreleaser `builds[].dir` 与 `before.hooks` 的工作目录 | **是**：T1 的 `goreleaser release --snapshot --clean` | 否 |
| `npm version … && npm publish` 在同一 job 里保证两产物配对 | 只能读 workflow 形状（T8） | **是**：第一次推 tag（`v0.2.0`）时观察 |
| `install.sh` 在 linux 与 darwin 各一次，含校验和不符时的中止 | 五种情形的逻辑由 T8 的本机 HTTP stub 覆盖 | **是**：真实 Release 下各跑一次 |
| node-pty 在 Windows 的行为 | 否 | **是**，且**不在本 plan 范围**（见 Out of Scope）；`spec-00012-AC-10.2` 的 Windows 归档只验 `persimmon version` 可执行，不验开板 |
| 缓存取得的 host 包下实起一个 pty | 已由 `issue-00030` §7 的验证持有，`design-00004` §3 明写不新增义务 | 否 |

**两处对 `spec-00012` §7 清单的有意偏离**（本 plan 据实调整，理由在此，
不改那份 spec）：

1. **`spec-00012-AC-5.1` / `AC-5.2`（版本配对）加进实测集**。§7 没有列它们，
   但它们断言的是「命令拉起的 host 与命令同版本」——只有一次真的发布之后才有
   可配对的版本，仓库内至多证到 `ldflags` 注入（`AC-9.1`，T8）与 `npx` 命令行
   拼得对。故这两条在第一次 tag 之后才计已验证。
2. **`spec-00012-AC-4.4` 计为仓库内已验证**。§7 把 `AC-4.1` … `AC-4.4` 一并
   押在信号透传实测之后，但 `AC-4.4` 讲的是**接入路径**——命令没有子进程，
   收到 `SIGINT` 只让自己退出、不向任何进程转发。那条路上既无 `npx` 也无
   子进程，T4 的 Go 测试就是完整证据。

## 须由人执行或授权的步骤（不是 agent 任务）

1. 在仓库 secrets 里配 `NPM_TOKEN`（`GITHUB_TOKEN` 是自动的）。
2. 推第一个 `v*` tag：**`v0.2.0`**。这是唯一的授权点——`npm publish` 与
   goreleaser 都由该 tag 触发的 workflow 执行，人只推 tag。
3. `ainpt` 仓库：README 改为一段指向本仓库的说明，然后归档。**在
   `v0.2.0` 发布之后**——`install.sh` 能装出东西之前不该先掐掉旧路径。
4. 模板仓库 README 的安装说明改指本仓库的 `install.sh`。
5. 实测义务表右列的四行：真机 linux / darwin 的 `install.sh`（含校验和不符）、
   离线与无 TTY 下的 `npx` 透传、第一次 tag 的两产物配对与版本配对
   （`AC-5.1` / `AC-5.2`）。

第 3、4 条落在本仓库之外；第 2 条把东西发到公网。按 `AUTOPILOT.md` 的停止
条件，autopilot 不执行其中任何一条——它们只出现在本节。

**没有 `npm deprecate` 这一步**：`@ryan-alexander-zhang/persimmon` 从未发布过
（`npm view` 答 404），没有可弃用的东西。

## 风险与回滚：一次切换，不留过渡 shim

**决定：一次切换。**本仓库不同时携带 `bin/persimmon.js`（打印指针的弃用
shim）与 `bin/host.js`，T7 直接删掉前者。理由是那个 shim 没有读者：

- **旧包从未发布，没有装过它的用户**——`@ryan-alexander-zhang/persimmon` 在
  npm 上不存在，`persimmon` 这个 bin 名今天只在本仓库的工作树里；没有既有安装
  需要过渡，也没有需要被指路的人。
- 新包名 `@…/persimmon-host` 的 bin 是 `persimmon-host`，装它的人不会敲
  `persimmon`，所以 shim 装在新包里等于装在没人走的路上。

**回滚**：本 plan 的产出在合并前是一条分支，退回即弃分支。`v0.2.0` 发布之后
要退，npm 上那一版留着无害（没有配对二进制的 host 包只是没人拉），Go 二进制
重推一个 tag 即可覆盖。真正不可逆的只有「ainpt 仓库归档」，所以它排在最后且
由人执行。

**风险**：Go 与 TS 两份注册表实现漂移。缓解是 `design-00003` §2 仍是唯一契约、
两侧测试引用同一组 `spec-00011` AC id（T3），漂移的代价是一侧红。

## Detailed Acceptance Path

1. T1 落地 → verify：`go -C cli build ./...`、`go -C cli test ./...`、
   `gofmt -l cli`（空）、`go -C cli vet ./...`、`npm test` 五条退出码 0；
   `goreleaser release --snapshot --clean` 在 `build/goreleaser/` 下产出六个
   平台归档与 `checksums.txt`，且 `dist/web` 未被清空；`git ls-files` 中
   `cli/` 下无二进制。
2. 五份 issue（T2 四份 + T8 一份）→ verify：每份都有一个**先于修复写下且当时
   失败**的测试，五份状态均为 `resolved`，`blocks` 指向本 plan。
3. T1 … T8 落地 → verify：交付范围内每一条 AC 各有一个带 id 标注的通过测试
   （人工实测那几条除外，见第 6 步）；「每条 AC 恰在一个任务清单里」这一点
   以逐任务清单对账，无重无漏。
4. 质量门 → verify：`npm run test:coverage` 三个数字 ≥ 90%；
   `scripts/go-coverage.sh` 退出码 0（四个新包 ≥ 90%，`scaffold` 不低于棘轮
   记录值）；无门槛下调、无被压制的发现（`CODE_QUALITY.md` §6）。
5. 回归约束 → verify：`spec-00001` … `spec-00011` 的既有验收照常通过；
   `record-00028` 覆盖的 TS 侧行为一条未改（`spec-00012` §7 的回归约束）。
6. 人工实测四行（实测义务表右列）→ verify：各留一条证据进 T10 的 record；
   未过的 AC 写为缺口，**阻塞 `resolved`**。
7. record 落地并列全交付范围内每一条 AC → verify：resolved 门通过
   （`rule-00001-BR-25`），本 plan `open → resolved`。

## Out of Scope

- **`config` 子命令**（`decision-00020` §2 第 7 条）：不实现、不进子命令集，
  日后只能加在 `cli/`。
- **白板界面里的 workspace 创建**（同 §2 第 7 条）：到来时由 Host 以子进程调
  `persimmon new`；本 plan 不加任何 UI、不加 Host 侧的 spawn 路径。
- **Windows 上开板的验证**：goreleaser 仍出三平台归档，`new` / `update` /
  `add` 在 Windows 可用（迁入源现状）；node-pty 在 Windows 未实测，开板继承
  host 包的平台支持（`design-00004` §6）。本 plan 不安排 Windows 实测，也不因
  它阻塞 `resolved`。
- `spec-00011-FR-6`（可用性判定）与 `FR-5` 的运行中会话拒绝：见「交付范围」。
- 把脚手架逻辑移植成第二份实现（TS 或别处）；任何新命令行入口都只能加在
  `cli/`（`decision-00020` §5 末条）。
- `src/workspaceRegistry.ts`、`src/workspaceAvailability.ts`、`src/host.ts` 与
  Web UI 的任何行为改动：`spec-00012` §7 的回归约束把它们钉为不变量。
- Go 侧的复杂度 / 重复门：TS 侧本就是 `(none yet)`，`design-00004` §10 明写
  Go 侧不在本轮补。
- 离线兜底与本地模板缓存（`spec-00012` §7、`spec-00013` §6）。
- homebrew / scoop 一类第二条分发渠道：取得形态只有 `install.sh` 与 Release
  归档两种（`spec-00012-FR-10`）。
- 上节列出的全部人工步骤，尤其仓库外的两处 README 与 ainpt 的归档。
