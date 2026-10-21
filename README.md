# ZL-WA

基于 **Ferdium 7.2.3** 的 Windows 桌面应用基础版，保留上游的多服务、多账号等功能。
当前包含独立应用身份、数据目录、可折叠分组、账户卡片、手动休眠，以及右侧的账号代理、双向翻译和文字批量发送。

- 应用名称：`ZL-WA`
- 应用 ID：`com.zl-wa.desktop`
- Windows 正式版数据：`%APPDATA%\ZL-WA`
- Windows 开发版数据：`%APPDATA%\ZL-WADev`
- 便携版数据：可执行文件旁的 `ZL-WAAppData`

详细操作及验收步骤见 [开发与测试说明](docs/ZL-WA.md)。
本轮新增的账户分组、卡片和菜单说明见 [分组账户侧栏](docs/ACCOUNTS.md)。
代理、两步发送翻译和文字群发说明见 [账号工具](docs/ACCOUNT-TOOLS.md)。
上游说明保留在 [README.upstream.md](README.upstream.md)，许可证见 [LICENSE.md](LICENSE.md)。

## Windows 开发

安装 Node.js **24.18.1**、pnpm **11.20.0** 和 Visual Studio Build Tools（C++ 工具及 Windows SDK），在 PowerShell 中执行：

若使用随附的源码 ZIP，已包含 recipes 源码，跳过下面的 `git submodule` 命令。ZIP 是源码，不是可直接运行的安装包。

```powershell
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm exec install-electron
Push-Location recipes
pnpm install --frozen-lockfile
pnpm package
Pop-Location
pnpm start:all-dev
```

## Windows 打包

```powershell
pnpm build:windows
```

生成的 x64 安装包和便携版位于 `out`。也可在推送本仓库后手动运行 GitHub Actions 的 **ZL-WA Windows** 工作流，下载构建附件。
当前没有配置自己的代码签名证书；Windows 可能显示未知发布者提示。

首次使用可选择“不使用账户”，之后添加 WhatsApp 并用手机扫码。这里的桌面应用账户与 WhatsApp 账户是两回事。
