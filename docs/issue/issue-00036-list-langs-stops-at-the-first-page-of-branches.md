---
id: issue-00036-list-langs-stops-at-the-first-page-of-branches
type: issue
status: resolved
blocks: [plan-00033-persimmon-command]
---

# Issue: `list-langs` 只取分支表的第一页，第 101 个分支起看不见

> `cmdLangs` 打一次 `…/branches?per_page=100` 就收工，GitHub 的 `Link` 头没人
> 读。模板仓库的分支超过 100 个时，后面的语言与变体在输出里整个消失，而命令
> 以 0 退出——用户拿到的是一张沉默地不完整的表。

## 1. Problem

- Observed: `cli/main.go:143`-`144` 只发一次 `GET
  https://api.github.com/repos/<owner>/<repo>/branches?per_page=100`，解码应答
  即结束；`resp.Header.Get("Link")` 从未被读。分支数超过 100 时只有第一页进入
  分组，命令仍以 0 退出。
- Expected: `spec-00013-FR-13` 要求「取分支时应**跟随分页直到取尽**，不因某一
  页的条数上限而截断」；`spec-00013-AC-13.4` 以「`lang/zzz` 只出现在第二页」
  为例，要求 `zzz` 也在输出里。
- Trigger: 模板仓库的分支数超过单页上限（GitHub 的 `per_page` 上限为 100）时
  执行 `persimmon list-langs`。

## 2. Impact

- Affected: 分支多于 100 的模板仓库的每个用户。缺省坐标
  `ryan-alexander-zhang/ai-native-project-template` 今天远不到 100 个分支，故
  现实里尚未触发；`AINPT_OWNER` / `AINPT_REPO` 指向别的仓库时立即可及。
- Since: 迁入提交 `93bb290`（plan-00033 T1，自 ainpt 逐字复制）；机制本身
  pre-dates 本仓库。 · Still occurring: yes
- Severity: 中。失败形态是**静默的不完整**加 0 退出码——没有任何信号说「还有」，
  用户会以为那个语言不存在。随模板仓库长大而必然到来。

## 3. Root Cause (first principles)

1. 分歧：分支表应取尽，实际只取一页。
2. 最小机制：`main.go:143` 的请求把 `per_page=100` 当成了「一次拿全」的写法。
   `per_page` 是**页大小**，不是「不分页」；GitHub 的集合端点用 `Link` 头
   （`rel="next"`）宣告还有下一页，`main.go:144`-`160` 这段代码里没有任何
   循环，也没有读 `Link`。
3. 真正的根因：**把一个分页集合端点当作单次请求的端点**——协议里「还有更多」
   的表达（`Link: …; rel="next"`）没有对应的读取，于是「够大的页」被当成了
   「全部」。
   它**不是**：`per_page` 给小了（把它调大也仍有上限）；不是 GitHub 少给了
   数据（它给了 `Link`，只是没人读）；也不是分组或排序丢了条目（分组照实处理
   它收到的每一条，见 `issue-00035` 的另一处机制）。

- Introduced by: `93bb290`（本仓库首次持有这份代码）。此前本仓库没有
  `list-langs`，缺陷不可能发生。

## 4. Scope (same-cause sweep)

机制是「分页集合端点只读一页」。`cli/` 里对 GitHub 的调用共三处：

| Site | Same pattern | Affected | Action |
| --- | --- | --- | --- |
| `cli/main.go:143`（`GET /repos/…/branches`，集合） | yes | yes | fixed here |
| `cli/internal/scaffold/scaffold.go:346`（`GET /repos/…/commits/<ref>`，单个对象） | no | no | 取的是一个 ref 的 SHA，应答是标量，端点不分页 |
| `cli/internal/scaffold/scaffold.go:103`（`codeload …/tar.gz/<ref>`，字节流） | no | no | 一个 tarball 的完整字节流，无分页概念 |

## 5. Reproduction (test-first)

- 失败测试：`cli/main_test.go::TestListLangsFollowsPaginationToTheLastPage`
  ——`httptest` 服务器第一页给 `lang/go` 并带
  `Link: <…?per_page=100&page=2>; rel="next"`，第二页给 `lang/zzz` 且不带
  `Link`；调 `cmdLangs(&buf, srv.URL)`，断言输出里同时有 `go` 与 `zzz`，且
  服务器被请求了两次。
- 修复前该测试红：输出里没有 `--lang zzz`，服务器只被请求一次。

## 6. Fix

- Change: `cmdLangs` 把单次请求改为循环——每页解码后追加进分支表，取
  `resp.Header.Get("Link")` 里 `rel="next"` 的 URL 作为下一次的地址，取不到即
  结束；新增小函数 `nextLink(header string) string` 只做这一件事。三种失败的
  错误文字与判定次序不变（发不出、非 200、不可解析），每一页都照同一套判。
- Why this addresses the root cause and not the symptom: 读的是协议里表达
  「还有更多」的那个字段，故与总页数、页大小和将来的默认值都无关；把
  `per_page` 调大只是把同一个截断推远。
- Alternatives rejected: 引入 `go-github` 一类客户端库——为一个 `Link` 头引入
  一份依赖，而 `cli/` 是零依赖模块（plan-00033 T1）；用 `page=1,2,3…` 数着翻页
  直到空页——多打一次请求，且要自己猜「空页即结束」，`Link` 是服务端给的
  权威答案。

## 7. Verification

已执行（`cli/`，修复已施加）：

1. **§5 的失败测试，红→绿**：修复前 `TestListLangsFollowsPaginationToTheLastPage`
   两条断言同时红——输出里没有 `--lang zzz`，且 `asked for 1 page(s), want 2`
   （`Link` 头被无视）；修复后 `zzz` 与 `go` 同在输出里，stub 服务器被请求
   两次，用例绿。
2. `go -C cli test ./...` 四个包全绿；`gofmt -l cli` 空输出；
   `go -C cli vet ./...` 无发现。
3. 覆盖率：`cli`（`package main`）语句覆盖 60.4%（同 `issue-00035` §7）。
4. `npm test` 73 个文件 / 2100 个用例全过、`npm run typecheck` 无输出。

## 8. Follow-through

- Detection gap: 同 `issue-00035`——迁入时 `package main` 无测试。分页这一条
  即便有测试也容易漏：单页装得下的 stub 数据永远不会红。本 issue 的测试因此
  **以 `Link` 头驱动两页**而不是以条目数逼近上限，`spec-00013-AC-13.4` 的
  Given 也是这样写的。
- Doc verdict: **code was non-conformant**——`spec-00013-FR-13` 与 `AC-13.4`
  已写明更正后的行为，文档不动。
- Residual state: none——`list-langs` 只读不写；此前被截断的输出没有留下任何
  持久痕迹。

## Links

- Blocks: plan-00033-persimmon-command（T2 第 3 处缺陷）
- Related: issue-00035-a-variant-only-language-prints-a-branch-that-does-not-exist
  （同函数、不同根因）、spec-00013-persimmon-scaffold（`FR-13`、`AC-13.4`）
