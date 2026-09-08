---
id: issue-00035-a-variant-only-language-prints-a-branch-that-does-not-exist
type: issue
status: resolved
blocks: [plan-00033-persimmon-command]
---

# Issue: `list-langs` 给只有变体的语言照印一行 `--lang <l>`，那个分支并不存在

> `cmdLangs` 分组时算出了 `hasBase`（该语言有没有 `lang/<l>` 基础分支）却从不
> 读它，每个语言都无条件印一行 `--lang <l>`。用户照着敲 `persimmon new x
> --lang java` 得到的是「分支取不到」。

## 1. Problem

- Observed: `cli/main.go:194` 无条件 `fmt.Printf("  --lang %-15s lang/%s\n", l, l)`。
  模板仓库只有 `lang/java/ddd` 而没有 `lang/java` 时，输出里仍有
  `--lang java          lang/java` 一行；`langInfo.hasBase`
  （`main.go:163` 声明、`main.go:179` 赋值）没有任何读取点。
- Expected: `spec-00013-FR-13` 要求「只有 `lang/<l>/<v>` 而没有 `lang/<l>` 的
  语言仍成组列出，但**不印那条不存在的 `--lang <l>` 基础行**，改在组头标注该
  语言没有基础分支、只能经 `--variant` 使用」；`spec-00013-AC-13.3` 要求输出里
  没有 `--lang java` 那一行。
- Trigger: 模板仓库存在任何 `lang/<l>/<v>` 而无对应 `lang/<l>` 时执行
  `persimmon list-langs`。

## 2. Impact

- Affected: 每个读 `list-langs` 输出去挑模板的用户，只要模板仓库里有一个
  「只有变体」的语言。命中后的失败发生在下一条命令（`new --lang <l>`
  报分支取不到），而不是在列表这一步。
- Since: 迁入提交 `93bb290`（plan-00033 T1，自 ainpt 逐字复制）；机制本身
  pre-dates 本仓库。 · Still occurring: yes
- Severity: 中低。不损坏任何东西，但它是**命令自己给出的、照着敲会失败的
  指令**——比没有提示更伤：用户会怀疑自己或网络，而不是怀疑这张表。

## 3. Root Cause (first principles)

1. 分歧：`hasBase == false` 的语言应当不印 `--lang <l>` 行，实际照印。
2. 最小机制：`hasBase` 是一个**写入但从不读取**的字段。分组循环
   （`main.go:178`-`182`）区分了「基础分支」与「变体」两种输入，打印循环
   （`main.go:192`-`199`）却只按语言名与变体表打印，把这个区分丢掉了。Go 的
   编译器与 `vet` 都不报未读的结构体字段，所以这半个实现能一直编译通过。
3. 真正的根因：**打印段没有消费分组段算出的信息**——`--lang <l>` 那一行被当作
   每个语言的固定表头，而它其实是一个条件项（一个真实存在的分支的用法）。
   它**不是**：GitHub 少给了分支（分页截断是另一处缺陷，见
   `issue-00036`，与本条同函数、不同机制）；不是 `new` 该对 `--lang` 更宽容
   （`spec-00013-FR-5` 明写取不到分支就失败）；也不是排序或格式问题。

- Introduced by: `93bb290`（本仓库首次持有这份代码）。此前本仓库没有
  `list-langs`，缺陷不可能发生。

## 4. Scope (same-cause sweep)

机制是「分组时算出的条件信息在打印时未被消费」：

| Site | Same pattern | Affected | Action |
| --- | --- | --- | --- |
| `cli/main.go:194`（语言组头） | yes | yes | fixed here |
| `cli/main.go:196`-`198`（变体行） | no | no | 变体行的每一条都来自一个真实分支名，无条件可判 |
| `cli/main.go:187`（基础模板 `(default)` 行） | no | no | `main` 分支是模板仓库的前提（`spec-00013-FR-1` 的缺省 ref），不由分支表决定 |
| `cli/internal/scaffold/scaffold.go` 的汇总打印（`:420`-`:432`） | no | no | 每个计数都在打印处被读，无写而不读的字段 |

`cmdLangs` 里另有一处独立缺陷（只取第一页）已单独立案为 `issue-00036`：
同一个函数，但根因是「分页协议未跟随」，与本条的「信息未被消费」不同，
故不并案。

## 5. Reproduction (test-first)

- 失败测试：`cli/main_test.go::TestListLangsOmitsTheBaseLineForAVariantOnlyLanguage`
  ——`httptest` 服务器给出分支 `main`、`lang/go`、`lang/java/ddd`，
  调 `cmdLangs(&buf, srv.URL)`，断言输出里**不含** `--lang java`、含
  `--lang go`、含 `--variant ddd`，且 `java` 的组头写明它没有基础分支。
- 修复前该测试红：输出里有 `--lang java          lang/java` 一行，
  `strings.Contains(out, "--lang java")` 为真。

## 6. Fix

- Change: 打印循环读 `hasBase`——为真时照旧印 `--lang <l>` 行；为假时改印一行
  组头 `  <l>   no lang/<l> branch — use --variant only`（对齐列与
  `--lang` 行相同），变体行不变。为使这一行可断言，`cmdLangs` 同时改为
  `cmdLangs(out io.Writer, api string) error`：输出写进 `out`，三种失败返回
  错误由 `main` 打印并以非 0 退出（原有输出文字一字不改），模板仓库的 API 基址
  由参数给出以便 `httptest` 接管。
- Why this addresses the root cause and not the symptom: 让打印段消费分组段已经
  算出的那一位，而不是在别处补一个特例；`hasBase` 从此有读取点，同一位信息
  只有一个来源。
- Alternatives rejected: 干脆不列出「只有变体」的语言——`spec-00013-FR-13` 明写
  它仍成组列出，且变体是可用的；把 `--lang <l>` 行留着但加注「不存在」——
  留着一条照着敲会失败的用法，正是 AC-13.3 要去掉的那一行。

## 7. Verification

已执行（`cli/`，修复已施加）：

1. **§5 的失败测试，红→绿**：修复前 `TestListLangsOmitsTheBaseLineForAVariantOnlyLanguage`
   两条断言同时红——实际输出里有 `  --lang java            lang/java` 一行，
   且没有任何「java 没有基础分支」的标注；修复后该行变为
   `  java                   no lang/java branch — use --variant only`，
   `--lang go` 与 `    --variant ddd        lang/java/ddd` 照旧，用例绿。
2. `go -C cli test ./...` 四个包全绿；`gofmt -l cli` 空输出；
   `go -C cli vet ./...` 无发现。
3. 覆盖率：`cli`（`package main`）语句覆盖 60.4%——本轮首次有测试的包，90% 的门
   随 plan-00033 的 T2b / T8 落地。
4. `npm test` 73 个文件 / 2100 个用例全过、`npm run typecheck` 无输出。

## 8. Follow-through

- Detection gap: `cli/` 迁入时没有 `main_test.go`——`package main` 的
  `cmdLangs` / `cmdNew` 一条测试都没有，`hasBase` 的空转因此无人发现。本 issue
  连带建立了 `cli/main_test.go` 与「`cmdLangs` 可注入 API 基址」这一可测形态，
  `spec-00013` 的 `FR-13` / `FR-14` 余下的 AC 随 plan-00033 的 T2b 补齐。
  静态层面的守卫：Go 无「未读字段」检查，本轮不引入新的静态工具
  （`design-00004` §10 明写 Go 侧的复杂度/重复门不在本轮）。
- Doc verdict: **code was non-conformant**——`spec-00013-FR-13` 与 `AC-13.3`
  已写明更正后的行为，文档不动。
- Residual state: none——`list-langs` 只读不写。

## Links

- Blocks: plan-00033-persimmon-command（T2 第 2 处缺陷）
- Related: issue-00036-list-langs-stops-at-the-first-page-of-branches（同函数、
  不同根因）、spec-00013-persimmon-scaffold（`FR-13`、`AC-13.3`）
