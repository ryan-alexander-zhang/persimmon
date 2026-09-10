---
id: plan-00034-persimmon-single-npm-artifact
type: plan
status: open
implements: [spec-00012-FR-1, spec-00012-FR-2, spec-00012-FR-3, spec-00012-FR-4, spec-00012-FR-9, spec-00012-FR-10, spec-00012-FR-12, spec-00012-FR-13, spec-00012-FR-14, spec-00012-FR-15, spec-00013-persimmon-scaffold, spec-00011-FR-13, spec-00011-FR-14, spec-00011-FR-15, spec-00011-FR-20, spec-00011-FR-21, design-00004-persimmon-cli]
---

# Plan: 一个 npm 产物——命令回到本包的 bin，脚手架移植为 `src/scaffold.ts`，发布线整条删除

> 落地 `decision-00020` 第三十二轮的回退：`cli/` 6394 行删除，命令是本包的 bin
> （`bin/persimmon.js` 薄入口 → `src/cli.ts`），脚手架自 `scaffold.go` 移植为
> `src/scaffold.ts`，注册表与可用性判定收回一份、`--judge` 与它的子进程一并
> 消失，`.goreleaser.yaml` / `install.sh` / `release.yml` / `scripts/go-coverage.sh`
> 与 `ci.yml` 的 go job 删除，暂不发布。支持平台仅 linux 与 darwin。交付
> `spec-00012` 现行 10 条 FR（30 条 AC）、`spec-00013` 全部 17 条 FR（86 条 AC）、
> `spec-00011` 的 FR-13/14/15/20/21（22 条 AC），合计 **138 条 AC**。

## Design

Links only——设计本身在 [`design/`](../design/README.md)：

- [design-00004-persimmon-cli](../design/design-00004-persimmon-cli.md)
  （第三十二轮原地重写，节号 §1…§11 保留、内容全换，**本轮的技术权威**）——
  §1 一个包一个进程；§2 命令面九行与 `util.parseArgs`；§3 同进程监听
  （`PORT` 校验照 `resolvePort`、三态探测「非拒绝一律算被占用」、EADDRINUSE
  兜底承认已登记不回滚、分发次序）；§4 注册表与判定只有一份、`--judge` 删除；
  §5 `new` 的登记闭环；**§6 代码位置与移植面——Go→TS 机制对照表（外壳 `tar`、
  `git merge-file` 与空临时文件作祖先、手写 glob 翻译器与四条实测语义、
  `util.parseArgs` 覆盖不到的三处）、按函数计的移植清单、测试来源与等价翻译**；
  §7 包名与开发命令、`test:install` 的三格 + pty 格；§8 发布线撤除；§9 握手与
  API 的不变项；§10 仍未改写的冲突（代码与配置那一条正是本 plan 的产出）与实测
  义务；§11 Trade-offs（含 `list` 路径的动态 `import()`）。
- [design-00003-multi-workspace](../design/design-00003-multi-workspace.md) ——
  §2 注册表文件契约（本轮起只有一份实现）；§3 可用性判定次序；§5 API 契约
  （`GET /api/instance`、`GET /api/workspaces`、`POST /api/workspaces`、
  `DELETE /api/workspaces/:id`）；§8 启动握手的三态判定表与子命令段。

`decision-00020` 是本 plan 的结构来源，不进 `implements`（`plan` 的
`implements` 只收 spec / rule / design / report 与需求项 id，
[docs/README.md](../README.md) 关系规则）。引它时连内容一起写——**该文 §2 的
决定表第三十二轮被整体重写，旧表编号与新表不对应**（见该文 §2 顶上的行号
警告与文末第三十二轮追注）。

## 交付范围（`rule-00001-BR-24`）

- **`spec-00012-persimmon-command`**：`implements` 里**逐条列出十个现行条目 id**
  （`FR-1`、`FR-2`、`FR-3`、`FR-4`、`FR-9`、`FR-10`、`FR-12`、`FR-13`、`FR-14`、
  `FR-15`），共 30 条 AC。**不写整份文档 id**：BR-24 对整份 id 的读法是「该文档
  的全部需求条目计入范围」，而 `FR-5` … `FR-8`、`FR-11` 五条是第三十二轮的墓碑
  ——该 spec §4 开头明写它们「不计入本 spec 的需求集，也不欠验收条目」。整份 id
  会把五条不欠验收的条目送进 BR-25 的门，逐条列出是同一个交付面的准确写法。
  十六条墓碑 AC（`AC-3.2`、`AC-5.1`…`AC-8.2`、`AC-10.3`、`AC-11.1`…`AC-11.5`）
  同样不收。
- **`spec-00013-persimmon-scaffold`**：整份文档 id，17 条 FR、86 条 AC 全部在
  范围内。该 spec 第三十二轮**没有产生任何墓碑条目**（其 §1 逐字：「70 条既有
  AC 一条未删、一条未改」，另新增 16 条），整份 id 即准确的交付面。
- **`spec-00011-multi-workspace`** 的五条：`FR-13`（`AC-13.1`…`13.7`）、
  `FR-14`（`AC-14.1`…`14.3`）、`FR-15`（`AC-15.1`…`15.6`，含本轮新增的
  `AC-15.5` / `AC-15.6`）、`FR-20`（`AC-20.1`、`AC-20.2`、`AC-20.4`；
  `AC-20.3` 是墓碑，不计入该 spec 的验收集）、`FR-21`（`AC-21.1`、`AC-21.2`、
  `AC-21.5`；`AC-21.3` / `AC-21.4` 随 `--judge` 退让分支一并退出验收集）。
  这正是该 spec 第三十二轮修订段列出的全部改动面——同段末句：「FR-1 … FR-12、
  FR-16 … FR-19、FR-22 … FR-24 未动」。
- **`design-00004-persimmon-cli`**：design 类型，按 BR-24 不计入范围，列出是为
  声明所建的设计。

**`spec-00011-FR-2` / `FR-3` / `FR-6` / `FR-18` 不在范围内**，与 `plan-00033`
不同：那一轮它们进范围是因为 Go 侧写出了第二份注册表实现与第二份判定；本轮
两者都收回一份，`src/workspaceRegistry.ts`（229 行）与
`src/workspaceAvailability.ts`（100 行）**一字不改**地被 `src/cli.ts` 直接调用，
没有新实现要验。它们的既有验收（`test/workspaceRegistry.test.ts`、
`test/workspaceAvailability.test.ts`）照常绿，属 T8 的回归约束。

**编号**：本轮不预立 issue——四条已修缺陷各留一条引其 issue id 的回归测试
（`decision-00020` §2 第 4 条），不是重新立案。实施中若发现新缺陷，按
`AGENTS.md` §8 先立 `docs/issue`（issue 类型现有最大是 38，下一个取 39 号）、
先写红再改。收口的 record 取 record 类型的 36 号。

## 账面（已核实）

**删**：`cli/` 6394 行（Go 实现 1943 / Go 测试 4400 / 其余为 `go.mod` 与
`testdata`）、`test/install.test.ts` 185、`install.sh` 86、
`.github/workflows/release.yml` 59、`scripts/go-coverage.sh` 46、
`.goreleaser.yaml` 41、`ci.yml` 的 `go` job 约 25 行。

**白拿**：`git show 40a5ca5^:bin/persimmon.js` —— 221 行，含 `add` / `remove` /
`list` / 无子命令握手 / `probe()` / `call()` / `post()` / `address()` /
`projectRoot()`，其 `list` 本来就是进程内调 `AvailabilityJudge`（正是本轮要的
形态）；`src/workspaceRegistry.ts`(229)、`src/workspaceAvailability.ts`(100)、
`src/config.ts` 的 `findRepoRoot` 直接复用，不新写第二份。

**只作骨架参考**：`git show 40a5ca5^:test/cli.test.ts`（482 行）——
**不整体恢复**，它与今天的 `test/startup.test.ts` / `test/host.test.ts` 有重叠。
恢复任何一段之前先 `git show 40a5ca5 -- test/startup.test.ts test/host.test.ts`
看那一轮把哪些断言挪去了哪里，否则会造出两份判同一件事的测试。

**要写**：`src/scaffold.ts` ~600、`src/cli.ts` ~450、`bin/persimmon.js` ~30、
测试 ~1500（`scaffold_test.go` 44 个用例 + `main_test.go` **61** 个用例 +
`cli/internal/hostproc/hostproc_test.go` 25 个用例的等价翻译，再叠加三项门槛所缺
的用例）。**`main_test.go` 是 61 不是 62**：`grep -c '^func Test'` 会把 `:122` 的
`func TestMain(m *testing.M)` 数进去，那是 harness 入口不是用例；
`go -C cli test . -list '.*'` 给 61。

**测试夹具是具名交付项，不是顺手的事。** 三份 Go 测试共 40 个 helper
（`scaffold_test.go` 12、`main_test.go` 19、`hostproc_test.go` 9；后两份各有一个
自己的 `hostStub` 与 `freePort`，同名不同物）。夹具译错的错法是让测试**通过**而
不是失败——这是本轮最大的静默误译面，故 T1 / T2a / T2b / T3 各带一条逐个点名
helper 的夹具交付项。**已有的 `test/helpers.ts` 先用**（`freePort`、`boundPort`、
`git`、`makeRepo`、`lastCommitMessage` 已在），不写第二份。

## Tasks

**依赖与并行**：T1 与 T2a **互相独立、可并行**——T1 动 `package.json` / `bin/` /
`src/cli.ts` 与三份牵连测试，T2a 只新增 `src/scaffold.ts` 与其测试，两者不碰同
一个文件。**T2b 依赖 T2a**（见下「T2 拆为 T2a / T2b」：它 import `excluded()`，
并接上 T2a 落下的 `update` 前半段）。T3 依赖 T1（要 `src/cli.ts` 与分发器）与
T2b（要脚手架模块两半都可接）。T4、T5、T6 各依赖 T3，**三者互相独立、可并行**。
**T7 依赖 T2a … T6**——它删 `cli/`，删之前 TS 侧必须已覆盖它的全部职责；**T6 也
在它前面**，因为 `scripts/test-install.js:2` / `:13` / `:46` / `:53` 一直带着
`--judge` 与 `persimmon-host`，T6 重写之前 T7 的那条 `git grep` 到不了零。T8 收口。

```
T1 ─────────┐
            ├→ T3 ┬→ T4 ─┐
T2a → T2b ──┘     ├→ T5 ─┼→ T7 → T8
                  └→ T6 ─┘
```

**对建议形状的三处调整，及理由**：

1. **建议的 T3（取回那 221 行）并入 T1**。分开做不出绿的中间态：T1 一旦把
   `bin/host.js` 改成 `bin/persimmon.js` 并删 `--judge`，
   `test/startup.test.ts`（`:17` 的 `ENTRY`）、`test/host.test.ts:1082` 的
   `describe('the host bin')`（**三条用例全红**）与
   `test/distribution.test.ts`（`:17` 包名、`:60` 的 `--judge` 探针）同时红，
   而让它们重新绿的唯一办法是无子命令路径与 `list` 已经能跑——那正是那 221 行。
   要么并任务，要么留一个打印指针的 `bin/host.js` shim，而 shim 没有读者
   （该包名从未发布，见「风险与回滚」）。
2. **建议的 T9（牵连测试改写）随其成因分居 T1 与 T7**，不作独立任务。同一个
   理由：那几处改写是 T1 / T7 的删改直接打破的，不是可以延后的独立工作。
   `test/startup.test.ts:13`（注释）/ `:17`（`ENTRY`）、
   `test/host.test.ts:1079`（注释）/ `:1105` / `:1128` / `:1138`、
   `test/distribution.test.ts:17` / `:60` 与 `test/globalSetup.ts:8` 的注释
   在 T1；`test/install.test.ts` 整份删除在 T7（它验的是 `install.sh`）。
   **这两处行号本轮据实核过**（上一版把 `startup.test.ts` 的 `ENTRY` 写成 `:13`、
   把 `host.test.ts` 的 `describe` 写成 `:1079`，是从 `decision-00020` §5 的清单里
   照抄未核）：实测 `startup.test.ts:13` 是文档块里那句 “tested in
   `cli/internal/hostproc` (plan-00033 T4)”、
   `ENTRY` 在 `:17`；`host.test.ts:1079` 是文档块里同类的 `cli/internal/hostproc`
   一句、`describe` 在 `:1082`。**这两句注释本身也必须改写**——T7 自己的
   `git grep 'cli/'` 会命中它们，此前两处都没人负责。
3. **建议的 T10（`bin/` 逃逸口的机器检查）并入 T1**。它断言的是 T1 这一个
   任务写出的那一个文件的属性，写在别处等于隔着六个任务遥控一个已经定稿的
   文件；并入之后它从 T1 起就一直在门内挡着后续任务往 `bin/` 里塞逻辑。

**每个任务落地后全仓必须仍绿**：`npm test`、`npm run typecheck`、
`npm run test:coverage`（三个数字 ≥ 90，**不得抬阈值、不得加豁免**，
`AGENTS.md` §8 / `CODE_QUALITY.md` §6）四条退出码 0。T2a 之后 `go -C cli test
./...` 与 `gofmt -l cli` 仍须绿直到 T7 删掉它们——`cli/` 在 T7 之前还在树里，
不能让它烂在原地。

**唯一知情的红窗**：`npm run test:install` 自 T1（`--judge` 消失）起红到 T6
（脚本重写）为止。它不在 `npm test` 里、不是任何门，是分钟级网络绑定的 E2E
（`TESTING.md` 的 E2E 级）；本 plan 明记这个窗口而不是假装它不存在，T6 之前
不得把它算作证据。

**跨任务的三条约定**（写在这里，不在每个任务下重复）：

- **一律 `console.log` / `console.error`，不得 `process.stdout.write`**。Go 的
  `capture` 夹具靠给 `os.Stdout` 接一根管子，vitest 侧的对应物是
  `vi.spyOn(console, 'log')`；写成 `process.stdout.write` 夹具抓不到，测试会
  以「没有输出」的形态假绿。
- **`src/` 里不调 `process.exit`**。`src/cli.ts` 的入口是
  `run(argv): Promise<number>`（Go 侧 `run(args []string) int` 的等价物，
  `cli/main.go:133-135` 的注释即此：把退出码返回而不是拿走，才让测试观察得到）；
  `process.exit` 只出现在 `bin/persimmon.js` 那一行。这也是 90/90/90 够得着的
  前提——`process.exit` 会把 v8 覆盖率的收尾一起带走。
- **模块顶层不读环境**。`PORT`、`HOME`（注册表路径）、`package.json` 的
  `version` 三处在 `40a5ca5^:bin/persimmon.js:11-16` 是模块顶层常量；挪进
  `src/cli.ts` 时必须收进函数体，否则 vitest 里第一次 import 就把它们钉死，
  后面每个用例的临时 `HOME` 与 `PORT` 都失效。

---

- **T1 — 包形态、薄入口、握手与注册表子命令**（`spec-00011-FR-13`、`FR-14`、
  `FR-15`、`FR-21`、`FR-20` 的「本仓库是第一个 workspace」那一半；
  `spec-00012-FR-3`、`FR-4`）：
  - `package.json`：`name` → `@ryan-alexander-zhang/persimmon`、
    `bin` → `{ "persimmon": "./bin/persimmon.js" }`、`start` →
    `node bin/persimmon.js`、`description` 改回描述整体（命令 + 白板服务）、
    **补 `"license": "MIT"`**（`LICENSE` 是 MIT，字段一直缺，npm 会显示
    UNLICENSED——`decision-00020` §2 第 6 条，是发布线搭建时就该补的既有缺口）；
    `version` 保持 `0.0.0-dev`、`engines` 与 `files` 不变（`design-00004` §7）。
  - 新增 `bin/persimmon.js`（约 30 行，**删 `bin/host.js`**）：读
    `process.argv.slice(2)`、`await` 调 `lib/cli.js` 的 `run`、以其返回码
    `process.exit`。此外一行逻辑也没有。
  - 新增 `src/cli.ts`：`40a5ca5^:bin/persimmon.js` 那 221 行原样挪进来，改动
    只有五项——TS 化（类型、`import` 改为 `../src/*` 的相对源）、上列三条跨任务
    约定、`fail()` 改为「写 stderr 并返回非 0」而不是 `process.exit(1)`、
    `list` 与 `add`/`remove` 的解析暂留原样（终态在 T3），**以及下一条的 listen
    失败路径接线**。`fail()` 的前缀**用 `persimmon: `**（`40a5ca5^:bin/persimmon.js:219`
    与 `cli/main.go:213` 两侧本来都是它；今天树里的 `bin/host.js:77` 打的是
    `persimmon-host: ${message}`，随包名一并退役）。**`--judge` 模式与
    `PERSIMMON_WORKSPACE` 一并删除**：判定就在本进程里，问的人与答的人是同一个
    （`design-00004` §4）；地址由 `listening` 回调直接拼，id 与
    `server.address().port` 都在手上（同文 §3）。
  - **listen 失败路径接进 `run(): Promise<number>`——本轮唯一真正的结构改动。**
    `40a5ca5^:bin/persimmon.js:53-61` 的 EADDRINUSE 兜底坐在一个**异步事件处理器**
    里，经 `fail()` → `process.exit` 才拿到退出码。按上列跨任务约定
    （`run(argv): Promise<number>`、`src/` 里不许 `process.exit`），无子命令路径
    必须**持一个 pending promise**，由 `server.on('error')`（失败码）与收尾处理器
    （正常码）来 resolve。这不是照搬，是重写这一处控制流：
    `spec-00012-AC-3.3`（listen 失败退非 0）与 `AC-4.2` / `AC-4.3`（收尾跑完才退、
    第二次信号并入而不是抢先退出）**全都只在这处接线上挣到**，接错的错法是测试
    永远拿不到退出码或提早拿到 0。
  - **`registry.add` 保持在 `host.listen` 之前**（`40a5ca5^:bin/persimmon.js:53-61`
    的次序），EADDRINUSE 兜底**不回滚**已写入的条目。这是裁定不是疏漏：`add`
    幂等，项目确实在那儿，为一个正确的条目写一段只在竞态里跑的删除代码不值得
    （`design-00004` §3、`spec-00011-FR-15` 第三十二轮的据实改正）。
    `AC-15.5` 盯着它。
  - **探测三态照「非拒绝一律算被占用」**：只有 `error.cause?.code ===
    'ECONNREFUSED'` 判 `free`，超时、`ECONNRESET`、非 200、答的 `app` 不是
    `persimmon` 一律 `occupied`（`40a5ca5^:bin/persimmon.js:142-148`）。
    `design-00003` §8 的三态即此，**不是**「拒绝 / 连上 / 出错」的三分。
  - **`list` 路径不求值服务端模块图**：`Host` 的引入放在无子命令启动路径里的
    动态 `import()`（`design-00004` §11）。承载它的是**一条断言模块图未被求值的
    测试**——断的是这个事实，不是一个计时阈值（`spec-00012` §7 的裁定）。
  - **`bin/` 逃逸口的机器检查**（`spec-00012` §7：「`bin/` 里不得有『读
    `process.argv`、调 `lib/cli.js`、以其返回码退出』之外的逻辑」）：
    `vitest.config.ts` 的覆盖率 `include` 是 `src/**/*.ts`，`bin/` 在门外，
    这条今天是君子协定。落成一条测试——读 `bin/persimmon.js`，断言
    ①非空非注释行数不超过一个定值（取 15，比实际略宽），②文件里的
    `import` / `require` 恰一处且指向 `../lib/cli.js`。不是注释、不是 review
    清单，是一条会红的断言。
  - **牵连测试改写**（T1 的删改直接打破的五处，**行号本轮逐个核过**）：
    - `test/startup.test.ts`：`:17` 的 `ENTRY` → `bin/persimmon.js`（**不是 `:13`**）；
      `:13` 是文档块里 “tested in `cli/internal/hostproc` (plan-00033 T4)”
      那一句，**同样必须改写**——那个包
      在 T7 消失，且 T7 的 `git grep 'cli/'` 会命中它。两个用例都仍成立且各换了
      归属——「reports a port it cannot have」现在采 `spec-00012-AC-3.3` 与
      `spec-00011-AC-15.5`（本仓库根有 `whiteboard.config.yaml`，无子命令路径会先把
      它登记进临时 `HOME` 的注册表，再在 `listen` 上失败，**条目仍在**正是
      `AC-15.5` 断言的），「handles SIGTERM itself」采 `spec-00012-AC-4.2`。
    - `test/host.test.ts:1082` 的 `describe('the host bin')` 有**三**条用例，
      **三条都要动**：
      - `:1105` `it('prints the registry judged as JSON with --judge, without
        listening')` —— **整体退役**（查询模式不存在了，它的断言由 `list` 的
        进程内路径在 `test/cli.test.ts` 承接）。
      - `:1128` `it('reports the address with the workspace the command handed
        it')` —— 改为断言命令自己拼出 `/w/<id>`（`spec-00011-AC-13.1`）；
        `PERSIMMON_WORKSPACE` 随之删除。
      - `:1138` `it('reports the entry point when it was handed no workspace')`
        —— **此前没被点名，而它会红**：它不带 `PERSIMMON_WORKSPACE` 起 bin、期望
        `persimmon: http://localhost:<p>/`，而 T1 之后 cwd 是仓库根、仓库根
        **确实有** `whiteboard.config.yaml`，新握手会把仓库根登记并打印
        `/w/<id>`。它的 AC 是 `spec-00011-AC-13.4`（「注册表为空，当前目录不在
        任何项目内」），已在 T1 范围内，所以这是任务文本的缺口不是范围缺口。
        改法：**必须从一个不是项目的 cwd 里跑**（`spawn` 的 `cwd` 给一个临时
        目录），Given 才与 `AC-13.4` 相符。
      - `:1079` 的文档块里 `cli/internal/hostproc` 一句同样据实改写（与
        `startup.test.ts:13` 同因）。
    - `test/distribution.test.ts:17` 的 `PACKAGE` 随包名改；`:60` 以 `--judge`
      作探针改为在一个空 `HOME` 下跑 `persimmon list`（同样是「答完就退、不监听」
      的形态，正是这份测试要的：验的是 `node_modules` 下的布局跑不跑，
      不是服务，`issue-00029`）。
    - `test/globalSetup.ts:8` 的注释里 `bin/host.js` 据实改。
  - **测试来源：`cli/internal/hostproc/hostproc_test.go`**（`go -C cli test
    ./internal/hostproc -list '.*'` 给 **25** 个用例；`grep -c '^func Test'` 会
    多数出 `:746` 的 `TestMain`）。**这 27 条 AC 的 Go 原件正在这里**，先等价
    翻译再叠加，与 T2a / T2b 对 `scaffold_test.go` 的做法一致。逐用例判据：
    - **译（带 AC 溯源）**——`TestProbeReadsWhoHoldsThePort`:185 与
      `TestProbeReadsASilentHolderAsOccupied`:240（三态探测，
      `spec-00011-AC-15.1` / `AC-15.2`）、`TestJoinsTheProcessOnThePort`:266
      （`AC-14.1`）、`TestJoinsOutsideEveryProject`:288（`AC-14.3`）、
      `TestRefusesAPortItCannotHave`:308（`spec-00012-AC-3.3`）、
      `TestReportsARegistrationTheProcessRefused`:352（`AC-15.3`）、
      `TestReportsARegistrationTheFileRefused`:412（`AC-15.6`）、
      `TestForwardsSIGINTAndDoesNotExitFirst`:694 /
      `TestForwardsSIGTERM`:726 / `TestTheJoinPathIsTakenDownByTheSignal`:769
      （`spec-00012-AC-4.1` / `AC-4.2` / `AC-4.4`）、
      `TestWorkspacesReadsTheListingTheProcessHolds`:842 与
      `TestDeleteDropsTheEntryThroughTheProcess`:886（`list` / `remove` 的
      有进程那一支）。
    - **译（无独立 AC，守同一条路径的报错形态）**——
      `TestPostReportsAConnectionItCannotMake`:402、
      `TestWorkspacesReportsWhatTheProcessRefused`:861、
      `TestDeleteReportsWhatTheProcessRefused`:904。
    - **不译，机制消失但断言换载体**——`TestLaunchesTheHostForTheProjectTheCwdIsIn`:440
      与 `TestLaunchesWithNoWorkspaceOutsideEveryProject`:471：子进程拉起没有了，
      它们断的那两条地址线由本任务的 `spec-00011-AC-13.1` / `AC-13.4` 用例承接
      （后者正是 `test/host.test.ts:1138` 要改的那条）。
    - **不译，整体退役**——`TestPassesTheHostsStderrThrough`:490、
      `TestExitsWithTheHostsCode`:512、`TestPassesStdinThrough`:533、
      `TestTakesThePublishedHostPackage`:553、`TestRefusesToGuessAVersion`:571、
      `TestReportsAMissingNode`:592（都只在「命令拉起另一个包的子进程」这个
      形态里有意义）；`TestJudgeReadsTheHostPackagesQueryMode`:920 与
      `TestJudgeReportsAJudgementItCouldNotGet`:945（`--judge` 删除）。
  - **夹具交付项（具名，逐个点名）**：`hostproc_test.go` 的
    `newStub`:136（冒充已运行进程的 HTTP stub，含 `GET /api/instance` /
    `GET|POST /api/workspaces` / `DELETE /api/workspaces/:id` 四个 handler）、
    `created`:166（`POST` 的 201 应答体）、`projectDir`:92（带
    `whiteboard.config.yaml` 的临时项目）、`noRegistry`:176（不可读的注册表
    文件）、`setup`:111（`Options` + 两个 buffer + 临时 `HOME`）各要一个 vitest
    等价物；`main_test.go` 的 `newHarness`:576、`newFakeHost`:646、
    `strangerOn`:696（占住端口的陌生监听）、`portOf`:705、`projectAt`:619、
    `printed`:988（`vi.spyOn(console, 'log')`，见跨任务约定第一条）、
    `gitRepo`:1046、`mustGetwd`:1165 同。**`freePort`:75 / `tempDir` 不新写**——
    `test/helpers.ts` 的 `freePort` / `boundPort` 已在。**不译的夹具**：
    `hostStub`:54、`npxShim`:65、`requireNode`:46（子进程与 `npx` 形态随
    `--judge` 一并消失）。夹具译错的错法是让测试**通过**，故这一条与实现同为
    交付项，不是顺手的事。
  - 新增 `test/cli.test.ts`：本任务的 27 条 AC。`add` / `remove` / `list` 的
    三条路径（有进程经 API、端口被陌生进程占用、无进程直写文件）以本地
    HTTP stub 冒充已运行进程；`spec-00011-AC-13.1` … `AC-13.3`、`AC-13.5`、
    `AC-13.7` 的 Then 有「页面呈现 X」那一半，那一半是 UI / 服务端的、本轮
    一字未改，命令侧证的是登记与地址，页面侧以既有的通过测试为证据（沿
    `plan-00033` T10 对切换器侧 AC 的同一读法）。
  - **本任务讨到的 AC（27 条）**：`spec-00011-AC-13.1` … `AC-13.7`、
    `AC-14.1` … `AC-14.3`、`AC-15.1` … `AC-15.6`、`AC-20.4`、`AC-21.1`、
    `AC-21.2`、`AC-21.5`；`spec-00012-AC-3.1`、`AC-3.3`、`AC-3.4`、
    `AC-4.1` … `AC-4.4`。
  - **本任务尚不是终态**：`version` / `help` / 未知子命令的话术与退出码、
    `PORT` 校验、`parseArgs`、分发次序都在 T3；`list extra` 此时仍按迁入前
    被静默吞掉（`AC-12.4` 在 T3 才成立）。本任务说的「原样挪进来」是指那 221
    行的行为，不是命令面的终态。
  - verify：`npm test`、`npm run typecheck`、`npm run test:coverage`、
    `npm run build` 后 `node bin/persimmon.js` 在本仓库内走通完整握手并起板；
    `npm start` 同（**它的可观察行为本轮改变**：此前只起服务、不写注册表，
    现在走完整握手、会把 cwd 所在项目登记进 `~/.persimmon/workspaces.json`，
    端口被陌生进程占用时报「port N is already in use」exit 1，
    `design-00004` §7 末条点名了这一处）。

**T2 拆为 T2a / T2b（编排者裁定）。** 原 T2 一个人占 138 条里的 53 条、约 600 行
实现、约 1500 行测试的大头、`spec-00013` 17 条 FR 里的 10 条、12 个夹具。对照
[docs/plan/README.md](README.md) 的「keep tasks cohesive and low dependency」，
它是本 plan 里唯一过线的任务。按本 plan 自己的函数清单拆成两个，**不新增依赖边**
（T2b 依赖 T2a 一条，方向单一）。收益是「风险一」列的**两处会静默失败的翻译
（glob 与三方合并）从此坐在不同任务、各有各的门**，而不是挤在一个 53 条 AC 的
大块里。

**划分判据（机械的，一句话）**：一条 AC 的 Then 由 `mergeTree` / `mergeSymlink`
决定的归 T2b，其余归 T2a。**T2a 不只是 `new`**——`update` 的前半段（创建标记读取
与坐标校验、`ref` / SHA 解析、「已是最新」短路、`tar` 前置）不经合并，也在 T2a。

**编号不顺延**：T3 … T8 保留原编号。本 plan 正文里有十几处「终态在 T3」「登记那
一半在 T5」「T7 依赖…」的交叉引用，顺延只会把它们全部作废，换不来任何东西。

- **T2a — `src/scaffold.ts` 的 `new` 侧与 `update` 的前半段**
  （`spec-00013-FR-2`、`FR-3`、`FR-5`、`FR-9`、`FR-11`、`FR-15` … `FR-17`）。
  **与 T1 并行**。按 `design-00004` §6 的按函数移植清单：`resolveRef` / `fetch` /
  `loadManifest` / `resolveVars` / `excluded`（含手写 glob 翻译器）/ `copyTree` /
  `substitute` / `runSteps` / `writeLock` / `resolveSHA`。`new` 的语义、
  `.ainpt.json` 的内容与文件名一律不变。本任务**不含命令层**（旗标解析与
  `cmdNew` / `cmdUpdate` 在 T3），落地时它是一个还没有调用者的模块。
  - **解归档**：`fetch()` 取 codeload tarball，响应体管进外壳
    `tar -xzf - --strip-components=1 -C <tmp>`（**实现期改为** `node:zlib` 进程内 `gunzipSync` 后 `tar -xf -`——首次 linux CI 暴露 GNU tar 的 `-z` 要 exec `gzip`，见 `issue-00041`）。`--strip-components=1` 做的正是
    Go 的 `stripFirst` 那件事，**那个函数连同它自己一起删**；目录、普通文件、
    符号链接与权限位都由 tar 落地，不写第二份解包实现、不新增依赖。
    **`tar` 是移植新引入的外部前置**（Go 侧用进程内的 `archive/tar` +
    `compress/gzip`），故 `FR-17` 是本轮才有的需求条目：缺 `tar` 时 `new` 一个
    文件也不落、`update` 一个文件也不改（`AC-17.1` / `AC-17.2`，后者的 Given
    要求上游提交与基准**不同**，相同则在取 tarball 之前就报「已是最新」，走不到
    解归档）。
  - **外壳 `tar` 与 Go 的读取器对「其余条目类型」不等价，且外壳一侧更严。**
    `scaffold.go:137-163` 只 switch `tar.TypeDir` / `TypeReg` / `TypeSymlink`，
    **没有 `default`**——硬链接、fifo、设备，以及 `stripFirst` 映射成 `""` 的
    条目，一律静默跳过、`fetch` 返回 nil。外壳 `tar -xzf -` 会去创建或拒绝
    它们，于是**可能在 Go 退 0 的地方退非 0**。落地时二选一，写进实测义务表：
    ①在实测里连这一类条目一起比对；②确证 codeload 出的 tarball 只含那三类
    并把它记作 codeload 的保证。**不得默认「反正只有那三类」。**
  - **glob 翻译器手写，禁用 `path.matchesGlob`**。真分歧是两处：**否定字符类**
    （Go `filepath.Match("[^A-Z]x","ax")` = `true`，Node `matchesGlob` = `false`）
    与**反斜杠转义**（Go `Match("a\\*b","a*b")` = `true`，Node = `false`）；
    `excluded` 的模式两样都在用，换过去会静默改变 `exclude` 的含义——创建时排除
    掉的东西会在 `update` 时长回来。要照搬的四条语义（`design-00004` §6 的实测
    取值，逐条有 AC）：
    - `*` / `?` 不跨 `/`（译成 `[^/]`），但**字符类不受分隔符约束**——
      `Match("[^A-Z]","/")` 与 `Match("[/]","/")` 都是 `true`，**不得**顺手把
      `/` 从用户写的字符类里剔掉（`AC-15.1`、`AC-15.2`）。
    - `!` 在类内是**字面成员**不是否定，否定符只有 `^`。JS 的 `RegExp` 与 Go
      一致（`/^[!A-Z]$/.test('A')` 为 `true`），**minimatch 不一致**——这条恰好
      排除「照 minimatch 口径写」这条路，直译成 `RegExp` 字符类反而是对的
      （`AC-15.3`）。
    - 整串锚定，`^…$`（`AC-15.4`）。
    - **`ErrBadPattern` 在调用处被吞掉**：`scaffold.go:233` 写的是
      `if ok, _ := filepath.Match(p, rel); ok`，错误丢弃；`[a-`、`[]a]`、`*[`
      三种 Go 都返回 `(false, ErrBadPattern)`，于是既不匹配也不报错。而
      `new RegExp("[a-")` 直接抛、`new RegExp("[]a]")` 不抛却把 `[]` 读成空类。
      **TS 侧遇到无法翻译或无法编译的模式一律按不匹配处理并静默跳过，不抛、
      不中止 `new` / `update`**（`FR-16`、`AC-16.1`；`update` 侧的 `AC-16.2`
      在 T2b）。
  - **`excluded()` 是两个互相独立的判定，不得合成一个 glob**
    （`scaffold.go:223-235`）：先 `TrimSuffix(ToSlash(p), "/")` 剥尾部斜杠，
    再 `rel === p || rel.startsWith(p + "/")` 走**字面串**（这一半不经任何
    glob），最后才跑 glob。**承重的实测值是这一个**：
    - `Match(".github", ".github/workflows/ci.yml")` = **`false`** ← 需要前缀
      那一半的，正是这一行；对应的 TS 侧
      `rel.startsWith(".github/")` = `true`。译成 glob-only 会让 `AC-2.1` 与
      `AC-15.6` 静默失效——它不会红，只是 `.github/` **下面的文件**漏不掉。
    - 另两行是**反证，不要拿去当等价依据**：`Match(".github/", ".github")` =
      `false`（`excluded()` 先剥尾部斜杠，`p` 已是 `.github`，这一行到不了）、
      `Match(".github", ".github")` = **`true`**（纯 glob 也能命中目录**自身**）。
      拿这两行去「验证等价」会让实现者认定剥尾斜杠是承重的、进而删掉
      `rel.startsWith(p + "/")`，恰好落进上一条的静默漏排除。
    - 反过来，把前缀那一半也当 glob 做才会出错的读法是「`p` → `p + "/**"`」；
      **不是** `doc?` 顺手当 glob——实测 `Match("doc?","docs/a.md")` 与
      `matchesGlob("docs/a.md","doc?")` **都是 `false`**，`AC-15.7` 的 Then
      也正是这么写的（「两半都不命中」）。`AC-15.6` / `AC-15.7` 分别盯这两侧。
  - **`issue-00034` 的回归测试**（引其 id）：创建标记的模板坐标须过「恰一个
    斜杠、owner 非空、repo 非空」三条件，`norepo` / `/repo` / `owner/` /
    `owner/repo/extra` 四种全拒**且在任何网络请求之前**
    （`FR-11`、`AC-11.4` … `AC-11.6`）。
  - 模板仓库以本地 HTTP server stub（一个 handler 出 tarball、一个出
    branches / commits API），**不打真网络**；`post_create` 的每一步经 `sh -c`
    执行（`sh` 是第三个外部命令，但它是模板声明步骤的执行器、不是本命令自己的
    调用，`FR-17` 的报错义务不及于它）。
  - **测试来源与做法**：`cli/internal/scaffold/scaffold_test.go` 的 44 个用例里
    **属本任务的 23 个先等价翻译**，再在其上补足 90/90/90 所缺的用例——
    `TestExcludedMatchesTheDirectoryButNotTheFileBeneathIt`:82、
    `TestCopyTreePreservesSymlinks`:344、
    `TestUpdateRejectsATemplateThatIsNotOwnerSlashRepo`:394、
    `:564` … `:821` 的十六个 `TestNew*`、
    `TestUpdateReportsAProjectAlreadyUpToDate`:946、
    `TestUpdateRefusesADirectoryWithNoCreationMarker`:1009、
    `TestUpdateRefusesACreationMarkerThatIsNotValidJSON`:1023、
    `TestUpdateRefusesACreationMarkerWithAnEmptyBase`:1038。**顺序有意义**：等价
    翻译压制的是译错风险，补测试是叠加而不是替代（`decision-00020` §4）。
    Go 侧 `CODE_QUALITY.md` §3 那条 82.8% 语句棘轮**不迁移**——移植后的代码按新
    代码对待，受 `vitest.config.ts` 的 90% 行/分支/函数三项约束。
    **glob 翻译器的期望表**取 `design-00004` §6 已列出的实测取值加
    `scaffold_test.go` 的既有用例；想要更强的保证，可趁 `cli/` 还在树里
    （T7 之前）跑一次一次性的 Go 对照脚本，那是核对手段、不留文件。
  - **夹具交付项（具名，逐个点名）**：`scaffold_test.go` 的
    `writeTree`:20、`exists`:33、`writeLink`:40、`linkTarget`:52、
    `readFile`:69、`tarball`:432（在内存里造 tarball 喂给 stub）、
    `stubGitHub`:455（branches / commits / codeload 三个 handler）、
    `capture`:499（→ `vi.spyOn(console, 'log')`，见跨任务约定第一条；写成
    `process.stdout.write` 夹具抓不到、测试会以「没有输出」的形态**假绿**）、
    `runNew`:524、`marker`:541、`readLock`:554 各要一个 vitest 等价物。
    `stubUpdateRepo`:548 在 T2b。夹具译错的错法是让测试**通过**而不是失败，
    故这一条与实现同为交付项。
  - **本任务讨到的 AC（32 条）**：`spec-00013-AC-2.1` … `AC-2.8`、
    `AC-3.1`、`AC-3.2`、`AC-5.1` … `AC-5.6`、`AC-9.9`、
    `AC-11.1` … `AC-11.6`、`AC-15.1` … `AC-15.4`、`AC-15.6`、`AC-15.7`、
    `AC-16.1`、`AC-17.1`、`AC-17.2`。
    这些 AC 的 When 写作「执行 `persimmon new demo`」，本任务以直接调用模块
    函数取证（沿 `plan-00033` T2b 的同一读法：命令层是薄的透传，那一层的
    AC 在 T3）。
  - 文件：新增 `src/scaffold.ts`、`test/scaffold.test.ts`。
  - verify：`npm test`、`npm run typecheck`、`npm run test:coverage`——
    **从覆盖率报告的逐文件表里读 `src/scaffold.ts` 的行/分支/函数三个数字，
    各 ≥ 90**（不是看全局那三个数字，见下「逐文件覆盖率的已知限度」）。

- **T2b — `src/scaffold.ts` 的三方合并**（`spec-00013-FR-3`、`FR-9`、`FR-10`、
  `FR-12`、`FR-15`、`FR-16`）。**依赖 T2a**：从 T2a import `excluded()`，并接上
  T2a 落下的 `update` 前半段。按 `design-00004` §6 的移植清单：`mergeTree` /
  `mergeSymlink`。三方合并算法一律不变。
  - **三方合并**：`spawnSync('git', ['merge-file', '-L', 'yours', '-L',
    'template (old)', '-L', 'template (new)', mine, base, theirs])` ——三个 `-L`
    与 `cli/internal/scaffold/scaffold.go:520-522` **一字不差**；退出码非 0 即
    冲突，与 Go 侧同读法。**空祖先用一个空临时文件，不用 `/dev/null`**：已实测
    两者的冲突标记输出逐字节相同、退出码同为 1，空文件把「祖先为空」表达得更
    直白，也省掉一处对特殊文件的依赖（原设计给的理由是「`/dev/null` 在 Windows
    上不存在」，Windows 已出支持范围，理由撤回、选择不变）。
  - **`update` 缺 git 保持 Go 的既有行为，不做预检**：逐文件外壳调一次
    `git merge-file`，缺失时在**第一个需要合并的文件**上失败，此前已 add 的
    上游新增文件留在项目里，**半截树不回滚、基准不推进**（`AC-12.1` …
    `AC-12.3`）。不做合并前预检——一次只新增文件或符号链接的 `update` 根本不需要
    `git`，预检会把这种本可完成的升级也拒掉（`FR-12`、`design-00004` §6）。
  - **`excluded()` 从 T2a import，不复制第二份。** `AC-15.5`（创建时被否定字符类
    排除掉的那批文件，`update` 时仍不参与合并、不被塞回项目——「两处判据同一」）
    正是这条 import 的验收：它落在本任务，是为了让 T2a 的 glob 翻译器与本任务的
    合并各有各的门，而这一条把两者的接缝也守住。`AC-16.2`（不合式模式在 `update`
    侧同样按不匹配处理、合并照常完成）同理。
  - **`TestUpdateMergesOnAMachineWithoutNode`:1090 不译**：它当年证的是「`update`
    只要 git 不要 Node」，命令自己就是 Node 程序之后这句话失去意义
    （其需求 `spec-00012-AC-7.3` 已是墓碑）。
  - **测试来源与做法**：`scaffold_test.go` 属本任务的 21 个用例里，**20 个先
    等价翻译**（第 21 个是上一条的 `:1090`，不译）——`:114` … `:364` 的九个
    `TestMergeTree*`、`TestUpdateHandlesAProjectScaffoldedBeforeTheMove`:722、
    `TestUpdateLeavesConflictMarkersAndListsTheFile`:841、
    `TestUpdateSucceedsEvenWhenItLeavesAConflict`:861、
    `TestUpdateAdvancesTheBaseAfterAConflict`:874、
    `TestUpdateAdvancesTheBaseAfterACleanMerge`:889、
    `TestUpdateLeavesTheProjectsOwnFilesAlone`:908、
    `TestUpdateMergesAnUpstreamAdditionThatTheProjectAlreadyHas`:926、
    `TestUpdateMergesTheDirectoryItWasPointedAt`:964、
    `TestUpdateHonoursAnExcludePatternTheTemplateAddedAfterCreation`:986、
    `TestUpdateFailsOnTheFirstMergeWhenGitIsMissing`:1053、
    `TestUpdateLeavesTheBaseWhereItWasWhenGitIsMissing`:1073。再在其上补足
    90/90/90 所缺的用例。82.8% 那条 Go 棘轮同样不迁移。
  - **夹具交付项（具名）**：`scaffold_test.go` 的 `stubUpdateRepo`:548
    （base / head 两棵树的上游 stub）要一个 vitest 等价物；T2a 已交付的
    `writeTree` / `writeLink` / `linkTarget` / `readFile` / `readFile` /
    `tarball` / `stubGitHub` / `capture` / `marker` / `readLock` **直接复用，
    不写第二份**。`test/helpers.ts` 的 `git` / `makeRepo` 同样先用。
  - **本任务讨到的 AC（21 条）**：`spec-00013-AC-3.3`、
    `AC-9.1` … `AC-9.8`、`AC-9.10`、`AC-10.1` … `AC-10.6`、
    `AC-12.1` … `AC-12.3`、`AC-15.5`、`AC-16.2`。
  - 文件：`src/scaffold.ts`、`test/scaffold.test.ts`。
  - verify：`npm test`、`npm run typecheck`、`npm run test:coverage`——
    **从覆盖率报告的逐文件表里读 `src/scaffold.ts` 的三个数字，各 ≥ 90**。

**逐文件覆盖率的已知限度。** `vitest.config.ts:23` 的
`thresholds: { lines: 90, branches: 90, functions: 90 }` 是**全项目**的，
**没有 `perFile`**。照现配置，一个 600 行的 `src/scaffold.ts` 停在 70% 也能靠
`src/` 下已覆盖的约 4000 行把全局门顶过去。**裁定：本轮不动全局 `perFile`**
——打开它会让本轮范围外的既有模块变红，属越界（`AGENTS.md` §3）。取而代之，
T2a / T2b / T3 的 verify 明写「从覆盖率报告的逐文件表里读该文件的三项数字」。
这是一条**人读的门**而不是机器门，是本轮的已知限度，记在这里而不是假装它是
机器保证的。

- **T3 — 解析器层与命令面终态，`new` / `update` 接上**
  （`spec-00012-FR-2`、`FR-9`、`FR-12`、`FR-13`、`FR-14`、`FR-15`；
  `spec-00013-FR-1`、`FR-4`）：
  - **参数解析用 `util.parseArgs`**（`allowPositionals: true`，`--set` 声明
    `multiple: true`，其余 `string`），不引入解析框架、**不新增任何 npm 依赖**。
    三处它覆盖不到，须自己补（均已实测，`design-00004` §6）：
    - **调它之前**把单横杠长旗标规范化为双横杠（`-lang` → `--lang`，
      `-lang=go` 同理）。`parseArgs(['-lang','go'])` 抛
      `ERR_PARSE_ARGS_UNKNOWN_OPTION`，而 Go 的 `flag` 对一横杠与两横杠一视同仁。
      **短旗标 `-v` / `-h` 不动**——它们是 `FR-1` 子命令集里的那两个，不得被
      改写成 `--v` / `--h`（`spec-00012-AC-15.2` 就是这条边界）。
      **这一条承重且上着膛**：`-v` / `-h` 一旦走到 `parseArgs` 就抛——实测
      `parseArgs({args:['-v'],options:{},allowPositionals:true})` 抛
      `ERR_PARSE_ARGS_UNKNOWN_OPTION`，于是 `persimmon -v` 会从「打印版本号」
      变成 exit 2，`spec-00012-AC-15.2` 直接失效。**救它的是下面那条分发次序，
      不是这一句**：`version` / `-v` / `--version` 与 `help` / `-h` / `--help`
      在 `parseArgs` 之前就被认掉（照 `cli/main.go:145-150`）。两条一起读才成立，
      单看任一条都会把陷阱留在膛里。
    - **调它之后**自己校验 `--set` 的 `KEY=VALUE`。`parseArgs(['--set','A'])`
      成功并把 `"A"` 收进数组。报出的那一句**含 `expected KEY=VALUE, got <该值>`
      这个片段**，该片段与迁入前逐字相同（出自 `cli/main.go:256-263` 的
      `setFlag.Set`）；外层的 `invalid value … for flag -set:` 包装与那份
      FlagSet usage dump 是 Go `flag` 包的产物，**不复现**。
    - **调它之后**自己断言「不得剩余未读的位置参数」。这是**解析器层的统一
      断言、作用于全部八个子命令**（`spec-00012-FR-12`），一处覆盖
      `issue-00037` 的 `new` 与它 §4 记下的 `cmdUpdate` 同类缺陷
      （`decision-00020` §2 第 4 条）。
  - **退出码**：用法与解析错误一律 **2**（`parseArgs` 只抛异常，须接住后照退
    2），未知子命令退 **1**。这是对迁入前分裂退出码的**有意统一**，代价点名在
    `spec-00012-FR-12`：`persimmon add --frobnicate` / `add --name` /
    `new demo extra` / `new`（缺 `<name>`）/ `remove`（缺参数）自 1 变 2，
    **`persimmon list extra` 自 0 变 2**——从被静默吞掉变为拒绝，是本 FR 唯一
    改变「能不能跑通」的一处（`AC-12.4` 盯着它）。同理
    **`persimmon add -name foo` 自「按未知旗标被拒」变为可用**（`AC-15.1`）。
    两处都是行为变更，各有一条带 AC id 的测试守着。
  - **未知子命令的判定要提到端口与注册表解析之前**（`spec-00012-FR-2` /
    `FR-14`）。迁入前 Go 的 `default` 分支落在 `newCommand()` 之后
    （`cli/main.go:153-171`），所以今天 `PORT=abc persimmon frobnicate` 报的是
    PORT 那一句；提前之后 `FR-2` 无条件成立。话术照
    `cli/main.go:168-171`：stderr 打 `unknown command "<它>"` 后跟一个空行与
    usage，exit 1。像路径的第一参同样落入本条（`AC-2.2`）。
  - **usage 的流向：错误路径写 stderr，正常出口写 stdout（编排者裁定，是一处
    行为变更）。** 迁入前 `cli/main.go:168-171` 只把 `unknown command %q\n\n`
    写 `os.Stderr`，紧跟的 `usage()`（`cli/main.go:217`）是 `fmt.Print` →
    **stdout**，于是拒绝的一半在 stderr、usage 的一半在 stdout。裁定：
    - **错误路径上的 usage 一律写 stderr**（未知子命令、解析错误、
      `newUsage` 随 `new` / `update` 的用法错误一起报出的那一份）——stdout
      要留给机器读取者。
    - **`help` / `-h` / `--help` 这条正常出口写 stdout。**
    - `newUsage`（`cli/main.go:31`）同理按错误 / 正常分流；它今天只在
      `:279` / `:284` 的错误路径上出现，故一律 stderr。
    **这是对迁入前行为的变更**（Go 在错误路径上也把 usage 打到 stdout），
    在此明写，并**留一条守着它的测试**：`persimmon frobnicate` 的 stdout 为空、
    usage 全在 stderr；`persimmon help` 的 stderr 为空、usage 全在 stdout。
  - **`PORT` 校验照 `resolvePort`**（`cli/main.go:122-131`）：空串走缺省 4173，
    `Atoi` 失败或 `< 1` 或 `> 65535` 一律拒并报一句，**不得 `listen(NaN)`、
    不得静默折回缺省**。理由写在它自己的注释里：*silently serving somewhere
    else than the user asked is worse than one sentence*。T1 挪进来的
    `Number(process.env.PORT ?? 4173)` 在本任务被它替换。
    （边界**内**取值能用——`PORT=1` / `PORT=65535` 监听得起来——归
    `spec-00011-FR-13`，那边只采了 `PORT=5000` 一格，本轮不补：补它要动
    `spec-00011`，见 Out of Scope。）
  - **分发次序**：`update` / `list-langs` / `version` / `help` 排在注册表路径
    解析与 `PORT` 解析**之前**（`cli/main.go:136-152` 的提前 switch，其注释即
    此理由）；其余入口照常在解析之后分发。上一条新加的 `PORT` 校验正是会让
    `persimmon help` 无端失败的那种前置，排序把它挡在外面
    （`AC-14.1` … `AC-14.3`）。
  - **`help` / `version`**：`help`（含 `-h` / `--help`）打印的子命令清单恰为
    `spec-00012-FR-1` 那九项、不多不少（`AC-1.2` 在 T4 才成立——`list-langs`
    到那时才真的能跑）；`version`（含 `-v` / `--version`）打印本包
    `package.json` 的 `version`（`0.0.0-dev`），取得形态不改变这个值。
  - **`new` / `update` 的命令层**：`setFlag` / `cmdNew`（登记那一半在 T5）/
    `cmdUpdate` 自 `cli/main.go` 移植；分支取法（缺省 `main`、`--lang` →
    `lang/<l>`、`--lang` + `--variant` → `lang/<l>/<v>`、`--ref` 覆盖一切）、
    `--dir`、可重复的 `--set`、`AINPT_OWNER` / `AINPT_REPO` 覆盖模板坐标
    （环境变量名保留，已在用户 shell 配置里）一律不变。`--variant` 未配
    `--lang` 虽不在解析器那一层，也属「命令认得而用法写错」，**同样退 2**
    （`spec-00012-FR-12` 末段一并纳入，`AC-4.1`）。
  - **`issue-00037` 的回归测试**（引其 id）：`persimmon new demo extra` 与
    `persimmon update extra` 各一条（`AC-4.4` / `AC-4.5`），落在解析器层的
    统一断言上。
  - **测试来源：`cli/main_test.go` 的 61 个用例**（**不是 62**——
    `grep -c '^func Test'` 会把 `:122` 的 `func TestMain(m *testing.M)` 数进去，
    那是 harness 入口不是用例；`go -C cli test . -list '.*'` 给 61）。命令层的
    Go 原件都在这一份里，T4 / T5 从同一份取自己那一段。**先等价翻译再叠加**，与
    T2a / T2b 对 `scaffold_test.go` 的做法一致。
    - **判据（正向）**：一个用例翻译，除非它的主题正是本轮**删掉的机制**——
      拉起另一个包的子进程、`--judge`、`-ldflags` 注入版本号、Go 内部
      `newCommand()` / `judgeLocally()` 的形状、或「本机没有 Node」。
    - **不得翻译，逐条点名**：
      - `TestNewWorksWithNoNodeOnThePath`:944 与
        `TestEverySubcommandRunsWithoutNode`:1701 —— 命令自己就是 Node 程序，
        「没有 Node 也能跑」失去意义。
      - `TestListRetreatsToWhatItCanSettleWithoutNode`:1220 与
        `TestListStillNamesTheUnavailabilitiesItCanSettle`:1244 ——
        `spec-00011-AC-21.3` / `AC-21.4` 是墓碑（随 `--judge` 退让分支一并退出
        验收集，见「交付范围」）。
      - `TestListWorksOnADevelopmentBuildWithNoOverride`:1263 ——
        `spec-00012-FR-8` 作废。
      - `TestVersionPrintsTheInjectedVersion`:1678 —— 版本号从 `-ldflags` 注入
        改为读本包 `package.json`；`AC-9.1` … `AC-9.3` 是它的替代，形态不同。
      - `TestNewCommandReadsTheWorldOnce`:1567 与
        `TestNewCommandReportsAWorldItCannotRead`:1591 —— 断的是 Go 内部
        `newCommand()` 的形状，TS 侧没有这个函数。
      - `TestTheThreeUnavailabilitiesTheCommandSettlesItself`:1514 ——
        Go 专有的 `judgeLocally` 三态，已被 `spec-00011-AC-21.5` 取代。
    - **夹具交付项（具名）**：`main_test.go` 的 `branchServer`:32（T4 的
      `Link: rel="next"` 分页 stub）、`stubTemplateRepo`:167、`sourced`:237、
      `newIn`:243、`newInWith`:251、`source`:275、`printed`:988 各要一个 vitest
      等价物；`runChild`:140（子进程跑命令）**不译**，`run(argv)` 直接调即可，
      `hostStub`:1015 与 `pathWithoutNode`:1031 随上面两类不译的用例一并退役。
      T1 已交付的 `newHarness` / `newFakeHost` / `strangerOn` / `portOf` /
      `projectAt` / `gitRepo` / `mustGetwd` **直接复用**。
  - **本任务讨到的 AC（32 条）**：`spec-00013-AC-1.1` … `AC-1.9`、
    `AC-4.1` … `AC-4.5`；`spec-00012-AC-2.1`、`AC-2.2`、`AC-9.1` … `AC-9.3`、
    `AC-12.1` … `AC-12.6`、`AC-13.1` … `AC-13.3`、`AC-14.1`、`AC-14.3`、
    `AC-15.1`、`AC-15.2`。`AC-9.3`（`npm pack` 后全局安装仍打印
    `package.json` 里那个值）以 `test/distribution.test.ts` 的 `node_modules`
    布局模拟取证——它已在 T1 改好，本任务只加一条 `persimmon version` 断言。
  - 文件：`src/cli.ts`、`test/cli.test.ts`、`test/distribution.test.ts`。
  - verify：`npm test`、`npm run typecheck`、`npm run test:coverage`——
    **从覆盖率报告的逐文件表里读 `src/cli.ts` 的行/分支/函数三个数字，
    各 ≥ 90**（见 T2a / T2b 之后的「逐文件覆盖率的已知限度」）。

- **T4 — `list-langs`**（`spec-00013-FR-13`、`FR-14`；`spec-00012-FR-1` 的
  子命令集封闭那一半、`spec-00012-FR-14` 的 `list-langs` 那一格）：
  `cmdLangs` / `getBranchPage` / `nextLink` 移植。
  - **API base 是注入缝**：`cmdLangs(out, api)` 取 `api` 参数、生产值是常量
    （`cli/main.go:27` 的 `githubAPI`），测试由此指向本地 server。译过去的
    `listLangs` **同样以 API base 作参数，不在函数体里读常量**——移植过来的
    测试要同一条缝（`design-00004` §6 点名把这个签名形状进移植清单）。
  - **`issue-00035` 的回归测试**（引其 id）：只有变体、没有 `lang/<l>` 基础
    分支的语言仍成组列出，但**不印那条不存在的 `--lang <l>` 行**，改在组头
    标注（`AC-13.3`）。
  - **`issue-00036` 的回归测试**（引其 id）：跟随 `Link: rel="next"` 取完所有
    分支，不因某一页的条数上限而截断（`AC-13.4`）。
  - **不做速率限制处理**：无 token、无退避、无重试，每页一次裸请求；撞上
    GitHub 未认证的 60 次/小时之后，403 按「HTTP 状态非 200」那一支原样呈现为
    `error: <url> returned 403 Forbidden`（`FR-14`、`AC-14.4`）。这是一个选择
    ——加 token 要谈凭据存放，加退避要谈超时上限，都不在本轮范围。
  - **`help` 的子命令清单在此定终态**：本任务之后八条子命令全部真的能跑，
    `spec-00012-AC-1.2`（清单恰为 `FR-1` 那些、既没有 `up` / `down` 也没有
    `config`）与 `AC-1.1`（`list-langs` 不经另一个二进制、也不经另一个包执行）
    在此成立。
  - **本任务讨到的 AC（11 条）**：`spec-00013-AC-13.1` … `AC-13.4`、
    `AC-14.1` … `AC-14.4`；`spec-00012-AC-1.1`、`AC-1.2`、`AC-14.2`
    （用户目录不可读时 `list-langs` 照常列出——它从不读注册表，属分发次序）。
  - 文件：`src/cli.ts`、`test/cli.test.ts`。
  - verify：`npm test`、`npm run test:coverage`。

- **T5 — `new` 的登记闭环**（`spec-00013-FR-6`、`FR-7`、`FR-8`）：按
  `design-00004` §5——脚手架成功后取 `<dir>/<name>` 的 realpath，走与 `add`
  **完全相同**的登记路径（有进程经 `POST /api/workspaces`，无进程直写文件），
  末行向 **stdout** 打印已登记的条目 id 与「在项目内执行 `persimmon` 打开」
  的提示（`cli/main.go:316` 的字面，**没有** `persimmon: ` 前缀）。
  - **`new` 遇端口被陌生进程占用时不失败，直接写文件**（`FR-7`）——项目已经
    建好，不该因为一个无关进程占了端口而少登记一步。这与 `spec-00011-FR-15`
    对启动路径与 `add` 的「报端口被占用、非 0 退出」是**有意的不同**。
  - 脚手架失败不登记；登记失败**不回滚**已建好的项目，只报注册表侧的原因并以
    非 0 退出、不改写注册表文件（`FR-8`）。**登记没有关闭途径**：
    `--no-register` 一类旗标按未知旗标被拒（`AC-6.5`）。
  - **本任务讨到的 AC（11 条）**：`spec-00013-AC-6.1` … `AC-6.5`、`AC-7.1`、
    `AC-7.2`、`AC-8.1` … `AC-8.4`。
  - 文件：`src/cli.ts`（`cmdNew` 尾部与 `register`）、`test/cli.test.ts`。
  - verify：`npm test`、`npm run test:coverage`。

- **T6 — `scripts/test-install.js` 重写为三格 + pty 格**
  （`spec-00011-FR-20` 的安装形态那一半；`spec-00012-FR-10`）。按
  `design-00004` §7：**重写而不是删除**——该脚本从来只需要 `npm pack` 的本地
  tarball，不需要真发布（其文件头注即此）；今天坏的只有 `--judge` 那一格。
  - **三格 + 一格**，都对**同一个** `npm pack` tarball：
    1. **`npm link`**：`npm ci && npm run build && npm link` 之后在任意目录跑
       `persimmon version`（`spec-00012-AC-10.1` 在此取数——发布之前这就是取得
       它的方式）。
    2. **`npx` 形态**：`npx --yes --package <tarball> -- persimmon list`。
    3. **全局安装形态**：装同一个 tarball 后 `persimmon list`。
       第 2、3 格的输出**逐字比对**（`spec-00011-AC-20.2` 与
       `spec-00012-AC-10.2` 在此取数）。
    4. **pty 格保留**：以不跑安装脚本的缓存安装形态取得后**实起一个 pty**
       （`spec-00011-AC-20.3` 留在该 spec 验收集之外的那条实测义务与
       `issue-00030` 的读数在此产生）。既有脚本里 `--allow-scripts` 那段
       npm ≥ 11.17 的说明与 `spawn-helper` 权限位的取数一并保留，只把探针
       从 `persimmon-host --judge` 换掉。
  - 一并保留既有的「装出来的东西不带源码」检查（tarball 里不得有 `.ts` 或
    `package/src/`）——它与包名无关，改的只有 `PACKAGE` 常量。
  - **仍不进 `npm test`**：网络绑定的分钟级 E2E（`TESTING.md` 的 E2E 级；
    tarball 是本地的，但它的依赖来自 registry，干净 `HOME` 即冷缓存，
    `--offline` 是 ENOTCACHED）。**本任务落地即把 T1 起的红窗关掉。**
  - **本任务讨到的 AC（4 条）**：`spec-00011-AC-20.1`、`AC-20.2`；
    `spec-00012-AC-10.1`、`AC-10.2`。
  - 文件：`scripts/test-install.js`。
  - verify：`npm run test:install` 退出码 0（跑一次，见「实测义务」一节的
    分工）；`npm test` 不受影响。

- **T7 — 删 `cli/` 与整条发布线**（无新 AC；交付的是
  `design-00004` §8 与 §10 的「代码与配置」清单）。**依赖 T2a … T6**——删之前
  TS 侧必须已覆盖它的全部职责，**且 T6 必须先落地**：
  `scripts/test-install.js:2` / `:13`（注释）与 `:46` / `:53`（`--judge` 那一格
  与 `persimmon-host` 的 `lib/pty.js` 路径）在 T6 重写之前一直带着这两个串，
  下面那条 `git grep` 到不了零。
  - **删除**：`cli/` 整个目录（`main.go`、`internal/scaffold`、
    `internal/registry`、`internal/hostproc`、`internal/project`、其测试与
    `testdata`、独立 `go.mod`，6394 行）；`.goreleaser.yaml`(41)、
    `install.sh`(86)、`.github/workflows/release.yml`(59)、
    `scripts/go-coverage.sh`(46)、`test/install.test.ts`(185，六个用例随
    `install.sh` 一并没有对象)。
  - `.github/workflows/ci.yml`：去掉 `go` job（约 25 行，含 `gofmt` /
    `go vet` / `go test` / `sh scripts/go-coverage.sh` 四步）与文件头注里
    「两半」的说法；`node` job 不动。
  - **`.gitignore` 两段**，别以为扫一遍就干净（**行号本轮据实核过，上一版两段
    各差一行**）：
    - `:304-310` 的 `# Go (cli/)` 段——段头注 `:304`、两行说明 `:305-306`、
      `/cli/persimmon`:307、`/cli/cli`:308、goreleaser 说明 `:309`、
      `build/`:**310**。上一版写 `:304-309` 却把 `build/` 列进该段，而
      `build/` 落在 `:309` 之外。整段删。
    - `:45-46` **与** `:51-53` 落在该段之外的 Go 专有条目——
      `*.coverprofile`:45、`profile.cov`:46、`# Go workspace file`:**51**、
      `go.work`:**52**、`go.work.sum`:**53**。上一版写 `:45-52`，把
      `go.work.sum` 漏在范围外。
    - **`:51` 的 `# Go workspace file` 必须一起删。** 它是 Go 专有的、上一版
      既没删也没豁免；只删 `:52-53` 会把它留成一个**无头注释**。上一版仔细
      豁免了 `:48-49`（`# Dependency directories` / `# vendor/`）却漏了它。
    **裁定**：删这五行 Go 专有的（`:45`、`:46`、`:51`、`:52`、`:53`）加上
    `:304-310` 整段；`*.out`:43 与 `coverage.*`:44（通用）与
    `# Dependency directories`:48 / `# vendor/`:49 两行注释（GitHub Go 模板的
    残留、零风险、不属本轮请求）留着不动，按 `AGENTS.md` §3「不改邻近代码」。
  - `package.json` 的 `test:install` 脚本名保留（T6 已重写其内容）。
  - verify：`npm test`、`npm run typecheck`、`npm run test:coverage`、
    `npm run build`；`ls cli` 报不存在；**下面这一条命令输出为空**——
    照上一版的写法（只豁免 `docs/`）它到不了零，实跑有两处落在豁免之外，
    故给出 pathspec 与逐处点名：

    ```sh
    git grep -nE 'cli/|goreleaser|install\.sh|go-coverage|persimmon-host|--judge|bin/host' \
      -- . ':!docs/' \
      | grep -v 'docs\.usebruno\.com' \
      | grep -v 'integration-00001-cli' \
      | grep -v '5527313:cli/'
    ```

    第三条豁免是 T7 落地时才出现的：T1 … T5 移植时在 `src/` 与 `test/` 留下
    11 处指向 Go 原文的**出处注释**（如 `cli/main.go:31`），plan 起草时它们尚不
    存在。裁定：保留溯源、不删，但把每处钉到 `cli/` 仍在的最后一个提交
    `5527313`（`git show 5527313:cli/main.go` 可解析），使路径不再指向一个
    不存在的文件；grep 据此多一条豁免。

    两处豁免各有其名，都不是本轮的产物：
    - **`API_TESTING.md:172`** —— Bruno 文档的第三方 URL
      `https://docs.usebruno.com/bru-cli/commandOptions`，`cli/` 是它的一部分。
      它是**根指南、不在 `docs/` 下**，所以上一版「`docs/` 除外」够不着它。
    - **`test/server.test.ts:4199` / `:4200` / `:4222`** —— 文档 id
      `integration-00001-cli`。上一版点名豁免了这个 id，但同样把豁免限定在
      `docs/` 下，而这三处在 `test/`。

- **T8 — 测试与验收收口**（无新 AC）：
  - 四条命令全绿且门不下调：`npm test`、`npm run typecheck`、
    `npm run test:coverage`（行/分支/函数三项 ≥ 90）、`npm run build`；
    加 `npm run test:install` 一次（T6 已使其可跑）。
  - 交付范围内 **138 条 AC 各有一个带 id 溯源标注的通过测试**；
    「每条 AC 恰在一个任务清单里」以逐任务清单对账：
    **T1 27 + T2a 32 + T2b 21 + T3 32 + T4 11 + T5 11 + T6 4 = 138**，
    无重无漏（原 T2 的 53 = 32 + 21）。
  - 四条 issue（`issue-00034` / `00035` / `00036` / `00037`）各有一条**逐字引其
    issue id** 的回归测试（`decision-00020` §2 第 4 条、`spec-00013` §7）。
  - 四处行为变更各有一条测试守着：`persimmon list extra` 0 → 2
    （`spec-00012-AC-12.4`）、`persimmon add -name foo` 拒绝 → 可用
    （`AC-15.1`）、`npm start` 从「只起服务」变为走完整握手并写注册表
    （`design-00004` §7 末条，读数在 T1 的 verify）、**错误路径上的 usage 自
    stdout 改到 stderr**（迁入前 `cli/main.go:217` 的 `usage()` 是 `fmt.Print`
    → stdout，连未知子命令那一支也是；裁定见 T3，测试守的是
    `persimmon frobnicate` 的 stdout 为空、`persimmon help` 的 stderr 为空）。
  - 回归约束：`spec-00001` … `spec-00011` 的既有验收照常通过
    （`spec-00012` §7、`spec-00011` §7）；`src/workspaceRegistry.ts`、
    `src/workspaceAvailability.ts`、`src/host.ts` 与 Web UI 一字未改。
  - 按 [docs/record/README.md](../record/README.md) 写 `record`
    （**36 号**，`parent` 指向本 plan，`verifies` 列尽 138 条——每行恰一个 id，
    禁止区间写法与一格多 id）。页面呈现那一半的 AC 以既有的通过测试为证据原样
    列出（T1 的说明），不重写一份实现。

## 实测义务：谁在什么时候取数，阻不阻塞 `resolved`

| 义务（`design-00004` §10 · `spec-00013` §7 · `spec-00012` §7） | 取数处 | 阻塞 `resolved`？ |
| --- | --- | --- |
| 外壳 `tar` 读标准输入 + `--strip-components=1` 在 macOS 的 bsdtar 与 Linux 的 GNU tar 上对目录、普通文件、符号链接与权限位的一致性 | **不需要人另跑真机**：T2a 的脚手架测试真的外壳调 `tar`，于是 darwin 的读数来自本机 `npm test`，linux 的读数来自 `ci.yml` 的 `node` job（ubuntu-latest）跑同一批测试 | 是（两个平台各绿一次） |
| **Go 的读取器静默丢弃的条目类型，外壳 `tar` 不等价。**`scaffold.go:137-163` 只 switch `TypeDir` / `TypeReg` / `TypeSymlink`，**没有 `default`**——硬链接、fifo、设备，以及 `stripFirst` 映射成 `""` 的条目一律静默跳过、`fetch` 返回 nil；外壳 `tar -xzf -` 会去创建或拒绝它们，**可能在 Go 退 0 的地方退非 0** | T2a，二选一并把选了哪一条写进 record：①在上一行的实测里连这一类条目一起比对；②确证 codeload 出的 tarball 只含那三类、把它记作 codeload 的保证。**不得默认「反正只有那三类」** | 是（与上一行合为一次读数） |
| `git merge-file` 以空临时文件作祖先时的输出与退出码同 Go 侧 `os.DevNull` 等价 | 已实测（冲突标记逐字节相同、退出码同为 1）；T2b 的三方合并用例在两个平台上各跑一次即为持续证据 | 是（同上一行的两次） |
| 手写 glob 翻译器与 `filepath.Match` 逐例等价（含否定字符类、`[!…]`、锚定、非法模式四条） | T2a（`update` 侧的 `AC-15.5` / `AC-16.2` 在 T2b）：`design-00004` §6 的实测取值 + `scaffold_test.go` 既有用例的等价翻译；可选的一次性 Go 对照脚本趁 T7 之前跑 | 是（`AC-15.1` … `AC-16.2` 十一条） |
| `npm pack` 出的 tarball 在 `npx` 与全局安装两种形态下输出逐字相同、`npm link` 形态可执行、且 pty 起得来 | **T6：`npm run test:install`**。不是真机步骤、不需要发布、不需要 token——只需要 npm registry 的出网与几分钟。由落地 T6 的那一方跑一次并把输出留进 record | **是**：`spec-00011-AC-20.1` / `AC-20.2` 与 `spec-00012-AC-10.1` / `AC-10.2` 只在这里取数，`spec-00012` §7 明写「这些条目在对应实测通过前不计已验证」 |
| `FR-4` 的信号收尾在真终端与无 TTY 两种情形下各一次（`spec-00012-AC-4.1` … `AC-4.4`） | 无 TTY 那一半由 T1 的测试证明（`os/exec` 与 `child_process` 都不给 pty）；真终端那一半是一次 Ctrl-C——本机开板、起一个会话、Ctrl-C、看没有孤儿进程且会话已 commit | 是（真终端那一次，一条 record 行） |
| node-pty 在 Windows 的行为 | **不再是义务**：Windows 已出支持范围（`decision-00020` §2 第 10 条） | 否 |

**没有须由人在真机上跑的步骤，也没有须由人授权的步骤。** 发布线已删，本轮
不再有 tag、`NPM_TOKEN`、真 Release、`install.sh` 的双平台安装
（`plan-00033` 那五条人工步骤随其对象一并消失）。上表右列的两处「人」
——`npm run test:install` 与一次 Ctrl-C——都是在本仓库检出里跑的开发动作，
出网与一个终端即可，不改变仓库之外的任何东西。**仍在本仓库之外、由那两个
仓库自己持有的两处**（ainpt 仓库 README 改为指向本仓库并归档；模板仓库 README
的安装说明现指向已删除的 `curl … install.sh | sh`，而发布之前没有可替代的一行
安装法）是 `design-00004` §10 明记的**交付边界**，不是本 plan 的产出、也不阻塞
本 plan 的 `resolved`。

## 风险与回滚

**一次切换，不留过渡 shim。** 本仓库不同时携带 `bin/host.js` 与
`bin/persimmon.js`，T1 直接删掉前者。那个 shim 没有读者：
`@ryan-alexander-zhang/persimmon-host` 与
`@ryan-alexander-zhang/persimmon` 都从未发布过（`npm view` 404），
`persimmon-host` 这个 bin 名今天只在本仓库的工作树里，没有既有安装需要过渡。
同理**没有 `npm deprecate` 这一步**。

**回滚**：本 plan 的产出在合并前是一条分支，退回即弃分支。合并之后要回到 Go
形态，`git revert` 即可——`cli/` 的 6394 行完整留在 git 历史里
（`decision-00020` §3 否决「保留 `cli/` 目录备将来之需」的理由正是这一条）。
不可逆的动作本轮一个也没有：不发布、不推 tag、不动仓库之外的任何东西。

**风险一：三方合并与 glob 译错，且不会红。** 这两处的错法都是「少排除一个
文件」「多留一个冲突」，测不到就悄悄过。缓解有三条：**先等价翻译 44 个 Go 用例
再叠加**（`decision-00020` §4 的裁定）；`excluded()` 两半与 glob 四条语义各自的
AC（`AC-15.1` … `AC-15.7`、`AC-16.1` / `AC-16.2`、`AC-2.1`）；以及**把 T2 拆成
T2a / T2b，让这两处坐在不同任务、各有各的门**（见「T2 拆为 T2a / T2b」）。
**风险一之二：测试夹具译错——本轮最大的静默误译面。** 40 个 Go helper 的等价物
译错时测试**通过**而不是失败。缓解是 T1 / T2a / T2b / T3 各带一条逐个点名 helper
的夹具交付项，且 `capture` → `vi.spyOn(console, 'log')` 这一条写进跨任务约定。
**风险二：`cli/` 删得太早。** 缓解是 T7 排在 T2a … T6 之后，且它的 verify 里
有一条给了 pathspec 的 `git grep` 对账。**风险三：`bin/` 成为覆盖率门的逃逸口。**
缓解是 T1 那条机器检查。**风险四：逐文件覆盖率不是全局门量的东西**——见
「逐文件覆盖率的已知限度」，本轮以人读的 verify 而不是机器门缓解。

## Detailed Acceptance Path

1. T1 落地 → verify：`npm test`、`npm run typecheck`、`npm run test:coverage`、
   `npm run build` 四条退出码 0；`node bin/persimmon.js` 在本仓库内走通完整握手
   并起板，Ctrl-C 后无孤儿进程；`bin/persimmon.js` 的那条机器检查通过；
   `ls bin` 只有 `persimmon.js`。
2. T2a 落地 → verify：**从覆盖率报告的逐文件表**里读 `src/scaffold.ts` 的三项
   ≥ 90（全局门不强制逐文件，见「逐文件覆盖率的已知限度」）；`scaffold_test.go`
   属它的 23 个用例的等价翻译全过；夹具交付项逐个点名到位；
   `go -C cli test ./...` 与 `gofmt -l cli` 仍绿（`cli/` 尚在树里）。
   T2b 落地 → 同样从逐文件表读 `src/scaffold.ts` 三项 ≥ 90；属它的 20 个用例
   （`:1090` 不译）全过；`AC-15.5` 那条守住它 import 的 `excluded()` 与 T2a
   判据同一。
3. T3 … T5 落地 → verify：八条子命令 + 无子命令路径全部可跑；
   `persimmon help` 的清单恰为 `spec-00012-FR-1` 那九项；三处退出码变更
   （`list extra`、`add --frobnicate`、`new demo extra`）各如 `FR-12` 所规定。
4. 四条 issue 的回归测试 → verify：每条**逐字引其 issue id**，四份 issue 状态
   仍为 `resolved`（本轮不改它们的状态，只在移植后守住其修复）。
5. T6 落地 → verify：`npm run test:install` 退出码 0，四格全过；T1 起的红窗
   关闭。
6. T7 落地 → verify：`cli/`、`.goreleaser.yaml`、`install.sh`、`release.yml`、
   `scripts/go-coverage.sh`、`test/install.test.ts` 均不存在；`ci.yml` 只剩
   `node` job；`.gitignore` 里没有 Go 专有条目；那条 `git grep` 命中为零。
7. 交付范围内每一条 AC 各有一个带 id 标注的通过测试 → verify：138 条按逐任务
   清单对账（27 + 32 + 21 + 32 + 11 + 11 + 4 = 138），无重无漏；实测义务表右列
   「是」的六行各有一条证据行。
8. 质量门 → verify：`npm run test:coverage` 三个数字 ≥ 90；**另从逐文件表读
   `src/scaffold.ts` 与 `src/cli.ts` 各自的三项 ≥ 90**（全局门没有 `perFile`，
   见「逐文件覆盖率的已知限度」——不动它是本轮的裁定，这一步是它的补偿）；
   **无门槛下调、无被压制的发现**（`CODE_QUALITY.md` §6）；Go 侧那条 82.8%
   棘轮未被迁移进来。
9. 回归约束 → verify：`spec-00001` … `spec-00011` 的既有验收照常通过；
   `src/workspaceRegistry.ts`、`src/workspaceAvailability.ts`、`src/host.ts`
   与 Web UI 的 diff 为空。
10. record-00036 落地并列全 138 条 → verify：resolved 门通过
    （`rule-00001-BR-25`），本 plan `open → resolved`。任一实测义务未过即写为
    缺口并**阻塞 `resolved`**。

## Out of Scope

- **`config` 子命令**（`decision-00020` §2 第 7 条 ⑥）：不实现、不进子命令集；
  日后只能加在这一个包里（同 §2 第 9 条）。
- **白板界面里的 workspace 创建**（同 §2 第 7 条 ⑥）：到来时由 Host **直接调用
  同进程的脚手架模块**（同 §2 第 8 条，第三十二轮推翻了原先的「以子进程调
  `persimmon new`」）；本 plan 不加任何 UI、不加 Host 侧的调用路径。
- **`up` / `down` 子命令**（`decision-00020` §3 否决、域主 2026-09-09 确认不做）。
- **Windows**（`decision-00020` §2 第 10 条，域主 2026-09-09 裁定）：支持矩阵
  是 linux 与 darwin，本 plan 的任何一条交付都不对 Windows 作断言，也不因它
  阻塞 `resolved`。
- **真发布**（`decision-00020` §2 第 6 条与 §3）：`version` 保持 `0.0.0-dev`，
  不推 tag、不 `npm publish`、不配 `NPM_TOKEN`、不写那条 workflow——决定只裁定
  了「不发布」，先写等于替将来做没人要求的选择（`design-00004` §8）。
- `spec-00011-FR-2` / `FR-3` / `FR-6` / `FR-18` 的实现改动：注册表与判定收回
  一份、既有模块一字不改，见「交付范围」。
- `spec-00011-FR-13` 的 `PORT` 边界**内**取值（`PORT=1` / `PORT=65535` 能用）：
  那边只采了 `PORT=5000` 一格，补它要动 `spec-00011`，本轮不动
  （`spec-00012-FR-13` 末句把它记作交付边界）。
- `list-langs` 的凭据、退避与重试（`spec-00013-FR-14`）；离线兜底与本地模板
  缓存（`spec-00013` §6、`spec-00012` §6）。
- 交互式脚手架（变量缺值一律失败，不提问、不读 TTY）；`update` 的事务性与
  `--abort` 一类的撤销（半截树不回滚，`FR-12`）。
- 脚手架逻辑或注册表的第二份实现，与任何第二种命令行实现语言
  （`decision-00020` §2 第 9 条）。
- 复杂度 / 重复 / 格式门：`CODE_QUALITY.md` §2 里这三格今天是 `(none yet)`，
  本轮不新设。
- 仓库之外的两处（ainpt 仓库 README 与归档、模板仓库 README 的安装说明）：
  `design-00004` §10 的交付边界，由那两个仓库自己的修订持有。
