---
id: issue-00029-a-shipped-ts-source-cannot-run-from-node-modules
type: issue
status: resolved
blocks: [plan-00027-multi-workspace]
---

# Issue: 装好的包一敲就崩——Node 不给 `node_modules` 下的 `.ts` 剥类型

> `files` 里发的是 `src/*.ts`，`bin/persimmon.js` 直接 `import '../src/config.ts'`。
> 一旦这份包被装进 `node_modules`（全局安装或 `npx` 缓存都是），Node 拒绝对
> 其下的 `.ts` 剥类型，`persimmon list` 以 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`
> 崩在第一条 import 上——`spec-00011-FR-20` 的两种安装形态都不成立。

## 1. Problem

- Observed: `npm pack` 与 `npm install -g --prefix <tmp> <tarball>` 都成功
  （退出码 0，bin 软链已建），随后执行装好的命令：

  ```
  $ HOME=<tmp>/home <tmp>/prefix/bin/persimmon list
  node:internal/modules/typescript:155
      throw new ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING(filename);
            ^
  Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]: Stripping types is
  currently unsupported for files under node_modules, for
  "file://<tmp>/prefix/lib/node_modules/@ryan-alexander-zhang/persimmon/src/config.ts"
  Node.js v26.5.0
  === EXIT: 1 ===
  ```

  `npx` 形态同一句话，只是路径落在 npx 缓存里
  （`<home>/.npm/_npx/a3615dd1bf6e0e97/node_modules/@ryan-alexander-zhang/persimmon/src/config.ts`）。
- Expected: `spec-00011-AC-20.1`——「包已全局安装，在任意目录执行
  `persimmon list`，命令可执行并输出注册表」；`spec-00011-AC-20.2`——`npx`
  形态输出与全局安装相同。`spec-00011-FR-20` 还写了「两种安装形态下命令行为
  相同」。今天两种形态一致地不可执行，只有仓库内的第三种形态可用。
- Trigger: 任何一次「把这个包装到 `node_modules` 里再执行它的 bin」。与命令、
  与注册表内容、与 cwd 无关：崩在 `bin/persimmon.js` 的第一条 `../src/*.ts`
  import 上，任何子命令都到不了自己的第一行。

## 2. Impact

- Affected: 装了这个包的每一个人、两种安装形态的每一条命令。仓库内
  `npm start` / `node bin/persimmon.js` 不受影响（源码不在 `node_modules`
  下），所以开发全程看不见——`plan-00027` 的第 1 到第 6 步验证全绿，第 7 步
  才第一次踩到。
- Since: `07fc1a7`（2026-09-07，`plan-00027` T2 把仓库变成 npm 包） ·
  Still occurring: yes
- Severity: 高，且是「发布阻断」级：`spec-00011-FR-20` 的交付物就是「可发布
  形态」（`plan-00027` Out of Scope 第 2 条），而这个形态装上就是崩。
  `AC-20.1`/`AC-20.2` 与 `plan-00027` 第 7 步在修好前都不可能通过，
  `spec-00011` §7 已写明「`AC-20.2` 在实测通过前不计已验证」。

## 3. Root Cause (first principles)

1. 分歧：仓库布局与分发布局被当成同一件事。在仓库里 `bin/persimmon.js`
   与 `src/*.ts` 是普通目录下的文件，Node 给 `.ts` 剥类型（`engines: node >= 23.6`
   正是为此）；同一份文件树装进 `node_modules` 后，Node 对其下的 `.ts`
   一律拒绝剥类型——同样的相对 import，在两处一个能跑一个必崩。
2. 最小机制：`bin/persimmon.js:6-9` 的四条 import 写的是 `.ts` 说明符
   （`../src/config.ts`、`../src/host.ts`、`../src/workspaceAvailability.ts`、
   `../src/workspaceRegistry.ts`），而 `package.json:12-17` 的 `files` 把
   `src/` 整个发出去。装好之后这四个说明符解析到
   `<prefix>/lib/node_modules/@ryan-alexander-zhang/persimmon/src/*.ts`，
   Node 在模块翻译阶段（`node:internal/modules/typescript:155`）抛
   `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`。第一条 `../src/config.ts`
   就抛，`src/` 内部另外 28 个 `./x.ts` 说明符只是同一机制的下游。
3. 真正的根因：**发的是「作者写的东西」而不是「能跑的东西」。** Node 关掉
   `node_modules` 下的类型剥离是刻意的，理由正是这一条——已发布的包必须自带
   可直接执行的 JavaScript，不能把自己的编写语言变成每个使用者的运行时代价；
   这条限制没有开关：`--experimental-strip-types` 依旧抛同一句，
   `--experimental-transform-types` 在 Node 26 已不存在（`node: bad option`），
   `NODE_OPTIONS` 里也不许出现它。所以这不是「Node 的实验特性还不稳」，
   而是「`files` 里必须是构建产物」这条契约被 `src/` 违反了。

   它**不是**这些症状：不是 `postinstall` 或 `node-pty` 原生构建失败（`npm
   install -g` 与 `npx` 都以 0 退出，加 `--allow-scripts` 让 `postinstall`
   跑过之后同一句话照旧）；不是包名、bin 名或软链错（软链正确指向
   `bin/persimmon.js`）；不是缺依赖（449 个依赖装齐了）；也不是 Node 版本
   太低（v26.5.0 远高于 `engines` 的 23.6——版本再高也不会放开这条）。

- Introduced by: `07fc1a7`（`plan-00027` T2）。此前的 `tools/whiteboard/package.json`
  是 `private: true`、无 `files`、无 `prepack`、bin 名为 `whiteboard`，
  根本不存在可安装的产物，也就不存在「装到 `node_modules` 下的副本」——
  缺陷不可能发生。`design-00003` §10 把这份布局写成了设计事实
  （「`files` 只含运行所需（`bin/`、`src/`、`dist/web/`、`scripts/`）」），
  T2 只是照着落地，所以这条是文档先错、代码后随（见 §8）。

## 4. Scope (same-cause sweep)

机制是「已安装副本里被执行/被 import 的文件是 `.ts`」。扫了 `files` 发出去的
四项与每个入口：

| Site | Same pattern | Affected | Action |
| --- | --- | --- | --- |
| `bin/persimmon.js:6-9`（四条 `../src/*.ts`） | yes | yes | 缺陷入口，按 §6 改 |
| `package.json:12-17` 的 `files` 含 `src/` | yes | yes | 发的就是不能跑的东西，按 §6 改 |
| `src/**/*.ts` 内部 28 个 `./x.ts` 说明符 | yes | yes | 同一机制的下游；随 `src/` 不再发出而消失（编译产物里说明符改写为 `.js`） |
| `scripts/fix-pty-permissions.js`（`postinstall` 入口） | no | no | 已是 `.js`，且只 import `node:fs`——装好的副本里照常运行 |
| `scripts/sync-docs.sh` | no | no | shell 脚本，不经 Node 加载（且与包运行无关，只是随 `scripts/` 一并发出） |
| `dist/web/**`（`prepack` 的 vite 产物） | no | no | 已是构建好的 JS，全目录无 `.ts` 说明符；浏览器加载，不经 Node 类型剥离 |
| `src/host.ts:33`、`src/server.ts:284` 的 `../dist/web` | no | no | 不是类型剥离问题，但**任何把服务端编译到别处的修复都会挪动它们的相对基点**——§6 的选型把它列为硬约束 |
| 仓库内 `npm start` / `node bin/persimmon.js` / `test/cli.test.ts`、`test/startup.test.ts` 生成的子进程 | yes | no | 源码不在 `node_modules` 下，Node 照常剥类型——这正是缺陷在开发与测试里全程不可见的原因 |

## 5. Reproduction (test-first)

诚实的复现就是安装本身，逐条记录如下（`HOME` 与 prefix 都指向临时目录，
不碰真实的 `~/.persimmon` 与全局前缀）：

```
$ npm pack --pack-destination <tmp>                       # prepack 跑 vite build
ryan-alexander-zhang-persimmon-0.1.0.tgz                  # 132 files, 1.6 MB
$ HOME=<tmp>/home npm install -g --prefix <tmp>/prefix <tmp>/*.tgz
added 449 packages in 28s                                 # EXIT 0，bin 软链已建
$ cd <tmp>/elsewhere && HOME=<tmp>/home <tmp>/prefix/bin/persimmon list
Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]: ...src/config.ts        # EXIT 1
$ cd <tmp>/elsewhere && HOME=<tmp>/home2 npx --yes --package <tmp>/*.tgz persimmon list
Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]: ..._npx/.../src/config.ts  # EXIT 1
$ HOME=<tmp>/home node bin/persimmon.js list               # 仓库内，同一份代码
                                                           # EXIT 0（注册表为空，输出为空）
```

对照实验（都排除了旁支解释）：加
`--allow-scripts=@ryan-alexander-zhang/persimmon,node-pty` 重装一遍，
`postinstall` 放行后同一句话照旧；`NODE_OPTIONS=--experimental-strip-types`
照旧；`--experimental-transform-types` 在 NODE_OPTIONS 里被拒
（`not allowed in NODE_OPTIONS`），作为 CLI 旗标在 Node 26 已不存在
（`bad option`）。

**能进测试套件的复现（本轮只写在这里，不落代码）**，两级：

- **默认级（`npm test`，无网络，秒级）——`test/distribution.test.ts`**：
  在 `mkdtempSync` 出的临时目录里造一份「假安装树」
  `<tmp>/node_modules/@ryan-alexander-zhang/persimmon/`，把 `bin/`、
  发布产物目录与 `package.json` 拷进去，再把仓库 `node_modules/` 下的每一项
  软链成 `<tmp>/node_modules/` 的同级兄弟（依赖照常按目录上溯解析——已实测
  `express`、`ws`、`node-pty` 三个都能从这棵假树里 import 成功），然后
  `spawnSync(process.execPath, [<tmp>/.../bin/persimmon.js, 'list'])`，
  `HOME` 指向临时目录。修复前它以 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`
  失败（已实测），修复后应 0 退出并输出空列表。它守的正是根因那句话——
  「已安装副本里被 import 的必须是能跑的东西」——而不是安装器的行为。
- **实测级（opt-in，不进 `npm test`）——安装形态实测**：`npm pack` +
  `npm install -g --prefix` + `npx --package`，即 §5 上半段那串命令。
  tarball 是本地文件，但**它的依赖必须走 registry**：把 `HOME` 指向干净的
  临时目录后 npm 缓存也是空的，`npm install -g --offline` 直接
  `ENOTCACHED`（已实测）。所以它有网络依赖、耗时数十秒、且跑一次会装 449
  个包——按 `TESTING.md` 的分级它是 E2E/smoke 级的一条，属于
  `spec-00011` §7 的「实测义务」与 `plan-00027` 第 7 步，应作为单独的、显式
  触发的检查（例如 `npm run test:install`）存在，不进默认套件。

- Failing test: 上面第一条（`test/distribution.test.ts::the installed layout
  runs from node_modules`）——修复前 fails with
  `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING ... /src/config.ts`

## 6. Fix

本节原是**给域主选的提案**；域主已定 **(a)**，`engines` 留在 `>=23.6`，按此落地
（见 §7）。硬约束三条：(i) 发出去的东西里
不能有被 Node 加载的 `.ts`；(ii) 仓库自己的 `npm start` 与两个 spawn 真入口
的测试（`test/cli.test.ts`、`test/startup.test.ts`）行为不变；(iii)
`src/host.ts:33` 与 `src/server.ts:284` 用 `new URL('../dist/web',
import.meta.url)` 定位静态目录——服务端模块搬家会挪动这个相对基点。

- **(a) 构建期把服务端编译成 JS，`files` 里换掉 `src/`（推荐）**，且编译目标
  取包根下**一层**的 `lib/`（`/lib/` 已被 `.gitignore` 锚定忽略，见
  issue-00017 那条注释）：
  - 新增 `tsconfig.build.json`（`extends` 根 `tsconfig.json`，`noEmit: false`、
    `rootDir: "src"`、`outDir: "lib"`、`rewriteRelativeImportExtensions: true`
    ——已在 scratch 里用本仓库的 tsc 5.9.3 实测：`./b.ts` 说明符在产物里被
    改写为 `./b.js`，`include` 里的 `.js` 文件（`allowJs`）也照改且保留
    shebang）；
  - `build` 变成「vite build + tsc -p tsconfig.build.json」（`prepack` 已经
    跑 `build`，不动）；
  - `bin/persimmon.js` 的四条 import 改成 `../lib/*.js`；
  - `files` 改为 `["bin/", "lib/", "dist/web/", "scripts/"]`——`src/` 不再发出。
  - **关键红利**：`lib/*.js` 与 `src/*.ts` 同为「包根下一层」，
    `../dist/web` 在两种布局里都指向 `<root>/dist/web`，
    `src/host.ts` 与 `src/server.ts` **一行不改**（编译到 `dist/server/`
    的那种写法会把它们变成 `dist/dist/web`，必须再改两处或把静态目录从入口
    穿进 `HostOptions`——这是 `dist/server/` 变体比 `lib/` 变体多出来的代价）。
  - 代价：仓库内 `npm start` 与那两个测试需要 `lib/` 先存在。`npm start`
    这一侧几乎不算代价——它本来就服务**已构建**的 UI（`DEVELOPMENT.md`
    Commands 就这么写），`npm run build` 本来就是前置步骤；测试这一侧需要
    vitest `globalSetup` 跑一次 `tsc -p tsconfig.build.json`（增量后亚秒级），
    是默认套件多出来的一点固定开销。
- **(b) 入口做运行时回退**：`bin/persimmon.js` 里 `existsSync(lib)` 就 import
  编译产物、否则 import `src/*.ts`。开发零代价，但把「我现在是哪种布局」
  变成入口里一条**隐藏分支**（`CODE_QUALITY` 明令反对），四条静态 import
  得改成动态 `await import`，并且带一个经典的 3am bug：仓库里存着一份过期的
  `lib/`，`npm start` 会**静默**跑旧代码而不是改过的源码。它还把
  `src/` 继续发出去（发一份永远跑不到的死代码）。
- **(c) 编译整棵树（`rootDir: "."`，产物含 `lib/bin/persimmon.js`），
  `bin` 指向产物，源 bin 留给开发**：能同时免掉 (a) 的构建依赖与 (b) 的分支
  （已实测 `allowJs` + `rewriteRelativeImportExtensions` 会把
  `bin/cli.js` 里的 `../src/a.ts` 改写为 `../src/a.js` 并保留 shebang），
  但产物里的服务端落在包根下**两层**（`lib/src/host.js`），约束 (iii) 破了，
  又得改那两处或穿参——比 (a) 多一处改动换来一点测试速度。
- **(d) 安装期编译（`postinstall` 跑 tsc）**：直接否。typescript 变成运行时
  依赖、安装慢、且实测里 npm 11.17 **默认就拦住了我们的 `postinstall`**
  （`npm warn allow-scripts ... not yet covered by allowScripts`）——任何把
  正确性押在安装脚本上的修复都比今天更脆。
- **(e) 保留 `.ts` 发出、靠旗标放开**：不可能，根因第 3 条已实测三种旗标全废。

推荐 **(a)**：它是唯一一条真正遵守「发布可运行的 JavaScript」这条契约的路，
而不是在入口里替 Node 猜自己身处哪种布局；把产物放在包根下一层的 `lib/`，
`../dist/web` 两种布局同解，除 `bin/persimmon.js` 与两个配置文件外**没有源码
改动**；换来的唯一代价是那两个 spawn 真入口的测试要先编译一次，而
`npm start` 本来就跑在 `npm run build` 之后，几乎没有新的开发摩擦。

- Open Question（只有域主能定）——**已定**：修复后**已安装的包不再需要类型
  剥离**，`ARCHITECTURE.md` §2 那行「Node.js ≥ 23.6（TypeScript type stripping;
  `node-pty` native module）」的前半个理由只对**仓库自己的开发运行**成立。
  `engines` 是给使用者的门槛，真实下界改由 `node-pty` 预编译产物与
  `target: ES2023` 决定。域主定：`engines` **留在 `>=23.6`**（与开发环境一致、
  更保守）；§2 那行的理由已按「开发运行需要类型剥离；安装后的包只需
  `node-pty` 的原生模块」改写。

## 7. Verification

按 §6(a) 落地后逐条实测，全部从仓库根执行（第 3、4、6 条的脚本形态是
`npm run test:install`）：

1. ✅ 默认级守卫 `test/distribution.test.ts::runs the shipped entry point from
   under node_modules` 通过。红半边已确认：同一棵假安装树按修复前布局重造一次
   （拷 `src/` 而非 `lib/`，并把副本里 bin 的四条 import 改回 `../src/*.ts`），
   它以 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING ...
   /node_modules/@ryan-alexander-zhang/persimmon/src/config.ts` 退出 1——与 §1
   观测到的同一句话。
2. ✅ `npm run typecheck` 0 退出（`lib/` 不在根 `tsconfig.json` 的 `include` 里，
   产物不进静态分析）；`npm run build` 同时产出 `dist/web/` 与 29 个 `lib/*.js`；
   `npm test` 连跑两次都是 71 files / 2073 tests 全绿（守卫落地前 2072）；
   `npm run test:coverage` 98.63 / 95.29 / 98.67 / 99.36，阈值仍是三个 90、
   `lib/` 不在覆盖率 `include` 里。默认套件新增的固定开销只有 vitest
   `globalSetup` 跑的那一次 `tsc -p tsconfig.build.json`，冷热都约 0.6 s。
3. ✅ 两种安装形态各实测一次：`npm pack`（133 files, 1.6 MB）→
   `npm install -g --prefix <tmp> <tarball>`（added 449 packages，0 退出）→
   `persimmon list` 空且 0 退出、`persimmon add <repo>` 输出
   `{"id":"persimmon","name":"persimmon","path":"<repo>"}`、`persimmon list` 输出
   `persimmon  persimmon  <repo>  available`；同一 `HOME` 下
   `npx --yes --package <tarball> -- persimmon list` 的输出与上一句**逐字相同**
   （`AC-20.2` 的字面要求）。
4. ✅ 同一份 tarball 里 `tar -tf` 无 `package/src/`、无任何 `.ts`——
   `scripts/test-install.js` 把这一条做成断言，不再靠人眼看。
5. ✅ 约束 (ii) 与 (iii)：`test/cli.test.ts` 与 `test/startup.test.ts` 照旧 spawn
   `bin/persimmon.js`（现在打到 `lib/`），两文件一行未改且全绿；构建后
   `node bin/persimmon.js list` 在仓库根 0 退出并列出本仓库；`src/host.ts` 与
   `src/server.ts` 的 `new URL('../dist/web', import.meta.url)` 一行未改。
6. ⚠️ `node-pty` 的安装脚本在 npm 11.17 下**默认被拦**
   （`npm warn allow-scripts ... not yet covered by allowScripts`），两条路径各跑了
   带与不带 `--allow-scripts=@ryan-alexander-zhang/persimmon,node-pty` 的一遍：
   - **全局安装**：`node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper`
     在两种情况下**都在且是 0755**——预编译产物随 npm tarball 发出、模式位在
     全局解包时保留，所以 `list` 与 pty 都不受影响。带 `--allow-scripts` 时 npm
     仍报**本包自己**的 `postinstall` 未被覆盖（对本地 tarball 的根包按名匹配
     不生效）。
   - **`npx` 缓存**：`spawn-helper` 带与不带 `--allow-scripts` 都是 **0644**
     ——`npx` 既不跑 `node-pty` 的 `post-install.js`，也不跑本包的
     `fix-pty-permissions.js`。`list` 不开 pty，所以 `AC-20.1`/`AC-20.2` 照样
     成立；但 `npx` 形态下开终端会以 `posix_spawnp failed` 失败。这是
     `spec-00011` §7 里与本 issue **并列的另一半义务**留下的独立缺陷：机制是
     npm 的脚本策略（被拦的正是本该自救的 `postinstall`），不是类型剥离，
     不由本 issue 修——待单独立案。

## 8. Follow-through

- Detection gap: **没有任何测试装过这个包。** 71 个测试文件里，服务端侧的 31 个全部从仓库
  路径 import `.ts`；`test/cli.test.ts` 与 `test/startup.test.ts` 确实 spawn
  了真入口 `bin/persimmon.js`，但 spawn 的是**仓库里的**那一份，源码不在
  `node_modules` 下，于是恰好落在缺陷不可见的那一侧。整个套件能看见的是
  「代码对不对」，看不见的是「发出去的形态能不能跑」——这与
  issue-00017（`.gitignore` 规则藏掉一个源模块）、issue-00021（NUL 字节让源
  文件不可合并）同属「只在分发/克隆态可见」的缺陷族，而那两条都是被专门的
  守卫测试（`test/tracked.test.ts`）抓住的。**缺口已闭合**：默认级守卫
  `test/distribution.test.ts` 常驻默认套件、无网络、秒级，从「假安装树」里跑真
  入口并断言退出 0 与空输出；安装形态实测落为 opt-in 的 `npm run test:install`
  （`scripts/test-install.js`，不进 `npm test`——它的依赖必须走 registry），
  作为它的上位确认而非日常门。
- Doc verdict: **the doc was wrong** → `design-00003-multi-workspace` §10 与
  `ARCHITECTURE.md` §2 **已据实校正**（前者写明 `files` 含 `lib/`、`build` 以
  `tsconfig.build.json` 把 `src/*.ts` 编到 `lib/*.js`、`bin` 引 `../lib/*.js`；
  后者把 Node ≥ 23.6 的理由拆成「开发运行需要类型剥离」与「已安装的包携带
  `lib/` 的编译产物」）；`DEVELOPMENT.md` Commands 的 Build/Run 两行与
  `README.md` 的命令表随本轮一并改。判为错的原文与理由如下。
  该节写「`files` 只含运行所需（`bin/`、`src/`、`dist/web/`、`scripts/`）」，
  把 `src/` 判为「运行所需」——这在仓库布局里对，在分发布局里错，而 `files`
  只描述分发布局。`plan-00027` T2 是照文档落地的，代码没有跑偏。同节还写
  「`prepack` 构建 `dist/web`」——`prepack` 现在构建 UI **与**服务端，同改。
  连带项也已处理：`ARCHITECTURE.md` §2 的 Node ≥ 23.6 理由（§6 的 Open
  Question）、`DEVELOPMENT.md` Commands 的 Build 一行（`build` 从此产出两样
  东西）。`spec-00011-FR-20` 与 `AC-20.1`/`AC-20.2` 的措辞不改——它们对
  行为的要求是对的，今天只是没被满足；`spec-00011` §7 也不改，本 issue 正是
  它那条验证义务第一次被执行的产物。
- Residual state: none。包从未 `npm publish`（`plan-00027` Out of Scope 第 2
  条明写发布须域主单独授权），所以外面没有装坏的副本需要回收；本轮实测装出
  的 prefix 与 npx 缓存都在临时目录里。

## Links

- Blocks: plan-00027-multi-workspace（`AC-20.1`、`AC-20.2` 与第 7 步在修好前
  都不可能通过）
- Related: design-00003-multi-workspace §10（判为错，待修订）、
  spec-00011-multi-workspace §7（本 issue 是其验证义务的产物）、
  issue-00017-an-unanchored-gitignore-rule-hides-a-source-module 与
  issue-00021-a-raw-nul-byte-makes-a-source-unmergeable（同属「只在分发/克隆态
  可见」的缺陷族）
