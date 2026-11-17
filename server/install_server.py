"""魅KTV效率助手 —— 安装明细上报服务（只用标准库 + pymysql）。

插件后台每小时、以及在禅道页面识别到登录人时，POST 到 /api/ping；
本服务把记录写进 MySQL 表 helper_install（不存在会自动建），
管理员用浏览器打开 /installs?key=<admin_key> 查看安装明细。

配置：server/config.local.json（已 .gitignore，绝不要提交），格式见 config.example.json。
启动：python server/install_server.py    （或双击 server/启动上报服务.bat）
日志：server/server.log，每行写完立即关闭文件，运行中也能用记事本打开；超过 5MB 启动时自动轮转为 server.log.1。
"""
import datetime
import html
import json
import pathlib
import re
import secrets
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import pymysql

HERE = pathlib.Path(__file__).resolve().parent
CONFIG_PATH = HERE / "config.local.json"
LOG_PATH = HERE / "server.log"
LOG_MAX_BYTES = 5 * 1024 * 1024
TABLE = "helper_install"


def log(msg):
    """追加一行日志后立即关闭文件（不长期占用，记事本可随时打开）；有控制台时同时打印。"""
    line = f"[{datetime.datetime.now():%Y-%m-%d %H:%M:%S}] {msg}\n"
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line)
    except OSError:
        pass
    if sys.stderr:  # pythonw 启动时没有控制台，sys.stderr 为 None
        try:
            sys.stderr.write(line)
        except Exception:  # noqa: BLE001
            pass


def rotate_log():
    try:
        if LOG_PATH.exists() and LOG_PATH.stat().st_size > LOG_MAX_BYTES:
            LOG_PATH.replace(LOG_PATH.with_suffix(".log.1"))
    except OSError:
        pass

DDL = f"""
CREATE TABLE IF NOT EXISTS `{TABLE}` (
  `client_id`  VARCHAR(64)  NOT NULL COMMENT '插件安装实例ID（每个浏览器一个，随机生成）',
  `name`       VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '禅道真实姓名',
  `dept`       VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '禅道所属部门',
  `role`       VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '禅道职位',
  `version`    VARCHAR(32)  NOT NULL DEFAULT '' COMMENT '插件版本',
  `browser`    VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '浏览器及版本',
  `os`         VARCHAR(32)  NOT NULL DEFAULT '' COMMENT '操作系统',
  `ip`         VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '最后上报来源IP',
  `first_seen` DATETIME     NOT NULL COMMENT '首次上报时间',
  `last_seen`  DATETIME     NOT NULL COMMENT '最后上报时间',
  `ping_count` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '上报次数',
  PRIMARY KEY (`client_id`),
  KEY `idx_last_seen` (`last_seen`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='魅KTV效率助手插件安装明细'
"""

UPSERT = f"""
INSERT INTO `{TABLE}` (client_id, name, dept, role, version, browser, os, ip, first_seen, last_seen, ping_count)
VALUES (%(client_id)s, %(name)s, %(dept)s, %(role)s, %(version)s, %(browser)s, %(os)s, %(ip)s, %(now)s, %(now)s, 1)
ON DUPLICATE KEY UPDATE
  name = IF(VALUES(name) = '', name, VALUES(name)),
  dept = IF(VALUES(dept) = '', dept, VALUES(dept)),
  role = IF(VALUES(role) = '', role, VALUES(role)),
  version = VALUES(version), browser = VALUES(browser), os = VALUES(os), ip = VALUES(ip),
  last_seen = VALUES(last_seen), ping_count = ping_count + 1
"""

FIELDS = {"client_id": 64, "name": 64, "dept": 64, "role": 64, "version": 32, "browser": 64, "os": 32}


def load_config():
    if not CONFIG_PATH.exists():
        log(f"缺少配置文件 {CONFIG_PATH}，请复制 config.example.json 改名后填写。")
        sys.exit(1)
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    if not cfg.get("admin_key"):
        cfg["admin_key"] = secrets.token_urlsafe(12)
        CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
        log(f"已生成查看口令 admin_key 并写回 {CONFIG_PATH.name}")
    return cfg


CFG = load_config()
DB_LOCK = threading.Lock()


def db():
    m = CFG["mysql"]
    return pymysql.connect(host=m.get("host", "localhost"), port=int(m.get("port", 3306)), user=m["user"],
                           password=m["password"], database=m["database"], charset="utf8mb4", autocommit=True,
                           connect_timeout=5)


def init_db():
    with db() as conn, conn.cursor() as cur:
        cur.execute(DDL)


def latest_version():
    try:
        return json.loads((HERE.parent / "version.json").read_text(encoding="utf-8")).get("version", "")
    except Exception:  # noqa: BLE001
        return ""


def vtuple(v):
    return tuple(int(x) for x in re.findall(r"\d+", v or "")) or (0,)


class Handler(BaseHTTPRequestHandler):
    server_version = "MeiktvHelperInstall/1.0"

    def log_message(self, fmt, *args):
        log(f"{self.client_address[0]} {fmt % args}")

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self._send(204, b"")

    def do_POST(self):
        if urlparse(self.path).path != "/api/ping":
            return self._send(404, '{"ok":false}')
        try:
            length = min(int(self.headers.get("Content-Length", 0)), 4096)
            payload = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._send(400, '{"ok":false,"error":"bad json"}')
        row = {k: str(payload.get(k, "") or "").strip()[:n] for k, n in FIELDS.items()}
        if not re.fullmatch(r"[A-Za-z0-9-]{8,64}", row["client_id"]):
            return self._send(400, '{"ok":false,"error":"bad client_id"}')
        row["ip"] = self.client_address[0]
        row["now"] = datetime.datetime.now().replace(microsecond=0)
        try:
            with DB_LOCK, db() as conn, conn.cursor() as cur:
                cur.execute(UPSERT, row)
        except pymysql.MySQLError as e:
            self.log_message("写库失败：%s", e)
            return self._send(500, '{"ok":false,"error":"db"}')
        return self._send(200, '{"ok":true}')

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/health":
            return self._send(200, '{"ok":true}')
        if url.path == "/update/version.json":
            data = released_file("version.json")
            if data is None:
                return self._send(503, '{"ok":false,"error":"no release"}')
            return self._send(200, data, "application/json; charset=utf-8")
        if url.path == "/update/plugin.zip":
            data = released_zip()
            if data is None:
                return self._send(503, "打包失败", "text/plain; charset=utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Disposition", 'attachment; filename="meiktv-efficiency-helper.zip"')
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)
            return None
        if url.path == "/api/team-config":
            # 分组与默认抄送名单只放在本地配置（config.local.json 的 team），不进公开仓库；插件后台定时拉取
            team = CFG.get("team") or {}
            body = {"groups": team.get("groups") or {}, "mailto": team.get("mailto") or []}
            return self._send(200, json.dumps(body, ensure_ascii=False))
        if url.path not in ("/", "/installs"):
            return self._send(404, "not found", "text/plain; charset=utf-8")
        key = (parse_qs(url.query).get("key") or [""])[0]
        if not secrets.compare_digest(key, CFG["admin_key"]):
            return self._send(403, "需要查看口令：/installs?key=...", "text/plain; charset=utf-8")
        return self._send(200, render_page(), "text/html; charset=utf-8")


# ---------- 内网更新：插件和 updater 只从这里取新版 ----------
# 只提供“已发布”的内容：取本地仓库的 release 分支（发版时 git branch -f release HEAD），本地未发版的提交不会被下载到。
# 还没有 release 分支时退回 origin/main（旧的发版方式）。
REPO_DIR = HERE.parent
RELEASE_REFS = ("refs/heads/release", "origin/main")
_zip_cache = {"sha": "", "data": b""}
_zip_lock = threading.Lock()


def _git(*args):
    import subprocess  # noqa: PLC0415
    flags = 0x08000000 if sys.platform == "win32" else 0  # CREATE_NO_WINDOW，pythonw 下不弹黑框
    return subprocess.run(["git", "-C", str(REPO_DIR), *args], capture_output=True, timeout=60,
                          creationflags=flags, check=True).stdout


def release_ref():
    for ref in RELEASE_REFS:
        try:
            _git("rev-parse", "--verify", "--quiet", ref)
            return ref
        except Exception:  # noqa: BLE001
            continue
    raise RuntimeError("没有 release 分支，也没有 origin/main")


def released_file(path):
    try:
        return _git("show", f"{release_ref()}:{path}")
    except Exception as e:  # noqa: BLE001
        log(f"读取已发布文件 {path} 失败：{e}")
        return None


def released_zip():
    try:
        ref = release_ref()
        sha = _git("rev-parse", ref).decode().strip()
        with _zip_lock:
            if _zip_cache["sha"] != sha:
                # 压缩包里是 meiktv-efficiency-helper-main/ 目录（沿用旧结构，updater 按 manifest.json 位置找根目录）
                _zip_cache["data"] = _git("archive", "--format=zip", "--prefix=meiktv-efficiency-helper-main/", ref)
                _zip_cache["sha"] = sha
                log(f"已打包内网更新 zip：{sha[:7]}，{len(_zip_cache['data']) // 1024} KB")
            return _zip_cache["data"]
    except Exception as e:  # noqa: BLE001
        log(f"打包内网更新 zip 失败：{e}")
        return None


def render_page():
    with db() as conn, conn.cursor(pymysql.cursors.DictCursor) as cur:
        cur.execute(f"SELECT * FROM `{TABLE}` ORDER BY last_seen DESC")
        rows = cur.fetchall()
    latest = latest_version()
    now = datetime.datetime.now()
    active = sum(1 for r in rows if now - r["last_seen"] < datetime.timedelta(days=1))
    outdated = sum(1 for r in rows if latest and vtuple(r["version"]) < vtuple(latest))
    named = sum(1 for r in rows if r["name"])
    e = html.escape

    def tr(r):
        age = now - r["last_seen"]
        status = "活跃" if age < datetime.timedelta(days=1) else ("近7天" if age < datetime.timedelta(days=7) else "不活跃")
        cls = "ok" if status == "活跃" else ("warn" if status == "近7天" else "off")
        old = latest and vtuple(r["version"]) < vtuple(latest)
        return (
            f"<tr><td>{e(r['name']) or '<span class=muted>未识别</span>'}</td><td>{e(r['dept'])}</td><td>{e(r['role'])}</td>"
            f"<td class='{'old' if old else ''}'>{e(r['version'])}{' ↑待更新' if old else ''}</td>"
            f"<td>{e(r['browser'])}</td><td>{e(r['os'])}</td><td>{e(r['ip'])}</td>"
            f"<td>{r['first_seen']:%Y-%m-%d %H:%M}</td><td>{r['last_seen']:%Y-%m-%d %H:%M}</td>"
            f"<td><span class='tag {cls}'>{status}</span></td><td>{r['ping_count']}</td></tr>"
        )

    body = "".join(tr(r) for r in rows) or "<tr><td colspan=11 class=muted>暂无上报</td></tr>"
    return f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>插件安装明细</title><style>
body{{margin:0;padding:20px;font:13px/1.6 "Microsoft YaHei",system-ui,sans-serif;color:#1f2329;background:#f5f7fa}}
h1{{font-size:18px;margin:0 0 12px}} .cards{{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px}}
.card{{background:#fff;border-radius:8px;padding:10px 16px;min-width:110px;box-shadow:0 1px 3px rgba(0,0,0,.06)}}
.card b{{display:block;font-size:22px}} .wrap{{overflow-x:auto;background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.06)}}
table{{border-collapse:collapse;width:100%;white-space:nowrap}} th,td{{padding:8px 10px;border-bottom:1px solid #eef0f4;text-align:left}}
th{{background:#fafbfc;color:#646a73;font-weight:normal}} .muted{{color:#a3abba}} .old{{color:#d1343a}}
.tag{{padding:1px 8px;border-radius:10px;font-size:12px}} .ok{{background:#e8f7ef;color:#1f8a55}} .warn{{background:#fff4e0;color:#b86e00}} .off{{background:#f0f1f5;color:#8f959e}}
</style></head><body>
<h1>魅KTV效率助手 · 安装明细</h1>
<div class="cards"><div class="card">安装数<b>{len(rows)}</b></div><div class="card">已识别姓名<b>{named}</b></div>
<div class="card">24小时内活跃<b>{active}</b></div><div class="card">最新版本<b>{e(latest) or '-'}</b></div><div class="card">待更新<b>{outdated}</b></div></div>
<div class="wrap"><table><thead><tr><th>姓名</th><th>部门</th><th>职位</th><th>插件版本</th><th>浏览器</th><th>系统</th><th>IP</th><th>首次安装</th><th>最后活跃</th><th>状态</th><th>上报次数</th></tr></thead>
<tbody>{body}</tbody></table></div>
<p class="muted">一个浏览器算一个安装；“未识别”表示该浏览器还没打开过已登录的禅道页面。生成于 {now:%Y-%m-%d %H:%M:%S}</p>
</body></html>"""


def main():
    rotate_log()
    try:
        init_db()
        host, port = CFG.get("listen_host", "0.0.0.0"), int(CFG.get("listen_port", 8790))
        server = ThreadingHTTPServer((host, port), Handler)
    except OSError as e:
        log(f"启动失败（端口被占用或数据库连不上？）：{e}")
        sys.exit(1)
    except pymysql.MySQLError as e:
        log(f"启动失败，数据库错误：{e}")
        sys.exit(1)
    # 口令不写进日志，只在有控制台时显示
    log(f"上报服务已启动：http://{host}:{port}  明细页：/installs?key=<见 config.local.json 的 admin_key>")
    if sys.stdout:
        print(f"明细页：http://<本机IP>:{port}/installs?key={CFG['admin_key']}")
    server.serve_forever()


if __name__ == "__main__":
    main()
