# 交接文档：魅KTV效率助手（浏览器插件）

> 写于 2026-11-16。新会话第一步：读完本文件，再看 `README.md`（面向使用者的功能说明）。
> 所有回复用中文，代码/命令/文件名保持原样。

## 1. 这是什么

Chrome/Edge **Manifest V3 内容脚本插件**，给魅KTV 内部后台加"批量操作"按钮，省掉一个个点选/提交。
纯前端，没有后台、没有 popup、没有 background service worker，也没有构建步骤——改完文件在扩展页点"重新加载"就生效。

当前版本 `manifest.json` → `2.3.0`。2026-11-16 起是 git 仓库，远程在 GitHub **公开**仓库 `flowjx/meiktv-efficiency-helper`（分支 `main`）。**公开仓库：不要提交任何账号、token、Cookie、webhook、员工姓名或业务数据。**

四个功能，按页面区分：

| 页面 | 注入的按钮 | 作用 |
|---|---|---|
| `https://op.meiktv.com/*`（运营后台，FastAdmin 风格，`row[xxx]` 字段名） | 右下角浮动"批量选中门店" | 粘贴门店名称 JSON 数组 → 批量勾选/取消门店复选框 |
| `http://music.remote.meiktv.com/music/play.html` | 原"添加"按钮**后面**的"批量添加播放列表" | 一批 store_id × 一个素材 ID，逐个调 `meiktvSongPlayList/save` |
| `http://music.remote.meiktv.com/singer/index.html` | "歌手合并"按钮**前面**的"批量添加歌手" | 先按名字查重，再逐个调 `meiktvSinger/add` |
| `https://bug.meiktv.com/*` 中的测试单列表（`body.m-testtask-browse`） | 表格上方"效率助手"工具栏 | 统计/筛选、产品项目合并、进度列、搜索、导出 CSV、复制摘要（2026-11-16 新增，`zentao.js`） |

## 2. 文件地图

| 文件 | 内容 |
|---|---|
| `manifest.json` | 匹配规则、`all_frames: true`（op 后台是 iframe 套页面，必须开）、`run_at: document_idle` |
| `background.js` | service worker：每小时（`chrome.alarms`）拉取仓库里的 `version.json`，和 manifest 版本比较，有新版就加工具栏角标"新"，结果写入 `chrome.storage.local.update` |
| `update-config.js` | 仓库地址、分支、检查间隔。**换仓库只改这里**（background 和 popup 共用） |
| `popup.html/js/css` | 点击工具栏图标的弹窗：当前/最新版本、更新内容、更新步骤、"立即检查"、"重新加载插件"（`chrome.runtime.reload()`，会从磁盘重新读取已解压的插件） |
| `update-notice.js` | 注入所有业务页面（排在各 content script 前面）：有新版且用户没点过"知道了"时，在顶层页面左下角提示一次 |
| `zentao-sign.js` | 禅道“提交测试”（`body.m-testtask-create`）和“编辑测试单”（`m-testtask-edit`）页：名称加/锁【姓名】签名。真正的 `name` 输入框改成 hidden，旁边放只填内容的输入框（`required`），输入时实时写回“签名+内容”，与禅道提交方式无关。编辑页只锁已有签名、保留原签名人；无签名不处理。2026-11-16 在两个页面上模拟验证（未保存） |
| `identity.js` | 只注入 bug.meiktv.com 顶层页面：读右上角 `#userNav .user-name`，每天最多拉一次 `m=my&f=profile` 取部门/职位，发给 background 上报。**不取用户名（是手机号）** |
| `server/install_server.py` | 安装明细上报服务：`POST /api/ping` 写 MySQL 表 `helper_install`（自动建表，按 client_id upsert），`GET /installs?key=` 明细页。配置在 `server/config.local.json`（gitignore，含数据库密码，绝不提交），模板 `config.example.json` |
| `version.json` | 线上最新版本信息（`version/date/notes/download/history`），插件读的就是 GitHub 上这个文件 |
| `scripts/bump_version.py` | 发版脚本，同时改 manifest.json 和 version.json |
| `zentao.js` / `zentao.css` | 禅道测试单列表增强，独立的 content script，和 `content.js` 互不依赖。类名前缀 `mkz-` |
| `content.js` | op 后台和音乐后台的逻辑（约 930 行，一个 IIFE）。见下方函数索引 |
| `styles.css` | 按钮、面板、toast 样式。类名统一前缀 `meiktv-batch-store-*` / `meiktv-music-*` |
| `icons/` | 16/32/48/128 PNG，2026-11-16 重新设计（玫红→紫渐变圆角方 + 白闪电 + 小黄星，16px 无星），由 `scripts/make_icon.py` 生成，改图标改这个脚本再运行 |
| `README.md` | 功能说明 + 安装步骤 |

`content.js` 函数索引：

- **入口**：`start()` → `syncButton()`，并用 `MutationObserver`（100ms 防抖）持续检测页面，元素出现就加按钮、消失就移除按钮和面板。
- **判断页面**：`isMusicPage()`、`isSingerPage()`、`findSpecifiedStoreRadio()`、`findDirectStoreHeading()`、`findButtonTrigger()`
- **门店勾选**（op 后台）：`createPanel()` → `applyStoreSelection(select)` → `parseStoreNames()` / `getStoreCheckboxes()` / `getStoreName()`；`activateStoreSelectionMode()` 会先自动点"指定门店 / 自定义门店"单选框
- **播放列表**（music 页）：`createMusicPanel()` → `runMusicBatch()`；请求统一走 `musicRequest()`；`containsMaterialId()` 用于判断门店是否已有该素材；`downloadMusicCsv()` 导出
- **歌手**（singer 页）：`createSingerPanel()` → `runSingerBatch()`（两阶段：`singerQueryByName()` 查重 → `singerRequest()` 添加）；`parseSingerItems()` 解析输入
- **登录态**：`refreshMusicAuth()` / `getStoredToken()` / `musicHeaders()`——每次请求前重新从 localStorage/sessionStorage/meta/cookie 读 `token`，放进请求头 `token`；Cookie（`JSESSIONID`）靠 `credentials: 'include'` 自动带上。**插件里没有任何硬编码凭证，保持这样。**

## 3. 禅道测试单增强（zentao.js）

- 站点是禅道旧版（12.x 风格，GET 参数路由 `index.php?m=&f=`，无 iframe 外壳）。需要用户自己登录，插件复用登录态。
- 只在 `body.m-testtask-browse` 且存在 `#taskList` 时生效；列按**表头文字**定位（ID/名称/所属产品/所属项目/版本/负责人/开始日期/结束日期/状态），禅道改列名或用户自定义列后要同步改 `C` 映射。
- 加载全部：读 `.pager[data-link-creator]`，把 `{recPerPage}` 换成总数、`{page}` 换成 1 重新拉列表并替换 tbody（总数 > 1000 不做）。替换后的行没有禅道弹窗脚本，"概况"按钮改为新标签打开。
- 进度：对每行的"概况"链接（`m=testtask&f=view&taskID=N&onlybody=yes`）并发 4 个请求，解析 `#actionbox .histories-list > li`：头部文字形如 `2026-11-13 17:50:40, 由 <strong>张三</strong> 编辑。`，备注在 `.article-content.comment`。缓存在页面 localStorage `mkz-progress:<id>`，30 分钟过期；筛选偏好存 `mkz-prefs`。
- **跟进（2026-11-16 新增）**：进度列的“跟进”按钮 → 弹窗写备注 → `submitFollowUp()`：GET 该行“编辑”链接（加 `onlybody=yes`）拿到编辑表单，**原样带回全部字段**（含 desc、mailto 多选），只设置 `comment`（纯文本转义、换行转 `<br />`），POST 回同一地址；成功时禅道返回 `parent.location=...view...` 脚本，失败通常是 `alert(...)`。最后强制刷新该行历史，最新备注等于提交内容才算成功。
  - 为什么不用 `m=action&f=comment`：本站禅道该方法对账号返回 `user-deny`（无权限）。
  - 已在 #111 真实验证（2026-11-16 16:23 蒋晓华 “【效率助手】跟进功能测试，请忽略”）：提交前后编辑表单全部字段无差异。
  - 自己写的备注在详情页 li 里会多一个“修改备注”编辑框，文本出现两次；解析只取第一个 `.comment`，不受影响。
- **复制归档SQL（2026-11-16 新增）**：`copyArchiveSql()` 取当前可见行中 `status === 'done'` 的，生成 `UPDATE \`meiktv_bug\`.\`meiktv_testtask\` SET \`product\` = 91 WHERE \`id\` = N;`（`ARCHIVE_PRODUCT_ID = 91` 是归档用的产品，id 去掉前导 0），首行是带日期和单号的注释。插件不执行 SQL。
- "N 天无更新"按历史记录最后一条日期算，阈值 `STALE_DAYS = 3`。
- 2026-11-16 在内置浏览器里把脚本注入真实页面验证过：42 条全部加载，统计 进行中23/未开始7/被阻塞5/已完成7，逾期 27、3 天无更新 17；搜索、高亮、筛选正常。**还没以扩展形式安装后验证**，"导出CSV""复制摘要"按钮未在真实页面点过。
- 可以继续做的：在列表直接加备注（禅道 `m=action&f=comment` 接口）、按负责人分组视图、把摘要一键发企微（需要后端或 webhook，浏览器插件直接发会暴露 webhook）。

## 4. 接口约定（music.remote.meiktv.com）

| 接口 | 方法/格式 | 关键参数 |
|---|---|---|
| `/music-admin/meiktvSongPlayList/page` | POST JSON | `{storeId, pageNum:1, pageSize:1000}`，返回里任意层级出现 `materialId == 目标` 就算"已有" |
| `/music-admin/meiktvSongPlayList/save` | POST JSON | `{storeIds:"<单个id字符串>", materialId, showType:0, showRuleType:0, showRule:0, weight:0}` |
| `/music-admin/meiktvSinger/getByName?name=` | GET | 返回结构不固定，由 `singerExistsInPayload()` 宽松判断 |
| `/music-admin/meiktvSinger/add` | POST **FormData** | `singerId=0, name, pinyin, fullPinyin, hot=0, status=0, hasAvatar=1, language=0, category=0, thumb` |

- 素材 ID 是**素材页面的 ID，不是歌曲 ID**（面板里有提示，业务容易填错）。
- 登录失效判断：HTTP 401/403、业务 code 401/403、被重定向或返回 HTML。命中后自动暂停，用户重新登录后点"继续"。
- 判断失败：HTTP 非 2xx、业务 `code >= 400`、`success/ok/result === false`。

相关项目：`../meiktv-songlist-batch/batch_save.py` 是同一个 save 接口的 **Python 命令行版**（支持多个素材 ID，但 token/JSESSIONID 要手动从浏览器抓）。插件版是它的"不用抓凭证"替代品。

## 5. 在线更新与发版

- 原理：已解压安装的插件浏览器不会自动更新，所以只做"检查 + 提醒 + 一键重新加载"。Manifest V3 不允许远程加载代码，不要尝试从网上拉 js 执行。
- 发版：`python scripts/bump_version.py 2.3.1 "说明"` → commit → `git push`。只改代码不改版本号，用户不会收到提醒。
- raw.githubusercontent.com 有约 5 分钟 CDN 缓存，推送后不一定马上能检查到。
- 想换成公司内网地址：只改 `update-config.js` 的 URL，并把新域名加进 manifest 的 `host_permissions`。
- 2026-11-16 用 node 模拟 chrome API 测过版本比较和检查逻辑（有新版、同版、断网三种情况）；弹窗和提示条还没在真实浏览器里装插件看过。

## 5.1 安装明细上报（2026-11-16 新增）

- 链路：插件 background.js → `UPDATE_CONFIG.reportUrl`（当前 `http://172.16.5.36:8790/api/ping`，是维护者本机局域网 IP）→ `server/install_server.py` → 本机 MySQL `meiktv_business.helper_install`。
- 上报时机：安装/重新加载时立即、浏览器启动和每次定时检查时（节流 60 分钟）、禅道识别到的姓名部门职位变化时立即。上报字段：client_id（随机 UUID）、版本、浏览器、系统、姓名、部门、职位；服务端记录来源 IP、首次/最后时间、次数。
- **开机自启**（2026-11-16 配置）：`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\meiktv-helper-install-server.vbs`，登录 Windows 后隐藏窗口启动服务，输出追加到 `server/server.log`（已 gitignore）。脚本里写死了插件目录和 python 路径（`...\Python311\python.exe`），目录或 Python 换了要改这个 vbs；不想自启就删掉它。重复启动时第二个实例端口被占会直接退出。手动停服务：`Get-NetTCPConnection -LocalPort 8790 -State Listen | % { Stop-Process -Id $_.OwningProcess }`。
- 服务要一直开着，同事才能上报；本机 IP 变了要改 `update-config.js` 和 manifest `host_permissions` 再发版。同事访问需要本机防火墙放行 8790 入站。
- 2026-11-16 已联调：模拟插件上报（匿名 → 带姓名）、口令校验（无口令 403）、非法 client_id 拒绝、明细页渲染均正常，测试行已删除。

## 6. 安装与调试

1. Chrome/Edge 打开 `chrome://extensions`（或 `edge://extensions`），开启开发者模式。
2. "加载已解压的扩展程序" → 选本目录 `F:\PycharmProjects\pythonProject\魅KTV效率助手`（同事用 `git clone` 下来的目录）。
3. 改完代码：扩展页点刷新图标，**再刷新目标页面**。

调试：目标页 DevTools Console 搜 `[门店批量选择助手]`。注意 op 后台内容在 iframe 里，Console 左上角要切到对应 frame 才能看到日志。

无自动化测试；验证只能在真实后台手动点。批量提交会真实写线上数据，测试时用 1–2 个门店/歌手。

## 7. 已知问题 / 待办（2026-11-16 读代码发现）

1. ~~CSV 导出换行/BOM 多了反斜杠~~ —— 2026-11-16 已修（`downloadMusicCsv()`），待在真实页面导出验证。
2. ~~歌手按钮位置不会自我修正~~ —— 2026-11-16 已修（`syncButton()` 对 singer 页也调用 `placeMusicButton()`），待真实页面验证。
3. **歌手查重偏宽**：`singerExistsInPayload()` 只要返回里有 `id/singerId` 加任意名字字段就判定"已存在"，如果 `getByName` 是模糊匹配，同名前缀的歌手会被误判跳过。上线前最好确认接口是否精确匹配。
4. 歌手批量没有"重试失败项"和"导出 CSV"，播放列表那边有，业务要的话照搬。
5. ~~README 目录名、manifest 描述过时~~ —— 2026-11-16 已更新。
6. `syncButton()` 每次 DOM 变动都打一条 `console.debug`，页面变化频繁时日志很吵（默认 Verbose 级别才显示，影响不大）。
7. `musicState.abortController` 创建了但暂停时从未 `abort()`，暂停靠循环里轮询实现；代码里的 AbortError 分支实际走不到，不影响功能。

## 8. 改动约定

- 改功能同步更新 `README.md`，发版用 `scripts/bump_version.py` 升版本号（不要只改 manifest，version.json 会对不上）。
- 新增页面支持：在 `manifest.json` 的 `matches` 和 `host_permissions` 里都加上，再在 `content.js` 加对应的 `isXxxPage()` 和按钮锚点逻辑。
- 新增的 DOM id/类名沿用 `meiktv-` 前缀，避免和后台页面冲突。
- 不要在插件里写死 token/Cookie，也不要把门店/素材数据存进插件。
