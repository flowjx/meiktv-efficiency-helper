# 魅KTV效率助手

这是一个 Chrome/Edge Manifest V3 浏览器插件。

插件名称：**魅KTV效率助手**。工具栏和扩展管理页面使用 `meiktv-logo-transparent.png` 生成的透明 Logo 图标。

## 功能

- 在 `https://op.meiktv.com` 域名下运行。
- 页面动态出现以下“指定门店”单选项时，显示右下角“批量选中门店”按钮：

  ```html
  <input id="row[has_all_store]-0" name="row[has_all_store]" type="radio" value="0">
  ```

- 点击按钮会打开门店名称数组输入框，例如：`["门店A", "门店B"]`。
- “选中门店”会选中数组中匹配的门店复选框；“取消选中”会取消选中匹配的门店复选框。
- 门店名称按标签文本匹配，并自动去掉名称前的 `A-`、`B-` 等字母前缀。
- 同时兼容 `row[has_store_type]` / `row[has_store_id][]` 和 `row[store_type]` / `row[store_id][]` 两套字段。
- 门店复选框也兼容 `name="store_id[]"`、`id="store_id[]-1"` 这种直营门店写法。
- 如果直营复选框没有关联 `<label>`，数组中也可以直接填写复选框的 `value`，例如 `[1, 2, 3]`。
- 检测到包含 `----直营` 的 `<span>` 时也会显示“批量选中门店”按钮。
- 在 `http://music.remote.meiktv.com/music/play.html` 页面会在原“添加”按钮后显示“批量添加播放列表”按钮。

音乐页面的按钮会打开“批量添加播放列表”面板，支持：

- 粘贴数字逗号分隔的 `store_id` 字符串，例如 `127,128,129`；自动去重并保持顺序。
- 素材 ID 默认为空，提交前必须填写；先预览原始数量和去重数量。
- 素材 ID 提示为“素材页面的 ID，不是歌曲 ID”，音乐批处理弹框居中显示。
- 先查询 `/music-admin/meiktvSongPlayList/page`，已有该素材的门店自动跳过。
- 按顺序调用 `/music-admin/meiktvSongPlayList/save`，显示实时进度、成功数、跳过数和失败数。
- 暂停/继续、重试失败项，以及导出成功和失败 CSV（失败 CSV 包含失败原因）。
- 页面进入时刷新当前登录态参数，每次请求前再次读取最新 token；`credentials: include` 自动携带当前 `JSESSIONID` 等 Cookie，不在插件中硬编码凭证。

在 `http://music.remote.meiktv.com/singer/index.html` 页面，新增“批量添加歌手”按钮，会放在“歌手合并”按钮前面。执行时分两步：先调用 `/music-admin/meiktvSinger/getByName` 查询并移除已存在歌手，再调用 `/music-admin/meiktvSinger/add` 添加剩余歌手。输入支持每行 `歌手名,简拼,全拼`，也支持 JSON 对象数组；插件通过当前登录态调用接口。

其中自定义门店单选框也兼容 `id="row[store_type]-3"` 这种写法。

## 禅道测试单列表增强（bug.meiktv.com）

在禅道「测试 → 测试单」列表页（`m=testtask&f=browse`）自动生效（`zentao.js` + `zentao.css`）：

- **自动加载全部分页**：不用翻页，统计和搜索覆盖全部测试单。
- **统计栏**：状态（全部/进行中/未开始/被阻塞/已完成）、风险（已逾期、今明到期、3 天无更新、未完成且无备注）、负责人（未完成/总数）。点任意标签即可筛选，再点一次取消。
- **所属产品/项目合并为一列**：两者一致只显示一个；不一致时在下方用橙色提示项目名。
- **进度列**：读取每张测试单详情页的历史记录，显示最新两条备注（日期 + 人 + 内容），以及最近一次操作；结果在浏览器缓存 30 分钟，“刷新进度”强制重新拉取。
- **搜索**：按 ID/名称/负责人/版本/备注内容搜索，空格分隔多个词（同时满足），名称高亮；按 `/` 快速聚焦搜索框。筛选条件会记住。
- **结束日期提示**：未完成的显示“逾期 N 天 / 今天到期 / 明天到期”；被阻塞行左侧红条。
- **导出 CSV**：导出当前筛选结果（含最新两条备注）。
- **复制摘要**：把当前筛选结果按“被阻塞 / 已逾期 / 今明到期”整理成文字，复制后可直接贴到企微群。

## 安装

推荐用 git 安装，方便以后更新：

```bash
git clone https://github.com/flowjx/meiktv-efficiency-helper.git
```

不用 git 的话，下载 <https://github.com/flowjx/meiktv-efficiency-helper/archive/refs/heads/main.zip> 并解压。

1. 打开 Chrome/Edge 的扩展程序页面（`chrome://extensions` 或 `edge://extensions`）。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择上面克隆或解压出来的目录（里面有 `manifest.json` 的那一层）。
4. 建议把插件图标固定到工具栏，方便看到更新提醒。

## 在线更新

插件每 6 小时检查一次仓库里的 `version.json`（浏览器启动时也会检查一次）。有新版本时：

- 工具栏插件图标出现红色“新”字角标；
- 业务页面左下角弹出一次提示条（点“知道了”后，这个版本不再提示）；
- 点插件图标，弹窗里可以看到更新内容和更新步骤。

更新步骤：

1. 用 git 安装的：在插件目录执行 `git pull`；下载安装的：重新下载压缩包，解压后**覆盖**原目录的文件（目录位置不要变）。
2. 在插件弹窗里点“我已替换文件，重新加载插件”，然后刷新业务页面。

### 发布新版本（维护者）

```bash
python scripts/bump_version.py 2.3.1 "更新说明1" "更新说明2"
git add -A
git commit -m "release 2.3.1"
git push
```

脚本会同时改 `manifest.json` 和 `version.json` 的版本号。推送后，已安装的插件最多 6 小时内会提示更新，在弹窗里点“立即检查”可以马上看到。

## 调试日志

打开目标页面的开发者工具 Console，搜索：`[门店批量选择助手]`。

- `content script 已加载`：说明插件脚本已经注入。
- `检测页面元素`：会显示是否检测到触发元素、复选框数量。
- `已显示“批量选中门店”按钮`：说明按钮已经创建。
