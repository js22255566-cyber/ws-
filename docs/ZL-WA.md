# ZL-WA 基础版开发与验收

## 来源和修改范围

- 上游：<https://github.com/ferdium/ferdium-app>
- 标签：`v7.2.3`
- 完整提交：`a44bc7d85dea106aaf7f7f6e2c9820597d38ebc6`
- recipes 子模块：`bc708f6aad02fc43168e976d1d65678eaf96f21b`，按上游固定提交初始化，不追踪 main 最新版本。
- 保留上游 Apache-2.0 许可证、作者及原有版权信息；recipes 使用其自身许可证。

ZL-WA 修改了 package.json、electron-builder.yml、应用身份与 profile 初始化、欢迎标题、窗口标题、托盘、开机启动名称、任务菜单、URL 协议，以及部分应用名称的本地化文案。
上游的 API 名称、内部变量、服务配方、服务器选项、贡献者信息和品牌素材暂时保留。此版本不是最终品牌设计版。
账号管理、服务添加、工作区、通知、设置等功能沿用上游。新增右侧账号代理、接收翻译、两步发送翻译和文字批量发送，详见 [账号工具](ACCOUNT-TOOLS.md)。

## 数据目录

| 运行方式     | Windows 路径                     |
| ------------ | -------------------------------- |
| 安装版       | `%APPDATA%\ZL-WA`                |
| 开发版       | `%APPDATA%\ZL-WADev`             |
| 便携版       | 可执行文件旁的 `ZL-WAAppData`    |
| 便携开发环境 | 可执行文件旁的 `ZL-WAAppDataDev` |

配置、数据库、服务 Session/Partitions 均归属 ZL-WA 的 profile。
不读取 `FERDIUM_APPDATA_DIR`，不自动导入或删除 Ferdium 数据。
可通过 `ZL_WA_APPDATA_DIR` 显式指定完整 profile 路径，此设置优先于便携和开发目录；仅在确实需要时使用，勿指向 Ferdium 或其他正在使用的 profile。

应用协议使用 `zl-wa://`，开发版使用 `zl-wa-dev://`，不会接管 `ferdium://`。
安装器应用 ID、便携解压目录、开机启动条目均使用独立身份。
分组侧栏版本对 WhatsApp 强制使用独立 Session；其他服务仍沿用上游隔离选项。详见 ACCOUNTS.md。

## 本地验证

先按照根目录 README 安装依赖并打包 recipes，再执行：

```powershell
pnpm typecheck
pnpm test --runInBand --coverage=false
node esbuild.mjs
node scripts/verify-guest-build.cjs
pnpm start
```

开发热更新使用 `pnpm start:all-dev`。正式 Windows 构建使用 `pnpm build:windows`，只生成 x64 NSIS 和便携包，不发布。
Electron 43 的二进制可通过 `pnpm exec install-electron` 安装；依赖安装本身不保证运行时二进制已存在。

## 更新和构建

ZL-WA 7.2.5 的应用更新来自 `zhenglin1885-arch/ZL-WA` 的 GitHub Releases。启动约 30 秒后及每 4 小时检查一次；关闭自动更新仍可手动检查。发现更高版本显示提示，由用户前往 GitHub 下载，安装版和便携版均支持版本检查。应用不自动关闭，也不通过未签名安装包执行静默更新。

私有仓库需在「设置 → 更新 → 私有仓库访问设置」填写用户自己的只读 GitHub Token，并确保用户具有仓库访问权限。建议使用仅授予此仓库 Contents 读取权限的 fine-grained Token。Token 通过系统安全存储加密保存；公开仓库无需 Token。401/403/404、网络失败或缺少可用安装包会显示错误，不作为「已是最新版」处理。

正式通道只接收非草稿、非测试版本；打开「包含测试版本」后允许预发布。版本按语义版本号比较，需包含名称对应版本的 `ZL-WA-win-AutoSetup-版本-x64.exe` 安装包，避免发布空 Release 就提示下载。更新说明同样来自本仓库。

Windows 签名校验配置保持开启；当前通过浏览器下载和用户安装。后续实现自动下载安装时，需要配置本项目自己的代码签名身份。

发布步骤：更新 `package.json` 的版本号，提交对应 `v版本号` 标签并创建同名草稿 Release，运行 Windows 工作流并填写该标签。工作流检查版本号、执行测试、打包安装版及便携版、生成 SHA-256，然后上传附件并发布。正式标签标为正式版和 Latest，带后缀标签标为预发布。版本号与标签不一致时停止构建。用户端不会读取草稿。
上游自动发布与维护工作流保留在 `.github/upstream-workflows`，不再由 GitHub Actions 执行。

## Windows 人工验收

1. 安装并启动，确认显示 ZL-WA，安装目录及快捷方式不覆盖 Ferdium。
2. 选择“不使用账户”，确认可查看服务列表并添加 WhatsApp。
3. 用手机扫码；退出再打开，检查服务与登录状态是否保留。
4. 与官方 Ferdium 同时启动，确认两者设置、服务和登录状态分开保存。
5. 检查 `%APPDATA%\ZL-WA` 和 `%APPDATA%\ZL-WADev` 分离。
6. 解压便携包至另一目录，确认数据只写入其旁的 `ZL-WAAppData`，退出重开仍保留。
7. 检查托盘、通知、开机启动和卸载行为。

Linux 云环境的编译和自动化测试不能代替以上 Windows 实机检查，也不能代替 WhatsApp 扫码验证。
