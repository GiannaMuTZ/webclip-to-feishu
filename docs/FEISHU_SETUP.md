# 飞书配置教程

你需要一个飞书组织内的自建应用，以及一个自己有管理权限的云空间文件夹。项目使用飞书中国版开放平台；Lark 国际版不在本版配置范围内。

## 1. 创建应用

1. 登录 [飞书开发者后台](https://open.feishu.cn/app)。
2. 创建「企业自建应用」，命名为「Webclip 网页收藏」。
3. 在「凭证与基础信息」找到 **App ID** 和 **App Secret**，稍后只填写到电脑本地的 `.env`。
4. 在应用能力中开启「机器人」。这使应用能够作为协作者被添加到文件夹。

## 2. 开通云文档权限并发布

在「权限管理」→「开通权限」中搜索 `docx:document`，选择 **应用身份权限（tenant_access_token）** 下的两项：

- 创建新版文档：`docx:document:create`
- 编辑新版文档：`docx:document:write_only`

这两项已通过真实文档创建、公式写入、表格填充及单元格合并验证。可在 [创建文档](https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document/create)、[创建块](https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document-block/create) 和 [批量更新块](https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document-block/batch_update) 中核对接口权限。

然后在「版本管理与发布」创建版本并发布，确保你的账号在应用可用范围内。组织可能要求管理员审批；后台添加了权限但未发布版本时，实际调用仍可能失败。

当前版本不上传图片，所以无需为图片上传额外申请云盘素材上传权限，也无需消息发送权限。

## 3. 准备保存文件夹

1. 在飞书云文档进入「云盘」→「新建文件夹」，例如「网页收藏」。请用**云空间文件夹**，而不是知识库节点。
2. 打开文件夹的共享/协作者设置，以应用名称搜索上面开启的机器人，添加为**可编辑**协作者。
3. 打开文件夹链接，复制 URL 中 `/folder/` 后面的字符串作为 `FEISHU_FOLDER_TOKEN`。去掉后续 `?` 和查询参数。

应用权限和文件夹协作权限是两层独立检查：开通 API 权限不会自动获得私人文件夹的编辑权限。如果找不到机器人，先确认应用已发布、机器人已启用，且你在应用可用范围内。

新建文档使用应用身份创建。请在上述共享文件夹中保存，确保你能访问。项目要求配置文件夹，避免文档落入仅应用能看到的空间。

## 4. 填写本地配置

在项目目录运行：

```bash
npm run setup
```

打开 `.env`，填写：

```dotenv
FEISHU_APP_ID=你创建的应用ID
FEISHU_APP_SECRET=你的应用密钥
FEISHU_FOLDER_TOKEN=你的云空间文件夹token
BRIDGE_TOKEN=保留setup自动生成的值
PORT=17321
```

可选：如果希望文档链接使用你组织的域名，添加 `FEISHU_DOC_BASE_URL=https://你的组织.feishu.cn`，末尾不带斜杠。默认使用 `https://feishu.cn`。

不要把真实密钥发到聊天或提交到 GitHub。示例文件中只有空配置。setup 不会覆盖已有的非空配置。

```bash
npm run build
npm start
```

打开扩展连接设置，填写端口和 `.env` 中 `BRIDGE_TOKEN` 的值。提示「服务已连接」表示本机连接成功、配置项已填写；飞书权限会在首次保存时实际验证。

## 5. 安装浏览器扩展

1. Chrome 打开 `chrome://extensions/`（Edge 使用 `edge://extensions/`）。
2. 打开「开发者模式」，点击「加载未打包的扩展程序」或「加载已解压的扩展程序」。
3. 选择项目内的 **`dist/extension` 文件夹**，确认列表出现「Webclip · 网页到飞书」且已启用。
4. 打开一个普通网页，点击工具栏「保存到飞书」图标；若图标未显示，从扩展菜单找到 Webclip 并固定。
5. 在连接设置填入端口 `17321` 和 `.env` 中的 `BRIDGE_TOKEN`，点击「保存并检查连接」。

以后使用时保持本地服务运行。电脑重启后，在项目目录重新运行 `npm start`；修改扩展源码后先 `npm run build`，再到扩展管理页面重新加载。

## 6. 首次真实验收

打开 `http://127.0.0.1:17321/demo.html`，使用扩展提取并保存。依照 [验收清单](ACCEPTANCE.md)，在飞书中打开新文档并检查：

1. 行内公式、独立公式和单元格公式正常显示；点击后可编辑源码。
2. 表格的行列、合并表头和数据正确，可以编辑单元格。
3. 来源链接可以返回原网页。

本地网页地址只能在运行服务的电脑上打开；真实文章的来源链接不受此限制。

## 常见问题

| 现象 | 排查 |
| --- | --- |
| 无法连接本地服务 | 确认 `npm start` 正在运行、端口一致；Chrome/Edge 如出现本地网络访问询问，需允许扩展连接本机 |
| 配对码错误 | 配对码是 `BRIDGE_TOKEN`，不是 App Secret；复制后保存并检查连接 |
| 认证失败 | 核对 App ID、App Secret，检查是否发布了应用版本 |
| 无文档权限、403 | 检查 API 权限是否已批准并发布，机器人是否为目标文件夹编辑协作者 |
| 创建了文档但你打不开 | 从共享文件夹打开，核对机器人和用户的协作权限；必要时配置企业文档域名 |
| 导入中断但已有文档 | 扩展提供部分文档链接；先检查已经写入的内容，再重新提取，避免产生重复文档 |
| 页面太大 / 抓到了导航 | 先选择正文，再用「选中内容」模式 |
| 公式出现源码提示 | 原页面命令超出支持范围，或没有可恢复的 TeX/MathML；查看预览提示，必要时手动修改 |

接口结构可核对 [飞书官方 Node SDK](https://github.com/larksuite/node-sdk/blob/main/code-gen/projects/docx.ts) 和 [飞书公式使用说明](https://www.feishu.cn/hc/en-US/articles/894598450617-insert-equations-in-docs)。
