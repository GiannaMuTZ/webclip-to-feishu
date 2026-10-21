# 上传到 GitHub

项目已准备为公开仓库。建议仓库名：`webclip-to-feishu`。

## 使用 GitHub CLI

安装官方 [GitHub CLI](https://cli.github.com/)，在项目目录登录并发布：

```bash
gh auth login
gh repo create webclip-to-feishu --public --source=. --remote=origin --push
```

如果仓库已在网页中创建，只需关联并上传：

```bash
git remote add origin https://github.com/你的用户名/webclip-to-feishu.git
git push -u origin main
```

如本机已有 `origin`，先用 `git remote -v` 检查，不要覆盖其他仓库地址。HTTPS 推送需要本机 Git 凭据或 `gh auth setup-git`，在网页中登录不会自动为 Git 配置凭据。

## 发布前检查

```bash
npm run check
git status --short
git check-ignore .env .data/jobs.json node_modules dist release
```

本项目的 `.gitignore` 排除 `.env`、任务记录、依赖和构建输出。不要使用 `git add -f .env`。公开的 `.env.example` 只有空值和说明。

上传后，在 Actions 中查看 CI；通过后可下载扩展 ZIP artifact。扩展也可用 `npm run package` 在本机生成，位于 `release/`。
