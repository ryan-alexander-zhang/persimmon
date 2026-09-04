---
id: decision-00019-whiteboard-standalone-repo
type: decision
status: active
constrains: [design-00001-docs-whiteboard]
---

# Decision: 白板迁出模板、独立成仓——一处安装服务多个项目，模板只留流程配置

> 白板代码与其全部文档从 ai-native-project-template 迁到本仓库（persimmon）。
> 模板不再携带任何白板代码与白板实例文档，只保留 `whiteboard.config.yaml`
> （流程配置，属于每个项目）与 `.gitignore` 里对 `.whiteboard/` 的忽略。
> 下一步方向定为「多 workspace」：一个白板进程注册并切换多个项目目录。
> 推翻 `design-00001` §8「代码放 `tools/whiteboard/`（独立 package.json，
> 不影响模板本体）」所隐含的「白板随模板分发」前提。

## 1. 需要做这个决定的原因

- 白板此前作为 `tools/whiteboard/` 随模板分发。`ainpt new` 创建的每个项目都
  带一份完整源码、各自 `npm install`、各自构建、各自占一个端口。用户有几个
  项目就要起几个白板进程，代码副本之间没有升级通路。
- 模板仓库的 `docs/` 里全部实例文档（约 118 份）都是白板自身的 idea / prd /
  spec / rule / decision / design / plan / issue / record，CONTEXT.md 整篇是白板
  词汇表。模板名义上是「AI Native 项目模板」，实际内容是白板项目本身，两个
  关注点混在一个仓库里。
- 域主于 2026-09-04 的评审对话中提出并裁定：拆分；新增 workspace 概念；
  参考 t3code、orca 的「一个后端、项目即注册的目录、多前端壳」形态，但不把
  白板改造成以终端为中心的 ADE。

## 2. 决定

| # | 做法 | 理由 |
| --- | --- | --- |
| 1 | 白板代码 `tools/whiteboard/` 与全部白板相关实例文档、`CONTEXT.md` 迁入本仓库；本仓库由 `ainpt new` 从模板 `1c88a684` 生成，因此自身就是一个模板项目 | 白板继续用自己渲染自己的文档（自举），并可通过 `ainpt update` 跟随模板骨架升级 |
| 2 | 模板仓库删除 `tools/whiteboard/`、迁走的实例文档与 `CONTEXT.md`；README 改为一段指向本仓库的说明 | 模板回到「只有骨架与根指南」的本意 |
| 3 | `whiteboard.config.yaml` 留在模板（并随 `ainpt new` 进入每个项目） | 它是 `rule-00001` 的机器可读载体，声明的是项目自己的文档流程；也是白板识别一个项目根目录的标志 |
| 4 | 不保留 git 历史，以 `ainpt new` 的干净拷贝为起点 | issue / plan / record 文档已是这段历史的书面版；filter-repo 再叠骨架的成本不值 |
| 5 | 本轮不改动代码位置（仍在 `tools/whiteboard/`）与启动方式（向上找 `whiteboard.config.yaml`） | 迁移与重构分开落地，保证迁移本身零行为变更、测试原样通过 |
| 6 | 下一步方向：多 workspace——用户目录下的注册表记录多个项目根目录，一个进程按 workspace 分实例，UI 提供切换器；`ainpt new` 完成时自动注册 | 见 `idea-00004-multi-workspace`；该方向经 prd → spec 再落地，本决定只定方向 |

## 3. 考虑过的其他选项

| 选项 | 结论与理由 |
| --- | --- |
| 维持现状，每个项目一份白板 | **否决**。副本无升级通路，多项目多进程；模板与白板两个关注点持续混杂 |
| 白板留在模板，只做全局安装脚本 | **否决**。文档仍全部堆在模板 `docs/` 里，模板依旧不是模板 |
| 用 `git filter-repo` 切出历史再叠模板骨架 | **否决**。骨架文件（AGENTS.md、docs/**/README.md 等）同时来自历史与模板，合并两份来源的代价高于保留历史的收益；书面记录已足够 |
| 迁移时顺带把代码提到仓库根（根 package.json、`npx` 启动） | **否决（本轮）**。117 处文档路径引用 `tools/whiteboard/`，与「零行为变更」的迁移目标冲突；留给 workspace 轮 |

## 4. 后果

**接受的代价**

- 白板的提交历史留在模板仓库，本仓库从一个 `init` 提交开始。
- 仓库布局暂时仍带模板痕迹（`tools/whiteboard/`），配置测试仍读仓库根的 `whiteboard.config.yaml`。
- 模板仓库失去自带的示例文档；新用户打开模板项目的白板看到的是空板。

**得到的**

- 一个白板项目、一套文档、一个升级通路；模板回到纯模板。
- 本仓库既是白板的实现，也是白板的第一个 workspace，自举关系保持。

**不变的**

- 白板的全部行为、API、配置契约、测试。
- `whiteboard.config.yaml` 的位置与格式；每个项目仍自带一份。
- `rule-00001-docs-workflow` 的内容：它随白板迁入本仓库，但约束的是所有采用模板的项目。

## 5. 这个决定约束什么

- `design-00001-docs-whiteboard` §8：「不影响模板本体」的前提不再成立，据实校正为「本仓库即白板仓库」。
- 模板仓库的 README 与 `template.json`：不得再引入白板代码；`whiteboard.config.yaml` 继续随模板分发。
- 后续 workspace 工作（`idea-00004-multi-workspace` 起）落地时，须把代码位置与启动方式的重构一并记录，并回填本决定的 `constrains`。
