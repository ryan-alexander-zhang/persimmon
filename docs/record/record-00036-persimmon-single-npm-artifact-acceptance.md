---
id: record-00036-persimmon-single-npm-artifact-acceptance
type: record
status: active
parent: plan-00034-persimmon-single-npm-artifact
verifies: [
  spec-00011-AC-13.1, spec-00011-AC-13.2, spec-00011-AC-13.3, spec-00011-AC-13.4,
  spec-00011-AC-13.5, spec-00011-AC-13.6, spec-00011-AC-13.7, spec-00011-AC-14.1,
  spec-00011-AC-14.2, spec-00011-AC-14.3, spec-00011-AC-15.1, spec-00011-AC-15.2,
  spec-00011-AC-15.3, spec-00011-AC-15.4, spec-00011-AC-15.5, spec-00011-AC-15.6,
  spec-00011-AC-20.4, spec-00011-AC-21.1, spec-00011-AC-21.2, spec-00011-AC-21.5,
  spec-00012-AC-3.1, spec-00012-AC-3.3, spec-00012-AC-3.4, spec-00012-AC-4.1,
  spec-00012-AC-4.2, spec-00012-AC-4.3, spec-00012-AC-4.4, spec-00013-AC-2.1,
  spec-00013-AC-2.2, spec-00013-AC-2.3, spec-00013-AC-2.4, spec-00013-AC-2.5,
  spec-00013-AC-2.6, spec-00013-AC-2.7, spec-00013-AC-2.8, spec-00013-AC-3.1,
  spec-00013-AC-3.2, spec-00013-AC-5.1, spec-00013-AC-5.2, spec-00013-AC-5.3,
  spec-00013-AC-5.4, spec-00013-AC-5.5, spec-00013-AC-5.6, spec-00013-AC-9.9,
  spec-00013-AC-11.1, spec-00013-AC-11.2, spec-00013-AC-11.3, spec-00013-AC-11.4,
  spec-00013-AC-11.5, spec-00013-AC-11.6, spec-00013-AC-15.1, spec-00013-AC-15.2,
  spec-00013-AC-15.3, spec-00013-AC-15.4, spec-00013-AC-15.6, spec-00013-AC-15.7,
  spec-00013-AC-16.1, spec-00013-AC-17.1, spec-00013-AC-17.2, spec-00013-AC-3.3,
  spec-00013-AC-9.1, spec-00013-AC-9.2, spec-00013-AC-9.3, spec-00013-AC-9.4,
  spec-00013-AC-9.5, spec-00013-AC-9.6, spec-00013-AC-9.7, spec-00013-AC-9.8,
  spec-00013-AC-9.10, spec-00013-AC-10.1, spec-00013-AC-10.2, spec-00013-AC-10.3,
  spec-00013-AC-10.4, spec-00013-AC-10.5, spec-00013-AC-10.6, spec-00013-AC-12.1,
  spec-00013-AC-12.2, spec-00013-AC-12.3, spec-00013-AC-15.5, spec-00013-AC-16.2,
  spec-00013-AC-1.1, spec-00013-AC-1.2, spec-00013-AC-1.3, spec-00013-AC-1.4,
  spec-00013-AC-1.5, spec-00013-AC-1.6, spec-00013-AC-1.7, spec-00013-AC-1.8,
  spec-00013-AC-1.9, spec-00013-AC-4.1, spec-00013-AC-4.2, spec-00013-AC-4.3,
  spec-00013-AC-4.4, spec-00013-AC-4.5, spec-00012-AC-2.1, spec-00012-AC-2.2,
  spec-00012-AC-9.1, spec-00012-AC-9.2, spec-00012-AC-9.3, spec-00012-AC-12.1,
  spec-00012-AC-12.2, spec-00012-AC-12.3, spec-00012-AC-12.4, spec-00012-AC-12.5,
  spec-00012-AC-12.6, spec-00012-AC-13.1, spec-00012-AC-13.2, spec-00012-AC-13.3,
  spec-00012-AC-14.1, spec-00012-AC-14.3, spec-00012-AC-15.1, spec-00012-AC-15.2,
  spec-00013-AC-13.1, spec-00013-AC-13.2, spec-00013-AC-13.3, spec-00013-AC-13.4,
  spec-00013-AC-14.1, spec-00013-AC-14.2, spec-00013-AC-14.3, spec-00013-AC-14.4,
  spec-00012-AC-1.1, spec-00012-AC-1.2, spec-00012-AC-14.2, spec-00013-AC-6.1,
  spec-00013-AC-6.2, spec-00013-AC-6.3, spec-00013-AC-6.4, spec-00013-AC-6.5,
  spec-00013-AC-7.1, spec-00013-AC-7.2, spec-00013-AC-8.1, spec-00013-AC-8.2,
  spec-00013-AC-8.3, spec-00013-AC-8.4, spec-00011-AC-20.1, spec-00011-AC-20.2,
  spec-00012-AC-10.1, spec-00012-AC-10.2
]
---

# 验收记录：一个 npm 产物——命令回到本包的 bin，脚手架移植为 `src/scaffold.ts`

对 [plan-00034-persimmon-single-npm-artifact](../plan/plan-00034-persimmon-single-npm-artifact.md)
的验收。交付范围按该 plan「交付范围」一节：`spec-00012` 十个现行条目的 30 条 AC、
`spec-00013` 整份 17 条 FR 的 86 条 AC、`spec-00011` 的 `FR-13`/`FR-14`/`FR-15`/`FR-20`/`FR-21`
的 22 条现行 AC，合计 **138 条**，每行恰一个 id。`design-00004` 是 design 类型，
按 `rule-00001-BR-24` 不计入范围。测试路径相对仓库根。

读数取自本分支 `main`、提交 `814b5ab`（T7，本轮 HEAD）。逐任务的实现提交：
T1 `5939478`、T2a `8a9a630`、T2b `c22a614`、T3 `2396982`、T4 `4d80010`、T5 `5527313`、
T6 `b85ab44`、T7 `814b5ab`。

**本轮验收不放行 `resolved`**：138 条验收行全部 `pass`，`rule-00001-BR-25` 的机器门
因此通过；但本 plan「Detailed Acceptance Path」第 10 项另加了一条自设的门——
「任一实测义务未过即写为缺口并**阻塞 `resolved`**」——而「实测义务」表右列为「是」的
六行里有三行本轮未取到读数（linux 平台的 tar / merge 读数、tar 其余条目类型的二选一
裁定、真终端 Ctrl-C）。逐条见下「实测义务」。

## 质量门

均在仓库根、`814b5ab` 上执行（2026-09-10）：

- `npm test`：74 个文件、2281 个测试全部通过，退出码 0，无 skip。
- `npm run typecheck`：`tsc --noEmit` 无输出，退出码 0。
- `npm run test:coverage`：全部文件 Statements 98.64%（5734/5813）、
  Branches 95.45%（3276/3432）、Functions 98.69%（1658/1680）、Lines 99.37%（4922/4953），
  `vitest.config.ts` 的 `thresholds: { lines: 90, branches: 90, functions: 90 }` 三项全过，
  退出码 0。**阈值一字未改**（`git diff 756c4f2..HEAD -- vitest.config.ts` 为空）、
  **无 `perFile`**、**无本轮新增豁免**（`coverage.exclude` 仍只有
  `web/src/main.tsx` 与 `web/src/components/ui/**` 两项，`decision-00001` §4 的既有条目）、
  **无被压制的发现**。
- `npm run build`：`✓ built in 463ms`，退出码 0。
- **逐文件覆盖率**（本 plan 对全局门无 `perFile` 的补偿，从覆盖率报告的逐文件表读）：
  `src/cli.ts` 98.72 / 95.91 / 97.91 / 99.46（Stmts / Branch / Funcs / Lines），
  `src/scaffold.ts` 99.33 / 98.42 / 100 / 99.61。两文件三项均 ≥ 90。
- `npm run test:install`：四格全过、退出码 0（读数见下）。

另跑 T7 那条对账命令，命中为零：

```sh
git grep -nE 'cli/|goreleaser|install\.sh|go-coverage|persimmon-host|--judge|bin/host' \
  -- . ':!docs/' | grep -v 'docs\.usebruno\.com' | grep -v 'integration-00001-cli' \
  | grep -v '5527313:cli/'
```

## 验收清单

| GWT / requirement id | Test | Result | Evidence |
| --- | --- | --- | --- |
| spec-00011-AC-13.1 | test/cli.test.ts:580::registers the project the cwd is in and serves it on the port itself | pass | 页面呈现那一半：web/ 本轮一字未改；命令侧证登记与地址 |
| spec-00011-AC-13.2 | test/cli.test.ts:503::prints the running process entry point when the cwd is in no project | pass | 页面呈现那一半：web/test/workspaceSwitch.test.tsx:304::goes to the workspace this browser was last in |
| spec-00011-AC-13.3 | test/cli.test.ts:503::prints the running process entry point when the cwd is in no project | pass | 页面呈现那一半：web/test/workspaceSwitch.test.tsx:315::goes to the first available entry when nothing was remembered |
| spec-00011-AC-13.4 | test/cli.test.ts:621::starts with no workspace when the cwd is in no project | pass | 页面呈现那一半：web/test/workspaceSwitcher.test.tsx:493::invites the first workspace when the registry is empty, switcher and all |
| spec-00011-AC-13.5 | test/cli.test.ts:604::registers a project whose flow config is invalid and listens all the same | pass |  |
| spec-00011-AC-13.6 | test/cli.test.ts:580::registers the project the cwd is in and serves it on the port itself | pass |  |
| spec-00011-AC-13.7 | test/cli.test.ts:604::registers a project whose flow config is invalid and listens all the same | pass | 页面呈现那一半：web/test/workspaceSwitcher.test.tsx:481::says which config error keeps a registered workspace from opening |
| spec-00011-AC-14.1 | test/cli.test.ts:483::registers through the process already running and starts no second one | pass |  |
| spec-00011-AC-14.2 | test/cli.test.ts:483::registers through the process already running and starts no second one | pass | 页面呈现那一半：web/test/workspaceSwitcher.test.tsx:263::shows an entry added elsewhere while it stays open |
| spec-00011-AC-14.3 | test/cli.test.ts:503::prints the running process entry point when the cwd is in no project | pass |  |
| spec-00011-AC-15.1 | test/cli.test.ts:431::reports the port as occupied when the service on it is not a persimmon | pass |  |
| spec-00011-AC-15.2 | test/cli.test.ts:447::reports the port as occupied, in bounded time, when nothing on it answers | pass | 另有 test/startup.test.ts:43::reports a port it cannot have instead of crashing |
| spec-00011-AC-15.3 | test/cli.test.ts:537::reports %s the running process gave, and listens not | pass |  |
| spec-00011-AC-15.4 | test/cli.test.ts:936::reads the file and exits 0 while a stranger holds the port | pass |  |
| spec-00011-AC-15.5 | test/cli.test.ts:658::reports a port taken between the probe and the listen, and keeps the entry it wrote | pass | 另有 test/startup.test.ts:43::reports a port it cannot have instead of crashing |
| spec-00011-AC-15.6 | test/cli.test.ts:636::reports a registration the registry file refused, and listens not | pass |  |
| spec-00011-AC-20.4 | test/cli.test.ts:746::registers this repository at its root and judges it available | pass |  |
| spec-00011-AC-21.1 | test/cli.test.ts:905::lists every entry with its availability | pass |  |
| spec-00011-AC-21.2 | test/cli.test.ts:925::prints an empty list on an empty registry | pass |  |
| spec-00011-AC-21.5 | test/cli.test.ts:951::gives the same availability with a process running and without one | pass |  |
| spec-00012-AC-3.1 | test/cli.test.ts:580::registers the project the cwd is in and serves it on the port itself | pass |  |
| spec-00012-AC-3.3 | test/cli.test.ts:658::reports a port taken between the probe and the listen, and keeps the entry it wrote | pass | 另有 test/startup.test.ts:43::reports a port it cannot have instead of crashing |
| spec-00012-AC-3.4 | test/cli.test.ts:483::registers through the process already running and starts no second one | pass |  |
| spec-00012-AC-4.1 | test/cli.test.ts:692::wraps up on SIGINT and does not exit before the shutdown is done | pass |  |
| spec-00012-AC-4.2 | test/cli.test.ts:709::wraps up on SIGTERM and exits with 0 once it is done | pass | 另有 test/startup.test.ts:71::handles SIGTERM itself instead of being killed by it |
| spec-00012-AC-4.3 | test/cli.test.ts:724::joins a second SIGINT into the wrap-up already running | pass |  |
| spec-00012-AC-4.4 | test/cli.test.ts:519::installs no shutdown handler of its own on the join path | pass |  |
| spec-00013-AC-2.1 | test/scaffold.test.ts:299::skips an excluded directory | pass |  |
| spec-00013-AC-2.2 | test/scaffold.test.ts:311::never copies the git directory or the manifest | pass |  |
| spec-00013-AC-2.3 | test/scaffold.test.ts:321::substitutes placeholders in the listed files | pass |  |
| spec-00013-AC-2.4 | test/scaffold.test.ts:330::expands placeholders inside a variable default | pass |  |
| spec-00013-AC-2.5 | test/scaffold.test.ts:345::skips a post_create step gated on another language | pass |  |
| spec-00013-AC-2.6 | test/scaffold.test.ts:356::runs a post_create step gated on the chosen language | pass |  |
| spec-00013-AC-2.7 | test/scaffold.test.ts:383::runs post_create steps in declaration order | pass |  |
| spec-00013-AC-2.8 | test/scaffold.test.ts:398::ignores a substitute entry the branch does not have | pass |  |
| spec-00013-AC-3.1 | test/scaffold.test.ts:410::records the template coordinate, ref and base commit | pass |  |
| spec-00013-AC-3.2 | test/scaffold.test.ts:423::records the resolved variables without name | pass |  |
| spec-00013-AC-5.1 | test/scaffold.test.ts:478::refuses a target that already exists | pass |  |
| spec-00013-AC-5.2 | test/scaffold.test.ts:491::reports a missing branch and points at the listing | pass |  |
| spec-00013-AC-5.3 | test/scaffold.test.ts:506::reports a missing required variable | pass |  |
| spec-00013-AC-5.4 | test/scaffold.test.ts:532::reports which post_create step failed and writes no marker | pass |  |
| spec-00013-AC-5.5 | test/scaffold.test.ts:544::leaves what it already copied after a post_create failure | pass |  |
| spec-00013-AC-5.6 | test/scaffold.test.ts:558::warns and leaves the base empty when the commit cannot be resolved | pass |  |
| spec-00013-AC-9.9 | test/scaffold.test.ts:680::reports a project already up to date | pass |  |
| spec-00013-AC-11.1 | test/scaffold.test.ts:693::refuses a directory with no creation marker | pass |  |
| spec-00013-AC-11.2 | test/scaffold.test.ts:704::refuses a creation marker that is not valid json | pass |  |
| spec-00013-AC-11.3 | test/scaffold.test.ts:716::refuses a creation marker with an empty base | pass |  |
| spec-00013-AC-11.4 | test/scaffold.test.ts:731::refuses the template coordinate %s | pass |  |
| spec-00013-AC-11.5 | test/scaffold.test.ts:731::refuses the template coordinate %s | pass |  |
| spec-00013-AC-11.6 | test/scaffold.test.ts:731::refuses the template coordinate %s | pass |  |
| spec-00013-AC-15.1 | test/scaffold.test.ts:570::excludes README.md but not docs/a.md for the pattern *.md | pass |  |
| spec-00013-AC-15.2 | test/scaffold.test.ts:580::excludes docs/draft.md for the pattern docs[^A-Z]draft.md | pass |  |
| spec-00013-AC-15.3 | test/scaffold.test.ts:588::excludes !y.md but not ay.md for the pattern [!x]y.md | pass |  |
| spec-00013-AC-15.4 | test/scaffold.test.ts:597::keeps README.md for the pattern READM | pass |  |
| spec-00013-AC-15.6 | test/scaffold.test.ts:608::excludes a file beneath a directory named with a trailing slash | pass |  |
| spec-00013-AC-15.7 | test/scaffold.test.ts:626::prunes the docs directory and excludes the file dock, for the pattern doc? | pass |  |
| spec-00013-AC-16.1 | test/scaffold.test.ts:644::builds the project anyway when an exclude pattern is malformed | pass |  |
| spec-00013-AC-17.1 | test/scaffold.test.ts:654::reports a missing tar and creates nothing | pass |  |
| spec-00013-AC-17.2 | test/scaffold.test.ts:767::reports a missing tar and changes nothing | pass |  |
| spec-00013-AC-3.3 | test/scaffold.test.ts:1048::handles a project scaffolded before the move | pass |  |
| spec-00013-AC-9.1 | test/scaffold.test.ts:1030::keeps local edits while folding in upstream | pass |  |
| spec-00013-AC-9.2 | test/scaffold.test.ts:1061::leaves conflict markers and lists the file | pass |  |
| spec-00013-AC-9.3 | test/scaffold.test.ts:1080::succeeds even when it leaves a conflict | pass |  |
| spec-00013-AC-9.4 | test/scaffold.test.ts:1092::advances the base after a conflict | pass |  |
| spec-00013-AC-9.5 | test/scaffold.test.ts:1103::advances the base after a clean merge | pass |  |
| spec-00013-AC-9.6 | test/scaffold.test.ts:1116::leaves the project's own files alone | pass |  |
| spec-00013-AC-9.7 | test/scaffold.test.ts:894::adds files new since the base | pass |  |
| spec-00013-AC-9.8 | test/scaffold.test.ts:1129::merges an upstream addition that the project already has | pass |  |
| spec-00013-AC-9.10 | test/scaffold.test.ts:1158::merges the directory it was pointed at | pass |  |
| spec-00013-AC-10.1 | test/scaffold.test.ts:877::leaves deliberate deletions deleted | pass |  |
| spec-00013-AC-10.2 | test/scaffold.test.ts:1180::honours an exclude pattern the template added after creation | pass |  |
| spec-00013-AC-10.3 | test/scaffold.test.ts:854::prunes excluded directories | pass |  |
| spec-00013-AC-10.4 | test/scaffold.test.ts:982::leaves an agreeing link and its target alone | pass |  |
| spec-00013-AC-10.5 | test/scaffold.test.ts:1001::reports a link the project replaced with a file | pass |  |
| spec-00013-AC-10.6 | test/scaffold.test.ts:947::keeps a retargeted link and spares what it points at | pass |  |
| spec-00013-AC-12.1 | test/scaffold.test.ts:1241::fails on the first merge when git is missing | pass |  |
| spec-00013-AC-12.2 | test/scaffold.test.ts:1258::leaves the base where it was when git is missing | pass |  |
| spec-00013-AC-12.3 | test/scaffold.test.ts:1273::leaves the half-updated tree behind when git is missing | pass |  |
| spec-00013-AC-15.5 | test/scaffold.test.ts:1201::honours a negated character class on the update side too | pass |  |
| spec-00013-AC-16.2 | test/scaffold.test.ts:1223::treats a malformed exclude pattern as no match | pass |  |
| spec-00013-AC-1.1 | test/cli.test.ts:989::takes the base template by default | pass |  |
| spec-00013-AC-1.2 | test/cli.test.ts:999::takes the lang/<lang> branch for --lang | pass |  |
| spec-00013-AC-1.3 | test/cli.test.ts:1009::takes the lang/<lang>/<variant> branch for --lang with --variant | pass |  |
| spec-00013-AC-1.4 | test/cli.test.ts:1019::lets --ref override the branch --lang implies | pass |  |
| spec-00013-AC-1.5 | test/cli.test.ts:1029::creates the project under --dir | pass |  |
| spec-00013-AC-1.6 | test/cli.test.ts:1041::takes the template coordinate from the environment | pass |  |
| spec-00013-AC-1.7 | test/cli.test.ts:1052::accepts --set more than once | pass |  |
| spec-00013-AC-1.8 | test/cli.test.ts:1067::accepts a flag written before the project name | pass |  |
| spec-00013-AC-1.9 | test/cli.test.ts:1078::reads a long flag written with a single dash | pass |  |
| spec-00013-AC-4.1 | test/cli.test.ts:1090::refuses --variant without --lang | pass |  |
| spec-00013-AC-4.2 | test/cli.test.ts:1101::prints the usage of the subcommand when <name> is missing | pass |  |
| spec-00013-AC-4.3 | test/cli.test.ts:1113::refuses a --set value with no equals sign | pass |  |
| spec-00013-AC-4.4 | test/cli.test.ts:1139::rejects a second positional argument | pass |  |
| spec-00013-AC-4.5 | test/cli.test.ts:1337::rejects a positional argument | pass |  |
| spec-00012-AC-2.1 | test/cli.test.ts:1570::is named, printed the usage and refused with 1 | pass |  |
| spec-00012-AC-2.2 | test/cli.test.ts:1584::is what a path-like first argument is | pass |  |
| spec-00012-AC-9.1 | test/cli.test.ts:1519::prints the version of this package | pass |  |
| spec-00012-AC-9.2 | test/cli.test.ts:1528::answers to %s with the same line | pass |  |
| spec-00012-AC-9.3 | test/distribution.test.ts:75::prints the version of the installed package.json | pass |  |
| spec-00012-AC-12.1 | test/cli.test.ts:1113::refuses a --set value with no equals sign | pass |  |
| spec-00012-AC-12.2 | test/cli.test.ts:1624::exits 2 on %s | pass |  |
| spec-00012-AC-12.3 | test/cli.test.ts:1624::exits 2 on %s | pass |  |
| spec-00012-AC-12.4 | test/cli.test.ts:1640::exits 2 on a positional `list` does not read, and prints no listing | pass |  |
| spec-00012-AC-12.5 | test/cli.test.ts:1101::prints the usage of the subcommand when <name> is missing | pass |  |
| spec-00012-AC-12.6 | test/cli.test.ts:1624::exits 2 on %s | pass |  |
| spec-00012-AC-13.1 | test/cli.test.ts:1667::refuses the start path with one sentence | pass |  |
| spec-00012-AC-13.2 | test/cli.test.ts:1681::refuses `add` on PORT=%s rather than falling back to 4173 | pass |  |
| spec-00012-AC-13.3 | test/cli.test.ts:1681::refuses `add` on PORT=%s rather than falling back to 4173 | pass |  |
| spec-00012-AC-14.1 | test/cli.test.ts:1708::does not stop `%s` | pass |  |
| spec-00012-AC-14.3 | test/cli.test.ts:1696::refuses `list`, which probes the port | pass |  |
| spec-00012-AC-15.1 | test/cli.test.ts:1653::reads a single-dash long flag on `add`, which used to be refused | pass |  |
| spec-00012-AC-15.2 | test/cli.test.ts:1528::answers to %s with the same line | pass |  |
| spec-00013-AC-13.1 | test/cli.test.ts:1385::lists the base template, then each language in order with its variants beneath | pass |  |
| spec-00013-AC-13.2 | test/cli.test.ts:1396::says only the base template is available when there is no lang/* branch at all | pass |  |
| spec-00013-AC-13.3 | test/cli.test.ts:1408::groups a variant-only language without offering the base line it has not got (issue-00035) | pass |  |
| spec-00013-AC-13.4 | test/cli.test.ts:1420::follows the Link header to the last page (issue-00036) | pass |  |
| spec-00013-AC-14.1 | test/cli.test.ts:1442::reports a request that could not be sent, and exits non-zero | pass |  |
| spec-00013-AC-14.2 | test/cli.test.ts:1454::reports the address and the status of a non-200, and exits non-zero | pass |  |
| spec-00013-AC-14.3 | test/cli.test.ts:1467::reports a 200 whose body will not parse | pass |  |
| spec-00013-AC-14.4 | test/cli.test.ts:1475::sends the one request the 403 answered and does not retry it | pass |  |
| spec-00012-AC-1.1 | test/cli.test.ts:1485::lists the templates with nothing else on the PATH | pass |  |
| spec-00012-AC-1.2 | test/cli.test.ts:1537::lists exactly the closed subcommand set for %s | pass |  |
| spec-00012-AC-14.2 | test/cli.test.ts:1500::lists the templates with an unreadable home directory | pass |  |
| spec-00013-AC-6.1 | test/cli.test.ts:1162::registers what it scaffolded when nobody is on the port | pass |  |
| spec-00013-AC-6.2 | test/cli.test.ts:1177::registers through the process already running and writes no file of its own | pass |  |
| spec-00013-AC-6.3 | test/cli.test.ts:1194::closes with the registered id and how to open it | pass |  |
| spec-00013-AC-6.4 | test/cli.test.ts:1208::registers the path on disk, not the symlink it was reached through | pass |  |
| spec-00013-AC-6.5 | test/cli.test.ts:1224::refuses a flag that would skip the registration, and creates nothing | pass |  |
| spec-00013-AC-7.1 | test/cli.test.ts:1237::registers despite a port held by somebody who is not a persimmon | pass |  |
| spec-00013-AC-7.2 | test/cli.test.ts:1252::writes the same file contract a process would read | pass |  |
| spec-00013-AC-8.1 | test/cli.test.ts:1268::keeps the project when the registry is ill-formed, and rewrites nothing | pass |  |
| spec-00013-AC-8.2 | test/cli.test.ts:1284::keeps the project when the registry cannot be written | pass |  |
| spec-00013-AC-8.3 | test/cli.test.ts:1301::keeps the project when the running process refuses the registration | pass |  |
| spec-00013-AC-8.4 | test/cli.test.ts:1319::registers with `add` once the cause is gone | pass |  |
| spec-00011-AC-20.1 | scripts/test-install.js:13::第 2 / 3 格（npx 与全局安装） | pass | `npm run test:install` 本轮读数：`npx list = global list: true` |
| spec-00011-AC-20.2 | scripts/test-install.js:14::第 2、3 格逐字比对 | pass | `npm run test:install` 本轮读数：第 2、3 格逐字相同 |
| spec-00012-AC-10.1 | scripts/test-install.js:61::第 1 格 `npm link` | pass | `npm run test:install` 本轮读数：`persimmon version → "persimmon 0.0.0-dev"` |
| spec-00012-AC-10.2 | scripts/test-install.js:15::第 2、3 格逐字比对 | pass | `npm run test:install` 本轮读数：第 2、3 格逐字相同 |

138 行，138 个互不相同的 id，无缺失、无 fail。逐任务对账
（本 plan T8 的「每条 AC 恰在一个任务清单里」）：T1 27 + T2a 32 + T2b 21 + T3 32 +
T4 11 + T5 11 + T6 4 = **138**，与三份 spec 的交付面逐条相等
（`spec-00012` 30、`spec-00013` 86、`spec-00011` 22），无重无漏。

`it.each` 承载的行以其参数化名字（含 `%s`）逐字记入；一条测试同时溯源多条 AC 时，
该测试在多行出现，这是本 plan 自己的用例划分，不是重复计数。

## 实测义务

按本 plan「实测义务：谁在什么时候取数，阻不阻塞 `resolved`」一节，右列为「是」的六行：

| 义务 | 本轮读数 | 阻塞 `resolved`？ |
| --- | --- | --- |
| 外壳 `tar` + `--strip-components=1` 在 bsdtar 与 GNU tar 上对目录、普通文件、符号链接与权限位的一致性 | **部分取到**。darwin：本机 `npm test` 全绿，`test/scaffold.test.ts` 的 `tarball()`（`spawnSync('tar','-czf','-')`）与 `untar()`（`spawnSync('tar','-xzf','-','--strip-components=1')`）是真外壳调用。但夹具 `writeTree`（`test/scaffold.test.ts:51`）只写目录与普通文件——**符号链接与权限位没有走过 tar 那条路**（`copyTree` 的 `preserves symlinks`:274 走的是复制不是解包）。linux：**未取到**——`ci.yml` 只在 push / pull_request 上跑，本 HEAD 比 `origin/main` 领先 31 个提交、从未推送，该 job 未在 `814b5ab` 上跑过 | 是 → **缺口** |
| Go 读取器静默丢弃的条目类型与外壳 `tar` 不等价，二选一并写进 record | **未取到**。树里既没有把硬链接 / fifo / 设备 / 空名条目一起比对的用例，也没有把「codeload 只出那三类」记作保证的裁定文字——`src/scaffold.ts:123-126` 的文档块只陈述 tar 落地目录、普通文件、符号链接与权限位，未对其余条目类型表态。plan 明写「**不得默认「反正只有那三类」**」，故这一条按缺口记 | 是 → **缺口** |
| `git merge-file` 以空临时文件作祖先与 Go 侧 `os.DevNull` 等价 | **部分取到**。darwin：`test/scaffold.test.ts` 的三方合并用例（`spec-00013-AC-9.1` … `AC-9.10`、`AC-10.1` … `AC-10.6`、`AC-12.1` … `AC-12.3`）本轮全绿。linux：同上一行，未取到 | 是 → **缺口**（linux 那一次） |
| 手写 glob 翻译器与 `filepath.Match` 逐例等价 | **取到**。`spec-00013-AC-15.1` … `AC-15.7`、`AC-16.1`、`AC-16.2` 与 `AC-2.1` 共十一条本轮全绿（表内各有行） | 是 → 已满足 |
| `npm pack` tarball 在 `npx` 与全局安装两形态下输出逐字相同、`npm link` 形态可执行、pty 起得来 | **取到**。`npm run test:install` 于 `814b5ab` 再跑一次，退出码 0，末行 `all four cells passed — ok`。四格读数：① `npm link: persimmon version → "persimmon 0.0.0-dev"`；②③ `npx list = global list: true — "persimmon  persimmon  <projects>/persimmon  available\n"`；④ `spawn-helper: 644 before the first spawn`。tarball：`ryan-alexander-zhang-persimmon-0.0.0-dev.tgz`、134 个文件、1.6 MB、`shasum 83b86306a626174870ebb802084bded62d95ed6b` | 是 → 已满足 |
| `FR-4` 的信号收尾在真终端与无 TTY 两种情形下各一次 | **半条取到**。无 TTY 那一半：`spec-00012-AC-4.1` … `AC-4.4` 四条本轮全绿（`test/cli.test.ts`、`test/startup.test.ts` 都不给 pty）。真终端那一次 Ctrl-C：**待人工**——本轮在无 TTY 的代理会话里取不到，需要一个人在真终端起一次会话、Ctrl-C、确认无孤儿进程且会话已 commit | 是 → **待人工，阻塞** |

Windows 那一行按 `decision-00020` §2 第 10 条已不是义务，不记。

## 四处行为变更，各有守着的测试

| 变更 | 守着它的测试 |
| --- | --- |
| `persimmon list extra` 退出码 0 → 2（`spec-00012-AC-12.4`） | `test/cli.test.ts:1640::exits 2 on a positional \`list\` does not read, and prints no listing` |
| `persimmon add -name foo` 由「拒绝」变为可用（`spec-00012-AC-15.1`） | `test/cli.test.ts:1653::reads a single-dash long flag on \`add\`, which used to be refused` |
| `npm start` 由「只起服务」变为走完整握手并写注册表（`design-00004` §7 末条） | `package.json` 的 `start` 是 `node bin/persimmon.js`；该入口的行为由 `test/cli.test.ts:580::registers the project the cwd is in and serves it on the port itself` 与 `test/startup.test.ts`（`ENTRY = bin/persimmon.js`，真 `spawn`）守住，`test/cli.test.ts:1754::keeps bin/persimmon.js a thin entry point` 守住入口里没有第二条逻辑。**没有一条测试钉住 `package.json.scripts.start` 这个字符串本身**——改掉它不会红 |
| 错误路径上的 usage 自 stdout 改到 stderr | `test/cli.test.ts:1552::writes the usage to stdout on the way out and to stderr on a refusal`（断 `persimmon help` 的 stderr 为空、`persimmon frobnicate` 的 stdout 为空） |

## 四条 issue 的回归测试

各一条逐字引其 issue id：

| issue | 测试 |
| --- | --- |
| `issue-00034` | `test/scaffold.test.ts:731::refuses the template coordinate %s`（溯源注释 `:726` 逐字写 `issue-00034`） |
| `issue-00035` | `test/cli.test.ts:1408::groups a variant-only language without offering the base line it has not got (issue-00035)` |
| `issue-00036` | `test/cli.test.ts:1420::follows the Link header to the last page (issue-00036)` |
| `issue-00037` | `test/cli.test.ts:1139::rejects a second positional argument`（溯源注释 `:1137` 逐字写 `issue-00037`；另有 `:1336`、`:1638` 两处） |

四份 issue 的状态本轮未改，仍为 `resolved`。

## 回归约束

- `git diff 756c4f2..HEAD --stat -- src/workspaceRegistry.ts src/workspaceAvailability.ts src/host.ts web/`
  **输出为空**——这三个模块与整个 Web UI 相对本 plan 的提交一字未改。
- `spec-00001` … `spec-00011` 的既有验收照常通过：`npm test` 74 个文件全绿，
  其中 `test/workspaceRegistry.test.ts`、`test/workspaceAvailability.test.ts` 与
  `web/test/` 的 21 份用例文件都在内。

## plan / spec 说法与实际不符处

本节只记录，不改动任何 plan 或 spec；每条附证据。

1. **`git merge-file` 不产生 `||||||| ` 基准标签。** 冲突标记的三段式需要 `--diff3`；
   `src/scaffold.ts:575` 的 `args` 没有它（与 Go 原文一致）。
   `test/scaffold.test.ts:1069` 的注释已据实写明，测试只断 `<<<<<<< yours` 与
   `>>>>>>> template (new)`。
2. **`t.Setenv("PATH", "")` 直译会假绿。** Node 在 `PATH` 为空串时仍可能解析到
   `tar`。移植改为把 `PATH` 指向一个空临时目录（`test/scaffold.test.ts:204`
   的 `withoutPath()`：`process.env.PATH = tmp()`），`spec-00013-AC-17.1` /
   `AC-17.2` 才真的红得起来。
3. **`listLangs(api)` 没有 out 参数。** Go 侧把输出写进一个 writer；TS 侧
   `src/cli.ts:332` 是 `listLangs(api: string): Promise<number>`，输出走
   `console.log`（跨任务约定第一条），测试以 `vi.spyOn(console, 'log')` 取。
4. **基准推进用对象展开。** `src/scaffold.ts:668`
   `const advanced: Lock = { ...ready.lock, commit: ready.newSHA }`——不是逐字段赋值，
   `.ainpt.json` 的其余字段原样带过。
5. **`issue-00030` §7 的「global spawn-helper: 755」读数已不成立。**
   本轮 `npm run test:install` 第四格实测为 `spawn-helper: 644 before the first spawn`，
   且四格仍全过。引用该读数的地方需要重新取值。
6. **plan T7 说「11 处出处注释钉到 `5527313`」，实为 10 处。**
   `git grep -oh '5527313:cli/' -- src test | wc -l` 给 10：
   `src/cli.ts` 4、`src/scaffold.ts` 2、`test/cli.test.ts` 3、`test/scaffold.test.ts` 1。
7. **plan T1 说 `spec-00011-AC-13.1` … `AC-13.3`、`AC-13.5`、`AC-13.7` 的 Then 各有
   「页面呈现 X」那一半——`AC-13.5` 没有。** 该条的 Then 逐字是
   「`broken` 被登记，进程以监听态运行」（`spec-00011` `:682-684`），全在命令侧。
8. **`AC-13.1` 的页面半句没有带 id 的 web 测试。** 其 Then 是
   「注册表新增 `/work/alpha`，页面呈现 `alpha`」，而 `web/test/` 里带
   `spec-00011-AC-13.x` 溯源的只有 `AC-13.2`、`AC-13.3`、`AC-13.4`、`AC-13.7` 四条。
   本轮沿 `record-00035` 对同一条的读法（那份也只列了命令侧的一条测试）记 `pass`，
   并把这处记在这里。
9. **`npm start` 的行为变更没有一条钉住 `package.json.scripts.start` 的测试**——
   见上「四处行为变更」表末行。
10. **墓碑 AC 会让实现里的 `resolvedGate` 判本 plan 有缺口，与 plan 对 BR-25 的
    读法不一致。** 本 plan「交付范围」一节的裁定是「墓碑 AC 不收」，据此逐条列出
    `spec-00012` 的十个 FR 而不写整份文档 id。但 `src/resolvedGate.ts` 与
    `src/requirements.ts` **没有墓碑这个概念**：一个 FR 的覆盖度由该 FR 在 spec 里
    声明的**全部** AC 决定，任一条没有验收行即判 `uncovered`。以本记录作证据集
    （`parent` 指向本 plan 的记录只有它一份）实跑 `resolvedGaps`，得四条缺口：

    ```
    spec-00012-FR-3    ← spec-00012-AC-3.2（墓碑）无行
    spec-00012-FR-10   ← spec-00012-AC-10.3（墓碑）无行
    spec-00011-FR-20   ← spec-00011-AC-20.3（墓碑）无行
    spec-00011-FR-21   ← spec-00011-AC-21.3 / AC-21.4（墓碑）无行
    ```

    这四条 FR 的**现行** AC 本记录逐条都记了 `pass`（`AC-3.1`/`3.3`/`3.4`、
    `AC-10.1`/`10.2`、`AC-20.1`/`20.2`/`20.4`、`AC-21.1`/`21.2`/`21.5`）。
    缺口纯由墓碑而来，不是覆盖面的缺口。要么白板侧认下墓碑（改
    `requirements.ts` 的推导），要么域主裁定为这五条墓碑 AC 各补一行——两条路
    都不是本记录能替谁走的，故只点名。本轮**不**为墓碑 AC 编造验收行。

## 实现期的既定取舍

- 「每条 AC 恰在一个任务清单里」按 plan 的逐任务清单对账，不按「每条 AC 恰一条测试」：
  一条测试可以同时溯源多条 AC（如 `test/cli.test.ts:580` 同时承载
  `spec-00011-AC-13.1` / `AC-13.6` 与 `spec-00012-AC-3.1`），一条 AC 也可以有多条
  测试（如 `spec-00011-AC-15.5` 另有 `test/startup.test.ts`）。表里每行取的是该 AC
  在其归属任务的主用例，其余在 Evidence 列点名。
- `spec-00011-AC-20.1` / `AC-20.2` 与 `spec-00012-AC-10.1` / `AC-10.2` 四条的证据是
  `scripts/test-install.js` 的四格，不是 `npm test` 里的用例——`spec-00012` §7 明写
  「这些条目在对应实测通过前不计已验证」，本轮的实测读数在上面「实测义务」表里。
- 页面呈现那一半的 AC 不重写一份实现证据：Web UI 本轮一字未改，按 plan T1 的说明
  以既有的通过测试为证据原样列出。

## 结论：`plan-00034` 能否 `open → resolved`

**不放行。**

按本 plan 自己对 `rule-00001-BR-24` / `BR-25` 的读法（墓碑 AC 不计入交付范围），
交付面内的 138 条 AC 各有一条 `parent` 指向本 plan 的通过验收行，无缺失、无未通过、
无无法解析的 id。但**实现里的门不这么读**：以本记录为证据集实跑
`src/resolvedGate.ts` 的 `resolvedGaps`，返回四条缺口——`spec-00012-FR-3`、
`spec-00012-FR-10`、`spec-00011-FR-20`、`spec-00011-FR-21`，成因全是墓碑 AC
没有验收行（详见上一节第 10 条）。这一处读法分歧本身就阻着流转，且不是本记录
能单方面消解的。

此外本 plan 在「Detailed Acceptance Path」第 10 项加了一条更严的门：
「任一实测义务未过即写为缺口并**阻塞 `resolved`**」。据此点名三处缺口：

1. **linux 平台的 tar 与三方合并读数未取到**——`ci.yml` 的 `node` job 从未在
   `814b5ab` 上跑过（本地领先 `origin/main` 31 个提交，未推送）。推一次分支、
   等该 job 绿，这一条即可补上。
2. **外壳 `tar` 对「其余条目类型」的二选一裁定未落地**——既没有把硬链接 / fifo /
   设备 / 空名条目一起比对的用例，也没有把「codeload 只出那三类」记作保证的文字。
   plan 明写不得默认。补法是二选一并写进一份新的 record。
3. **真终端 Ctrl-C 那一次未取到**——`spec-00012-AC-4.1` … `AC-4.4` 的无 TTY 那一半
   本轮全绿，真终端那一半要一个人在真终端里跑一次。

另附一条不阻塞但值得补的观察：darwin 侧的 tar 一致性读数只覆盖了目录与普通文件，
符号链接与权限位没有走过解包那条路（见「实测义务」第一行）。

合起来，放行前要补的是四件事：上面三处实测缺口，加上墓碑 AC 与
`resolvedGate` 的读法分歧。补齐前 `plan-00034` 的状态不动。

## 追记（2026-09-10）：四件事的进展

1. **墓碑与 `resolvedGate` 的读法分歧——已解**（`issue-00039` resolved）。
   `spec-00001` 第三十三轮给归属标注加了第二 token `作废`，`src/requirements.ts`
   拆 token 后墓碑 AC 仍归属、仍计数、不参与三态。以本记录为证据集实跑
   `resolvedGaps(plan-00034)` 得 **`[]`**；19 条墓碑全部解析、`unattributable: 0`。
2. **tar 其余条目类型的二选一——已取 ②**：git 对象模型只能表达 dir / 普通文件
   （含可执行位）/ symlink / gitlink，codeload 的 `git archive` tarball 不含硬链接、
   fifo、设备；写在 `test/scaffold.test.ts` 头注。同批补了解包路径上符号链接与
   可执行位保住的两条测试（`c45e080`），原「darwin 侧只覆盖目录与普通文件」的
   观察随之关闭。
3. **linux 侧读数——域主裁定暂不推送**，留空；不阻塞本仓库内的结论，但
   `resolved` 前须由域主再定一次是推还是接受只有 darwin 读数。
4. **真终端 Ctrl-C——已取到**（域主 2026-09-10 在真终端跑
   `npm run build && PORT=4199 node bin/persimmon.js`）：打印
   `persimmon: http://localhost:4199/w/persimmon` 后按一次 Ctrl-C，进程退出、
   提示符回到 shell 无错误标记；事后核查 `pgrep -fl bin/persimmon.js` 无进程、
   `lsof -iTCP:4199 -sTCP:LISTEN` 端口已释放、`~/.persimmon/workspaces.json`
   含本仓库一条（登记发生在监听之前，符合 `spec-00011-FR-13`）。
   `spec-00012-AC-4.1` … `AC-4.4` 的真终端那一半由此取数。

5. **linux 侧读数——已取到**（域主 2026-09-10 裁定推送）。首次 CI（run
   `34438160787`，ubuntu-latest，Node 23）9 红：2 条是本轮的 linux 特有缺陷——
   `tar -xzf` 在 GNU tar 上 exec `gzip`，夹具 PATH 只含 `tar` 即死在解包
   （`issue-00041`，改为 `node:zlib` 进程内 gunzip 后 `tar -xf -`）；另 7 条在
   本轮未改的文件里、与 plan-00034 无因果——5 条 upgrade 拒绝在 Node 23 超时
   （`issue-00042`，undici 只发 `error` 不发 `close`）、`headless` 夹具 400 KB
   进 argv 撞 linux 单参上限（`issue-00043`）、`sessionManager` 用例按到达次数
   断言的竞态（`issue-00044`）。四条各按 `AGENTS.md` §8 先 issue 后修。
   第二次 CI（run `34441120647`，head `a8e418c`）**node job success**：
   `tar --strip-components=1`、`git merge-file` 与三方合并全部 20 例、解包路径
   的符号链接与可执行位，在 GNU tar / linux 上取到绿读数。

**四件事齐了。`plan-00034` 的 138 条 AC 各有通过测试，`resolvedGaps` 为空，
darwin 与 linux 两侧读数在手，真终端 Ctrl-C 已取——放行 `open → resolved`。**
