"""发版：同时更新 manifest.json 和 version.json 的版本号与更新说明。

用法（在插件目录执行）：
    python scripts/bump_version.py 2.3.1 "修复xxx" "新增yyy"
然后 git add -A && git commit -m "release 2.3.1" && git push
已安装的插件最多 1 小时内（或在弹窗点“立即检查”）就会提示更新。
"""
import datetime
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main():
    if len(sys.argv) < 3 or not re.fullmatch(r"\d+(\.\d+){1,3}", sys.argv[1]):
        sys.exit('用法：python scripts/bump_version.py <版本号如 2.3.1> "更新说明1" ["更新说明2" ...]')
    version, notes = sys.argv[1], sys.argv[2:]

    manifest_path = ROOT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    old = manifest["version"]
    if tuple(map(int, version.split("."))) <= tuple(map(int, old.split("."))):
        sys.exit(f"新版本 {version} 必须大于当前版本 {old}")
    manifest["version"] = version
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    version_path = ROOT / "version.json"
    info = json.loads(version_path.read_text(encoding="utf-8")) if version_path.exists() else {}
    history = info.get("history", [])
    if info.get("version"):
        history.insert(0, {k: info[k] for k in ("version", "date", "notes") if k in info})
    info.update({
        "version": version,
        "date": datetime.date.today().isoformat(),
        "notes": notes,
        "history": history[:20],
    })
    version_path.write_text(json.dumps(info, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{old} -> {version}，已更新 manifest.json 和 version.json")


if __name__ == "__main__":
    main()
