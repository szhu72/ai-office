"""Restore dev index.html, run Vite build, and copy compiled dist/* to root and docs/ for GitHub Pages."""
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).parent
DEV_INDEX = """<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#282b2b" />
    <meta name="description" content="一個可觀察、可互動的 AI 團隊工作空間。" />
    <title>無所事事辦公室 — AI Office</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
"""

def main():
    (ROOT / "index.html").write_text(DEV_INDEX, encoding="utf-8")
    subprocess.run(["npm.cmd", "run", "build"], cwd=ROOT, check=True)
    dist = ROOT / "dist"
    (dist / ".nojekyll").write_text("", encoding="ascii")
    for item in dist.iterdir():
        dest = ROOT / item.name
        if dest.exists():
            if dest.is_dir():
                shutil.rmtree(dest)
            else:
                dest.unlink()
        if item.is_dir():
            shutil.copytree(item, dest)
        else:
            shutil.copy2(item, dest)
    docs = ROOT / "docs"
    if docs.exists():
        shutil.rmtree(docs)
    shutil.copytree(dist, docs)
    print("Built and synced dist/ -> root and docs/ successfully.")

if __name__ == "__main__":
    main()
