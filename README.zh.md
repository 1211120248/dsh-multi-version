# DSH Multi-Version

`@linxin666/dsh-client-ui-multi-version`

[English](README.md) | 中文

一个独立、开源的 DeepSeek Harness（DSH）Web 插件，可把一次富输入请求转化为多个相互隔离的候选运行，并提供可选规划、受限并行、会话内持久进度、完整结果查看和确定性的本地摘要。

> 这是面向 DSH Web profile 的独立社区插件，使用 DSH 原生的 npm 与 Cordis bundle 格式。

## 为什么需要多版本

单次 Agent 运行只会给出一条实现路径。方向已经明确时，这很高效；但如果你希望先比较不同架构、写作方式或解决策略，再决定采用哪一种，一条路径往往不够。

DSH Multi-Version 只捕获一次输入，创建干净的工作区副本，再让全新的子 Agent 分别在这些副本中运行。来源工作区保持不变，每个候选的回复与文件改动都单独保留，便于检查。

## 产品亮点

- 从 DSH 普通输入框一次启动 2 至 20 个候选版本。
- 通过 DSH 官方富输入服务保留文字、结构化引用和待发送图片，不抓取页面 DOM。
- 可选用一个规划器，在候选执行前严格生成指定数量且互不重复的 brief。
- 最多并发运行 8 个候选；每个候选都使用从同一基础快照创建的独立可写工作区。
- 在普通会话流中持续查看状态、取消整次运行，并打开每个已完成候选的完整回复。
- Host 重启后恢复已完成历史，并在本地生成导航文件，不引入隐藏的评审、排名、合并或摘要模型。

## 一次运行如何执行

1. Client 原子捕获当前 DSH 输入框中的完整提交内容。
2. Host 根据活跃会话解析可信的来源工作区，并创建一份基础快照。
3. 开启规划器时，在隔离的规划工作区中严格生成指定数量的不同 brief。
4. 全新的子 Agent 继承父会话的模型路由和预设组合，在不同候选工作区中按并发上限运行。
5. Host 持久化状态与回复，再写入确定性的 `SUMMARY.md` 和 `index.json` 导航文件。

## 输出结构

每次运行都保存在活跃来源工作区下：

```text
<工作区>/.multi-version/<运行编号>/
├── request.json
├── run.json
├── planner.json                # 仅规划器模式
├── SUMMARY.md
├── index.json
├── base-snapshot/
├── planner/                    # 仅规划器模式
│   └── workspace/
└── versions/
    ├── version-01/
    │   ├── response.md
    │   ├── response.json
    │   ├── status.json
    │   └── workspace/
    └── version-02/
```

## 环境要求

| 组件 | 要求 |
| --- | --- |
| DSH | 已测试并支持 `0.1.1-rc.2` |
| Profile | Web |
| Node.js | `^22.19.0` 或 `>=24.0.0` |
| 包管理器 | pnpm 11 |

插件会探测所需的输入框服务。运行时不兼容时，“多版本”控件保持不可用，不会静默降级并丢失富输入。

## 安装

先构建这个独立项目，再把它作为链接式 bundle 插件加入 DSH Web profile：

```sh
pnpm install
pnpm build
dsh plugin --profile web add link:/absolute/path/to/dsh-multi-version
```

本包在 `package.json` 中声明 DSH Client 注入，并通过 `cordis.patch.yml` 插入 `ui-multi-version` bundle 行；无需修改 DSH 源码仓库。

## 使用方法

1. 打开具有活跃工作区的 DSH Web 会话，并准备好请求内容。
2. 在输入工具栏选择 **多版本**。
3. 设置版本数量、是否使用规划器和并发数量。
4. 开始运行后在会话流中查看状态；任一版本完成后都可以打开其完整回复。

## 运行选项

| 选项 | 范围 | 默认值 | 行为 |
| --- | --- | --- | --- |
| 版本数量 | 2-20 | 3 | 相互隔离的候选运行数量 |
| 使用规划器 | 开或关 | 开 | 候选启动前生成不同的 brief |
| 并发数量 | 1-8，且不超过版本数 | 3 | 同时运行的候选上限 |

`.multiversionignore` 支持相对工作区根的路径前缀，每行一项，使用 `#` 写注释。快照始终排除 `.git`、`.multi-version`、`node_modules`、`.pnpm-store`、`.cache`、`.next`、`dist`、`build` 和 `coverage` 目录。

## 兼容性与失败行为

- 关闭规划器时，全部候选接收同一份捕获输入，不添加隐藏的版本指令。
- 规划器返回格式错误、内容重复或数量不符时，规划模式直接失败，不会静默回退。
- 只有以 `completed` 结束的子 turn 才算成功；被中断、取消、阻塞、销毁、达到 token 上限或失败的部分输出只保留为诊断信息。
- Host 重启后，活跃工作会终止为“已中断”，等待中和运行中的候选变为失败，同时重新生成导航文件。
- 每个子 Agent handle 都会在结束后销毁。

## 安全模型

Host API 位于 `/api/dsh-multi-version/v1`，只接受 loopback 同源请求。浏览器既不提供也不接收工作区路径、输出路径、命令或 shell 文本；会话与文件系统权限由 Host 解析。

遇到绝对符号链接、逃逸符号链接、不支持的条目、非法运行路径或快照错误时，工作区复制会关闭失败。候选副本不使用硬链接。写入采用临时文件、fsync 和原子 rename；恢复时会隔离损坏的账本。

捕获内容可能包含敏感文字和编码图片，因此应当像保护来源工作区一样保护 `.multi-version`。候选子 Agent 使用固定的委派权限和 `never` 审批策略，无法在运行内部自行扩大权限。

## 已知限制

- 兼容适配器针对 DSH `0.1.1-rc.2` 的具体输入框方法。
- 完整回复以安全纯文本显示，不解释 HTML，也不进行 Markdown 格式化。
- DSH 尚无独立的持久 `internal` 可见性，存活中的 subagent-origin 子会话仍可能通过底层会话列表被发现。
- 工作区快照是文件复制，不是文件系统级原子快照；准备基础快照期间，来源文件必须保持稳定。
- 尚未实现重试 attempt。
- 尚未实现把选中的候选采用回来源工作区。

## 开发

在仓库根目录运行完整本地门禁：

```sh
pnpm check
pnpm pack --pack-destination ./artifacts
```

## 开源与社区

仓库已包含可持续维护开源项目所需的文件：

- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)
- [行为准则](CODE_OF_CONDUCT.md)
- [变更记录](CHANGELOG.md)

## 许可证

项目使用 [Apache License 2.0](LICENSE)；归属信息与独立社区插件声明见 [NOTICE](NOTICE)。
