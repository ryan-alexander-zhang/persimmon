---
id: issue-00034-a-template-coordinate-with-an-empty-owner-passes-validation
type: issue
status: resolved
blocks: [plan-00033-persimmon-command]
---

# Issue: 创建标记里 `/repo` 这样的模板坐标通不过校验却被放行

> `update` 用 `strings.SplitN(lock.Template, "/", 2)` 只数段数，`"/repo"`
> （owner 为空）与 `"owner/repo/extra"`（两个斜杠）都得到两段而被判为合法，
> 命令带着一个不是 `owner/repo` 的坐标去打 GitHub，用户收到的是一句网络层的
> 404 而不是「这个值形态不对」。

## 1. Problem

- Observed: `cli/internal/scaffold/scaffold.go:383` 的
  `parts := strings.SplitN(lock.Template, "/", 2); if len(parts) != 2` 对
  `"/repo"` 得到 `["", "repo"]`（两段，放行，owner 空）、对 `"owner/repo/extra"`
  得到 `["owner", "repo/extra"]`（两段，放行，repo 里带斜杠）。两种都继续往下走
  `resolveSHA`，命令最终报的是 `resolve sha for <ref>: 404 Not Found`
  一类的远端状态。
- Expected: `spec-00013-FR-11` 要求「标记里的模板坐标不是恰 `owner/repo` 形态
  （恰一个斜杠、两段都非空）」时说明是哪一种并以非 0 退出，不改动项目内任何
  文件；`spec-00013-AC-11.4`（`/repo`）与 `spec-00013-AC-11.5`
  （`owner/repo/extra`）要求命令**指明该值不是 `owner/repo` 形态**。
- Trigger: 在一个创建标记被手工改过（或由别的工具写过）的项目里执行
  `persimmon update`。`new` 自己写出的坐标恒为 `o.Owner + "/" + o.Repo`，两段
  在缺省与环境变量覆盖下都非空，所以缺陷只在标记被外部写过时露头。

## 2. Impact

- Affected: 任何创建标记的 `template` 不是恰 `owner/repo` 形态的项目——手工编辑、
  从别处拷来的标记、或 `AINPT_OWNER=""` 一类的环境残留写出的标记。
- Since: 迁入提交 `93bb290`（plan-00033 T1，自 ainpt 逐字复制）；机制本身
  pre-dates 本仓库。 · Still occurring: yes
- Severity: 低。不损坏数据（校验只在 `update` 的最前段，此时一个文件都还没动），
  代价是一句答不到点子上的错误信息：用户看到 404 会去查网络与权限，而问题在
  自己那份标记的一个空段。

## 3. Root Cause (first principles)

1. 分歧：`"/repo"` 应被判为不合式，实际被判为合式。
2. 最小机制：`scaffold.go:383` 的判据是 `SplitN(..., 2)` 的**段数**。
   `SplitN` 的第二个参数是上限而不是断言——它把「至多切两段」当成了「恰好两段」。
   段数为 2 只说明**至少有一个斜杠**，既不排除空段（`"/repo"`、`"owner/"`），
   也不排除第二段里还有斜杠（`"owner/repo/extra"`）。
3. 真正的根因：**把一个分隔符解析函数的返回长度当作形态校验**。`owner/repo` 的
   形态有三个条件（恰一个斜杠、owner 非空、repo 非空），`len(parts) != 2` 只覆盖
   了「至少一个斜杠」这一个。
   它**不是**：远端 404（那是这一放行的下游症状）；不是 `resolveSHA` 缺少
   错误处理（它照实报了状态）；也不是 `new` 写错了坐标（`new` 写出的恒合式）。

- Introduced by: `93bb290`（本仓库首次持有这份代码）。此前本仓库没有 `update`
  这条路径，缺陷不可能发生。在 ainpt 里这一行自脚手架的 `update` 落地起就在。

## 4. Scope (same-cause sweep)

机制是「以 `SplitN` 的段数代替形态校验」：

| Site | Same pattern | Affected | Action |
| --- | --- | --- | --- |
| `cli/internal/scaffold/scaffold.go:383`（`update` 读坐标） | yes | yes | fixed here |
| `cli/main.go:172`（`list-langs` 从 `lang/<l>[/<v>]` 分组） | yes | no | 那里 `SplitN` 用于**解析**而不是校验：分支名来自 GitHub，git 不允许以 `/` 结尾或含空段的引用名，故不存在空段输入；`lang/a/b/c` 的第二段整体作变体列出，不产生错误判定 |
| `cli/internal/scaffold/scaffold.go:346`（`resolveSHA` 拼 URL） | no | no | 不解析坐标，收到的是已校验过的 owner / repo |

## 5. Reproduction (test-first)

- 失败测试：`cli/internal/scaffold/scaffold_test.go::TestUpdateRejectsATemplateThatIsNotOwnerSlashRepo`
  ——在临时目录里写一份 `.ainpt.json`（`commit` 非空，`template` 分别为 `/repo`
  与 `owner/repo/extra`），调 `Update(dir)`，断言错误信息里出现 `owner/repo`
  且项目内文件一字未改。
- 修复前该测试红：命令不在校验处返回，而是走到 `resolveSHA`，返回的错误是
  远端状态（有网时 `resolve sha for main: 404 Not Found`，无网时拨号失败），
  两种都不含 `owner/repo` 字样。
- 修复后该测试绿且**不打网络**：校验在任何 HTTP 之前返回。

## 6. Fix

- Change: `scaffold.go` 的坐标校验改用 `strings.Cut` 并断言三个条件——恰一个
  斜杠（`strings.Contains(repo, "/")` 为假）、owner 非空、repo 非空；错误信息
  写为 `invalid template %q in .ainpt.json — expected owner/repo`。
- Why this addresses the root cause and not the symptom: 判据从「切出几段」改为
  「形态的三个条件」，`"/repo"`、`"owner/"`、`"owner/repo/extra"` 与
  `"norepo"` 四种不合式在同一处、在任何网络请求之前被同一条判据拦下。
- Alternatives rejected: 正则 `^[^/]+/[^/]+$`——同样的语义，多一个包与一次编译，
  三个布尔条件读起来更直白；在 `resolveSHA` 里补校验——那是下游，`update` 的
  前提校验属 `FR-11` 的那一段，放到下游会让「项目内文件一字未改」这条保证
  依赖调用顺序。

## 7. Verification

已执行（`cli/`，修复已施加）：

1. **§5 的失败测试，红→绿**：修复前两个子用例皆红，报的正是下游的远端状态——
   `scaffold_test.go:327: Update("/repo") error = resolve sha for main: 404 Not
   Found, want it to name the owner/repo shape`、`Update("owner/repo/extra")`
   同文；修复后两个子用例绿，且**不再发出任何 HTTP 请求**（子用例耗时自
   1.16s / 0.37s 降到 0.00s，是「校验在网络之前返回」的直接证据）。
2. `go -C cli test ./...` 四个包全绿；`gofmt -l cli` 空输出；
   `go -C cli vet ./...` 无发现。
3. 覆盖率：`cli/internal/scaffold` 语句覆盖自迁入时的 25.7% 升至 **28.8%**
   （门为「不低于记录值」，只升不降）。
4. 仓库其余部分未受影响：`npm test` 73 个文件 / 2100 个用例全过、
   `npm run typecheck` 无输出。

## 8. Follow-through

- Detection gap: 迁入随行的 9 个测试全部围绕 `mergeTree` 与 `copyTree`，
  `Update` 的前提校验段一条测试都没有（`spec-00013-FR-11` 的五条 AC 里
  `AC-11.1` … `AC-11.3` 也仍无测试，它们在 plan-00033 的 T2b）。本 issue 加的
  是坐标那两条；同一段的另三条随 T2b 补齐。
- Doc verdict: **code was non-conformant**——`spec-00013-FR-11` 与
  `AC-11.4`/`AC-11.5` 已写明正确行为（该 spec §1 就是按更正后的行为写定的），
  文档不动。
- Residual state: none。校验只影响 `update` 的入口判定，已建出的项目与已写下的
  创建标记都不受影响；坐标不合式的标记由用户改正后 `update` 即可继续。

## Links

- Blocks: plan-00033-persimmon-command（T2 第 1 处缺陷）
- Related: spec-00013-persimmon-scaffold（`FR-11`、`AC-11.4`、`AC-11.5`）、
  decision-00020-unified-go-cli（§2 第 1 条「迁入时逻辑不改」的四处例外之一）
