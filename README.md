# ZL-WA

Windows 桌面 WhatsApp 多开客户端：在一个窗口里分组管理多个 WhatsApp 账号，每个账号独立登录、独立代理，并带有收发翻译、群发、群组管理（发言管理、批量进群、批量退群）和客户资料等工具。

基于开源项目 [Ferdium](https://github.com/ferdium/ferdium-app) 7.2.3 修改（Apache-2.0），许可证见 [LICENSE.md](LICENSE.md)；服务配方来自 recipes 子模块，遵循其自身许可证。各工具的使用说明见 [docs/ACCOUNT-TOOLS.md](docs/ACCOUNT-TOOLS.md)。

## 下载

在本仓库 [Releases](../../releases) 下载：

- `ZL-WA-win-AutoSetup-版本-x64.exe`：安装版
- `ZL-WA-win-Portable-版本-x64.exe`：便携版，数据保存在 exe 旁的 `ZL-WAAppData`

安装版数据位于 `%APPDATA%\ZL-WA`。首次启动直接进入主界面，在左侧分组点击「新增会话」并用手机扫码登录 WhatsApp。

## 打包新版本

1. 修改 `package.json` 的 `version`，提交并推送到 `main`。
2. 在 GitHub → Actions → **ZL-WA Windows** → Run workflow：
   - `new_release` 填 `v` + 版本号（如 `v7.2.12`）：打包并自动创建 Release，带 `-` 的版本（如 `v7.2.12-beta.1`）发布为测试版；
   - 都留空：只打包，exe 在运行结果的附件里。

本地打包需要 Node.js 24.18.1、pnpm 11.20.0 和 Visual Studio Build Tools（C++ 工具及 Windows SDK）：

```powershell
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm exec install-electron
Push-Location recipes; pnpm install --frozen-lockfile; pnpm package; Pop-Location
pnpm build:windows
```

生成的 exe 在 `out` 文件夹。未配置代码签名，Windows 可能提示「未知发布者」。
