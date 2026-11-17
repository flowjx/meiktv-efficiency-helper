# 交接文档：魅KTV效率助手（浏览器插件）

> 更新于 2026-11-16，对应版本 **2.3.6**。新会话第一步：读完本文件，再看 `README.md`（面向同事的使用说明）。
> 所有回复用中文，代码/命令/文件名保持原样。

## 0. 先看这几条（最容易踩的坑）

1. **仓库是公开的**（GitHub `flowjx/meiktv-efficiency-helper`，分支 `main`）。不要提交账号、密码、token、Cookie、webhook、**同事姓名**、分组名单、业务数据。同事姓名/分组/抄送名单只放 `server/config.local.json`（已 gitignore）。提交前用 `git diff --cached` 扫一遍。
2. **用户的工作方式**：提需求 → 我改完只提交到本地 → 用户说“我先看看/我先试试”自己在浏览器里验证 → 用户说“发版 / 发 2.3.x”才升版本号并 push。**没说发版就不要 push 插件改动**（纯文档/服务端改动可以直接 push，不升版本号）。
3. **会写线上数据的操作**（禅道提交备注、建版本、建测试单、执行 SQL）先问用户，得到明确同意并确认目标（哪张单、什么内容）才做；调试时用拦截请求的方式验证提交数据。
4. **禅道成功时也会 `alert('保存成功')`**——成败一律以结果为准（版本列表里出现、历史记录里出现），不要凭 alert 判断。
5. 用户要求的交互要**和禅道原生一致**（例如概况必须是禅道原生弹窗，不要自制弹窗）。
6. 本机 git push 到 GitHub 经常 `SSL_ERROR_SYSCALL`，重试几次即可；推完用 `git ls-remote origin main` 对比 `git rev-parse HEAD` 确认。

## 1. 这是什么

Chrome/Edge **Manifest V3** 插件（以“加载已解压的扩展程序”方式安装，无构建步骤），给魅KTV 内部后台加批量操作和效率功能。

| 页面 | 入口 | 功能 | 代码 |
|---|---|---|---|
| 运营后台 `https://op.meiktv.com/*`（FastAdmin，`row[xxx]` 字段，内容在 iframe 里） | 右下角“批量选中门店” | 粘贴门店名 JSON 数组批量勾选/取消 | `content.js` |
| 音乐后台播放列表 `music.remote.meiktv.com/music/play.html` | “添加”后面“批量添加播放列表” | store_id × 素材 ID 批量 `meiktvSongPlayList/save`，已有跳过、暂停/重试/导出 CSV | `content.js` |
| 音乐后台歌手 `music.remote.meiktv.com/singer/index.html` | “歌手合并”前面“批量添加歌手” | 先 `getByName` 查重再 `add` | `content.js` |
| 禅道测试单列表 `bug.meiktv.com`（`body.m-testtask-browse`） | 表格上方“效率助手”工具栏 | 加载全部分页、统计/筛选（状态/风险/提测分组/负责人）、提测人员列、进度列（最新两条备注）、跟进写备注、搜索、导出 CSV、复制摘要、复制归档 SQL、单击名称/双击行打开原生概况 | `zentao.js` + `zentao-list-main.js` |
| 禅道提交测试（`m-testtask-create`） | 表单内 | 项目固定“测试计划跟进”(136)、本页弹窗新建版本并自动选中、“负责人”改“测试负责人”、默认抄送名单、admin 禁止提交 | `zentao-create-main.js` + `zentao-sign.js` |
| 禅道编辑测试单（`m-testtask-edit`） | 名称框 | 历史数据名称以【某人】开头的，签名锁定不可改 | `zentao-sign.js` |
| 所有上述页面 | 工具栏图标弹窗 / 页面左下角提示条 | 检查更新（GitHub，失败走内网）、一键重新加载插件 | `background.js` `popup.*` `update-notice.js` |
| 后台静默 | — | 安装明细上报（姓名/部门/职位/版本/浏览器）、拉取分组和抄送名单 | `background.js` `identity.js` + `server/` |

## 2. 文件地图

**插件**

| 文件 | 内容 |
|---|---|
| `manifest.json` | 3 组 content_scripts：① op/音乐后台 `update-notice.js + content.js`；② `bug.meiktv.com/*`：`update-notice.js, identity.js, zentao.js, zentao-sign.js`（隔离环境）；③ `bug.meiktv.com/*` **`world: "MAIN"`**：`zentao-create-main.js, zentao-list-main.js`。均 `all_frames: true`。权限 `alarms, storage`；host_permissions 含 `raw.githubusercontent.com` 和内网 `http://172.16.5.36/*` |
| `update-config.js` | 所有地址集中在这：GitHub 仓库/分支、内网更新源、上报地址、分组配置地址、检查间隔（60 分钟）、超时。**换地址只改这里**（并同步 manifest host_permissions） |
| `background.js` | service worker：`checkUpdate()`（`fetchLatest()` 先 GitHub 后内网）、`report()` 安装上报、`fetchTeamConfig()` 拉分组/抄送名单；安装/启动/每小时 alarm 触发；消息 `meiktv-check-update`、`meiktv-reload`、`meiktv-identity`、`meiktv-team-config` |
| `popup.html/js/css` | 工具栏弹窗：当前/最新版本、更新内容、按来源（GitHub/内网）显示不同下载步骤、立即检查、重新加载插件（`chrome.runtime.reload()`） |
| `update-notice.js` | 顶层页面左下角新版本提示条，每个版本点“知道了”后不再弹 |
| `identity.js` | 禅道顶层页面：右上角姓名 + 每天最多一次 `m=my&f=profile` 取部门/职位 → background 上报。**不取“用户名”（是手机号）** |
| `content.js` / `styles.css` | op 后台与音乐后台功能（见第 6 节），类名前缀 `meiktv-` |
| `zentao.js` / `zentao.css` | 禅道测试单列表增强（隔离环境），类名前缀 `mkz-`；`zentao.css` 也承载提交测试页、弹窗等全部禅道相关样式 |
| `zentao-list-main.js` | MAIN 环境：给插件替换进来的列表行重新绑定禅道原生弹窗 `$(a).modalTrigger({type:'iframe'})` |
| `zentao-create-main.js` | MAIN 环境：提交测试页的项目锁定、新建版本弹窗、默认抄送（操作禅道 jQuery/chosen 必须在页面环境；MAIN 环境不能用 chrome.* API） |
| `zentao-sign.js` | 隔离环境：提交测试页改“测试负责人”文案、admin 拦截、把抄送名单写到 `<html data-mkz-mailto>` 给 MAIN 脚本；编辑页锁定历史签名 |
| `version.json` | 最新版本信息 `version/date/notes/download/history`，插件读 GitHub 上的这个文件 |
| `updater/auto-update.ps1` | 自动更新脚本（UTF-8 **带 BOM**，PS 5.1 才能正确读中文）：读本地 manifest 版本 → 查最新（先 GitHub，失败走内网；地址从 `update-config.js` 正则读出）→ git 仓库只在工作区干净时 `git pull --ff-only`，否则下载 zip（GitHub 查到版本但 zip 下载失败时改从内网下载，此时只要求 zip 版本比本地新）、校验 zip 内版本、robocopy 覆盖（**manifest.json 最后复制**）。写 `updater/status.json`、`updater/update.log`（均 gitignore）。参数 `-ForceIntranet`、`-DryRun`、`-SimulateGithubZipFail` 用于测试 |
| `updater/install-updater.ps1` | 注册/删除当前用户的计划任务 `MeiktvHelperAutoUpdate`（每小时 + 登录时；登录触发器建不了就只用每小时），动作 `wscript run-hidden.vbs`。`-Uninstall`、`-DryRun` |
| `updater/run-hidden.vbs` | 隐藏窗口启动 auto-update.ps1；**只用 ASCII**，路径运行时从自身位置推出（插件路径可能含中文） |
| `安装自动更新.bat` / `卸载自动更新.bat` | 插件根目录，双击调用 install-updater.ps1 |
| `scripts/bump_version.py` | 发版：同时改 manifest.json 和 version.json（版本号必须递增） |
| `scripts/make_icon.py` | 生成 `icons/`（玫红→紫渐变圆角方 + 白闪电 + 小黄星，16px 无星） |
| `meiktv-logo-transparent.png` | 品牌原 logo，仅作素材，插件不用 |

**服务端（维护者本机运行）**

| 文件 | 内容 |
|---|---|
| `server/install_server.py` | 标准库 http.server + pymysql，监听 `0.0.0.0:8790`。接口见第 4 节 |
| `server/config.local.json` | **gitignore**：MySQL 连接、`admin_key`（明细页口令）、`team.groups` / `team.mailto`（同事姓名）。模板 `config.example.json` |
| `server/启动上报服务.bat` | 手动前台启动（带控制台） |
| `server/server.log` | gitignore；服务逐行追加、立即关闭，运行中可用记事本打开；>5MB 启动时轮转为 `.log.1` |

## 3. 禅道相关（zentao*.js）

站点：禅道 **11.5**（`/js/all.js?v=11.5`），GET 路由 `index.php?m=&f=`，弹窗用 zui `modalTrigger`（iframe，`#triggerModal`），下拉用 chosen。插件复用用户登录态。

**列表页（`zentao.js`）**
- 只在 `body.m-testtask-browse` + `#taskList` 生效；列按**表头文字**定位（`C` 映射：ID/名称/所属产品/所属项目/版本/负责人/开始日期/结束日期/状态/操作），禅道改列名要同步改。
- **加载全部**：`.pager[data-link-creator]` 里 `{recPerPage}`→总数、`{page}`→1，重新拉列表替换 tbody（>1000 条不做）。替换后的行由 `zentao-list-main.js` 重新绑定原生弹窗（参数已核对与原生一致）。
- **列宽**：表格 `table-layout: fixed`，给 ID 60 / 提测人员 120 / 版本 90px 定宽，其余给进度列；操作列隐藏 `#action-divider`（用例/关联用例/报告列表），宽 110px。
- **提测人员列**：原“所属产品”列；`parseHistory()` 取历史第一条“创建”的人 → `creator`；下面一行小字“分组 · 日期 提测”。“所属项目”列隐藏。
- **进度列**：并发 4 个请求 GET `m=testtask&f=view&taskID=N&onlybody=yes`，解析 `#actionbox .histories-list > li`（头部 `2026-11-13 17:50:40, 由 <strong>张三</strong> 编辑。`，备注 `.article-content.comment`，取第一个——自己写的备注会多一个“修改备注”编辑框）。显示最新两条备注（精确到分钟）+ 最近操作 + “N 天无更新”（`STALE_HOURS = 48`，**只按备注算**：最新备注时间，没有备注用创建时间；风险筛选、标签、进入页面提醒弹框共用 `isStale`）。进入列表页、进度首次加载完后，负责人=当前登录人且 isStale 的测试单弹框提醒（`showStaleReminder`，可直接跟进，跟进后从清单移除）。缓存 localStorage `mkz-progress2:<id>`（v2 加了 creator），30 分钟；筛选偏好 `mkz-prefs`。
- **统计栏**：状态 / 风险（已逾期、今明到期、2 天无更新、未完成且无备注）/ **提测分组**（teamConfig.groups，名单外归“其他”；名单没加载时提示“未加载”）/ 负责人，点 chip 筛选再点取消。
- **看概况**：单击名称（名称 `<a>` 已去掉 href，原来跳“用例”页）或双击行空白处 = 点该行 `a.iframe[href*="f=view"]`，即禅道原生概况弹窗；`refreshAfterModalClose()` 轮询 `#triggerModal.in` 由有到无后刷新该行进度。
- **跟进**：进度列“跟进”按钮（flex 竖直居中）→ 弹窗 → `submitFollowUp()`：GET 该行编辑链接（`onlybody=yes`）拿表单，**原样带回全部字段**，只设 `comment`（转义、换行转 `<br />`），POST 回同一地址；之后强制刷新历史，最新备注等于提交内容才算成功。不用 `m=action&f=comment` 是因为本站该方法返回 `user-deny`。已在 #111 真实验证（字段无变化）。
- **按钮**：清空筛选、刷新进度、导出CSV（含提测人员/分组/提测时间、最新两条备注）、复制摘要（被阻塞/已逾期/今明到期）、**复制归档SQL**（当前可见的已完成单 → `UPDATE \`meiktv_bug\`.\`meiktv_testtask\` SET \`product\` = 91 WHERE \`id\` = N;`，id 去前导 0，首行注释；插件不执行）。
- 搜索：ID/名称/负责人/提测人员/分组/版本/备注，空格分隔多词 AND，名称高亮，`/` 聚焦。

**提交测试页（`zentao-create-main.js` + `zentao-sign.js`）**
- 项目：选 136（测试计划跟进）并 `trigger('change')` 走禅道 `loadProjectRelated` 刷版本，然后 disabled + 同名 hidden input 提交。
- 新建版本：`#buildBox` 外加“+ 新建版本 / 刷新”。弹窗默认名称=今天 `YYYYMMDD`、日期=今天、描述选填；GET `m=build&f=create&project=136&onlybody=yes` 取原生表单默认值（product=90、builder=当前用户），只换 name/date/desc 后 POST；再 `loadProjectBuilds(136)` 并按名称选中，选中成功才算成功；重名前端先拦。用户已真实用过（2026-11-16 首次真实建版本时发现 alert 误判，已修）。
- 默认抄送：名单来自 teamConfig.mailto（不在代码里），`zentao-sign.js` 写到 `<html data-mkz-mailto>`，MAIN 脚本按禅道**显示名**（去掉“X:”前缀）匹配。禅道里的名字以禅道为准（用户口头给的可能有错别字）。不在内网拿不到名单就不预填。
- “负责人”文案改“测试负责人”。
- **admin 禁止提交**：`m=my&f=profile` 的“用户名”为 admin 时，表单顶部红色提示；window 捕获阶段拦截保存 click 与 form submit（preventDefault + stopImmediatePropagation）并 alert“admin 账号不能提交测试单，请用自己的账号提交”；按钮不禁用（禁用后点击没反应）。只是前端限制，彻底禁止需在禅道后台去权限。
- 2026-11-16 起**不再**给名称自动加【当前用户】签名（用户要求去掉）；编辑页仍锁定历史数据里已有的签名。

## 4. 服务端与运维（维护者本机 172.16.5.36）

| 接口 | 用途 |
|---|---|
| `POST /api/ping` | 插件安装上报，按 client_id upsert 到 MySQL `meiktv_business.helper_install`（首次启动自动建表） |
| `GET /installs?key=<admin_key>` | 安装明细页（安装数、24h 活跃、待更新、每人版本/最后活跃） |
| `GET /api/team-config` | 返回 `config.local.json` 的 `team.groups` 和 `team.mailto` |
| `GET /update/version.json`、`/update/plugin.zip` | 内网备用更新源：`git show origin/main:version.json`、`git archive origin/main`（按 sha 缓存，目录结构同 GitHub zip） |
| `GET /health` | 健康检查 |

- MySQL：本机 `localhost:3306`，库 `meiktv_business`，连接信息在 `config.local.json`（不要写进任何提交）。
- **开机自启**：`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\meiktv-helper-install-server.vbs`（UTF-16 编码，`pythonw.exe` 无窗口启动；写死了插件目录和 `...\Python311\pythonw.exe`）。不要再用 `cmd >> server.log` 重定向（会锁文件）。
- **重启服务**（改了 config.local.json 或 server 代码后必须重启）：
  ```powershell
  Get-NetTCPConnection -LocalPort 8790 -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }
  Start-Process wscript.exe -ArgumentList ('"' + [Environment]::GetFolderPath('Startup') + '\meiktv-helper-install-server.vbs"')
  ```
- 改分组/抄送名单：编辑 `config.local.json` 的 `team` → 重启服务；插件每小时拉取，打开测试单列表页时也会顺手刷新。**不用发版**。成员名匹配时去掉括号备注和“-xxx”后缀。
- 同事要能访问 8790 需本机防火墙放行入站（用户自己用管理员执行 `netsh advfirewall firewall add rule name="魅KTV效率助手上报" dir=in action=allow protocol=TCP localport=8790`；是否已执行未确认）。本机 IP 变了要改 `update-config.js` + manifest host_permissions 并发版。
- 不在内网 / 服务没开时：上报静默失败、分组显示“未加载”、提交测试不预填抄送，其他功能正常。

## 5. 在线更新与发版

- 已解压安装的插件不会被浏览器自动更新，只做“检查 + 提醒 + 一键重新加载”。MV3 禁止远程代码，不要尝试远程拉 js。
- **静默自动更新（2026-11-17，方案 A）**：同事在插件目录双击“安装自动更新.bat”后，计划任务每小时跑 `updater/auto-update.ps1` 覆盖文件；`background.js` 每 5 分钟（alarm `meiktv-disk-check`）+ 浏览器启动时 `checkDiskVersion()`：fetch `chrome.runtime.getURL('manifest.json')`（已解压插件读的是磁盘实时文件），比运行中版本新就 `chrome.runtime.reload()`。弹窗读 `updater/status.json` 显示“自动更新：已开启/未开启/超过 3 小时没运行”。已实测：2.3.5 副本经 GitHub、经内网（`-ForceIntranet`）都更新到 2.3.6；干净 git 克隆 pull 成功、有改动的 git 克隆跳过；再次运行显示已最新；`checkDiskVersion` 用 node 模拟过。**未实测**：真实浏览器里磁盘版本变化后是否自动 reload、计划任务真实注册（只跑过 `-DryRun`）。维护者自己的开发目录不要装（有改动会跳过，但没必要）。
- 检查：每 60 分钟 + 浏览器启动 + 弹窗“立即检查”。先 GitHub raw（8 秒超时，约 5 分钟 CDN 缓存），失败走内网；`update.source` 记录来源，内网时下载链接换内网 zip。2.3.6 之前的版本没有内网兜底。
- **发版流程**：
  ```bash
  python scripts/bump_version.py 2.3.7 "更新说明1" "更新说明2"
  git add -A
  git diff --cached        # 扫一遍：无密码/口令/手机号/同事姓名
  git commit -m "release 2.3.7"
  git push                 # 失败就重试；内网源取 origin/main，push 成功内网才更新
  git ls-remote origin main; git rev-parse HEAD   # 两者一致
  ```
  发完用 `curl` 看 GitHub raw（按 commit sha 的地址绕过缓存）和 `http://172.16.5.36:8790/update/version.json` 都是新版本。
- 版本历史：2.1.0 原始（op/音乐）→ 2.3.0 在线更新 + 禅道列表增强 → 2.3.1 新图标 → 2.3.2 弹窗去仓库链接 → 2.3.3 列宽/分钟时间/安装统计/1 小时检查 → 2.3.4 跟进/归档SQL/隐藏三个操作按钮 → 2.3.5 提交测试签名+项目锁定+新建版本弹窗+默认抄送、双击原生概况、alert 误判修复 → 2.3.6 提测人员列+分组筛选、名称点开概况、去签名、测试负责人、admin 禁提、内网更新兜底。

## 6. op 后台 / 音乐后台（content.js）

- 入口 `start()` → `syncButton()`，MutationObserver（100ms 防抖）检测页面，元素出现加按钮、消失移除。
- 门店勾选：`createPanel()` → `applyStoreSelection()`；名称去 `A-` 前缀匹配，也可直接填复选框 value；先 `activateStoreSelectionMode()` 点“指定/自定义门店”。
- 播放列表：`createMusicPanel()` → `runMusicBatch()`，请求走 `musicRequest()`；`containsMaterialId()` 判断已有；`downloadMusicCsv()` 导出。素材 ID 是**素材页面 ID，不是歌曲 ID**。
- 歌手：`createSingerPanel()` → `runSingerBatch()`（`singerQueryByName()` → `singerRequest()`）。
- 登录态：每次请求前从 storage/meta/cookie 读 `token` 放请求头，Cookie 靠 `credentials: 'include'`；**不硬编码任何凭证**。失效（401/403/重定向/HTML）自动暂停，重新登录后点继续。

| 接口 | 格式 | 参数 |
|---|---|---|
| `/music-admin/meiktvSongPlayList/page` | POST JSON | `{storeId, pageNum:1, pageSize:1000}` |
| `/music-admin/meiktvSongPlayList/save` | POST JSON | `{storeIds:"<单个id>", materialId, showType:0, showRuleType:0, showRule:0, weight:0}` |
| `/music-admin/meiktvSinger/getByName?name=` | GET | 返回结构不固定 |
| `/music-admin/meiktvSinger/add` | POST FormData | `singerId=0, name, pinyin, fullPinyin, hot=0, status=0, hasAvatar=1, language=0, category=0, thumb` |

相关项目：`../meiktv-songlist-batch/batch_save.py` 是 save 接口的 Python 命令行版（需手动抓 token）。

## 7. 安装与调试

1. `chrome://extensions` / `edge://extensions` 开开发者模式 → 加载已解压 → 选本目录（同事用 `git clone` 的目录）。需 Chrome/Edge ≥ 111（MAIN world 脚本）。
2. 改代码后：扩展页刷新或弹窗“重新加载插件”，**再刷新目标页面**。
3. Console 日志前缀：`[门店批量选择助手]`（op/音乐，op 要切到 iframe）、`[禅道测试单助手]`、`[禅道提交测试助手]`。
4. 调试技巧：内置浏览器打不开 `localhost`/内网 http 资源注入（https 页面混合内容被拦），验证插件逻辑只能把代码贴进页面执行，或在 node 里 mock chrome API；需要 chrome.* 的脚本要 mock。
5. 无自动化测试。批量提交、跟进、建版本都会写线上数据。

## 8. 验证状态（截至 2.3.6）

- 用户已实际使用：跟进、复制归档 SQL、新建版本（踩出 alert 误判已修）、列表各功能。
- 只做过页面注入/模拟验证、未经用户确认实测：提测人员列与分组筛选的最终界面、名称单击开概况、admin 拦截（没用真 admin 登录）、内网更新兜底（node 模拟四种网络情况 + 实际下载内网 zip）、弹窗“来源：公司内网”样式。
- 音乐后台的 CSV 修复、歌手按钮位置修复：未在真实页面验证。

## 9. 已知问题 / 待办

1. **同事姓名残留在 git 历史**：2.3.5 及以前的提交里 `zentao-create-main.js`、README、HANDOFF 写过默认抄送的 6 位同事姓名和维护者姓名，已从当前文件移除但历史仍在。彻底清除需改写历史并强推（已 clone 的同事要重新 clone），**未经用户同意不要做**。
2. 歌手查重偏宽：`singerExistsInPayload()` 只要有 id + 任意名字字段就判“已存在”，若 `getByName` 是模糊匹配会误跳过。
3. 歌手批量没有“重试失败项 / 导出 CSV”。
4. admin 禁提、签名锁定都只是前端限制，没装插件的人不受约束。
5. 内网服务依赖维护者电脑开机、IP 不变、防火墙放行（防火墙是否已放行未确认）。
6. `content.js` 的 `syncButton()` 每次 DOM 变化打 `console.debug`；`musicState.abortController` 从未 abort（暂停靠轮询），均不影响功能。
7. 测试单超过 1000 条时不做“加载全部”。
8. 可以继续做（用户提过方向，未定）：基于页面数据的提醒（逾期/阻塞弹窗或系统通知）、按负责人分组视图、摘要推送企微（要走服务端，插件里不能放 webhook）、仓库转私有 + 只走内网更新（需先发一版让大家具备内网兜底，再转私有）。

## 10. 改动约定

- 改功能同步更新 `README.md`（面向同事）和本文件（面向维护者）；发版用 `scripts/bump_version.py`。
- 新增页面：manifest 的 `matches` 和 `host_permissions` 都要加；需要操作页面 jQuery/组件的放 MAIN world 脚本，需要 chrome.* 的放隔离脚本，两者用 DOM（如 `data-*` 属性）传数据。
- 新 DOM id/类名：op/音乐用 `meiktv-`，禅道用 `mkz-`。
- 不写死 token/Cookie/口令，不存业务数据，不放同事姓名。
