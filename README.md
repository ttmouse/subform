# Subform Workspace Replica

一个纯前端、可离线运行的 Subform.ai 画布体验复刻版。你可以在无限画布上创建提示节点、分支对话、连线比较，并将输出交给自带的 API 调用逻辑（默认兼容 DeepSeek / OpenAI 风格的 `chat/completions` 接口）。

## 📁 目录结构

- `index.html` — 画布容器、API 菜单、滚动条等基础结构
- `styles.css` — 深色玻璃态界面、节点组件、菜单与响应式适配
- `app.js` — 画布交互、节点/连线管理、IndexedDB 持久化与模型调用
- `assets/favicon.svg` — 简易图标

## 🚀 启动方式

项目完全静态，无需后端。任意静态服务器即可运行：

```bash
# 方式 1：在 VS Code / WebStorm 中使用 Live Server

# 方式 2：Python 简易服务器（3.0+）
python -m http.server 4173

# 浏览器访问
open http://localhost:4173
```

## 🔑 API 配置

右上角的菜单（⊟）可录入自定义模型配置：

1. **API Base URL**：例如 `https://ark.cn-beijing.volces.com/api/v3/chat/completions`
2. **API Key**：例如 `71d19868-*****`
3. **Model**：例如 `deepseek-v3-250324`
4. 勾选 “Remember settings on this device” 后会将配置保存到 `localStorage`

点击保存后，普通节点底部的模型标签会更新；按 `Enter` 或点击 **Generate** 将调用配置的接口，并把响应写入新生成的输出节点。

> **接口格式**：默认按照 OpenAI/DeepSeek `chat/completions` 请求格式（`messages` + `model` + `Authorization: Bearer`）。如需适配其他字段，可调整 `app.js` 中 `callModel()`。

## ✨ 主要能力

- 无限画布，空格 + 拖拽平移，`Ctrl/Cmd + 滚轮` 缩放
- 双击创建节点，Option/Alt + 拖拽复制节点，Shift 进行多选
- 拖动节点左右连接点即可建立贝塞尔曲线连线
- `Enter` 触发生成输出，输出节点自动放置在原节点右侧
- 支持图片粘贴生成图片节点
- IndexedDB 持久化节点布局、连线与内容，刷新后自动恢复
- Undo / Redo（`Ctrl/Cmd + Z`/`Shift + Ctrl/Cmd + Z`）、Delete 删除选中项

## 🛠️ 定制建议

- 想接入流式响应，可替换 `callModel()` 为 SSE 解析逻辑
- 若需团队协作或云同步，可在当前数据结构基础上接入后端
- 如需更多 UI 元件（工具栏、模板库等），可在 `createNote` 与样式层面拓展

## ⚠️ 安全提示

配置的 API Key 默认仅保存在本地浏览器，未向任何第三方发送。仍建议使用专用 Token，并在公共设备上禁用 “Remember settings”。
