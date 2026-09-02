# 英语学习 Agent

一个 Windows 优先的 Electron + React + TypeScript 桌面英语学习应用，支持文本口语练习、语境化纠错、本地查词、AI 翻译补充、相关短语以及学习卡片。

## 主要功能

- 使用 DeepSeek 进行多轮英语对话，并按正式、轻松等场景提供不同风格的纠错建议
- 使用本地 ECDICT 快速查询单词、常见短语和词形变化
- 本地词典未命中时使用 DeepSeek 查询或翻译完整句子
- 点击对话中的单词查看释义、相关搭配和详细用法
- 收藏单词、短语和句子，并在本地学习卡片中管理
- 保存并继续历史对话

## 本地开发

环境要求：Node.js 20+、npm、Python 3。

```powershell
npm install
npm run typecheck
npm test
npm run dev
```

## 准备本地词典

仓库不会提交生成后的 SQLite 数据库。请从 [ECDICT](https://github.com/skywind3000/ECDICT) 获取 `ecdict.csv`，然后运行：

```powershell
python scripts/prepare-ecdict.py --source "C:\path\to\ecdict.csv" --output "resources\dictionary\ecdict.sqlite"
```

应用会从 `resources/dictionary/ecdict.sqlite` 加载本地词典。未安装本地词典时，应用仍可启动，但查词将依赖已配置的 DeepSeek 服务。

## DeepSeek 设置

在应用的“设置”页面输入 DeepSeek API Key、接口地址和模型名称.

## 隐私与安全

- 在支持 `safeStorage` 的 Windows 环境中，API Key 加密后保存在系统用户数据目录中
- 对话记录、学习卡片、查询缓存和应用设置保存在本机用户数据库中
- API Key、数据库、缓存、日志、环境文件和用户数据均被 `.gitignore` 排除
- 渲染进程只提交设置表单，不会读取已保存的 API Key

Windows 默认用户数据目录通常位于 `%APPDATA%\english-learning-agent`。请勿将该目录上传到公开仓库。

## 构建

```powershell
npm run build
npm run dist
```

安装包构建前需要准备本地词典数据库，否则安装包不会包含离线词典。

## 第三方数据

ECDICT 使用 MIT 许可证，具体说明见 `resources/dictionary/ECDICT-LICENSE.txt`。

## 许可证

本项目采用 MIT License。
