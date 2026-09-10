---
id: issue-00041-the-unpack-shells-out-to-a-gzip-nobody-declared
type: issue
status: resolved
blocks: [plan-00034-persimmon-single-npm-artifact]
---

# Issue: 解归档的 `tar -xzf` 在 GNU tar 上要再起一个 `gzip`，而前置只声明了 `tar`

> `spec-00013-FR-17` 把 `new` / `update` 的外部前置写定为 `tar`（与 `git`），
> 但 GNU tar 的 `-z` 是 **exec 一个 `gzip` 子进程**去解压。只装了 tar 没装
> gzip 的 linux 机器上 `persimmon new` 因此解包失败；CI 的首次 linux 读数以
> 两条 `update` 用例变红的形式把它撞了出来。

## 1. Problem

- Observed: CI run `34438160787`（ubuntu-latest，本仓库第一次在 linux 上跑
  测试），`test/scaffold.test.ts` 两条用例红：

  ```
  AssertionError: expected 'tar failed to unpack the template: ta…' to contain 'merge AAA.md'
  + tar (grandchild): Error is not recoverable: exiting now
  ```

  两条用例（`fails on the first merge when git is missing`、`leaves the
  half-updated tree behind when git is missing`）本要读的是 `git merge-file`
  缺失时的失败点，实际拿到的是 `tar` 的解包失败。
- Expected: `spec-00013-FR-17`——`new` 与 `update` 直接依赖的外部前置是
  `tar`（解归档）与 `git`（`FR-12`，仅 `update` 真要合并时），第三个是
  `post_create` 用的 `sh`。**`gzip` 不在其中**，PATH 上有 `tar` 就该能解出
  模板树（`spec-00013-AC-17.1` / `AC-17.2` 的对偶面）。
- Trigger: PATH 上有 `tar` 而没有 `gzip`，且 tar 是 GNU tar。测试夹具
  `withoutGit()`（`test/scaffold.test.ts:219`-`223`）把 PATH 换成只含一个
  `tar` 符号链接的目录，正是这个状态；生产上则是任何精简过的 linux 环境
  （容器基础镜像、busybox 之外单装了 GNU tar 的机器）。

## 2. Impact

- Affected: linux 上每一次 `persimmon new` 与 `persimmon update`——只要本机
  PATH 上没有 `gzip`。两条命令都必须解模板分支的 tarball，无一幸免。darwin
  不受影响：bsdtar 内建 libz，`-z` 不 exec 任何东西。CI 侧的直接受害者是
  `test/scaffold.test.ts` 的两条 `git is missing` 用例——它们把 PATH 收窄到
  只剩 tar，于是在 linux 上必然撞上这条。
- Since: `8a9a630`（plan-00034 T2a，`src/scaffold.ts` 落地）· Still
  occurring: yes
- Severity: 中。它不损坏任何东西，也不静默——失败时 `new` 一个文件都还没落，
  `update` 一个文件都还没合，`FR-17` 要的「半个项目也不留」照旧成立。但它让
  一条已声明的支持平台（linux）上的主命令在一类真实环境里直接不可用，且失败
  信息指向 tar 而不是缺失的 gzip，读的人无从照着改。

## 3. Root Cause (first principles)

1. 分歧：前置声明说「有 `tar` 就够」，实现说「还得有 `gzip`」。
2. 最小机制：`src/scaffold.ts:129`

   ```ts
   const done = spawnSync('tar', ['-xzf', '-', '--strip-components=1', '-C', dir], { input: archive })
   ```

   `-z` 在两种 tar 实现里语义不同：GNU tar 把解压**委托给外部程序**——它
   `exec` 一个 `gzip -d`（`--use-compress-program` 的内建缺省），找不到就报
   `tar (grandchild): ... Error is not recoverable`；bsdtar（darwin 的
   `/usr/bin/tar`）链接 libz，在**进程内**解压，不 exec 任何东西。同一个
   `-xzf` 因此在两个平台上有两套外部前置。
3. 真正的根因：**移植时把「解压」这件本在进程内做的事外包给了外壳，而外包的
   代价没有被记进前置清单**。Go 侧是 `net/http` + `compress/gzip` +
   `archive/tar`（`design-00004` §6 对照表那一行），gzip 是标准库、不是一个
   进程；TS 侧为了拿到 `--strip-components`、符号链接与权限位而改用外壳
   `tar`，**顺带**把 gzip 也一起外包了——后者是搭便车的，`--strip-components`
   与权限位都不需要它。
   它**不是**：夹具写错了（夹具照 `FR-17` 给出的正是「只有 tar」的 PATH，它
   读到的是真实缺陷）；不是 CI 镜像缺件（ubuntu-latest 有 gzip，是夹具刻意
   收窄的 PATH 暴露了它，而生产上的精简机器会自然处在同一状态）；也不是
   「darwin 与 linux 的 tar 行为要实测对齐」这条已知风险（`design-00004`
   §10）里的符号链接/权限位那一面——对齐没问题的正是那一面。

- Introduced by: `8a9a630`（plan-00034 T2a）。此前 `cli/internal/scaffold`
  用 `compress/gzip` 在进程内解压，PATH 上有没有 `gzip` 与它无关，缺陷不可能
  发生。

## 4. Scope (same-cause sweep)

机制是「把标准库能做的事交给一个未声明的外部进程」：

| Site | Same pattern | Affected | Action |
| --- | --- | --- | --- |
| `src/scaffold.ts:129`（`untar` 的 `-xzf`） | yes | yes | fixed here——`gunzipSync` 进程内解压，tar 只留 `-xf` |
| `src/scaffold.ts:107`（`fetchTemplate`，`new` 与 `update` 共用的唯一下载/解包入口） | — | yes | 两条命令都经此，一处修完即全覆盖；无第二个解包点 |
| `src/scaffold.ts:576`（`mergeFile` 的 `git merge-file`） | no | no | `git` 是 `FR-12` 明写的前置，不是搭便车的 |
| `src/scaffold.ts:384`（`runSteps` 的 `sh -c`） | no | no | `sh` 是 `FR-17` 明写的第三个前置 |
| `test/scaffold.test.ts:117`（夹具 `tarball()` 的 `tar -czf`） | 同为外壳 tar | no | 测试侧、PATH 完整时急切构建（`stubGitHub` 在收窄 PATH 之前就把归档做好了），且 `-z` 的压缩方向同样只在 GNU tar 上要 gzip——本机 PATH 完整，不受影响 |

## 5. Reproduction (test-first)

- 新增用例：`test/scaffold.test.ts::unpacks the template with tar as the only
  command on PATH`（归属 `spec-00013-FR-17` / `AC-17.1` 的对偶面）。它把 PATH
  收窄到只含 `tar`（复用 `withoutGit()`），跑 `create`，要求项目建出、
  `README.md` 落地。
- 修复前：**linux 上红**——`tar failed to unpack the template: tar
  (grandchild): Error is not recoverable: exiting now`，`create` 抛出、
  `demo/` 不存在。**darwin 上绿**——bsdtar 内建 libz，`-z` 不 exec gzip。
  这是一条 **linux 特有**的缺陷，本机（darwin，`/usr/bin/tar` = bsdtar）无法
  复现；本机唯一能复现它的办法是把 GNU tar 放进 PATH（`brew install
  gnu-tar` 后 `PATH=/opt/homebrew/opt/gnu-tar/libexec/gnubin:$PATH`），
  而本机未装 gnu-tar，故修复前的红读数只有 CI run `34438160787` 一份。
- 已有的两条 `git is missing` 用例（`AC-12.1` / `AC-12.3`）是同一根因的间接
  读数：它们在 linux 上红，且**不需要改动**——修好之后它们收窄的 PATH 就够用
  了，失败点回到 `git merge-file`。

## 6. Fix

- Change: `src/scaffold.ts` 的 `untar` 改为 `gunzipSync(archive)` 在进程内
  解压，再把明文 tar 流喂给 `tar -xf -`（`node:zlib`，无新依赖）。`untar`
  多收一个 `url` 参数，用于「响应内容不是 gzip」时报出一句点明来源的错误
  ——不静默、不当作空归档。`MissingToolError` 与它的两条 AC 语义不变：
  `tar` 仍是那个找不到就报 `tar is not on PATH` 的前置。
- Why this addresses the root cause and not the symptom: 外部前置回到
  `FR-17` 声明的那一份，两种 tar 实现的 `-z` 差异不再进入调用面——`-xf` 在
  bsdtar 与 GNU tar 上都不 exec 任何子进程。修夹具（往 PATH 里再塞一个
  `gzip`）只会让测试变绿而把生产缺陷留在原地。
- Alternatives rejected: 往 PATH 里补 `gzip` 并把它写进 `FR-17` 的前置清单
  ——多一个前置，且是标准库能做的事；用 `--use-compress-program` 指名
  ——同样要那个进程；引入一个解 tar 的 npm 包——`decision-00020` §2 不新增
  依赖，且 `--strip-components`、符号链接与权限位是 tar 已经做对的事。

## 7. Verification

- §5 的新用例，darwin 修复前后皆绿（平台使然，见 §5）；linux 的红→绿读数由
  下一次 CI 给出。
- `test/scaffold.test.ts` 全量在 darwin 绿；`npm run typecheck` 无输出；
  `npm run test:coverage` 中 `src/scaffold.ts` 的 lines / branches /
  functions 三项均 ≥ 90。
- 本机 GNU tar 一次复现：**未做**——本机未装 gnu-tar（`brew list gnu-tar`
  报 `No such keg`），未为此改动本机环境。

## 8. Follow-through

- Detection gap: 本仓库此前**没有 linux 读数**——CI 的 linux 作业是这一轮
  才第一次跑起来，而 darwin 上 bsdtar 的内建 libz 把这条缺陷整个盖住了。
  单加一条测试补不上这个洞：它是**平台矩阵**的洞，靠 CI 在 linux 与 darwin
  两侧都跑同一套用例来守（`design-00004` §10 已把「bsdtar 与 GNU tar 的行为
  要实测对齐」列为实测义务，这次撞上的正是它没覆盖到的一面）。
- Doc verdict: **code was non-conformant**（`spec-00013-FR-17` 的前置清单是
  对的，实现多要了一个 `gzip`），但 `design-00004` §6 机制对照表那一行把
  实现写作 `tar -xzf - --strip-components=1`，与修复后的
  「`node:zlib` 解压 + `tar -xf -`」不符 → **须改 `design-00004` §6 那一行**
  （并在 §10 的实测义务里点明 `-z` 的两实现差异）。本 issue 不动 `docs/`，
  改由编排者落。
- Residual state: none——失败发生在任何东西落地之前，没有半个项目、没有半合
  的树需要清理。

## Links

- Blocks: plan-00034-persimmon-single-npm-artifact（T2a 的解归档实现）
- Related: spec-00013-persimmon-scaffold（`FR-17`、`AC-17.1` / `AC-17.2`、
  `FR-12`）、design-00004-persimmon-cli（§6 机制对照表、§10 实测义务）、
  decision-00020（§2 不新增依赖）
