---
id: issue-00027-a-directory-symlink-crashes-the-text-merge-guard
type: issue
status: resolved
blocks: [decision-00019-whiteboard-standalone-repo]
---

# Issue: 一个指向目录的符号链接让「可文本合并」守卫测试抛 EISDIR

> `tracked.test.ts` 对 `git ls-files` 的每一项 `readFileSync`。`.claude/skills`
> 与 `.codex/skills` 是指向目录的符号链接，读它们抛 `EISDIR`，整个用例以
> 异常而非断言告终——白板测试套件在本仓库与模板 HEAD 上都是 1 败。

## 1. Problem

- Observed: `npm test` 里 `test/tracked.test.ts > tracks only files git can
  merge as text` 失败，错误是
  `Error: EISDIR: illegal operation on a directory, read`（`tracked.test.ts:35`）。
- Expected: 该用例应对每个被跟踪路径断言「git 会合并的那份内容前 8000 字节
  无 0x00」并通过——仓库里没有任何二进制源文件（issue-00021 的守卫）。
  `decision-00019` §2 第 5 条写的是「迁移本身零行为变更、测试原样通过」，
  本 issue 与之矛盾。
- Trigger: 任何被跟踪路径是指向**目录**的符号链接。本仓库有两条：
  `.claude/skills -> ../skills`、`.codex/skills -> ../skills`。

## 2. Impact

- Affected: 本仓库与模板仓库的每一次 `npm test`——套件常红，1904 过 1 败，
  真正的回归会被「反正有一个红」淹没；CI 一旦接上就永远不绿。
- Since: 模板 commit `38101d74`（2026-09-03，autopilot 模式引入两条 skills
  符号链接） · Still occurring: no（本 issue 已修）
- Severity: 中。不影响白板任何运行时行为，但让 issue-00021 加的分发守卫失去
  作用——用例以异常退出，其余 300 多个文件的 NUL 检查一个都没跑到。

## 3. Root Cause (first principles)

1. 分歧：测试问的是「git 会不会把这个路径当二进制」，做的却是「读工作副本
   里这个路径**指向的东西**」。两者对普通文件重合，对符号链接分叉。
2. 最小机制：`tools/whiteboard/test/tracked.test.ts:35` 的
   `readFileSync(join(repoRoot, path))` 跟随符号链接。链接指向文件时读到的是
   目标文件的内容（`CLAUDE.md -> AGENTS.md` 就这样被「读穿」，恰好无害）；
   指向目录时 `read(2)` 对目录描述符返回 `EISDIR`，`filter` 回调抛出，用例
   在第一个目录链接处中止。
3. 真正的根因：**把「git 的 blob 内容」实现成了「工作副本 `readFileSync` 的
   结果」。** git 对 mode `120000` 条目存的 blob 是链接目标**路径字符串**，
   永远是文本，`git merge-file` 合并的也是这串路径——符号链接根本不该参与
   二进制判定；而对普通文件两者一致，所以写测试时没有察觉。
   它**不是**这些症状：不是符号链接不该被跟踪（它们是模板骨架的一部分）；
   不是 `git ls-files` 列出了不该列的东西（它正确地列出索引条目）；也不是
   仓库里真有二进制文件（修复后全部路径扫描无 NUL）。

- Introduced by: 机制写于模板 `98720119`（2026-08-25，issue-00021 加此用例，
  当时仓库无任何目录符号链接，读穿等价于读 blob）；`38101d74`（2026-09-03）
  跟踪了第一条指向目录的符号链接，缺陷自此必然发生。本仓库以 `ainpt new`
  从 `1c88a684` 生成，两个 commit 都在其前——pre-dates the repo。

## 4. Scope (same-cause sweep)

机制是「以工作副本读取代替 git blob 判定」，扫了白板代码里对 `git ls-files`
结果逐项读文件的全部位置：

| Site | Same pattern | Affected | Action |
| --- | --- | --- | --- |
| `tools/whiteboard/test/tracked.test.ts:35` | yes | yes | fixed here |
| `tools/whiteboard/test/tracked.test.ts:27`（utils.ts 存在性） | no | no | 只比对路径字符串，不读文件 |
| `tools/whiteboard/src/gitLayer.ts` | no | no | 经 simple-git 操作索引，不按路径 `readFileSync` |

## 5. Reproduction (test-first)

1. 失败用例就是既有的 `tracks only files git can merge as text`：本仓库跟踪着
   两条目录符号链接，修复前它以 `EISDIR` 异常告终，而非断言失败。
2. 修复（§6）后通过。
3. 留作回归守卫：只要模板骨架仍跟踪 `.claude/skills`，任何把符号链接重新
   读穿的改动都会在此用例上再红。

- Failing test: `tools/whiteboard/test/tracked.test.ts::tracks only files git
  can merge as text` — fails with
  `Error: EISDIR: illegal operation on a directory, read`

## 6. Fix

- Change: 用例对每个路径先 `lstatSync`，`isSymbolicLink()` 的条目跳过
  NUL 检查，其余照旧 `readFileSync`。
- Why this addresses the root cause and not the symptom: 符号链接在 git 里的
  blob 是目标路径，按构造是文本——跳过它正是把判定对象校正为「git 会合并的
  内容」；顺带修掉指向文件的链接被读穿的那半边（`CLAUDE.md`）。不是只捕获
  `EISDIR`。
- Alternatives rejected: 逐项 `git cat-file -p` 读 blob——语义最准，但对
  300 多个路径各起一个子进程，一个 3 ms 的用例变成秒级；`git ls-files -s`
  取 mode 过滤 `120000`——等价，但要改动两个用例共用的 `tracked` 集合的
  形态，改动面大于必要。

## 7. Verification

- §5 的用例修复后通过。
- `npm test`（whiteboard 全套 vitest）全绿：62 个文件、1905 个用例通过，0 失败；`npm run typecheck` 通过。

## 8. Follow-through

- Detection gap: 用例写成时仓库没有目录符号链接，没有输入能触发分叉；模板
  后来加入符号链接的那次改动只跑了它自己的检查。修复后的用例本身就是守卫，
  不另加。
- Doc verdict: **code was non-conformant**——测试代码没有实现它注释里声明的
  判定（git 的二进制启发式）。`decision-00019` §2 第 5 条「测试原样通过」在
  迁移当日不成立，已在该条追注指向本 issue；其余文档不变。
- Residual state: none。模板仓库 HEAD 仍带同一缺陷，随下次向模板回流修复。

## Links

- Blocks: decision-00019-whiteboard-standalone-repo
- Related: issue-00021-a-raw-nul-byte-makes-a-source-unmergeable（本用例的来源）、
  issue-00017-an-unanchored-gitignore-rule-hides-a-source-module（同属「只在
  分发/克隆态可见」的缺陷族）
