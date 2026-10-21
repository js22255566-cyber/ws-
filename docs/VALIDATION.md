# 基础版验证记录

本记录针对当前 Linux 云环境中的 ZL-WA 基础版源码，已在 Linux 云环境生成 Windows x64 测试安装包及便携包，但尚未在真实 Windows 电脑启动验收。

| 项目                         | 结果                                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 上游基线                     | 官方 v7.2.3，完整提交见 ZL-WA.md                                                                                                   |
| recipes 打包                 | 441 个成功，0 个失败                                                                                                               |
| 源码编译                     | `node esbuild.mjs` 通过                                                                                                            |
| TypeScript                   | `tsc --noEmit` 通过                                                                                                                |
| 自动测试                     | 22 个套件通过；174 项通过，2 项为上游原有跳过项                                                                                    |
| 修改的 TypeScript 文件及测试 | ESLint 检查通过                                                                                                                    |
| 真实 Electron 启动           | 在 Linux Xorg 虚拟桌面中启动并进入本地账户模式                                                                                     |
| 应用身份                     | 运行时 app.name 为 ZL-WA，服务激活后的窗口标题也为 ZL-WA                                                                           |
| profile                      | userData 和 sessionData 均为 `/workspace/.zl-wa-config/ZL-WADev`                                                                   |
| 服务持久化                   | 从打包资源安装 WhatsApp 配方，创建停用的测试服务；进程重启后恢复相同服务 ID 和 Session 分区                                        |
| 分组与卡片                   | 实际点击验证默认/指定分组新增、备注、本地昵称、折叠与移动                                                                          |
| 缩放与刷新                   | 对真实 Electron guest 验证放大10%、缩小10%、重置和刷新事件                                                                         |
| 分组持久化                   | 完整进程重启后恢复分组、折叠状态、昵称、备注、缩放和会话                                                                           |
| 删除流程                     | 验证删除取消、删除分组移回默认、确认删除与偏好清理；只清理测试会话                                                                 |
| 卡片手动休眠                 | 验证对应 guest 被卸载、再次点击重建同一 Session 分区、测试 Cookie 保留、其他会话不受影响，以及阻止自动唤醒                         |
| 右侧代理                     | 实际 Electron Session 验证指定代理、账号隔离、关闭恢复 DIRECT；本地 HTTP CONNECT 代理及 TLS 目的端验证真实连接测试                 |
| 翻译                         | 本地模拟翻译响应；实际内容编辑器验证接收追加、首次点击/回车仅预览、校正后第二次发送、长按防误发、失败保留、编辑/切换聊天丢弃旧译文 |
| 文字群发                     | 实际居中窗口选择账号/群私聊，确认前不发送，模拟发送接口验证顺序、双账号对象隔离、进度与历史、失败停止、不重试、手动停止            |
| 注入函数构建                 | `node scripts/verify-guest-build.cjs` 通过；验证编译后的函数序列化到独立 JS 环境仍可执行                                           |
| 在线服务目录                 | 未通过；云网络代理对 api.ferdium.org 返回 CONNECT 403，已准备网络配置草稿                                                          |
| WhatsApp 登录和收发          | 未扫码，未验证                                                                                                                     |
| Windows 安装及便携包         | Linux 云端已生成 x64 NSIS 安装包与便携 EXE；校验 PE、功能模块、Windows SQLite 及依赖；尚未实机启动                                 |

云端仅为本地源码启动测试使用 `--no-sandbox`，原因是该容器无法配置 Chromium SUID sandbox；此参数没有写入应用代码、Windows 启动或打包脚本。
纯 headless Ozone 后端在此镜像中崩溃，后改用镜像已有的 Xorg dummy 驱动完成真实界面验证。

初始品牌图标、上游服务器和贡献者说明仍然保留；本阶段不属于最终视觉品牌替换。

以上翻译和发送验证使用本地模拟网页，不是 WhatsApp 实际账号收发。外部代理认证、第三方翻译网络和 Windows 实机仍待验收。详细范围见 ACCOUNT-TOOLS.md。

## Windows x64 测试包

本轮产物为 `ZL-WA-win-AutoSetup-7.2.3-x64.exe` 和 `ZL-WA-win-Portable-7.2.3-x64.exe`，位于 `out`。两者均约 134 MiB，未进行代码签名。产物 SHA-256 及测试边界记录在 `out/ZL-WA-7.2.3-test-manifest.json`，用户说明在 `out/Windows测试说明.txt`。

交叉打包使用官方 Electron 43.3.0 Windows x64 运行时和官方 node-sqlite3 v5.1.6 N-API v6 Windows x64 二进制。Windows 版 SQLite 与现有 Linux 开发二进制并存；已校验目标 Windows 文件为 PE AMD64，开发环境内存数据库仍可读写。

`beforePack` 的 `prepare-runtime-aliases.cjs` 从锁定依赖复制两个被打包器遗漏的 CommonJS 别名及其依赖至 `resources/node_modules`，并保留原许可证；实际包路径的 Node 模块回溯解析已验证。这些生成文件不进入源码仓库。

标准 Windows 构建仍使用 `pnpm build:windows`。Linux 云端准备好 `out/win-unpacked` 后，可使用 `node build-helpers/finish-windows-cross-build.cjs` 完成安装包：它使用 electron-builder 自带的 NSIS 解包器提取同次构建的真实卸载程序，再由原有 makensis 完成标准安装器编译；不会运行或模拟应用功能，也不会发布产物。

已验证两种 EXE 的完整 PE 结构及大小、应用 ASAR 身份与功能模块、Windows 原生 SQLite、打包的 WhatsApp 配方和开发账号数据未混入。以上不代替 Windows 安装、启动、扫码及真实收发测试。
