# subform

## 项目概述

一个纯前端、可离线运行的 Subform.ai 画布体验复刻版。你可以在无限画布上创建提示节点、分支对话、连线比较，并将输出交给自带的 API 调用逻辑（默认兼容 DeepSeek / OpenAI 风格的 `chat/completions` 接口）。

## 技术栈

- **语言**: JavaScript
- **包管理**: unknown
- **框架**: JavaScript
- **构建工具**: Vite (如使用)
## 上下文

- 热：AGENTS.md（此文件）、CONTEXT-MAP.md
- 温：.harness/commands.md、.harness/task-workflow.md、.harness/working-boundaries.md
- 冷：docs/agents/、docs/adr/

## 不可违反的规则

- 最小 diff 原则：只改必要的文件
- 禁止绕过测试或验证命令
- 改完后必须输出验证报告
- 引用源码中的文件路径，而非假设路径

## 来源

- generated_by_hermes
- generated_at: 2026-05-11T00:16:21Z
- source: /Users/douba/Projects/XM/project/subform
