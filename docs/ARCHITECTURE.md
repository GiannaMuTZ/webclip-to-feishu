# 模块与接口

## 处理流程

`extension/capture.ts` 在当前网页中抓取 DOM，或保留选区的 HTML 结构。只读取主框架，不传 Cookie。读取 MathJax 公共 MathItem 列表补充 SVG 渲染公式的 TeX；其余公式由服务端恢复。

`src/extract.ts` 使用不执行脚本、不加载远程资源的 JSDOM。先规范化数学内容，再选择 main/article 或使用 Mozilla Readability 定位正文，最终生成独立于飞书的 Article 模型。公式使用 KaTeX 校验，遇到不支持的内容返回可见提示。

`src/render.ts` 只从 Article 生成预览。原网页 HTML 不直接插入扩展。文本和链接转义，公式渲染关闭 trust 并限制宏展开。

`src/feishu.ts` 将 Article 转为飞书块。表格通过类型 31 创建骨架，按返回的 row-major `table.cells` ID 填写内容，然后请求合并单元格。单元格公式与正文使用同一 `equation` 元素。普通块每次最多提交 30 个；写请求以至少 400ms 间隔顺序执行。

`src/jobs.ts` 串行处理导入任务，将状态原子写入 `.data/jobs.json`。请求 UUID 与内容指纹绑定，相同任务重复提交只返回已有状态。保留 500 条历史、最多排队 10 个活跃任务；超过保留期的旧 UUID 不再具备去重保证。重启不会重新执行内容写入。

## 本地 HTTP API

默认地址 `http://127.0.0.1:17321`。所有 `/api` 请求需要 `Authorization: Bearer <BRIDGE_TOKEN>`，POST 使用 `Content-Type: application/json`。

| 方法与路径 | 输入 / 输出 |
| --- | --- |
| `GET /health` | 不需认证；只返回服务名称与版本 |
| `GET /api/status` | 本地飞书配置是否填写，**不代表远程权限已验证** |
| `POST /api/preview` | Capture → `{ article, html }`；无飞书写入 |
| `POST /api/jobs` | `{ id: UUID, capture: Capture }` → `202` + Job |
| `GET /api/jobs/:id` | 当前 Job 状态与已知文档链接 |

Capture：`{ title, url, html, mode }`。mode 为 `article`、`selection` 或 `page`。URL 只接受 http/https，HTML 最长 500 万个字符，HTTP JSON 上限 6 MB。

Job：`{ id, fingerprint, status, completed, total, createdAt, documentId?, documentUrl?, error? }`。status 为 `queued`、`running`、`done`、`failed`。进度以顶层内容块计数，大表格填充中进度可能暂时不变。

网络中断或 5xx 后不重试飞书写入；收到明确限流才退避重试，明确 token 失效时刷新凭证。失败状态保存已知文档 ID，可人工检查部分结果。尚未获知创建结果的超时无法提供文档 ID，应检查目标文件夹。
