---
id: issue-00038-install-script-installs-an-archive-it-could-not-verify
type: issue
status: resolved
blocks: [plan-00033-persimmon-command]
---

# Issue: `install.sh` 校验和不符时只打一句警告，照样把二进制装进 PATH

> 自 ainpt 迁入的安装脚本把校验写成「尽力而为」：校验不过就 `echo "warning:
> checksum not verified"` 然后继续装。校验和不符是归档被动过的证据，此时装下去
> 正是校验存在的理由所要防的那件事。

## 1. Problem

- Observed: `install.sh:31`-`40`。取到 `checksums.txt` 且本机有校验工具时，
  `grep " ${ASSET}\$" checksums.txt | sha256sum -c -` 的**任何**失败都落到
  `|| echo "warning: checksum not verified"` 这一支，脚本继续往下走
  （`:42` 解包、`:44`-`:53` 装入 PATH），最终以 0 退出并打印
  `Installed persimmon to …`。失败有三种来源，它们被一句话抹平：
  校验和不符（`sha256sum -c` 报 FAILED）、`grep` 无匹配（管道空输入，
  `sha256sum -c` 报「no properly formatted checksum lines found」）、
  那一行不合式（同上）。
- Expected: `spec-00012-FR-11`——校验和不符、校验和文件里没有该归档那一行、
  该行不合式，三者都按不一致处置：**中止安装、以非 0 退出、不在 PATH 上留下
  任何二进制**（`spec-00012-AC-11.1` / `AC-11.2` / `AC-11.3`）。只有校验和
  文件取不到（`AC-11.4`）或本机既无 `sha256sum` 也无 `shasum`（`AC-11.5`）
  才退让为一句警告并继续——那是本机少一件东西，不是归档有问题。
- Trigger: 跑 `curl -fsSL …/install.sh | sh`，而 Release 上的归档与
  `checksums.txt` 对不上——归档被替换、传输被中间人改写，或发布本身出了错。

## 2. Impact

- Affected: 每一个用安装脚本装 `persimmon` 的用户。这是**供应链路径**：脚本
  的整个校验段在被攻击的那一刻退化成一行灰色的警告，而它正是为那一刻写的。
  警告还印在 `Downloading …` 与 `Installed …` 之间，管道安装的滚动输出里几乎
  不会被读到。
- Since: 迁入提交 `93bb290`（plan-00033 T1，自 ainpt 逐字复制）；机制本身
  pre-dates 本仓库。 · Still occurring: yes
- Severity: 高。后果是在用户 PATH 上放一个内容未经确认的可执行文件，且脚本
  以 0 退出、宣告安装成功。它不损坏数据，但它让校验形同虚设。

## 3. Root Cause (first principles)

1. 分歧：「校验失败」应中止，实际继续。
2. 最小机制：`install.sh:34`-`35`（与 `:37`-`:38` 的 `shasum` 同构）把校验
   写成 `(… -c - >/dev/null 2>&1) && echo ok || echo warning`——`&&`/`||` 这
   一对把**非 0 退出码消费掉**，`set -e` 从此对这一段无效（`set -e` 不作用于
   `||` 左侧的命令）。校验的结论因此从不影响控制流。
3. 真正的根因：**脚本没有区分「校验不通过」与「无从校验」这两件事，把两者
   都归到同一个 warning 分支**。这不是 `grep` 匹配写错，也不是少了一次
   `exit 1`——把 `||` 换成 `|| exit 1` 会连 `AC-11.4` / `AC-11.5` 两种该退让
   的情形一并中止。要改的是判定的分层：先分「有没有 checksums.txt / 有没有
   工具」（缺件 → 警告继续），再在有的前提下分「对不对得上」（不对 → 中止）。
   它**不是**：`sha256sum -c` 用法有误（用法本身正确）；不是 `set -e` 没写
   （写了，在 `:4`，只是被 `||` 短路）；也不是缺少一个「严格模式」开关——
   `spec-00012-FR-11` 要的是唯一行为，不是一个选项。

- Introduced by: `93bb290`（本仓库首次持有这份脚本）。此前本仓库没有
  `install.sh`，缺陷不可能发生。ainpt 侧自脚本写下起就有，且在那里是**有意**
  的尽力而为——`design-00004` §6 的追注把本仓库的口径明写为对迁入源的有意
  偏离，故这不是「照抄错了」，而是迁入时该改而未改的一处。

## 4. Scope (same-cause sweep)

机制是「校验结论被 `&&`/`||` 消费掉，控制流不受其影响」：

| Site | Same pattern | Affected | Action |
| --- | --- | --- | --- |
| `install.sh:34`（`sha256sum` 一支） | yes | yes | fixed here |
| `install.sh:37`（`shasum` 一支） | yes | yes | fixed here——同一根因的第二个副本，两支合并为一条判定 |
| `install.sh:32`（取 `checksums.txt` 的 `curl`，失败即整段跳过） | 部分 | no | 同为「失败不中止」，但这是 `AC-11.4` 明写要退让的一种，行为正确；修复后它成为显式的一支并打印一句警告 |
| `install.sh:29`（下归档的 `curl -fsSL`） | no | no | 无 `||`，失败由 `set -e` 中止 |
| `install.sh:42`（`tar -xzf`） | no | no | 同上 |

## 5. Reproduction (test-first)

- 失败测试：`test/install.test.ts` 六个用例，各以一个本机 HTTP stub 冒充
  Release 的下载基址（`PERSIMMON_INSTALL_BASE_URL`）、装到临时目录
  （`PERSIMMON_INSTALL_DIR`）：`AC-10.1`（校验和相符 → 装好、退出 0）、
  `AC-11.1`（不符）、`AC-11.2`（缺该归档那一行）、`AC-11.3`（那一行不合式）、
  `AC-11.4`（`checksums.txt` 取不到 → 警告 + 装好）、`AC-11.5`（PATH 上既无
  `sha256sum` 也无 `shasum` → 警告 + 装好）。
- 修复前红的是五条：`AC-11.1` / `AC-11.2` / `AC-11.3` 因脚本以 0 退出、
  临时目录里出现可执行的 `persimmon`（根因本身）；`AC-11.4` / `AC-11.5`
  因原脚本在这两种该退让的情形下**连警告都不打**（`curl` 失败即整段跳过、
  两个 `command -v` 都不中即整段跳过），而两条 AC 要的是「一句未能校验的
  警告」。只有 `AC-10.1` 修复前即绿——它是本次要保住的行为，写在同一个文件里
  是为了防止修复越界。

## 6. Fix

- Change: `install.sh` 的校验段重写为三层判定——取不到 `checksums.txt` → 警告
  并继续；取到了但本机无 `sha256sum` / `shasum` → 警告并继续；两者都有 →
  从 `checksums.txt` 取该归档那一行的校验和，缺行、不是 64 位十六进制、
  或与实算值不等，三者各打一句点名原因的错误并 `exit 1`（此时尚未解包、
  更未 `install` 到目标目录，PATH 上不留任何东西）。另加两个环境变量覆盖
  （`PERSIMMON_INSTALL_BASE_URL` / `PERSIMMON_INSTALL_DIR`），使这六种情形
  可在本机被测——缺省值与今天一字不变。
- Why this addresses the root cause and not the symptom: 判定被分成「缺件」与
  「不符」两层，而不是在原来的单支上加一个 `exit`——`AC-11.4` / `AC-11.5`
  的退让与 `AC-11.1` … `AC-11.3` 的中止由此各走各的支，两支各有其测试。
  两处 `sha256sum` / `shasum` 的重复也在同一处收敛为一个 `$SUM` 变量，
  根因的第二个副本不再存在。
- Alternatives rejected: 保留 `sha256sum -c` 的管道写法只把 `||` 改成
  `|| exit 1`——会把「取不到 checksums.txt」之外的所有情形都中止，`AC-11.5`
  失守；加一个 `--strict` 开关——`spec-00012-FR-11` 要的是唯一行为。

## 7. Verification

已执行（修复已施加）：

1. **§5 的六个用例，红→绿**。修复前 `npx vitest run test/install.test.ts` 是
   `5 failed | 1 passed`，红的方式正是缺陷本身：`AC-11.1` / `AC-11.2` /
   `AC-11.3` 三条报 `expected +0 not to be +0`——脚本以 **0** 退出、临时目录里
   躺着一个可执行的 `persimmon`；`AC-11.4` / `AC-11.5` 两条报输出不含
   `warning`——原脚本在取不到 `checksums.txt` 或无校验工具时**一句话也不说**，
   而 `spec-00012-AC-11.4` / `AC-11.5` 要的是「一句未能校验的警告」。
   `AC-10.1` 修复前即绿，修复后仍绿（未越界）。修复后 `6 passed (6)`。
2. `npm run typecheck` 无输出；`sh -n install.sh` 通过；
   `sh scripts/go-coverage.sh` 退出码 0（与本条无关，同轮落地的覆盖率门）。
3. 真机一次（真实 Release、linux 与 darwin 各一次，含校验和不符时的中止）在
   plan-00033 的「实测义务」里，**未做即不计已验证**。

## 8. Follow-through

- Detection gap: `install.sh` 迁入时**一条测试都没有**——`scripts/test-install.js`
  测的是 npm 包的两种安装形态，与这个脚本无关。修复同时立起
  `test/install.test.ts`，六种情形各一条，本机 HTTP stub 无网络依赖。
- Doc verdict: **code was non-conformant**——`spec-00012-FR-11` 与
  `AC-11.1` … `AC-11.5` 已写明正确行为，`design-00004` §6 的追注也已把它记为
  对迁入源的有意偏离。文档不动。
- Residual state: 在此之前用这个脚本装过的用户，其 `persimmon` 是否经过校验
  无法在事后判定（脚本没有留下记录）。重跑一次修好的脚本即可覆盖安装，无需
  迁移。

## Links

- Blocks: plan-00033-persimmon-command（T8 的 `install.sh` 校验和偏离）
- Related: spec-00012-persimmon-command（`FR-11`、`AC-11.1` … `AC-11.5`、
  `FR-10`、`AC-10.1`）、design-00004-persimmon-cli（§6 追注）

## 第三十二轮追注（2026-09-09）：修复对象已删除

`decision-00020` 第三十二轮撤除了整条发布线，`install.sh` 与
`test/install.test.ts` 一并删除。本 issue 留 `status: resolved`——缺陷确曾
被定位并修复（校验和不符即中止），只是承载它的脚本此后不再存在。

若日后重建安装脚本，本 issue §根因（`&&` / `||` 吃掉非 0 退出码使 `set -e`
失效）仍然适用，须先读它再动手。
