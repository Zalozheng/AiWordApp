# AiWord 词根引擎 🚀
插件版本:https://github.com/Zalozheng/ai_root_english

**AiWord** 是一款面向硬核学习者、英语极客和考研党的**全新一代英语词根词源解析与特训工具**。
它摒弃了传统词典死记硬背的局限，首创了**“极速本地词库 + 智能大模型穿透”**的混合架构引擎。

无论是挖掘单字的“前世今生”、追踪千丝万缕的“同源派生树”，还是利用沉浸式的左右划卡功能背单词，AiWord 都能为你提供最顶级的学习体验。

---

## 🌟 核心亮点 (Features)

### 🧠 1. 混合解析引擎 (Hybrid Engine)
- **毫秒级本地响应**：内置海量且可由用户自行扩展的本地词汇与词根库。查询命中即瞬间返回解析。
- **大模型穿透 (LLM Integration)**：如果你查询的词较为生僻或词库中未收录，App 会自动呼叫绑定的顶尖 AI 大模型（如 DeepSeek, OpenAI），为你即时生成最地道的词源解析。

### 🌳 2. 无限派生树 (Derivation Tree)
- 每个词根都不再是一座孤岛。
- AiWord 会根据图谱算法，将同源词和派生词结构化地呈现出来，帮你实现“顺藤摸瓜，一生二，二生十”的词汇量暴增。

### 🎭 3. AI 情景人格切换 (Contexts)
- **多重人设**：随时在顶部切换“日常”、“极客”、“考研”甚至“文明6”等情景。
- AI 会根据你选定的角色，改变解析口吻、例句风格和联想记忆法，让背单词变成看故事。

### ⭐ 4. 沉浸式特训场 (Tinder-style Flashcards)
- 遇到硬骨头直接“收藏”。
- 在底部【收藏夹】中，你可以开启类似 Tinder 的左右划卡（左划忘记，右划掌握）沉浸式背词。
- 完美支持纯净词根模式、发音朗读 (TTS)、乱序特训。

### 📴 5. 极客级的本地优先 (Local-First)
- **完全支持离线断网运行**。
- 所有的数据、查询历史和收藏记录均保存在手机本地沙盒中。
- 提供“一键直链更新”、“JSON 导入”等开发者级别的数据维护通道，把词库的掌控权完全交还给用户。

---

## 📥 下载与安装

请前往本仓库的 [**Releases**](../../releases) 页面，下载最新的安装包。

由于 React Native 打包机制优化，我们为你提供了针对不同手机架构的分包，以最大程度缩小安装包体积并提升性能：

1. `app-arm64-v8a-release.apk`：**推荐绝大多数用户下载**。适配所有近几年的现代安卓手机（64位处理器）。
2. `app-armeabi-v7a-release.apk`：适配较旧款或低配版的安卓手机。
3. `app-universal-release.apk`：通用兼容包，体积较大，但能在任意安卓设备上安装运行。

*(如果不知道选哪个，直接下载 `arm64-v8a` 即可。)*

---

## 🛠 开发与构建指南

如果你想参与本项目开发或自行构建词库，请遵循以下流程。

### 环境准备
- Node.js (v22.11.0+)
- Java (JDK 17)
- Android Studio / Android SDK

### 安装依赖
```bash
git clone https://github.com/你的名字/AiWordApp.git
cd AiWordApp
npm install
```

### 本地打包构建词库
本 App 采用了高性能的字典树切片架构。在编译新版词库前，请确保执行此脚本将你的超大 JSON 自动切割为可供 Android 极速读取的碎片：
```bash
node build_dict.js word.json
```

### 编译 APK
```bash
cd android
./gradlew assembleRelease
```
生成的 APK 产物将位于 `android/app/build/outputs/apk/release/` 目录下。

---

## 📜 许可证 (License)

本项目采用 MIT License。你可以自由地使用、修改和分发，但请保留原作者归属。
