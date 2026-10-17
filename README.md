# DSH Seeit Video

让 DSH 阅读本地视频和 B 站视频。视频处理一次后保存理解结果，后续总结和追问可以复用字幕、时间线与画面证据。

底层使用 [Seeit](https://github.com/AsakuraAOI/Seeit)：优先利用字幕，缺少字幕时尝试 ASR，需要画面才能回答的问题再按预算抽帧。

## 准备视频环境

这个插件连接你自己的 Seeit 安装，不包含视频处理运行时。开始前准备：

1. 一个已构建、包含 `dist/index.js` 的 Seeit 目录。
2. 可用的 FFmpeg 与 FFprobe。
3. DSH 中已经配置好的默认模型与凭据；需要视觉理解时，模型必须支持图片输入。

```sh
dsh plugin --profile desktop add 'github:AsakuraAOI/dsh-seeit-video'
```

按管理器提示重启，然后在插件配置里填写**当前设备**的 Seeit 和二进制路径。仓库中保留的开发默认路径需要按本机安装调整。

## 处理、总结、追问

| 工具 | 什么时候用 |
|---|---|
| `video_process` | 首次读取本地文件或 B 站视频，建立持久化理解并取得 `videoId` |
| `video_summarize` | 从已经保存的理解生成总结 |
| `video_ask` | 围绕同一个 `videoId` 提问，缺少证据时有限回看 |

例如，先让 DSH「阅读这个视频，重点关注演示里的三个步骤」，再追问「第二步使用了什么参数」。默认复用已有处理结果；需要重建时才使用 `force`。

B 站来源支持完整链接、BV/av 号、短链和分 P。字幕优先；默认每分 P 下载上限为 **800 MB / 60 分钟**。若同时安装 B 站账号插件，两者可以共用独立登录态。

## 模型与路径

| 配置 | 用途 |
|---|---|
| `seeitRoot` | 已构建的 Seeit 源码目录 |
| `dataDir` | 视频数据与缓存位置，留空使用 Seeit 目录下的 `data` |
| `ffmpegPath` / `ffprobePath` | 二进制路径，留空按环境或 PATH 查找 |
| `dshBaseUrl` / `dshApiKeyRef` | 模型网关地址与 DSH 凭据引用 |
| `asrBaseUrl` / `asrModel` / `asrApiKeyRef` | ASR 服务、模型和凭据引用 |
| `seeitConfigPath` | ASR 凭据的可选回退配置文件 |
| `bilibiliAccountFile` | 可选的 B 站登录态路径 |

LLM 使用 DSH 默认模型；视觉使用同一模型，并按其图片能力决定是否启用。`dshJsonMode` 默认关闭。

## 回答依据是什么

处理结果中的 `videoContentRead` 表示是否取得字幕、ASR 或画面证据。只有标题和简介时为 `false`，不能据此声称已经读过视频内容。

问答会返回 `reliable`、`evidence` 和 `missingInformation`。ASR 失败时可以降级为无 ASR 处理，并保留失败原因；主模型不支持图片时不发送画面。视觉请求、帧数和回看时长都有预算，无法保证任意视频的每个细节都被覆盖。

每个视频的数据保存在独立目录，包含 `metadata.json`、`timeline.json`、`understanding.json`、字幕与抽帧缓存。请把数据目录放在当前用户有权限的位置。

## 验证适配器

```sh
npm install
npm test
```

测试需要通过 `SEEIT_ROOT` 指向实际构建的 Seeit。`tests/` 中另外保留真实视频和模型探测脚本，它们需要自行配置环境，可能产生服务调用费用。
