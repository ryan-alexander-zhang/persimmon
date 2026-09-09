---
id: spec-00013-persimmon-scaffold
type: spec
status: active
parent: prd-00003-multi-workspace
---

# Spec: `persimmon` 的脚手架——new / update / list-langs 与登记闭环

> `new` 从模板仓库的一个分支建出项目、写下创建标记、并把它登记为 workspace；
> `update` 把模板此后的改动三方合并回项目而保住本地改动；`list-langs` 列出
> 可用模板。登记在 `new` 里闭环，模板仓库不再需要知道白板的存在。行为取自
> 迁入前的 ainpt（`decision-00020` §2 第 1 条要求逻辑不改），四处已知缺陷按
> 更正后的行为写定（§1）。

## 1. Context

- canonical terms 见 `CONTEXT.md`：**persimmon 命令**、**已运行进程**、
  **workspace**、**workspace 注册表**、**切换器**。
- 本 spec 新增术语（拟，接收后进 `CONTEXT.md`）：
  - **模板仓库（Template Repository）**：`new` 与 `update` 取材的那个仓库，其
    每个分支是一个模板（`main` 为基础模板、`lang/<l>` 为语言模板、
    `lang/<l>/<v>` 为变体模板），每个分支自带 `template.json` 描述自己的
    脚手架。缺省坐标编译期钉死，可由环境变量覆盖（`FR-1`）。
    _Avoid_：脚手架仓库、骨架库、ai-native-project-template（那是缺省坐标的
    具体值，不是概念名）。
  - **创建标记（Creation Marker）**：`new` 在新项目根目录写下的一份文件，记住
    项目来自哪个模板仓库、哪个 ref、创建时的哪个提交与哪些变量；`update` 以
    它记下的提交为三方合并的基准。文件名永久沿用 `.ainpt.json`
    （`decision-00020` §2 第 7 条 ③：改名会让全部既有项目的 `update` 失效）。
    _Avoid_：锁文件、lock（那是实现里的类型名）、清单、配置。
  - **模板管辖文件（Template-managed File）**：当前上游模板分支里存在、且未被
    **该分支**的 `template.json` 的 `exclude` 命中的文件；只有它们参与
    `update` 的合并，项目自有的文件一律不动。
    _Avoid_：受管文件、模板文件（歧义：也可指 `template.json` 本身）。
  - **基准（Merge Base）**：创建标记里记下的那个模板提交；`update` 的三方合并
    以它为共同祖先，合并成功后它被推进为本次的上游提交（`FR-9`）。
    _Avoid_：基线、上次的版本。
- 输入与权威：[decision-00020-unified-go-cli](../decision/decision-00020-unified-go-cli.md)
  §2 第 1、5、8 条与 [design-00004-persimmon-cli](../design/design-00004-persimmon-cli.md)
  §2 / §5（命令面与 `new` 的登记闭环）。迁入前行为的事实取自独立仓库 ainpt 的
  `README.md`、`main.go` 与 `internal/scaffold/scaffold.go`。
- `parent` 为 [prd-00003-multi-workspace](../prd/prd-00003-multi-workspace.md)：
  该 PRD 第三十一轮修订后的功能需求 6 明确要求「`persimmon new` 在脚手架完成后
  **自己**登记新项目」，功能需求 1 说明登记走的正是 `add` 那条路径——本 spec 是
  它的需求形态；该 PRD 已把脚手架那一半点名交给本 spec——那些指针在树里，
  不是待办。
- **与 `spec-00012-persimmon-command` 的分界**：那份 spec 持有入口与子命令集、
  无子命令的启动路径（拉起服务、stdio 透传、信号、退出码、版本配对、缺 Node
  的失败）、`version` 与命令的取得形态；本 spec 持有 `new` / `update` /
  `list-langs` 三个子命令与 `new` 的登记闭环。逐条边界在 §6。
- **登记语义不在本 spec 重述**：`FR-6` 走的是 `persimmon add` 那条路径，其幂等、
  `id` 派生、路径规范化与可登记判定由 `spec-00011-FR-2` / `spec-00011-FR-3`
  持有，注册表不合式的判定由 `spec-00011-FR-18` 持有。
- **本稿的未决由编排者于 2026-09-08 代域主裁定**（`AUTOPILOT.md`，
  `decided_by: agent` 的口径），正文按裁定写定、不留 Open Questions：`update`
  缺 `git` 时不做合并前预检（`FR-12`）；创建标记永久沿用 `.ainpt.json`、不做
  迁移（`FR-3`）；`AINPT_OWNER` / `AINPT_REPO` 保留（`FR-1`）；`new` 的登记
  无关闭途径（`FR-6`）；`parent` 取 `prd-00003-multi-workspace`。
- **四处已知缺陷按更正后的行为写定，与迁入前的代码不一致**：创建标记的模板
  坐标须恰为 `owner/repo`（`FR-11`，现状用 `SplitN` 只查段数，`"/repo"` 一类
  空段可通过）；`list-langs` 对「有变体而没有 `lang/<l>` 基础分支」的语言不印
  基础行、改在组头标注（`FR-13`，现状照印一行不存在的分支）；`list-langs`
  须跟随分页取尽（`FR-13`，现状只取第一页 100 条即止）；`new` 拒绝第二个位置
  参数（`FR-4`，现状静默丢弃它，`FR-1` 的「旗标可在位置参数前后」也因此才真正
  成立）。迁入的 plan 须为这四处各开一份 `docs/issue`、先写出失败的测试再改
  （`AGENTS.md` §8）。同批盘出的另一处偏离是安装脚本的校验和，它落在
  `spec-00012-FR-11`，不在本 spec 的四处之内。
- 本 spec 不改任何 workspace 内部的行为，也不改模板仓库的 `template.json`
  （`decision-00020` §4「不变的」）。

## 2. Stories

| Story | Value | Delivers |
| --- | --- | --- |
| S1 | 作为文档负责人，我要从任意模板分支建项目、把变量一次讲清，参数写错时得到一句能照着改的说明而不是半个项目 | spec-00013-FR-1, spec-00013-FR-2, spec-00013-FR-4, spec-00013-FR-5 |
| S2 | 作为文档负责人，我要 `persimmon new` 建完就能在切换器里看到这个项目，不用记得再跑一次登记；登记出了问题也别把我刚建好的项目弄丢 | spec-00013-FR-6, spec-00013-FR-7, spec-00013-FR-8 |
| S3 | 作为文档负责人，模板骨架升级后我要把它折进已有项目，我自己的改动一个不丢、真撞上了留冲突标记给我，删掉的东西别给我塞回来 | spec-00013-FR-3, spec-00013-FR-9, spec-00013-FR-10, spec-00013-FR-11, spec-00013-FR-12 |
| S4 | 作为文档负责人，我要先看有哪些模板可用再决定建什么 | spec-00013-FR-13, spec-00013-FR-14 |

## 3. Business Rules

| Rule set | Doc | Covers |
| --- | --- | --- |
| Docs 工作流 | [rule-00001-docs-workflow](../rule/rule-00001-docs-workflow.md) | 不因本 spec 而变；本 spec 不新增业务规则——模板分支与三方合并都是软件概念，拿掉软件后不存在。`new` 建出的项目落地即带模板自带的 `whiteboard.config.yaml` 与 `docs/`，故一落地就满足 workspace 的定义（`CONTEXT.md`）并可被登记（`FR-6`）；这是模板分支内容的后果，不是本 spec 加的规则 |

## 4. System Requirements

- **spec-00013-FR-1** (Event) 当用户执行 `persimmon new <name>` 时，系统应把
  模板仓库的一个分支落地为 `<dir>/<name>` 目录下的新项目。分支的取法：缺省
  `main`；`--lang <l>` 取 `lang/<l>`；`--lang <l> --variant <v>` 取
  `lang/<l>/<v>`；`--ref <branch>` 覆盖以上一切。`--dir <path>` 指定新项目的
  父目录（缺省当前目录）；`--set KEY=VALUE` 可重复地提供模板变量；模板仓库的
  坐标可由环境变量 `AINPT_OWNER` / `AINPT_REPO` 覆盖（名字沿用，
  `decision-00020` §2 第 7 条 ④）。旗标可出现在 `<name>` 之前或之后，结果相同
  （解析方式属 `design-00004` §2；恰一个位置参数由 `FR-4` 保证）。
- **spec-00013-FR-2** (Event) 当 `new` 取到模板分支时，系统应按该分支
  `template.json` 的声明落地：`exclude` 命中的路径不复制（目录被命中即整棵
  跳过）；`.git` 与 `template.json` 本身永不复制，无需在 `exclude` 里声明；
  变量按「`--set` 给出的 > 该变量声明的 `default`」定值，`default` 自身也做
  占位替换（故 `default` 可写成 `{{name}}` 一类）；`{{name}}` 与
  `{{PROJECT_NAME}}` 缺省即项目名；`substitute` 列出的文件中的 `{{KEY}}` 占位
  以定好的变量替换，列出但该分支实际没有的文件跳过、不构成失败；`post_create`
  的各步在新项目目录内**按声明顺序**依次执行；`vars` 条目与 `post_create`
  步骤上的 `when_lang` / `when_variant` 是精确匹配的门控，与本次 `--lang` /
  `--variant` 不匹配的条目与步骤跳过。变量声明里的 `prompt` 只是给人看的说明：
  **没有交互路径**，缺值一律按 `FR-5` 失败而不是提问。
- **spec-00013-FR-3** (Ubiquitous) 系统应在 `new` 成功时于新项目根目录写下
  创建标记，记住模板仓库坐标、`ref`、`lang`、`variant`、创建时该 ref 的提交
  （即基准）与定好的变量（不含随项目名而变的 `name`）；`update` 以基准做三方
  合并（`FR-9`）。标记的文件名与格式与迁入前一致，故迁入前建出的既有项目
  无需任何迁移即可被 `update` 处理。
- **spec-00013-FR-4** (Unwanted) 若 `new` 的参数不合式——`--variant` 未配
  `--lang`、缺 `<name>`、某个 `--set` 的值不含 `=`、或给了第二个位置参数——
  系统应说明是哪一种并以非 0 退出，不取模板、不建立任何目录、不读写注册表。
- **spec-00013-FR-5** (Unwanted) 若 `new` 在落地过程中失败——目标
  `<dir>/<name>` 已存在、模板分支取不到（此时并提示可执行
  `persimmon list-langs`）、模板声明的某个必需变量（已声明、没有 `default`、
  也未经 `--set` 给出）缺值、或某个 `post_create` 步骤以非 0 退出——系统应报出
  是哪一种并以非 0 退出，**不写创建标记、不登记**（`FR-6`）。目标已存在这一种
  下目标目录的内容一字不改；已开始复制之后才失败的（`post_create` 失败）已
  复制的文件留在原地不回滚，用户自行删除后重来。模板分支可取而其提交号取不到时
  不算失败：项目照常建出并登记，命令给出一句警告，创建标记的基准为空——其后的
  `update` 因此按 `FR-11` 拒绝。
- **spec-00013-FR-6** (Event) 当 `new` 的脚手架成功时，系统应把 `<dir>/<name>`
  登记为 workspace：走与 `persimmon add` 完全相同的登记路径——有已运行进程时
  经它登记（该进程的切换器随即可见新条目），无已运行进程时直接写注册表文件；
  路径规范化、幂等、`id` 派生与可登记判定的语义同 `spec-00011-FR-2` /
  `spec-00011-FR-3`。登记成功后命令的最后一行应给出已登记的条目 id 与「在项目内
  执行 `persimmon` 打开」的提示。**登记没有关闭途径**：不提供跳过它的旗标或
  环境变量，试图给出这样一个旗标应按未知旗标被拒（`FR-4` 的口径）。
- **spec-00013-FR-7** (Unwanted) 若 `new` 登记时该端口被一个不是已运行进程的
  程序占用，系统应仍直接写注册表文件完成登记并以 0 退出——项目已经建好，不因
  一个无关进程占了端口而少登记一步。这与 `spec-00011-FR-15` 对启动路径与
  `add` 的「报端口被占用、非 0 退出」是**有意的不同**（`design-00004` §5）。
- **spec-00013-FR-8** (Unwanted) 若登记本身失败——注册表不合式
  （`spec-00011-FR-18` 的判定）、写盘失败、或经已运行进程被拒——系统应保留已
  建好的项目、不回滚，以一句话报出登记侧的原因并以非 0 退出，且不改写注册表
  文件。项目目录是主产物，登记是附带动作：用户修好原因后 `persimmon add` 即可
  补上。
- **spec-00013-FR-9** (Event) 当用户在一个带创建标记的项目内执行
  `persimmon update [--dir <path>]` 时，系统应取模板仓库在基准与当前 `ref` 两个
  版本，对每个模板管辖文件做三方合并：项目的本地改动保留、上游的增量折入、二者
  重叠处留下常规的 `<<<<<<<` 冲突标记。**只有基准与项目侧都没有该路径时**上游
  文件才作为新增被原样加入；上游有、基准没有而项目侧已有同路径文件的，仍做
  三方合并（共同祖先为空）并计为已合并。项目自有的文件一律不动。合并后系统应
  把基准推进为本次的上游提交，并汇总合并数、新增数、因项目已删而留空的数与
  冲突文件清单，冲突不为空时列出各文件并提示逐个解决后提交。**留下冲突不是
  失败**：命令以 0 退出，基准照样推进——冲突标记已在工作树里，下一次 `update`
  该从这一次的上游提交继续。当前 `ref` 的提交与基准相同时报「已是最新」且不
  改动任何文件。
- **spec-00013-FR-10** (Ubiquitous) 合并的取舍口径应为：只有**基准中不存在**的
  上游文件才算新增——基准有而项目没有的文件是项目自己删过的（含 `post_create`
  删掉的引导物），尊重该删除、不重建，并在汇总中计出；`exclude` 取的是**本次
  上游分支**的 `template.json`（创建标记不记 `exclude`，故排除集随模板演进，
  上游新加的排除项立即生效），它在目录上与在文件上同样生效、命中的目录整棵
  跳过；上游是符号链接的条目不做文本合并——目标一致即通过，上游自基准以来未动
  而项目侧改过则以项目侧为准且不报冲突，其余报为冲突并保持项目侧原样（链接处
  无处安放冲突标记）。符号链接的新增同受 `FR-9` 的两个前提约束。
- **spec-00013-FR-11** (Unwanted) 若 `update` 的前提不成立——目标目录内没有
  创建标记、标记不是合法 JSON、标记里的基准为空、或标记里的模板坐标不是恰
  `owner/repo` 形态（恰一个斜杠、两段都非空）——系统应说明是哪一种并以非 0
  退出，不改动项目内任何文件。
- **spec-00013-FR-12** (Unwanted) 若本机 PATH 上没有 `git`，系统应在第一个
  **需要合并**的文件上报出合并失败并以非 0 退出——三方合并由 `git` 执行。此时
  **基准不推进**，故此前已加入项目的上游新增文件在重跑时会被再次处理（它们已
  在项目里，按 `FR-9` 走三方合并而不是重复新增）。不做合并前的一次性预检：
  一次只新增文件或符号链接的 `update` 根本不需要 `git`，预检会把这种本可完成的
  升级也拒掉。
- **spec-00013-FR-13** (Event) 当用户执行 `persimmon list-langs` 时，系统应列出
  模板仓库的模板：先一行基础模板，再按语言字典序列出每个有 `lang/*` 分支的
  语言，每个语言之下按字典序列出其变体，以 0 退出。取分支时应**跟随分页直到
  取尽**，不因某一页的条数上限而截断。只有 `lang/<l>/<v>` 而没有 `lang/<l>` 的
  语言仍成组列出，但**不印那条不存在的 `--lang <l>` 基础行**，改在组头标注该
  语言没有基础分支、只能经 `--variant` 使用。没有任何 `lang/*` 分支时输出说明
  只有基础模板可用。
- **spec-00013-FR-14** (Unwanted) 若列分支失败，系统应报错并以非 0 退出：
  请求发不出去时报出该错误；HTTP 状态非 200 时另报出该请求的地址与状态；
  应答不可解析时报出解析错误。

**Acceptance (GWT)**

- **spec-00013-AC-1.1** (spec-00013-FR-1)
  Given 模板仓库的 `main` 分支存在，当前目录下没有 `demo`
  When 执行 `persimmon new demo`
  Then `./demo` 建出，其内容来自 `main`
- **spec-00013-AC-1.2** (spec-00013-FR-1)
  Given 模板仓库有分支 `lang/go`
  When 执行 `persimmon new svc --lang go`
  Then `./svc` 的内容来自 `lang/go`
- **spec-00013-AC-1.3** (spec-00013-FR-1)
  Given 模板仓库有分支 `lang/java/ddd`
  When 执行 `persimmon new app --lang java --variant ddd`
  Then `./app` 的内容来自 `lang/java/ddd`
- **spec-00013-AC-1.4** (spec-00013-FR-1)
  Given 模板仓库有分支 `lang/go` 与 `spike`
  When 执行 `persimmon new demo --lang go --ref spike`
  Then 内容来自 `spike`——`--ref` 覆盖由 `--lang` 推出的分支
- **spec-00013-AC-1.5** (spec-00013-FR-1)
  Given 目录 `/work` 存在且可写
  When 执行 `persimmon new demo --dir /work`
  Then 项目建在 `/work/demo`
- **spec-00013-AC-1.6** (spec-00013-FR-1)
  Given 环境变量 `AINPT_OWNER=acme`、`AINPT_REPO=tpl`
  When 执行 `persimmon new demo`
  Then 取的是 `acme/tpl` 的模板而不是缺省坐标的
- **spec-00013-AC-1.7** (spec-00013-FR-1)
  Given 模板的 `template.json` 声明变量 `MODULE_PATH`
  When 执行 `persimmon new demo --set MODULE_PATH=example.com/x --set EXTRA=1`
  Then 两个变量都进入替换——`--set` 可重复
- **spec-00013-AC-1.8** (spec-00013-FR-1)
  Given 模板仓库有分支 `lang/go`
  When 执行 `persimmon new --lang go demo`（旗标在位置参数之前）
  Then 结果与 `persimmon new demo --lang go` 相同
- **spec-00013-AC-2.1** (spec-00013-FR-2)
  Given 模板分支的 `template.json` 的 `exclude` 含 `.github/`
  When `new` 建出项目
  Then 项目内没有 `.github/`
- **spec-00013-AC-2.2** (spec-00013-FR-2)
  Given 模板分支的 `template.json` 的 `exclude` 既没写 `.git` 也没写 `template.json`
  When `new` 建出项目
  Then 项目内既没有 `.git/` 也没有 `template.json`
- **spec-00013-AC-2.3** (spec-00013-FR-2)
  Given `substitute` 列出 `README.md`，模板的该文件含 `{{PROJECT_NAME}}`
  When 执行 `persimmon new demo`
  Then 项目的 `README.md` 中该占位已成 `demo`
- **spec-00013-AC-2.4** (spec-00013-FR-2)
  Given 变量 `ARTIFACT_ID` 声明了 `default` 为 `{{name}}`，用户未给 `--set`
  When 执行 `persimmon new demo`
  Then 该变量取值 `demo`——`default` 自身也做占位替换
- **spec-00013-AC-2.5** (spec-00013-FR-2)
  Given `post_create` 含一步标了 `when_lang: go`
  When 执行 `persimmon new demo`（未给 `--lang`）
  Then 该步不执行
- **spec-00013-AC-2.6** (spec-00013-FR-2)
  Given `post_create` 含一步标了 `when_lang: go`
  When 执行 `persimmon new demo --lang go`
  Then 该步在新项目目录内执行
- **spec-00013-AC-2.7** (spec-00013-FR-2)
  Given `post_create` 声明了三步，其中第二步的效果依赖第一步
  When 执行 `persimmon new demo`
  Then 三步按声明顺序在项目目录内依次执行
- **spec-00013-AC-2.8** (spec-00013-FR-2)
  Given `substitute` 列出一个该分支实际没有的文件
  When `new` 建出项目
  Then 命令不因此失败，项目照常建成
- **spec-00013-AC-3.1** (spec-00013-FR-3)
  Given 模板分支 `lang/go` 的最新提交为 `abc1234`
  When 执行 `persimmon new svc --lang go`
  Then `svc` 的创建标记记下模板坐标、`ref` 为 `lang/go`、`lang` 为 `go`、基准为 `abc1234`
- **spec-00013-AC-3.2** (spec-00013-FR-3)
  Given 执行 `persimmon new demo --set MODULE_PATH=example.com/x`
  When 读该项目的创建标记
  Then 其变量表含 `MODULE_PATH` 与 `PROJECT_NAME`，不含 `name`
- **spec-00013-AC-3.3** (spec-00013-FR-3)
  Given 一个由迁入前的 `ainpt` 建出、根目录已有创建标记的既有项目（本仓库即是其一）
  When 在其中执行 `persimmon update`
  Then 命令照常合并，无需任何迁移步骤
- **spec-00013-AC-4.1** (spec-00013-FR-4)
  Given 当前目录下没有 `app`
  When 执行 `persimmon new app --variant ddd`（未给 `--lang`）
  Then 命令说明 `--variant` 需要 `--lang` 并以非 0 退出，`./app` 未建立
- **spec-00013-AC-4.2** (spec-00013-FR-4)
  Given 命令已装好
  When 执行 `persimmon new`（未给 `<name>`）
  Then 命令打印该子命令的用法并以非 0 退出，未建立任何目录
- **spec-00013-AC-4.3** (spec-00013-FR-4)
  Given 当前目录下没有 `demo`
  When 执行 `persimmon new demo --set BAD`（值不含 `=`）
  Then 命令说明期望 `KEY=VALUE` 并以非 0 退出，`./demo` 未建立
- **spec-00013-AC-4.4** (spec-00013-FR-4)
  Given 当前目录下没有 `demo` 也没有 `extra`
  When 执行 `persimmon new demo extra`（两个位置参数）
  Then 命令说明只接受一个 `<name>`、打印用法并以非 0 退出，两个目录都未建立
- **spec-00013-AC-5.1** (spec-00013-FR-5)
  Given `./demo` 已存在且其中有文件
  When 执行 `persimmon new demo`
  Then 命令说明目标已存在并以非 0 退出，`./demo` 的内容一字未改，注册表不变
- **spec-00013-AC-5.2** (spec-00013-FR-5)
  Given 模板仓库没有分支 `lang/rust`
  When 执行 `persimmon new demo --lang rust`
  Then 命令报取不到该分支、提示可执行 `persimmon list-langs`，以非 0 退出，`./demo` 未建立
- **spec-00013-AC-5.3** (spec-00013-FR-5)
  Given 模板声明变量 `MODULE_PATH`（有 `prompt`、无 `default`），用户未给 `--set`
  When 执行 `persimmon new demo`
  Then 命令说明缺该变量并指出用 `--set MODULE_PATH=VALUE`，以非 0 退出，不向用户提问，`./demo` 未建立
- **spec-00013-AC-5.4** (spec-00013-FR-5)
  Given 模板的某个 `post_create` 步骤以非 0 退出
  When 执行 `persimmon new demo`
  Then 命令报出是哪一步失败并以非 0 退出，`./demo` 内没有创建标记，注册表不变
- **spec-00013-AC-5.5** (spec-00013-FR-5)
  Given 模板的某个 `post_create` 步骤以非 0 退出
  When 检视 `./demo`
  Then 此前已复制的文件仍在原地——命令不回滚
- **spec-00013-AC-5.6** (spec-00013-FR-5)
  Given 模板分支可取，但取其提交号的请求失败
  When 执行 `persimmon new demo`
  Then 项目照常建出并登记，命令给出一句警告，创建标记的基准为空
- **spec-00013-AC-6.1** (spec-00013-FR-6)
  Given 该端口上没有已运行进程，注册表为空
  When 执行 `persimmon new demo --dir /work`
  Then 注册表新增一条，其路径为 `/work/demo`
- **spec-00013-AC-6.2** (spec-00013-FR-6)
  Given 一个已运行进程在监听且其切换器处于打开态，注册表为空
  When 执行 `persimmon new demo --dir /work`
  Then 登记经该进程完成、其切换器随即列出该条，命令不起第二个服务
- **spec-00013-AC-6.3** (spec-00013-FR-6)
  Given 脚手架与登记都成功
  When 读命令的最后一行输出
  Then 它给出已登记的条目 id 与在项目内执行 `persimmon` 打开的提示
- **spec-00013-AC-6.4** (spec-00013-FR-6)
  Given `/work` 是指向 `/private/work` 的符号链接，注册表为空
  When 执行 `persimmon new demo --dir /work`
  Then 条目的路径为 `/private/work/demo`
- **spec-00013-AC-6.5** (spec-00013-FR-6)
  Given 当前目录下没有 `demo`
  When 执行 `persimmon new demo --no-register`
  Then 命令按未知旗标拒绝并以非 0 退出，项目未建立——登记没有关闭途径
- **spec-00013-AC-7.1** (spec-00013-FR-7)
  Given 该端口被一个不是已运行进程的程序占用，注册表为空
  When 执行 `persimmon new demo`
  Then 项目建出、注册表得到该条，命令以 0 退出
- **spec-00013-AC-7.2** (spec-00013-FR-7)
  Given 上一条的条目已直接写入注册表文件
  When 其后启动一个已运行进程并打开切换器
  Then 该条在列，与经进程登记的条目没有分别
- **spec-00013-AC-8.1** (spec-00013-FR-8)
  Given 注册表文件存在但不可解析
  When 执行 `persimmon new demo`
  Then 项目建出且完整，命令以一句话报出注册表的问题并以非 0 退出，注册表文件未被改写
- **spec-00013-AC-8.2** (spec-00013-FR-8)
  Given 注册表文件所在目录不可写
  When 执行 `persimmon new demo`
  Then 项目建出且完整，命令以一句话报出写盘失败并以非 0 退出
- **spec-00013-AC-8.3** (spec-00013-FR-8)
  Given 一个已运行进程在监听，它对该路径的登记以 422 拒绝
  When 执行 `persimmon new demo`
  Then 项目建出且完整，命令以一句话报出该进程给出的拒绝原因并以非 0 退出
- **spec-00013-AC-8.4** (spec-00013-FR-8)
  Given 上述任一失败之后，用户已排除该原因
  When 在该项目内执行 `persimmon add`
  Then 该项目照常登记
- **spec-00013-AC-9.1** (spec-00013-FR-9)
  Given 项目由 `new` 建出，其后用户改过某模板管辖文件，上游对该文件另有改动且两处不重叠
  When 执行 `persimmon update`
  Then 该文件同时含用户的改动与上游的改动
- **spec-00013-AC-9.2** (spec-00013-FR-9)
  Given 用户与上游改的是同一处
  When 执行 `persimmon update`
  Then 该文件留下 `<<<<<<<` 冲突标记，命令列出该文件并提示解决后提交
- **spec-00013-AC-9.3** (spec-00013-FR-9)
  Given 用户与上游改的是同一处
  When 执行 `persimmon update`
  Then 命令以 0 退出——留下冲突不是失败
- **spec-00013-AC-9.4** (spec-00013-FR-9)
  Given 本次合并留下了冲突
  When 读该项目的创建标记
  Then 基准已推进为本次的上游提交
- **spec-00013-AC-9.5** (spec-00013-FR-9)
  Given 合并完成且没有冲突
  When 读该项目的创建标记
  Then 基准已推进为本次的上游提交
- **spec-00013-AC-9.6** (spec-00013-FR-9)
  Given 项目里有一个模板从未有过的文件
  When 执行 `persimmon update`
  Then 该文件一字未改
- **spec-00013-AC-9.7** (spec-00013-FR-9)
  Given 上游新增了一个基准里不存在的文件，项目里也没有该路径
  When 执行 `persimmon update`
  Then 该文件被原样加入项目，汇总中计为新增
- **spec-00013-AC-9.8** (spec-00013-FR-9)
  Given 上游新增了一个基准里不存在的文件，而项目里已有同路径的自己的文件
  When 执行 `persimmon update`
  Then 该文件不被覆盖，而是与上游做共同祖先为空的三方合并、计为已合并（重叠处留冲突标记）
- **spec-00013-AC-9.9** (spec-00013-FR-9)
  Given 基准与当前 `ref` 的提交相同
  When 执行 `persimmon update`
  Then 命令报「已是最新」，不改动任何文件，以 0 退出
- **spec-00013-AC-9.10** (spec-00013-FR-9)
  Given 带创建标记的项目在 `path/to/proj`
  When 在别处执行 `persimmon update --dir path/to/proj`
  Then 被合并的是该目录
- **spec-00013-AC-10.1** (spec-00013-FR-10)
  Given 基准里有一个文件而项目里没有（创建后被 `post_create` 或用户删掉）
  When 执行 `persimmon update`
  Then 该文件不被重建，汇总说明有文件因项目已删而留空
- **spec-00013-AC-10.2** (spec-00013-FR-10)
  Given 上游分支的 `template.json` 新增了一条创建时不存在的 `exclude` 模式，命中项目里的一批文件
  When 执行 `persimmon update`
  Then 那批文件不参与合并——排除集取自本次上游分支，不是创建时那一份
- **spec-00013-AC-10.3** (spec-00013-FR-10)
  Given `exclude` 的某个模式命中的是一个目录而非其中的文件
  When 执行 `persimmon update`
  Then 该目录整棵不参与合并
- **spec-00013-AC-10.4** (spec-00013-FR-10)
  Given 上游有一个符号链接，项目里也是指向同一目标的符号链接
  When 执行 `persimmon update`
  Then 链接与其所指的目标文件都未被合并结果覆盖
- **spec-00013-AC-10.5** (spec-00013-FR-10)
  Given 上游自基准以来改了某符号链接的目标，项目里那个位置是用户放的普通文件
  When 执行 `persimmon update`
  Then 命令把它报为冲突并保持项目侧原样
- **spec-00013-AC-10.6** (spec-00013-FR-10)
  Given 上游那个符号链接自基准以来未动，项目却把它改指了别处
  When 执行 `persimmon update`
  Then 以项目侧为准，不报冲突
- **spec-00013-AC-11.1** (spec-00013-FR-11)
  Given 某目录内没有创建标记
  When 在其中执行 `persimmon update`
  Then 命令说明该目录里没有创建标记并以非 0 退出，目录内文件一字未改
- **spec-00013-AC-11.2** (spec-00013-FR-11)
  Given 创建标记不是合法 JSON
  When 执行 `persimmon update`
  Then 命令说明解析失败并以非 0 退出，项目内文件一字未改
- **spec-00013-AC-11.3** (spec-00013-FR-11)
  Given 创建标记的基准为空（`spec-00013-AC-5.6` 的产物）
  When 执行 `persimmon update`
  Then 命令说明没有基准、无法三方合并并以非 0 退出，项目内文件一字未改
- **spec-00013-AC-11.4** (spec-00013-FR-11)
  Given 创建标记里的模板坐标为 `/repo`（斜杠前一段为空）
  When 执行 `persimmon update`
  Then 命令指明该值不是 `owner/repo` 形态并以非 0 退出，项目内文件一字未改
- **spec-00013-AC-11.5** (spec-00013-FR-11)
  Given 创建标记里的模板坐标为 `owner/repo/extra`（两个斜杠）
  When 执行 `persimmon update`
  Then 命令指明该值不是 `owner/repo` 形态并以非 0 退出
- **spec-00013-AC-12.1** (spec-00013-FR-12)
  Given 本机 PATH 上没有 `git`，项目有需要合并的模板管辖文件
  When 执行 `persimmon update`
  Then 命令在第一个需要合并的文件上报出合并失败并以非 0 退出
- **spec-00013-AC-12.2** (spec-00013-FR-12)
  Given 上一条失败之后
  When 读该项目的创建标记
  Then 基准未推进——重跑 `update` 仍从同一个基准开始
- **spec-00013-AC-13.1** (spec-00013-FR-13)
  Given 模板仓库有分支 `lang/go`、`lang/java`、`lang/java/ddd`
  When 执行 `persimmon list-langs`
  Then 输出先列基础模板一行，再按字典序列 `go`、`java`，`ddd` 列在 `java` 之下，命令以 0 退出
- **spec-00013-AC-13.2** (spec-00013-FR-13)
  Given 模板仓库没有任何 `lang/*` 分支
  When 执行 `persimmon list-langs`
  Then 输出说明只有基础模板可用，命令以 0 退出
- **spec-00013-AC-13.3** (spec-00013-FR-13)
  Given 模板仓库有 `lang/java/ddd` 但没有 `lang/java`
  When 执行 `persimmon list-langs`
  Then `java` 成组列出并标注它没有基础分支，`ddd` 列在其下，输出里没有 `--lang java` 那一行
- **spec-00013-AC-13.4** (spec-00013-FR-13)
  Given 模板仓库的分支数超过单页上限，`lang/zzz` 只出现在第二页
  When 执行 `persimmon list-langs`
  Then `zzz` 也在输出里——取分支跟随分页直到取尽
- **spec-00013-AC-14.1** (spec-00013-FR-14)
  Given 列分支的请求发不出去（无网络）
  When 执行 `persimmon list-langs`
  Then 命令报出该错误并以非 0 退出
- **spec-00013-AC-14.2** (spec-00013-FR-14)
  Given 列分支的请求返回 403
  When 执行 `persimmon list-langs`
  Then 命令报出该请求的地址与状态并以非 0 退出
- **spec-00013-AC-14.3** (spec-00013-FR-14)
  Given 列分支的应答是 200 但正文不可解析
  When 执行 `persimmon list-langs`
  Then 命令报出解析错误并以非 0 退出

## 5. Technical Design

| Design | Doc | Covers |
| --- | --- | --- |
| 命令面、`new` 的登记闭环、脚手架代码的位置与迁入时的穷举改动 | [design-00004-persimmon-cli](../design/design-00004-persimmon-cli.md) §2 / §5 / §6 | 全部 FR 的实现结构 |

`design-00004` 已声明 `informs` 本 spec——那条边在树里，不是待办。注册表的
文件契约是 `design-00003-multi-workspace`
§2，由 `spec-00011` 持有，本 spec 的 `FR-6` … `FR-8` 经 `design-00004` §4 / §5
引用它，不另开一份契约。

## 6. Out of Scope

- **`spec-00012-persimmon-command` 持有的**：子命令集与未知子命令的拒绝
  （`spec-00012-FR-1`、`spec-00012-FR-2`）；无子命令的启动路径——拉起服务、
  stdio 透传、信号转发、以服务退出码退出、版本配对、开发覆盖、缺 Node 与开发态
  构建的失败（`spec-00012-FR-3` … `spec-00012-FR-8`）；`version`
  （`spec-00012-FR-9`）；命令的取得形态与安装时的校验和处置
  （`spec-00012-FR-10`、`spec-00012-FR-11`）。
- **`spec-00011-multi-workspace` 持有的**：注册表的位置、格式与整份校验
  （`spec-00011-FR-1`、`spec-00011-FR-18`）；`add` / `remove` / `list` 的行为
  （`spec-00011-FR-2` … `spec-00011-FR-5`、`spec-00011-FR-21`）；可用性判定
  （`spec-00011-FR-6`）；启动路径的登记与接入（`spec-00011-FR-13`、
  `spec-00011-FR-14`）；端口被他人占用时启动路径与 `add` 的拒绝
  （`spec-00011-FR-15`）。本 spec 的 `FR-6` 走的是同一条登记路径，语义在那边。
- 模板仓库的内容：`template.json` 的字段设计、有哪些语言与变体分支、
  `post_create` 具体做什么、模板里的 `whiteboard.config.yaml` 长什么样。本 spec
  只规定命令**如何处置** `template.json` 所声明的东西（`FR-2`）。
- `config` 子命令与白板界面里的 workspace 创建（`decision-00020` §2 第 7 条 ⑥）；
  后者到来时由 Host 直接调用同进程的脚手架模块（同决定 §2 第 8 条，第三十二轮
  推翻了原先的「以子进程调 `persimmon new`」），脚手架逻辑仍只此一份。
- 交互式脚手架：变量缺值一律失败（`FR-2`、`FR-5`），不提问、不读 TTY。
- `update` 的事务性：合并中途失败不回滚已加入的文件（`FR-12`），也不提供
  `--abort` 一类的撤销。
- 离线兜底：`new` 与 `update` 都要取网络上的模板，无网络时按各自的失败路径报错
  （`FR-5`、`FR-9` 的取模板失败）；不设本地模板缓存。
- 脚手架逻辑的第二份实现。任何新的命令行入口只能加在同一个可执行体里
  （`decision-00020` §5 末条）。

## 7. Non-Functional

- **回归约束**：迁入的脚手架逻辑除 §1 列出的四处缺陷更正外不改
  （`decision-00020` §2 第 1 条），其随行的既有测试照常通过；四处更正各须先有
  一份 `docs/issue` 与一个失败的测试（`AGENTS.md` §8）。
- 迁入的 `scaffold` 包现为 25.7% 语句覆盖，按 `CODE_QUALITY.md` §8 作为 legacy
  记债并逐步收紧（`decision-00020` §4）；本 spec 的验收集是收紧的目标。
- `new` 与 `update` 各取一次模板分支的 tarball（`update` 取两次：基准与上游），
  耗时受网络支配；不设进度条要求。

## Links

- Parent: [prd-00003-multi-workspace](../prd/prd-00003-multi-workspace.md)
- Decision: [decision-00020-unified-go-cli](../decision/decision-00020-unified-go-cli.md)（它的 `constrains` 列出本 spec；spec 不携带 `implements`，`docs/README.md` 关系规则）
- Design: [design-00004-persimmon-cli](../design/design-00004-persimmon-cli.md) §2/§5/§6 · [design-00003-multi-workspace](../design/design-00003-multi-workspace.md) §2（经 `design-00004` 引用）
- 并列 spec: [spec-00012-persimmon-command](spec-00012-persimmon-command.md) · [spec-00011-multi-workspace](spec-00011-multi-workspace.md)（分界见 §6）
- Rules: [rule-00001-docs-workflow](../rule/rule-00001-docs-workflow.md)（不变）
