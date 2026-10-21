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

打包后的更新源明确配置为 `zhenglin1885-arch/ZL-WA`，不会从官方 Ferdium 下载应用更新。
在本仓库尚无 release 时，检查更新可能返回找不到发布版本；这不代表已有可安装更新。
Windows 更新签名校验保持开启。后续发布签名版本时，需要配置本项目自己的证书和发布流程。
本阶段的手动 Windows 工作流只上传构建附件，不创建 release、不自动发布、不使用上游签名身份。
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
