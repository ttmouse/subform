# Task Workflow

## 标准流程

1. 读取 AGENTS.md 和 CONTEXT-MAP.md（热上下文）
2. 按任务类型读取温上下文：.harness/commands.md、.harness/working-boundaries.md
3. 定位受影响模块
   - 前端改动 → `src/components/`、`src/jsx-components/`
   - 入口文件 → `src/App.tsx`、`src/main.tsx`
   - 样式 → `src/index.css`、`tailwind.config.js`
4. 制定实施计划
5. 执行改动
6. 运行验证命令
7. 自查（scope、风格、禁止范围）
8. 输出修改摘要

## 验证报告格式

```
## 改动摘要
- 文件：
- 行为：
- 验证：

## 检查清单
- [ ] build 通过
- [ ] 行为未改变
```

## 来源

- generated_by_hermes
