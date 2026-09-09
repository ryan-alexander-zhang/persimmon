---
id: decision-00020-unified-go-cli
type: decision
status: active
constrains: [spec-00011-multi-workspace, design-00003-multi-workspace, design-00004-persimmon-cli, prd-00003-multi-workspace, plan-00033-persimmon-command, spec-00012-persimmon-command, spec-00013-persimmon-scaffold, record-00035-persimmon-command-acceptance, issue-00034-a-template-coordinate-with-too-many-segments-is-accepted, issue-00035-a-variant-only-language-is-listed-with-a-lang-line-that-does-not-work, issue-00036-list-langs-stops-at-the-first-page, issue-00037-new-silently-drops-a-second-positional, issue-00038-install-script-installs-an-archive-it-could-not-verify]
---

# Decision: 一个 `persimmon` 命令——ainpt 并入本仓库，命令行入口合一，实现为单一 Node 产物

> 独立仓库 ainpt 的 `new` / `update` / `list-langs` 迁入本仓库，与 `add` /
> `remove` / `list` 与启动握手合成**一个**命令，命令名 `persimmon`，ainpt 仓库
> 归档。实现与分发形态为单一 npm 产物：命令就是本包的 bin，脚手架是本包的
> 一个模块，不另起语言、不另起产物、暂不发布。
>
> **本文档经过一次语言与分发形态的回退**（第三十二轮，2026-09-09）。2026-09-08
> 的原始裁定是「用 Go：新增 `cli/` 独立模块承担全部入口，npm 包让出 `persimmon`
> 这个 bin 名改称 host 包，一个 tag 同发两个配对产物」，其实现已在
> `plan-00033` 中完整落地。域主 2026-09-09 决定暂不发布任何产物，并在同一次
> 对话中提出去掉 Go 层。§2 的决定表是回退后的现行裁定；被推翻的原裁定、
> 推翻的理由与代价见文末第三十二轮追注。
>
> 推翻 `spec-00011-FR-20`（包名与安装形态）。另两处曾在 2026-09-08 被列为
> 推翻对象——`design-00003` §8「`ainpt new` 的登记属模板仓库」与 §10「命令是
> `bin/persimmon.js`」——今天都已不是冲突：前者第三十一轮即改为「登记由
> `persimmon new` 自己做」，后者第三十二轮恰恰把它恢复为真。

## 1. 需要做这个决定的原因

- 同一条流程今天分在三处入口：`ainpt new` 建项目（Go 二进制，`curl | sh`
  安装），`persimmon add` 登记与 `persimmon` 开板（npm bin），下一步白板界面
  里还要加 workspace 创建。三者互相依赖，命名却不指向同一个产品。
- `design-00003` §8 把「`ainpt new` 完成时登记」留给模板侧，`plan-00027`
  据此只保证 `persimmon add` 非交互幂等；模板 `template.json` 的 `post_create`
  至今只有 git 初始化两步（`git init`、`core.hooksPath`），登记从未落地——
  两个仓库互相等对方。
- ainpt 本体约 600 行实现 + 300 行测试、仅标准库、逻辑稳定（加语言只加分支，
  命令不改），迁移成本是一次移植。
- 域主于 2026-09-08 的评审对话中裁定：合并，命令改名 `persimmon`；并确认
  四项形状（Node 服务保留、npm 包让出 bin 名、`add` 双路径保留、一个 tag 同发
  两个产物）。同一次对话中裁定用 Go 实现。
- 域主于 2026-09-09 的评审对话中**推翻了后两项**：决定暂不发布任何产物，
  并据此提出去掉 Go 层、把命令加回 Node 包（原话：「所以应该去掉，把这功能
  加到当前的 js 项目中对吗？」），随后指示记录并开工。§2 第 1–6 条据此改写；
  §2 第 7 条是 2026-09-08 裁定中不受影响、继续有效的部分。
- 本决定没有可引的上游文档，故不写 `motivated_by`。

## 2. 决定

> **行号在第三十二轮位移过**：本表被整体重写，旧表的第 1…8 条与新表的编号
> 不对应。仓内以「`decision-00020` §2 第 N 条」为坐标的引用约五十处，第三十二轮
> 已核校并改正过一轮；`spec-00012` 与 `spec-00013` 尚待其修订轮再核一遍。引本表
> 时请连同该条的内容一起写，不要只写行号。

| # | 做法 | 理由 |
| --- | --- | --- |
| 1 | 一个 `persimmon` 命令承担**全部**命令行入口：`new` / `update` / `list-langs` / `add` / `remove` / `list` / `version` / `help` / 无子命令（启动或接入）。命令即本 npm 包的 bin，不引入第二种实现语言、不引入第二个产物 | 一个名字、一份 usage、一个版本号；模板项目的用户只装一个东西 |
| 2 | 包名与 bin 名**改回** `@ryan-alexander-zhang/persimmon` / `persimmon`（`package.json:2` 与 `:9` 现为 `persimmon-host`，`40a5ca5` 落地，从未发布，无迁移成本）；`bin/host.js` 改回 `bin/persimmon.js` 并承担子命令分发 | 让名是为了给 Go 二进制腾位置；没有第二个产物就不需要让名 |
| 3 | 脚手架移植为 TypeScript，落在 `src/`。移植面按**函数**而非目录计：`cli/internal/scaffold/scaffold.go` 全部（含 `resolveRef` / `fetch` / `loadManifest` / `resolveVars` / `excluded` / `copyTree` / `substitute` / `runSteps` / `writeLock` / `resolveSHA` / `mergeTree` / `mergeSymlink`）、`cli/main.go` 的 `setFlag` / `cmdNew` / `register` / `cmdUpdate` / `cmdLangs` / `getBranchPage` / `nextLink`、以及 `cli/internal/project`。`new` / `update` 的语义、参数（`--lang` / `--variant` / `--dir` / `--ref` / `--set`）、三方合并算法、`.ainpt.json` 的内容与文件名**一律不变** | 这是唯一需要真移植的逻辑面；按目录声明会漏掉 `list-langs` 与 `new` 的命令层，而 issue-00035/36/37 的修复恰在那里 |
| 4 | 移植不得让 `issue-00034` / `00035` / `00036` / `00037` 的缺陷重现：模板坐标须「恰一个斜杠、owner 非空、repo 非空」三条件校验；只有变体的语言不印 `--lang <l>` 行；`list-langs` 跟 `Link: rel="next"` 取完所有分支；解析完不得剩余未读的位置参数。四条各留一条引其 issue id 的回归测试。第四条在 TS 侧实现为**解析器层的统一断言**，一并覆盖 `issue-00037` §4 记下的 `cmdUpdate` 同类缺陷（该延期原挂在 `plan-00033` T2b，随其失效） | 这四条是 Go 版实测发现的真缺陷；移植是重写，最容易原样长回来 |
| 5 | 注册表读写与可用性判定只保留一份（`src/workspaceRegistry.ts`、`src/workspaceAvailability.ts`）。host 的 `--judge` 查询模式删除，`list` 直接调用 `AvailabilityJudge` | 原裁定里「两份实现靠文档与两侧测试防漂移」的债，本轮不是偿还而是取消；单产物下 `list` 不再需要子进程，也不再有取不到判定时的降级 |
| 6 | 不发布任何版本。`version` 保持 `0.0.0-dev`；分发形态为 `npx @ryan-alexander-zhang/persimmon` 与 `npm i -g @ryan-alexander-zhang/persimmon`。`.goreleaser.yaml`、`install.sh`、`.github/workflows/release.yml`、`scripts/go-coverage.sh` 删除，`ci.yml` 去掉 Go job。同批补上缺失的 `"license": "MIT"`（`LICENSE` 是 MIT，字段一直缺，npm 会显示 UNLICENSED） | 域主决定暂不发布；再发布时也只有一个产物，不需要配对、校验和与两步顺序。license 字段是发布线搭建时就该补的既有缺口 |
| 7 | 以下 2026-09-08 的裁定不受本轮回退影响，继续有效：<br>① ainpt 仓库 README 改为指向本仓库的说明并归档，不再发布 `ainpt` 二进制；<br>② `persimmon new` 在脚手架完成后**自己**登记新项目（走与 `add` 相同的路径），模板 `template.json` 的 `post_create` 保持现状（只做 git 初始化）；<br>③ 创建标记文件名保留 `.ainpt.json`——改名会让所有既有项目的 `update` 失效，零收益；<br>④ 保留 `AINPT_OWNER` / `AINPT_REPO` 环境变量名——已在用户 shell 配置里；<br>⑤ `add` 的双路径（`spec-00011-FR-13/14`）保留：有已运行进程走 Host API，无进程直接读写文件；<br>⑥ `config` 子命令与白板界面里的 workspace 创建不在本决定范围 | 本轮推翻的是「用什么语言、怎么分发」，不是「入口要不要合一」 |
| 8 | 界面创建到来时，Host **直接调用同进程的脚手架模块**（原裁定为「以子进程调 `persimmon new`」）。这是第 1 条的直接后果，不是第 7 条的重述 | 同一个包里的模块，起子进程只是多一层 |
| 9 | 今后不得再为命令行引入第二种实现语言，不得再出现第二份注册表实现或第二份脚手架 | 本轮回退的成本正是这两件事产生的 |
| 10 | **支持平台仅 linux 与 darwin**，Windows 明写在支持范围外（域主 2026-09-09 裁定）| 模板带 `CLAUDE.md -> AGENTS.md` 符号链接，Windows 建链接需 Developer Mode 或提权；解归档改用外壳 `tar`，Windows 上不保证存在；node-pty 在 Windows 从未实测。原 goreleaser 虽出过 windows 产物，那条路径同样从未验过——本裁定是把既有事实写明，不是收窄 |

## 3. 考虑过的其他选项

| 选项 | 结论与理由 |
| --- | --- |
| 维持两仓库两命令，模板 `post_create` 调 `persimmon add` | **否决**。登记等了两轮没落地；用户仍要装两个东西、记两个名字；后续界面创建还要第三处调用脚手架 |
| 用 Go 实现命令行（2026-09-08 采纳，2026-09-09 推翻） | **推翻**。详见文末第三十二轮追注。当时的否决 TypeScript 的理由是「`new` 是项目还不存在、机器上未必有 Node 时跑的引导步骤；移植后 `new` 被 Node 与 node-pty 挡住。域主明确要 Go」——前半句在事实层面不成立（`new` 之后的每一步都要 Node），后半句已由域主本人于 2026-09-09 撤销 |
| 保留 `cli/`，只是暂不发布 | **否决**。Go 的净收益全部在分发形态上（单文件二进制、`curl \| sh`、目标机器不需要 Node）；不发布就只剩成本 |
| 保留 Go 只做 `new`，其余回 Node | **否决**。回到两个二进制、两个名字，正是本决定要消灭的形态；脚手架仍要在界面创建时被第三处调用 |
| 把 `scaffold` 留在 Go、由 Node 以子进程调用 | **否决**。等于保留整条 Go 工具链与跨语言启动，只为省一次移植 |
| 保留 `cli/` 目录备将来之需 | **否决**。YAGNI；git 历史完整保存，真要回去 `git revert` 即可 |
| 引入 `up` / `down` 子命令 | **否决**。`down` 要再写一遍探活与终止阶梯，前台进程 Ctrl-C 即停；只留 `up` 则与既有的「无子命令即启动」两种做法做同一件事。域主于 2026-09-09 确认不做 |
| 把本轮回退写成一份新的 `decision-00021` 并归档本文档 | **否决**。`docs/README.md:23` 的缺省是原地修订，新文档只留给「不可重写（已发布或被仓库之外引用）」的文档；本文档两者皆非，且已有两段原地追注的先例。归档它会造出约 70 处指向非现行文档的引用，其中相当一部分引的是第 7 条那些**存续**的裁定 |
| 把 Node 服务也重写为 Go | **否决**。约 30 个服务端模块、PTY、WS、React 前端；不在讨论范围 |
| `npm install -g` 一个独立 host 包作为前置步骤 | **否决**。单产物下不存在第二个包 |

## 4. 后果

**接受的代价**

- 移植 `scaffold.go` 590 行实现与 `scaffold_test.go` 1118 行测试到 TypeScript，
  外加 `cli/main.go` 的脚手架命令层与其在 `main_test.go` 里的测试。三方合并
  那段最容易译错，缓解手段是把 Go 的测试**等价**译过去，而不是重写一套。
- 覆盖率门槛提高：Go 侧 `scaffold` 今天的门是 82.8% 语句覆盖
  （`CODE_QUALITY.md` §3 的 legacy 记债，1118 行测试换来的），落到 `src/` 后
  受 `vitest.config.ts` 的 90% 行 / 分支 / 函数三项约束。移植后的代码按**新代码**
  对待，不继承那条棘轮：先等价翻译，再在其上补足三项门槛所缺的用例——补测试
  是叠加，不削弱等价翻译对译错风险的压制。
- 失去「目标机器无 Node 也能跑 `new`」的路径。这条路径本来就通不到白板
  （开板必须有 Node），代价是名义上的。
- `plan-00033` 产出的 Go 侧约 6394 行（其中 6343 行 Go、测试约 4400 行）作废。
  沉没成本不构成保留理由，但须在 `plan-00033` 与 `record-00035` 的状态上如实反映。
- `install.sh` 删除后 `issue-00038` 的修复对象不复存在，`test/install.test.ts`
  六个用例同删。

**得到的**

- 一个产物、一个版本号、一份注册表实现、一份可用性判定、一套工具链。
- `list` 不再起子进程、不再需要 `--judge` 模式、不再有取不到判定时的降级。
- 无包改名、无版本配对、无校验和策略、无两步发布顺序。
- 登记在 `new` 里闭环，模板仓库再无需知道白板的存在。
- 白板界面日后的 workspace 创建直接调用同进程的脚手架模块。
- 本仓库自身（根有 `.ainpt.json`，`decision-00019` §2 第 1 条）今后用自己
  产出的 `persimmon update` 跟随模板骨架升级。

**不变的**

- 白板服务的全部行为、HTTP/WS API、`whiteboard.config.yaml` 契约、
  `~/.persimmon/workspaces.json` 的格式与校验（`design-00003` §2）。
- `new` / `update` 的语义与参数、`.ainpt.json` 的内容与文件名、模板仓库的
  `template.json`。
- 无子命令启动时**用户可见的**握手输出与三态判定（`design-00003` §8 的流程图，
  含「端口被他人占用」的第三态）。进程模型变了——不再有子进程，
  故 `spec-00012-FR-3` / `FR-4` 的需求文本必须改写为同进程直出，
  不能以「输出不变」搪塞。

## 5. 这个决定约束什么

- `design-00004-persimmon-cli`：§1 形态、§3 host 启动时序、§4 两份实现与
  `--judge`、§6 代码位置、§7 包改名、§8 发布线整段作废；§2 命令面与 §5
  `new` 的登记闭环存续。由后续 plan 决定重写还是归档另起。
- `spec-00012-persimmon-command`：逐条——`FR-3`（转发 stdout/stderr、以服务
  退出码退出）与 `FR-4`（向子进程转发信号）**改写**为同进程模型；`FR-5`
  （版本配对）、`FR-6`（开发覆盖 `PERSIMMON_HOST`）、`FR-7`（本机无 Node 时
  开板失败）、`FR-8`（开发态构建须设开发覆盖）、`FR-11`（校验和）**作废**；
  `FR-10`（取得形态）是**改写**不是作废——它有替代形态（今天只有仓库检出，
  发布后 `npx` / `npm i -g`），有替代的需求走改写；入口、子命令集、退出码、
  `version`、`help` 存续。
- `spec-00013-persimmon-scaffold`：需求内容整体存续，实现语言从 Go 变为 TS。
- `spec-00011-multi-workspace`：FR-20 的包名与安装形态回到本包本名；
  `AC-20.1` 的 Given 字面是「已经 `install.sh` 装入 PATH」，须改写为 npm bin；
  FR-21 的 If 分支（取不到 host 包时降级，见第三十一轮追注）随 `--judge`
  一并删除；FR-13/14 的握手执行者改回 Node。走修订轮（`rule-00001-BR-3`）。
- `design-00003-multi-workspace` §2 的注册表契约恢复为单一实现；§8 / §10
  随修订轮据实改写。
- `prd-00003-multi-workspace`：角色表里的 `ainpt`、功能需求 6、功能需求 10 的
  包名与安装形态、In scope「单命令启动」、风险与依赖里的模板依赖与发布依赖
  随修订轮据实改写。
- `plan-00033-persimmon-command`：其交付被本轮回退推翻，转 `wontfix`
  （`docs/README.md:26`「被事件推翻」）。回退与移植由后续 plan 承担。
- `record-00035-persimmon-command-acceptance`：留 `active`——它如实记录了
  2026-09-09 那次验收的结果，`docs/README.md:27` 禁止用归档来记录结果。
  由后续 plan 在其上加一段追注，说明所验收的交付已被推翻、125 行 pass 的
  证据全是 Go 测试名、16 行「待人工实测」中的 15 行随其需求作废。
- `issue-00034` / `00035` / `00036` / `00037`：留 `resolved`——缺陷确曾被修复。
  §2 第 4 条要求移植后各留一条引其 id 的回归测试。
  `issue-00038`：留 `resolved`，由后续 plan 加一句追注说明其修复对象
  （`install.sh`）已随本轮删除。
- `ARCHITECTURE.md`（:20 技术选型行、:64 目录树、:68-69、:78、:119、:121、
  :123、:160 覆盖率行、:168 两份注册表实现的风险行——该风险消失）、
  `DEVELOPMENT.md`（:92-103、:111）、`TESTING.md`（:68、:101、:114-120）、
  `CODE_QUALITY.md`（:44-48、:63）、`CODE_STYLE.md`（:35）、
  `README.md`（:21 Quick Start 的 `curl | sh`、:43、:198 Repo Map）：
  Go 章节、Go 命令、Go 覆盖率口径与 legacy 记债撤除。
- `CONTEXT.md`：`persimmon 命令`（:476，定义句是「名为 `persimmon` 的 Go
  二进制」，`_Avoid_` 里写着「npm bin」——本轮使它变成自己的 Avoid 项）、
  `已运行进程`（:469，「host 进程（`persimmon-host`）」）、`模板仓库`（:508，
  「缺省坐标编译期钉死」是 ldflags 的概念）、`创建标记`（:515）、`host 包`、
  `版本配对`、`开发覆盖` 七个术语随其所指消失而移除或改写。
- 代码与配置：`cli/`、`.goreleaser.yaml`、`install.sh`、
  `.github/workflows/release.yml`、`scripts/go-coverage.sh`、
  `test/install.test.ts` 删除；`.github/workflows/ci.yml`（:23-47 Go job）、
  `package.json`（:2 包名、:9 bin、:21 start、缺失的 license、:25 `test:install`）、
  `scripts/test-install.js`（**重写而不是删除**：去掉 `--judge`，改为对同一个
  `npm pack` tarball 分别以 npx 形态与全局安装形态跑 `persimmon list` 并逐字
  比对，承载复活的 `spec-00011-AC-20.2`，并保留起一次 pty 的那格，承载
  `AC-20.3` 与 pty 实测义务；`test:install` 脚本保留。该脚本从来只需要
  `npm pack`，不需要真发布）、
  `test/distribution.test.ts`（:17 包名、:60 以 `--judge` 作探针）、
  `test/host.test.ts`（:1079、:1105）、`test/startup.test.ts`（:13）、
  `.gitignore`（:304-309 Go / goreleaser 段，另有 :45-52 的 `*.coverprofile` /
  `profile.cov` / `go.work` / `go.work.sum` 落在该段之外，别以为扫一遍就干净）、`bin/host.js` → `bin/persimmon.js` 改写。
- TS 侧命令测试的来源是 `cli/main_test.go`（1748 行，覆盖闭合子命令集）译过来；
  `40a5ca5` 删除的 `test/cli.test.ts`（482 行）只作为 TS 侧测试骨架的参考，
  不整体恢复——它与今天的 `test/startup.test.ts` / `test/host.test.ts` 有重叠。
- 后续任何命令行入口（含 `config`）只能加在这一个包里。落在本决定之下的
  新文档回填 `constrains`。

## 第三十一轮追注（2026-09-08）

> （本追注依据的 Go / host 包形态已由第三十二轮推翻，保留作历史记录。
> 它所设立的 FR-21 If 分支随 `--judge` 一并删除。）

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

> （本追注依据的两产物发布线已由第三十二轮推翻，保留作历史记录。）

§4「已发布的 `@ryan-alexander-zhang/persimmon` 要 `npm deprecate`」前提不实：
`npm view` 返回 404，该包从未发布过（`design-00003` §10 的包名是设计值，
`plan-00027` 未走到 publish）。因此没有旧包可弃用，host 包以新名首发即可；
首个 tag 取 `v0.2.0`——续本仓库 `package.json` 的 `0.1.0`，本仓库尚无任何 tag，
ainpt 自己的 `v0.3.2` 序列随其归档终止。

## 第三十二轮追注（2026-09-09）：语言与分发形态回退

本轮推翻了 2026-09-08 决定表里的第 1、2、3、4、6 条，改写了第 7 条 ⑤ 的调用
机制（现 §2 第 8 条），存续第 5、7、8 条（现 §2 第 7 条 ②③④）。原裁定与
其理由如下，保留以说明为什么曾经选 Go：

> 1. 本仓库新增 `cli/`（独立 `go.mod`，Go 1.24，仅标准库），ainpt 的 `main.go`
>    与 `internal/scaffold/` 迁入，逻辑不改，只改 import 路径与命令名字串。
> 2. Go 二进制命名 `persimmon`，承担全部命令行入口。
> 3. npm 包改名 `@ryan-alexander-zhang/persimmon-host`，bin 改 `persimmon-host`，
>    只剩监听端口与 `--judge` 查询模式；`persimmon` 以
>    `npx -y @…/persimmon-host@<编译期钉死的版本>` 启动它。
> 4. 一个 tag 触发一条 workflow，先 `npm publish` 再 goreleaser 出六个平台的
>    Go 产物；`install.sh` 迁入本仓库。
> 6. 注册表文件契约从此有两份实现（Go 直接读写文件，TS 走 Host API），
>    契约来源仍是 `design-00003` §2，靠两侧测试引用同一组需求项防漂移。

**推翻的触发**：域主于 2026-09-09 决定暂不发布任何产物。

**推翻的理由**：

1. Go 的净收益只有一项——单文件二进制、`curl | sh` 安装、目标机器不需要
   Node。暂不发布把这一项整个抽走。
2. 即使发布，这一项也只成立一半。Go 二进制打开白板必须走 `npx`
   （`cli/internal/hostproc/hostproc.go:339`），必须有 Node。「不需要 Node」
   只在「无 Node 的机器上跑 `new`」这一种场景里成立，而 `new` 产出的项目
   正是为了在白板里看。§3 当年否决 TypeScript 移植时写的「`new` 被 Node
   挡住」，在事实层面不成立：`new` 之后的每一步都被 Node 挡住。
3. 成本是实测的。`cli/` 共 6394 行（6343 行 Go，其中测试约 4400 行）：
   `internal/hostproc/hostproc.go` 410 行完全是为跨语言启动、探活、信号
   转发与 `--judge` 握手而存在；`internal/registry/registry.go` 270 行与
   `src/workspaceRegistry.ts` 229 行是同一份文件契约的两份实现——原第 6 条
   自己承认了这一点，并把防漂移的责任推给文档；`list` 的 `available` 与
   `invalidConfig` 两态 Go 侧算不出（`cli/main.go:492` 的 `judgeLocally`
   只给三种否定态），要起子进程绕一圈，取不到就降级。**Go 版的 `list`
   比 Node 版更慢，且会降级。**
4. 附带成本同样只服务于分发：包改名、编译期钉死版本的配对、一个 tag 两个
   产物的发布顺序、`install.sh` 的校验和策略，以及 `record-00035` 中 16 行
   「待人工实测」——其中 15 行只有真发布之后才可能验证。

**关于「域主明确要 Go」**：这是 2026-09-08 §3 否决 TypeScript 的第二半理由，
不受上述事实论证影响。它由域主本人于 2026-09-09 撤销（「所以应该去掉，
把这功能加到当前的 js 项目中对吗？」），并指示记录后开工。起草者不曾、
也不能仅凭「暂不发布」推翻一条域主指令。

**文档 id 未改**：`unified-go-cli` 这个 slug 保留，因为约 70 处仓内引用以
`decision-00020` 为权威（其中多数引的是存续裁定）。slug 是标识符，不是断言。
