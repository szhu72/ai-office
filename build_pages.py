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
    docs = ROOT / "docs"
    pub_docs = ROOT / "public" / "docs"
    pub_docs.mkdir(parents=True, exist_ok=True)
    # Preserve any direct edits made to docs/*.md before rebuilding
    for md_name in ["HR_COLLEAGUE_ROSTER.md", "BRAND_VISUAL_SYSTEM.md", "brand-colors.pdf", "WORKSPACE_MAP.md"]:
        top_doc = docs / md_name
        pub_doc = pub_docs / md_name
        if top_doc.exists():
            if not pub_doc.exists() or top_doc.stat().st_mtime > pub_doc.stat().st_mtime:
                shutil.copy2(top_doc, pub_doc)

    (ROOT / "index.html").write_text(DEV_INDEX, encoding="utf-8")
    subprocess.run(["npm.cmd", "run", "build"], cwd=ROOT, check=True)
    dist = ROOT / "dist"
    (dist / ".nojekyll").write_text("", encoding="ascii")

    # Inject @ts-nocheck header to compiled JS bundles so IDE linters never report false-positive diagnostics
    dist_assets = dist / "assets"
    if dist_assets.exists():
        for js_file in dist_assets.glob("*.js"):
            content = js_file.read_text(encoding="utf-8")
            if not content.startswith("// @ts-nocheck"):
                js_file.write_text("// @ts-nocheck\n/* eslint-disable */\n" + content, encoding="utf-8")

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
    if docs.exists():
        shutil.rmtree(docs)
    shutil.copytree(dist, docs)
    # Also keep HR_COLLEAGUE_ROSTER.md, BRAND_VISUAL_SYSTEM.md, WORKSPACE_MAP.md directly at docs/<name>
    for md_name in ["HR_COLLEAGUE_ROSTER.md", "BRAND_VISUAL_SYSTEM.md", "brand-colors.pdf", "WORKSPACE_MAP.md"]:
        pub_doc = pub_docs / md_name
        if pub_doc.exists():
            shutil.copy2(pub_doc, docs / md_name)
    print("Built and synced dist/ -> root and docs/ successfully.")

if __name__ == "__main__":
    main()
