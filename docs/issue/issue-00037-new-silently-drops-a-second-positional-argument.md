---
id: issue-00037-new-silently-drops-a-second-positional-argument
type: issue
status: resolved
blocks: [plan-00033-persimmon-command]
---

# Issue: `persimmon new demo extra` 静默丢掉第二个位置参数

> `cmdNew` 为了让旗标能写在 `<name>` 前后而做了两趟 `flag` 解析，第二趟的剩余
> 参数没人看。`persimmon new demo extra` 建出 `demo`、当 `extra` 不存在；
> 用户想说的第二件事被沉默地吃掉，而命令以 0 退出。

## 1. Problem

- Observed: `cli/main.go:102`-`109`——第一趟 `fs.Parse(args)` 停在第一个位置
  参数，取 `rest[0]` 为 `<name>`，第二趟 `fs.Parse(rest[1:])` 解析 `<name>`
  之后的旗标。第二趟同样停在第一个位置参数上，而其后的 `fs.Args()` 从未被检查:
  `new demo extra` 建出 `./demo` 并以 0 退出，`extra` 无声无息；
  `new demo extra --lang go` 更糟——`--lang go` 落在 `extra` 之后，第二趟在
  `extra` 处停下，`--lang` 也一起被丢掉，建出的是基础模板而不是 go 模板。
- Expected: `spec-00013-FR-4` 要求参数不合式的四种（含「给了第二个位置参数」）
  都说明是哪一种并以非 0 退出，不取模板、不建立任何目录、不读写注册表；
  `spec-00013-AC-4.4` 要求命令说明只接受一个 `<name>`、打印用法并以非 0 退出，
  两个目录都未建立。
- Trigger: `persimmon new` 后跟两个及以上位置参数——最常见的是名字里有空格
  （`persimmon new my project`）或漏了 `--set`（`persimmon new demo
  MODULE=x`）。

## 2. Impact

- Affected: 每个多敲了一个位置参数的用户。两种后果：多余的参数被吃掉（建出的
  项目名不是用户想的那个），或**其后的旗标一并被吃掉**（`--lang` / `--dir` /
  `--set` 失效，建出一个配置不对的项目）。第二种会真的落地一个错的项目目录。
- Since: 迁入提交 `93bb290`（plan-00033 T1，自 ainpt 逐字复制）；机制本身
  pre-dates 本仓库。 · Still occurring: yes
- Severity: 中。它建出**看起来成功、内容不对**的项目，且以 0 退出——`new` 的
  产物是一整棵目录树，用户发现时通常已经在里面工作了。

## 3. Root Cause (first principles)

1. 分歧：第二个位置参数应被拒，实际被丢弃。
2. 最小机制：标准库 `flag` 在第一个非旗标参数处停止解析，`cmdNew` 因此解析
   两趟（`main.go:100`-`101` 的注释写明了这个用意）。第一趟的剩余
   （`rest`）被读了一次（`rest[0]` 作 `<name>`），**第二趟的剩余
   （`fs.Parse(rest[1:])` 之后的 `fs.Args()`）没有任何读取点**。
3. 真正的根因：**两趟解析只消费了第一趟的剩余，把第二趟的剩余当作不存在**。
   两趟解析本身是正确的手法（`design-00004` §2 就是这么定的），错的是它少了
   一次收尾断言：「解析完之后不该再剩下任何位置参数」。
   它**不是**：`flag` 的行为有问题（停在第一个位置参数是它的规格）；不是
   `<name>` 取法不对（`rest[0]` 是对的）；也不是缺少一个「多参数」形态的
   功能——`new` 只接受一个名字（`spec-00013-FR-1`）。

- Introduced by: `93bb290`（本仓库首次持有这份代码）。此前本仓库没有 `new`，
  缺陷不可能发生。ainpt 侧自两趟解析写下起就有。

## 4. Scope (same-cause sweep)

机制是「`flag` 解析后的剩余位置参数未被断言」：

| Site | Same pattern | Affected | Action |
| --- | --- | --- | --- |
| `cli/main.go:109`（`cmdNew` 第二趟的 `fs.Args()`） | yes | yes | fixed here |
| `cli/main.go:135`（`cmdUpdate` 的 `fs.Parse(args)`，剩余未检查） | 部分 | no | 同为「剩余未断言」，但不是本条的根因（那里只有一趟解析，没有第二趟的剩余可丢）；`persimmon update extra` 今天同样静默忽略 `extra`。`spec-00013` 的 `FR-11` / `FR-4` 都不覆盖 `update` 的多余位置参数，故本 issue **不改它**，在此记下待 plan-00033 的 T2b 按 `AGENTS.md` §8 判定是否另立一份 issue |
| `cli/main.go:37`（顶层子命令派发） | no | no | 顶层不用 `flag`，未知子命令已在 `default` 分支被拒并以非 0 退出 |

## 5. Reproduction (test-first)

- 失败测试：`cli/main_test.go::TestNewRejectsASecondPositionalArgument`
  ——在一个临时目录里（`t.Chdir`）调 `cmdNew([]string{"demo", "extra"})`，
  断言返回错误、错误文字点名多余的 `"extra"` 并带上该子命令的用法，且该目录
  下没有建出任何条目。
- 修复前该测试红：`cmdNew` 不返回错误，而是带着 `Name: "demo"` 走进
  `scaffold.Run`（去打模板仓库的网络），临时目录里出现 `demo`。

## 6. Fix

- Change: 第二趟解析之后断言剩余为空——`if extra := fs.Args(); len(extra) > 0`
  即返回错误，文字点名第一个多余参数并附上 `new` 的用法行。为使这一判定可测，
  `cmdNew` 同时改为 `cmdNew(args []string) error`：原先直接
  `fmt.Fprintln(os.Stderr, …)` + `os.Exit(1)` 的三处改为返回错误，由 `main`
  统一打印并以非 0 退出，**输出文字与退出码一字不变**；`new` 的用法行提为
  常量 `newUsage`，缺 `<name>` 与多余参数两处共用它。
- Why this addresses the root cause and not the symptom: 断言加在「解析结束」
  这一点上，故对任意旗标/位置参数的排列都成立——`new demo extra`、
  `new demo extra --lang go`、`new --lang go demo extra` 三种都在同一处被拒，
  而不是为某一种排列打补丁。
- Alternatives rejected: 改用一趟解析并要求旗标必须在 `<name>` 之前——
  `spec-00013-AC-1.8` 明确要求旗标写在位置参数前后结果相同；把第二个位置参数
  解释成别的东西（如第二个项目）——`new` 的规格是一个名字。

## 7. Verification

已执行（`cli/`，修复已施加）：

1. **§5 的失败测试，红→绿**：修复前 `TestNewRejectsASecondPositionalArgument`
   报 `cmdNew error = <nil>, want it to name the extra argument and give the
   usage`，且测试输出里留下了缺陷的现场——`Fetching
   ryan-alexander-zhang/ai-native-project-template@main ...` / `post-create: git
   init -q` / `Created demo`：命令真的去打了网络、真的在临时目录里建出了
   `demo`，`extra` 无声无息（§2 的影响由此实测）。修复后返回
   `error: new takes a single <name>, got "extra" as well` 加一行 `usage:
   persimmon new <name> …`，临时目录一个条目都没有，用例绿且**不打网络**
   （耗时自 2.37s 降到 0.00s）。
2. `go -C cli test ./...` 四个包全绿；`gofmt -l cli` 空输出；
   `go -C cli vet ./...` 无发现。
3. 覆盖率：`cli`（`package main`）语句覆盖 60.4%（同 `issue-00035` §7）。
4. `npm test` 73 个文件 / 2100 个用例全过、`npm run typecheck` 无输出。

## 8. Follow-through

- Detection gap: 迁入时 `package main` 无测试（同 `issue-00035` / `issue-00036`），
  参数解析这一段一条断言都没有。修复后 `cmdNew` 返回错误而不是自己 `os.Exit`，
  `spec-00013-FR-4` 余下三条 AC（`AC-4.1` … `AC-4.3`）因此也可测，随
  plan-00033 的 T2b 补齐。
- Doc verdict: **code was non-conformant**——`spec-00013-FR-4` 与 `AC-4.4` 已
  写明更正后的行为；`spec-00013-AC-1.8`（旗标在位置参数前后结果相同）也是靠
  这一修才真正成立。文档不动。
- Residual state: 已经被这个缺陷建出的项目（名字被吃掉一半、或旗标失效导致取
  了错的模板）无法在事后识别——它们与正常建出的项目没有区别。用户自行删除后
  重建即可，无需迁移。

## Links

- Blocks: plan-00033-persimmon-command（T2 第 4 处缺陷）
- Related: spec-00013-persimmon-scaffold（`FR-4`、`AC-4.4`、`AC-1.8`）、
  design-00004-persimmon-cli（§2 两趟 `flag` 解析）
