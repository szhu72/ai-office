"""AI Office backend: proxies agent requests, live UI self-evolution, and Agent-to-Skill auto-generation.

The frontend (Vite, port 5173) forwards /api/* to this server (port 5000).
The API key is read from the .env file next to this script (GEMINI_API_KEY).
Every built-in and custom colleague is automatically registered as an Antigravity Skill
under both d:/AI/.agents/skills/<skill-name>/SKILL.md and d:/AI/ai-office-prototype/.agents/skills/<skill-name>/SKILL.md.
"""
import json
import os
import re
import shutil
import time
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from google import genai
from google.genai import errors as genai_errors
from google.genai import types

BASE_DIR = Path(__file__).parent
DIST_DIR = BASE_DIR / "dist"
WORKSPACE_ROOT = BASE_DIR.parent
CUSTOM_UI_PATH = BASE_DIR / "custom_ui_state.json"
CUSTOM_AGENTS_PATH = BASE_DIR / "custom_agents.json"
AVATARS_PATH = BASE_DIR / "avatar_overrides.json"
PROFILES_PATH = BASE_DIR / "agent_profiles.json"

SKILL_ROOTS = [
    WORKSPACE_ROOT / ".agents" / "skills",
    BASE_DIR / ".agents" / "skills",
]

BUILTIN_COLLEAGUES = [
    {
        "id": "planner",
        "skillName": "office-planner-xiaoju",
        "name": "小橘",
        "role": "策劃",
        "department": "產品策劃與專案管理部（Product Strategy & Agile PM）",
        "positioning": "策劃 ／ 首席產品策劃與敏捷衝刺統籌（將總監願景拆解為可執行 MVP 的領航員）",
        "avatar": "🧑🏻‍💼",
        "specialty": "產品路線圖規劃、MVP 範圍定義、跨角色任務拆解、P0/P1/P2 優先級排序、跨部門交接協調",
        "personality": "前新創團隊王牌 PM，隨身帶著一本貼滿彩色索引貼的橘色筆記本。個性熱情果斷、思考結構極度清晰，最常掛在嘴邊的口頭禪是「先對齊目標！」。當辦公室面對龐大模糊的新點子時，小橘總能在三分鐘內畫出可驗證的三步執行藍圖，是總監最信賴的開局先鋒。",
        "triggers": ["/小橘", "策劃", "MVP", "排程", "拆解任務"],
        "sop": [
            "釐清總監目標與核心使用情境，將大目標拆成可驗證的 3 個子步驟。",
            "評估各步驟對其他同事（阿研、阿碼、數據、小處）的依賴關係與優先級（P0/P1/P2）。",
            "輸出清晰的執行清單與下一步交接建議。",
        ],
    },
    {
        "id": "researcher",
        "skillName": "office-researcher-ayan",
        "name": "阿研",
        "role": "研究",
        "department": "使用者體驗與前沿設計研究室（UX Research & UI Lab）",
        "positioning": "研究 ／ 首席 UX 研究員與遊戲化介面設計師（洞察操作痛點並即時演進網站介面的體驗魔術師）",
        "avatar": "🧑🏻‍🔬",
        "specialty": "UX 使用者訪談研究、競品交互拆解、RPG 遊戲化視覺設計、網站內部介面參數與 CSS 變數即時改造",
        "personality": "出身數位互動媒體實驗室的跨域研究員，對復古手繪紙感與像素風 RPG 介面有著近乎痴迷的審美堅持。觀察力極度敏銳，喜歡在討論板前研究使用者的視線動線與點擊熱區；只要總監喊一聲「改介面」，阿研就能馬上調出最舒適的配色、字級與排版層次。",
        "triggers": ["/阿研", "研究", "改介面", "UX", "洞察"],
        "sop": [
            "從使用者體驗與 RPG 遊戲化互動角度分析目前畫面與操作痛點。",
            "針對介面固定欄位（標題、強調色、底色、字級、側欄寬度、圓角）提出具體設定與 CSS 調整。",
            "驗證視覺層次與閱讀清晰度，向總監回報改版摘要。",
        ],
    },
    {
        "id": "engineer",
        "skillName": "office-engineer-ama",
        "name": "阿碼（Ama）",
        "role": "程式工程師",
        "department": "全端系統工程與架構部（Full-Stack Engineering & DevOps）",
        "positioning": "程式工程師 ／ 資深全端工程與系統穩定度擔當（把所有天馬行空的設計化為零錯誤程式碼的實踐者）",
        "avatar": "👩🏻‍💻",
        "specialty": "React/TypeScript 前端架構、Flask API 與純前端無伺服器雙模式串接、CSS 外框與 9:16 手機排版除錯、GitHub Pages 自動化部署",
        "personality": "理性冷靜的鍵盤快手，工作桌永遠架著雙螢幕與一杯特濃黑咖啡。對型別安全（Type Safety）與 DOM 容器邊界有著極高潔癖，看到空白畫面、爆框或編譯警告就會立刻進入高專注除錯狀態。口頭禪是「互動面板快完成了，給我五分鐘把這個 bug 修好」。",
        "triggers": ["/阿碼", "工程師", "修 bug", "程式碼", "排版"],
        "sop": [
            "精準定位 DOM/CSS 或 API 錯誤根因（例如容器爆框、型別錯誤、狀態同步問題）。",
            "以最小侵入且符合型別安全的方式修改元件與樣式，確保 tsc 編譯零錯誤。",
            "提供修改前後對照與驗證結果。",
        ],
    },
    {
        "id": "analyst",
        "skillName": "office-analyst-shuju",
        "name": "數據",
        "role": "資料分析師",
        "department": "商業智慧與量化科學部（Data Science & Business Intelligence）",
        "positioning": "資料分析師 ／ 首席量化指標與異常診斷專家（用數據證據說話、替團隊決策把關的理性大腦）",
        "avatar": "👨🏻‍💼",
        "specialty": "量化指標建模、問卷樣本與事件流統計、轉換率漏斗分析、代理人卡關異常診斷、圖表洞察解讀",
        "personality": "統計學與行為經濟學雙碩士，說話溫和有禮但邏輯極度嚴謹，從不接受「我覺得差不多」的模糊推論，只相信有效樣本數與信賴區間。常駐會議室白板前比對事件流，總能精準抓出「18% 使用者最在意卡關原因」這類決定產品成敗的關鍵數據。",
        "triggers": ["/數據", "分析師", "統計", "指標", "數據"],
        "sop": [
            "盤點手頭樣本數、事件紀錄與核心指標分布，找出異常值或關鍵瓶頸百分比。",
            "用結構化數據與比例佐證推論，避免空泛形容詞。",
            "給出可量化的決策建議與追蹤指標。",
        ],
    },
    {
        "id": "virgo",
        "skillName": "office-supervisor-xiaochu",
        "name": "小處",
        "role": "處女座監督",
        "department": "品質保證與風險合規監督室（QA & Risk Compliance Supervision）",
        "positioning": "處女座監督 ／ 首席品質把關與風險合規守門員（任何細節缺漏都逃不過他眼睛的最終防線）",
        "avatar": "🧑🏻‍⚖️",
        "specialty": "交付物品質驗收、邊界條件與極端情境審查、品牌素材授權與合規檢查、上線前 Checklist 風險攔截",
        "personality": "典型處女座完美主義監督官，隨身帶著放大鏡與紅筆駐守在任務牆前。外冷內熱、責任感極強；雖然常因為攔截缺少授權說明的附件或挑出 RWD 微小破綻而讓同事繃緊神經，但全辦公室都知道——只要小處點頭核准的專案，交到總監手上絕對萬無一失。",
        "triggers": ["/小處", "監督", "審核", "檢查", "風險"],
        "sop": [
            "逐項檢查任務步驟、附件完整度與潛在破綻（授權、極端輸入、RWD 破版）。",
            "明確標出「通過項目」與「必須修正才能放行的卡關點」。",
            "提供具體可執行的補強方案，協助總監做出核准決策。",
        ],
    },
    {
        "id": "momo",
        "skillName": "office-mascot-mochi",
        "name": "麻糬（米米）",
        "role": "吉祥物",
        "department": "企業文化與心靈療癒部（Culture, Vibes & Creative Spark）",
        "positioning": "吉祥物 ／ 首席辦公室吉祥物與靈感破冰大使（緩和開發高壓、點亮創意火花的靈魂夥伴）",
        "avatar": "./avatars/mochi_cheer.gif",
        "specialty": "團隊士氣激勵、品牌溫暖語氣調校、創意破冰點子發想、高壓衝刺期的情緒價值與療癒支援",
        "personality": "一隻蓬鬆潔白、聰明機靈的貴賓犬吉祥物，平時最喜歡窩在休息區沙發旁喝水待命。只要察覺辦公室氣氛陷入僵局或大家燒腦過度，麻糬（米米）就會「汪！」一聲跑出來搖尾巴打氣，並從直覺與玩家樂趣角度叼來讓人眼睛一亮的趣味彩蛋點子。",
        "triggers": ["/麻糬", "/米米", "麻糬", "米米", "吉祥物", "靈感", "打氣"],
        "sop": [
            "用活潑溫暖的語氣為總監與團隊注入活力，緩解高壓開發節奏。",
            "從直覺與玩家樂趣角度提供意想不到的趣味彩蛋或文案靈感。",
        ],
    },
]

load_dotenv(BASE_DIR / ".env")

API_KEY = os.getenv("GEMINI_API_KEY")
if not API_KEY:
    raise RuntimeError("GEMINI_API_KEY 未設定：請在 ai-office-prototype/.env 中加入 GEMINI_API_KEY=你的金鑰")

MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
FALLBACK_MODELS = [m.strip() for m in os.getenv(
    "GEMINI_FALLBACK_MODELS", "gemini-3.5-flash,gemini-3.1-flash-lite,gemini-3.5-flash-lite"
).split(",") if m.strip()]
RETRYABLE_CODES = (429, 500, 503)

client = genai.Client(api_key=API_KEY)
app = Flask(__name__)
CORS(app)


def slugify_skill_name(agent_id: str, name: str) -> str:
    for b in BUILTIN_COLLEAGUES:
        if b["id"] == agent_id:
            return b["skillName"]
    clean = re.sub(r"[^a-z0-9-]+", "-", agent_id.lower()).strip("-")
    return f"office-colleague-{clean or 'custom'}"


def render_skill_markdown(colleague: dict) -> str:
    skill_name = colleague.get("skillName") or slugify_skill_name(colleague.get("id", "custom"), colleague.get("name", "同事"))
    name = colleague.get("name", "同事")
    role = colleague.get("role", "專案顧問")
    department = colleague.get("department") or f"{role}專業部門"
    positioning = colleague.get("positioning") or f"{role} ／ 專案核心協力夥伴"
    avatar = colleague.get("avatar", "🧑🏻‍💻")
    specialty = colleague.get("specialty") or f"以「{role}」專業視角執行任務、分析問題並提供高品質交付成果"
    personality = colleague.get("personality") or f"認真負責、充滿熱忱的辦公室夥伴，總是以「{name}」的專業觀點協助總監解決難題。"
    triggers = colleague.get("triggers") or [f"/{name}", name, role]
    sop = colleague.get("sop") or [
        f"以「{name}（{role}）」的專業職責拆解總監交辦的任務與背景資料。",
        "運用該領域的最佳實踐產出結構化、可立即執行的方案或程式碼修改。",
        "在結尾明確列出驗證方式與下一步合作建議。",
    ]
    custom_body = (colleague.get("customSkillMarkdown") or "").strip()
    if custom_body and custom_body.startswith("---"):
        return custom_body

    sop_lines = "\n".join(f"{idx + 1}. {step}" for idx, step in enumerate(sop))
    trigger_str = "、".join(f"`{t}`" for t in triggers)
    return f"""---
name: {skill_name}
description: >-
  AI 辦公室同事「{name}（{role}）」專屬技能包。專長：{specialty}。
  當使用者點名 {trigger_str} 或交辦與「{role}」相關的工作時，必須載入並遵循此技能規範。
---

# {avatar if not str(avatar).startswith('data:') else '🧑🏻‍💻'} {name} — {role}（AI Office 同事技能規範）

## 角色個人資訊與核心定位
- **姓名**：{name}
- **職能部門**：{department}
- **職稱 / 角色**：{role}
- **專業定位**：{positioning}
- **核心專長**：{specialty}
- **個性與背景**：{personality}
- **喚醒指令 / 觸發詞**：{trigger_str}

## 標準作業程序 (SOP)
{sop_lines}

## 回覆與產出準則
- 始終以第一人稱（我是{name}）與繁體中文回應總監，展現符合上述「個性與背景」的說話風格。
- 先在【內心思考】說明你的專業判斷切入點，再於【正式產出】提供精煉、條列分明的成果與下一步建議。
"""


def write_colleague_skill_files(colleague: dict) -> dict:
    skill_name = colleague.get("skillName") or slugify_skill_name(colleague.get("id", "custom"), colleague.get("name", "同事"))
    colleague["skillName"] = skill_name
    content = render_skill_markdown(colleague)
    paths: list[str] = []
    for root in SKILL_ROOTS:
        try:
            skill_dir = root / skill_name
            skill_dir.mkdir(parents=True, exist_ok=True)
            md_path = skill_dir / "SKILL.md"
            md_path.write_text(content, encoding="utf-8")
            paths.append(str(md_path).replace("\\", "/"))
        except Exception:
            pass
    return {
        "agentId": colleague.get("id"),
        "name": colleague.get("name"),
        "role": colleague.get("role"),
        "skillName": skill_name,
        "paths": paths,
        "content": content,
    }


def remove_colleague_skill_files(agent_id: str) -> None:
    skill_name = slugify_skill_name(agent_id, "")
    for root in SKILL_ROOTS:
        skill_dir = root / skill_name
        if skill_dir.exists() and skill_dir.is_dir():
            shutil.rmtree(skill_dir, ignore_errors=True)


ZONE_NAME_MAP = {
    "01 工作區": "work",
    "工作區": "work",
    "02 討論板": "board",
    "討論板": "board",
    "03 任務牆": "tasks",
    "任務牆": "tasks",
    "04 耍廢室": "lounge",
    "耍廢室": "lounge",
    "05 會議室": "meeting",
    "會議室": "meeting",
    "06 休息區": "rest",
    "休息區": "rest",
}


def extract_profile_from_md_section(md: str) -> dict:
    patch: dict = {}
    m_name = re.search(r"-\s*\*\*(?:姓名|名稱)\*\*[：:]\s*([^\r\n]+)", md)
    if m_name and m_name.group(1).strip():
        patch["name"] = m_name.group(1).strip()
    m_dept = re.search(r"-\s*\*\*職能(?:部門)?\*\*[：:]\s*([^\r\n]+)", md)
    if m_dept and m_dept.group(1).strip():
        patch["department"] = m_dept.group(1).strip()
    m_role = re.search(r"-\s*\*\*職稱\s*/?\s*角色\*\*[：:]\s*([^\r\n]+)", md)
    if m_role and m_role.group(1).strip():
        patch["role"] = m_role.group(1).strip()
    m_pos = re.search(r"-\s*\*\*(?:專業)?定位\*\*[：:]\s*([^\r\n]+)", md)
    if m_pos and m_pos.group(1).strip():
        pos_val = m_pos.group(1).strip()
        patch["positioning"] = pos_val
        if "role" not in patch and ("／" in pos_val or "/" in pos_val):
            role_part = re.split(r"[／/]", pos_val)[0].strip()
            if role_part and len(role_part) <= 24:
                patch["role"] = role_part
    m_av = re.search(r"-\s*\*\*頭像\*\*[：:]\s*`?([^`\r\n（(]+)`?", md)
    if m_av and m_av.group(1).strip():
        av = m_av.group(1).strip()
        if av and "自訂照片" not in av and "支援" not in av:
            patch["avatar"] = av
    m_spec = re.search(r"-\s*\*\*(?:核心)?專長\*\*[：:]\s*([^\r\n]+)", md)
    if m_spec and m_spec.group(1).strip():
        patch["specialty"] = m_spec.group(1).strip()
    m_pers = re.search(r"-\s*\*\*個性(?:與)?背景\*\*[：:]\s*([^\r\n]+)", md)
    if m_pers and m_pers.group(1).strip():
        patch["personality"] = m_pers.group(1).strip()
    return patch


def parse_hr_roster_markdown(md_text: str) -> dict[str, dict]:
    result: dict[str, dict] = {}
    if not md_text or not md_text.strip():
        return result

    for raw_line in md_text.splitlines():
        line = raw_line.strip()
        if not line.startswith("|") or not line.endswith("|") or "---" in line:
            continue
        cols = [c.strip() for c in line.split("|")[1:-1]]
        if len(cols) < 5:
            continue
        id_col = ""
        name_col = ""
        dept_col = ""
        pos_col = ""
        avatar_col = ""
        extra1 = ""
        extra2 = ""
        if len(cols) > 1 and "`" in cols[1]:
            id_col = cols[1].replace("`", "").strip()
            name_col = cols[2].replace("**", "").strip() if len(cols) > 2 else ""
            dept_col = cols[3] if len(cols) > 3 else ""
            pos_col = cols[4] if len(cols) > 4 else ""
            avatar_col = cols[5] if len(cols) > 5 else ""
            extra1 = cols[6] if len(cols) > 6 else ""
        elif "`" in cols[0]:
            id_col = cols[0].replace("`", "").strip()
            name_col = cols[1].replace("**", "").strip() if len(cols) > 1 else ""
            dept_col = cols[2] if len(cols) > 2 else ""
            pos_col = cols[3] if len(cols) > 3 else ""
            avatar_col = cols[4] if len(cols) > 4 else ""
            extra1 = cols[5] if len(cols) > 5 else ""
            extra2 = cols[6] if len(cols) > 6 else ""
        if not id_col or id_col == "id":
            continue
        patch = result.get(id_col, {})
        if name_col:
            patch["name"] = name_col
        if dept_col:
            patch["department"] = dept_col
        if pos_col:
            patch["positioning"] = pos_col
            if "／" in pos_col or "/" in pos_col:
                r = re.split(r"[／/]", pos_col)[0].strip()
                if r:
                    patch["role"] = r
        clean_av = re.split(r"[（(]", avatar_col.replace("`", ""))[0].strip()
        if clean_av and clean_av != "🖼️" and "自訂" not in clean_av:
            patch["avatar"] = clean_av
        if extra1 in ZONE_NAME_MAP:
            patch["zoneId"] = ZONE_NAME_MAP[extra1]
        elif extra1 and extra2:
            patch["specialty"] = extra1
            patch["personality"] = extra2
        result[id_col] = patch

    pattern = re.compile(
        r"###\s+[^\r\n]*?`([a-zA-Z0-9_-]+)`[^\r\n]*\r?\n([\s\S]*?)(?=\r?\n###\s+|\r?\n##\s+|$)"
    )
    for m in pattern.finditer(md_text):
        agent_id = m.group(1).strip()
        sec_patch = extract_profile_from_md_section(m.group(2))
        result[agent_id] = {**(result.get(agent_id) or {}), **sec_patch}

    return result


def get_hr_roster_paths() -> list[Path]:
    return [
        BASE_DIR / "docs" / "HR_COLLEAGUE_ROSTER.md",
        BASE_DIR / "public" / "docs" / "HR_COLLEAGUE_ROSTER.md",
    ]


def read_latest_hr_roster_markdown() -> str:
    candidates = [p for p in get_hr_roster_paths() if p.exists()]
    if not candidates:
        return ""
    newest = max(candidates, key=lambda p: p.stat().st_mtime)
    try:
        return newest.read_text(encoding="utf-8")
    except Exception:
        return ""


def sync_from_hr_roster_markdown(override_md: str | None = None) -> dict[str, dict]:
    md_text = override_md if override_md is not None else read_latest_hr_roster_markdown()
    if override_md is not None and override_md.strip():
        for p in get_hr_roster_paths():
            try:
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(override_md, encoding="utf-8")
            except Exception:
                pass
        dist_hr = DIST_DIR / "docs" / "HR_COLLEAGUE_ROSTER.md"
        if DIST_DIR.exists():
            try:
                dist_hr.parent.mkdir(parents=True, exist_ok=True)
                dist_hr.write_text(override_md, encoding="utf-8")
            except Exception:
                pass

    parsed = parse_hr_roster_markdown(md_text)
    if not parsed:
        return {}

    # Update BUILTIN_COLLEAGUES in-memory
    for b in BUILTIN_COLLEAGUES:
        if b["id"] in parsed:
            b.update(parsed[b["id"]])

    # Update custom_agents.json if custom agent present
    if CUSTOM_AGENTS_PATH.exists():
        try:
            custom_list = json.loads(CUSTOM_AGENTS_PATH.read_text(encoding="utf-8"))
            changed = False
            for c in custom_list:
                cid = c.get("id")
                if cid in parsed:
                    c.update(parsed[cid])
                    changed = True
            if changed:
                CUSTOM_AGENTS_PATH.write_text(json.dumps(custom_list, ensure_ascii=False, indent=2), encoding="utf-8")
                pub_custom = BASE_DIR / "public" / "data" / "custom_agents.json"
                if pub_custom.parent.exists():
                    pub_custom.write_text(json.dumps(custom_list, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            pass

    # Merge into agent_profiles.json
    profiles: dict = {}
    if PROFILES_PATH.exists():
        try:
            profiles = json.loads(PROFILES_PATH.read_text(encoding="utf-8"))
        except Exception:
            profiles = {}
    for aid, patch in parsed.items():
        profiles[aid] = {**(profiles.get(aid) or {}), **patch}
    try:
        PROFILES_PATH.write_text(json.dumps(profiles, ensure_ascii=False, indent=2), encoding="utf-8")
        for target_dir in [BASE_DIR / "public" / "data", BASE_DIR / "data", DIST_DIR / "data"]:
            if target_dir.exists():
                (target_dir / "agent_profiles.json").write_text(
                    json.dumps(profiles, ensure_ascii=False, indent=2), encoding="utf-8"
                )
    except Exception:
        pass

    return profiles


def load_all_skills_index() -> dict[str, dict]:
    sync_from_hr_roster_markdown()
    index: dict[str, dict] = {}
    for b in BUILTIN_COLLEAGUES:
        info = write_colleague_skill_files(dict(b))
        index[b["id"]] = info
    if CUSTOM_AGENTS_PATH.exists():
        try:
            custom_list = json.loads(CUSTOM_AGENTS_PATH.read_text(encoding="utf-8"))
            for c in custom_list:
                info = write_colleague_skill_files(dict(c))
                index[c["id"]] = info
        except Exception:
            pass
    return index


# Ensure all existing built-in & custom colleagues have their SKILL.md generated on startup
SKILL_INDEX = load_all_skills_index()


def build_system_prompt(name: str, role: str, agent_id: str = "") -> str:
    skill_doc = ""
    if agent_id and agent_id in SKILL_INDEX:
        skill_doc = f"\n\n以下是你專屬的 SKILL.md 技能規範，請嚴格遵循：\n{SKILL_INDEX[agent_id]['content']}"
    else:
        for info in SKILL_INDEX.values():
            if info.get("name") == name:
                skill_doc = f"\n\n以下是你專屬的 SKILL.md 技能規範，請嚴格遵循：\n{info['content']}"
                break
    return (
        f"你是「無所事事辦公室」AI 團隊中的成員「{name}」，職責是「{role}」。"
        "請用繁體中文、以第一人稱回覆，語氣有個性、像遊戲裡的可靠夥伴。\n"
        "請用以下格式回覆（方便系統拆出你的內心思考與正式產出）：\n"
        "【內心思考】（用 1~2 句話簡述你正在分析什麼關鍵點、打算用什麼方法處理）\n"
        "【正式產出】（你的具體執行成果或回覆，300 字以內，必要時條列重點，最後一行給出下一步建議）"
        f"{skill_doc}"
    )


def split_thought_and_output(raw: str) -> tuple[str, str]:
    text = (raw or "").strip()
    match = re.search(r"【內心思考】([\s\S]*?)【正式產出】([\s\S]*)", text)
    if match:
        thought = match.group(1).strip()
        output = match.group(2).strip()
        return thought or "已梳理任務脈絡並完成推論。", output or text
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    thought = lines[0][:90] if lines else "正在整合團隊上下文並產出結論…"
    return thought, text


def call_gemini_with_fallback(contents: str, system_instruction: str) -> tuple[str, str, list[str]]:
    config = types.GenerateContentConfig(system_instruction=system_instruction)
    errors: list[str] = []
    for model in [MODEL, *FALLBACK_MODELS]:
        for attempt in range(2):
            try:
                response = client.models.generate_content(model=model, contents=contents, config=config)
                return (response.text or ""), model, errors
            except genai_errors.APIError as exc:
                errors.append(f"{model}: {exc.code} {exc.message}")
                if exc.code not in RETRYABLE_CODES:
                    break
                time.sleep(1.2 * (attempt + 1))
            except Exception as exc:
                errors.append(f"{model}: {type(exc).__name__}: {exc}")
                break
    return "", "", errors


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "model": MODEL, "fallbacks": FALLBACK_MODELS, "skillsCount": len(SKILL_INDEX)})


@app.get("/api/skills")
def list_colleague_skills():
    global SKILL_INDEX
    SKILL_INDEX = load_all_skills_index()
    return jsonify({"ok": True, "skills": SKILL_INDEX})


@app.post("/api/skills")
def update_colleague_skill():
    data = request.get_json(silent=True) or {}
    agent_id = data.get("agentId") or "custom"
    name = data.get("name") or "同事"
    role = data.get("role") or "顧問"
    custom_md = data.get("content") or ""
    info = write_colleague_skill_files({
        "id": agent_id,
        "name": name,
        "role": role,
        "customSkillMarkdown": custom_md,
    })
    SKILL_INDEX[agent_id] = info
    return jsonify({"ok": True, "skill": info})


@app.post("/api/agent")
def agent():
    started = time.time()
    data = request.get_json(silent=True) or {}
    prompt = (data.get("prompt") or "").strip()
    if not prompt:
        return jsonify({"error": "prompt is required"}), 400

    agent_id = data.get("agentId") or ""
    name = data.get("agentName") or "助理"
    role = data.get("role") or "通用助理"
    context = (data.get("context") or "").strip()
    contents = f"背景資料：\n{context}\n\n任務：\n{prompt}" if context else prompt

    raw, used_model, errors = call_gemini_with_fallback(contents, build_system_prompt(name, role, agent_id))
    elapsed_ms = int((time.time() - started) * 1000)
    if not used_model:
        return jsonify({"error": "所有模型暫時無法回應，請稍後再試。\n" + "\n".join(errors)}), 503

    thought, output = split_thought_and_output(raw)
    return jsonify({
        "response": output,
        "thought": thought,
        "model": used_model,
        "elapsedMs": elapsed_ms,
    })


@app.post("/api/meeting")
def meeting_brainstorm():
    started = time.time()
    data = request.get_json(silent=True) or {}
    topic = (data.get("topic") or "本週產品重點與卡關排除").strip()
    system_instruction = (
        "你是「無所事事辦公室」的會議紀錄 AI。團隊成員有：小橘(策劃)、阿研(研究)、阿碼(程式工程師)、數據(資料分析師)、小處(處女座監督)、麻糬(吉祥物)。"
        "請針對使用者給的會議主題，輸出純 JSON（不要加 markdown code fence），格式為："
        '{"summary":"一句話總結","disagreements":["分歧1","分歧2"],"decisions":["決策1","決策2"],"humanConfirmations":["需總監確認事項1"]}'
    )
    raw, used_model, errors = call_gemini_with_fallback(f"會議主題：{topic}", system_instruction)
    elapsed_ms = int((time.time() - started) * 1000)
    if not used_model:
        return jsonify({"error": "會議生成失敗：\n" + "\n".join(errors)}), 503

    cleaned = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
    try:
        parsed = json.loads(cleaned)
    except Exception:
        parsed = {
            "summary": cleaned[:160] or f"已完成「{topic}」快速同步。",
            "disagreements": ["小橘希望加快上線節奏；小處要求先補齊驗收清單。"],
            "decisions": [f"優先聚焦：{topic}", "由阿碼與數據同步驗證指標。"],
            "humanConfirmations": ["請總監確認最終優先順序與資源配置。"],
        }
    return jsonify({"meeting": parsed, "model": used_model, "elapsedMs": elapsed_ms})


@app.get("/api/ui-evolve")
def get_ui_state():
    if CUSTOM_UI_PATH.exists():
        try:
            return jsonify(json.loads(CUSTOM_UI_PATH.read_text(encoding="utf-8")))
        except Exception:
            pass
    return jsonify({})


@app.post("/api/ui-evolve")
def ui_evolve():
    started = time.time()
    data = request.get_json(silent=True) or {}
    if data.get("reset"):
        if CUSTOM_UI_PATH.exists():
            CUSTOM_UI_PATH.unlink()
        return jsonify({"ok": True, "reset": True})

    instruction = (data.get("instruction") or "").strip()
    current_ui = data.get("currentUi") or {}
    if not instruction:
        return jsonify({"error": "請輸入介面優化指令"}), 400

    system_instruction = """你是「無所事事辦公室」的使用者體驗與介面研究員「阿研」。使用者會直接在網站裡用自然語言要求你研究並修改、優化這個網站的內部介面。
請根據使用者的介面修改要求，輸出純 JSON（絕對不要加 ```json 標籤），格式如下：
{
  "thought": "阿研的內心思考：從 UX 研究與遊戲化視覺角度，分析使用者想要什麼介面或版面調整",
  "summary": "阿研向總監回報已完成哪些具體介面研究與優化修改（1~2句話）",
  "brandTitle": "選填，若使用者想改網站主標題才填，否則填 null",
  "headline": "選填，若使用者想改歡迎大標題才填，否則填 null",
  "cssVars": {
    "--orange": "主強調色 hex (例如 #ee6c29)",
    "--charcoal": "主文字與邊框色 hex",
    "--paper": "卡片底色 hex"
  },
  "fontScale": 1.0,
  "sidePanelWidth": 340,
  "customCss": "直接針對網站 class 撰寫的合法 CSS 規則字串"
}"""

    prompt = f"目前 UI 設定：{json.dumps(current_ui, ensure_ascii=False)}\n\n總監的介面優化指令：{instruction}"
    raw, used_model, errors = call_gemini_with_fallback(prompt, system_instruction)
    elapsed_ms = int((time.time() - started) * 1000)
    if not used_model:
        return jsonify({"error": "AI 介面優化呼叫失敗：\n" + "\n".join(errors)}), 503

    cleaned = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
    m = re.search(r"\{[\s\S]*\}", cleaned)
    if m:
        cleaned = m.group(0)
    try:
        patch = json.loads(cleaned)
    except Exception as exc:
        return jsonify({"error": f"AI 回傳的介面結構解析失敗：{exc}\n原始內容：{cleaned[:200]}"}), 500

    patch = {**current_ui, **patch}
    patch["model"] = used_model
    patch["elapsedMs"] = elapsed_ms
    try:
        CUSTOM_UI_PATH.write_text(json.dumps(patch, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass
    return jsonify({"ok": True, "patch": patch, "model": used_model, "elapsedMs": elapsed_ms})


@app.post("/api/gemini")
def gemini_legacy():
    return agent()


@app.get("/api/custom-agents")
def get_custom_agents():
    if CUSTOM_AGENTS_PATH.exists():
        try:
            return jsonify(json.loads(CUSTOM_AGENTS_PATH.read_text(encoding="utf-8")))
        except Exception:
            pass
    return jsonify([])


@app.post("/api/custom-agents")
def save_custom_agent():
    data = request.get_json(silent=True) or {}
    existing = []
    if CUSTOM_AGENTS_PATH.exists():
        try:
            existing = json.loads(CUSTOM_AGENTS_PATH.read_text(encoding="utf-8"))
        except Exception:
            existing = []
    if data.get("deleteId"):
        del_id = data["deleteId"]
        existing = [a for a in existing if a.get("id") != del_id]
        remove_colleague_skill_files(del_id)
        SKILL_INDEX.pop(del_id, None)
    elif data.get("agent"):
        new_agent = data["agent"]
        existing = [a for a in existing if a.get("id") != new_agent.get("id")]
        existing.append(new_agent)
        # Automatically create/update a standalone Antigravity Skill (SKILL.md) for this colleague
        skill_info = write_colleague_skill_files(dict(new_agent))
        SKILL_INDEX[new_agent["id"]] = skill_info
        CUSTOM_AGENTS_PATH.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
        return jsonify({"ok": True, "agents": existing, "skill": skill_info})

    CUSTOM_AGENTS_PATH.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
    return jsonify({"ok": True, "agents": existing})


@app.get("/api/avatars")
def get_avatars():
    if AVATARS_PATH.exists():
        try:
            return jsonify(json.loads(AVATARS_PATH.read_text(encoding="utf-8")))
        except Exception:
            pass
    return jsonify({})


@app.post("/api/avatars")
def save_avatar():
    data = request.get_json(silent=True) or {}
    agent_id = data.get("agentId")
    avatar = data.get("avatar")
    existing = {}
    if AVATARS_PATH.exists():
        try:
            existing = json.loads(AVATARS_PATH.read_text(encoding="utf-8"))
        except Exception:
            existing = {}
    if data.get("resetId"):
        existing.pop(data["resetId"], None)
    elif agent_id and avatar:
        existing[agent_id] = avatar
    AVATARS_PATH.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
    return jsonify({"ok": True, "avatars": existing})


@app.post("/api/upload-avatar")
def upload_avatar():
    """Uploads an image or animated GIF avatar and saves it as a static asset."""
    import base64
    agent_id = request.form.get("agentId") or "agent"
    file_obj = request.files.get("file")
    data_url = request.form.get("dataUrl")
    filename = request.form.get("filename") or ""

    ext = ".gif"
    content_bytes = b""

    if file_obj:
        orig_name = file_obj.filename or "avatar.gif"
        ext = Path(orig_name).suffix.lower() or ".gif"
        content_bytes = file_obj.read()
    elif data_url and data_url.startswith("data:"):
        match = re.match(r"^data:image\/([a-zA-Z0-9+]+);base64,(.+)$", data_url)
        if match:
            raw_ext = match.group(1).lower()
            ext = ".gif" if "gif" in raw_ext else f".{raw_ext}"
            content_bytes = base64.b64decode(match.group(2))
    elif not content_bytes:
        data = request.get_json(silent=True) or {}
        agent_id = data.get("agentId") or agent_id
        data_url = data.get("dataUrl") or ""
        if data_url.startswith("data:"):
            match = re.match(r"^data:image\/([a-zA-Z0-9+]+);base64,(.+)$", data_url)
            if match:
                raw_ext = match.group(1).lower()
                ext = ".gif" if "gif" in raw_ext else f".{raw_ext}"
                content_bytes = base64.b64decode(match.group(2))

    if not content_bytes:
        return jsonify({"error": "No file or dataUrl provided"}), 400

    clean_id = re.sub(r"[^a-zA-Z0-9_-]", "", agent_id) or "avatar"
    timestamp = int(time.time())
    final_filename = f"{clean_id}_{timestamp}{ext}"

    target_dirs = [
        BASE_DIR / "public" / "avatars",
        BASE_DIR / "docs" / "avatars",
        DIST_DIR / "avatars",
    ]
    for d in target_dirs:
        d.mkdir(parents=True, exist_ok=True)
        (d / final_filename).write_bytes(content_bytes)

    relative_url = f"./avatars/{final_filename}"
    return jsonify({
        "ok": True,
        "url": relative_url,
        "filename": final_filename,
        "isGif": ext == ".gif",
        "sizeBytes": len(content_bytes),
    })


@app.get("/api/hr-roster")
def get_hr_roster():
    md_text = read_latest_hr_roster_markdown()
    profiles = sync_from_hr_roster_markdown()
    return jsonify({"ok": True, "markdown": md_text, "profiles": profiles})


@app.post("/api/hr-roster")
def save_hr_roster():
    global SKILL_INDEX
    data = request.get_json(silent=True) or {}
    md_text = (data.get("markdown") or "").strip()
    if not md_text:
        return jsonify({"error": "markdown is required"}), 400
    profiles = sync_from_hr_roster_markdown(override_md=md_text)
    SKILL_INDEX = load_all_skills_index()
    return jsonify({"ok": True, "profiles": profiles, "skills": SKILL_INDEX})


@app.get("/api/agents/profile")
def get_agent_profiles():
    profiles = sync_from_hr_roster_markdown()
    if profiles:
        return jsonify(profiles)
    if PROFILES_PATH.exists():
        try:
            return jsonify(json.loads(PROFILES_PATH.read_text(encoding="utf-8")))
        except Exception:
            pass
    return jsonify({})


@app.post("/api/agents/profile")
def save_agent_profile():
    data = request.get_json(silent=True) or {}
    agent_id = data.get("agentId")
    patch = data.get("patch") or {}
    full_agent = data.get("agent") or {}
    if not agent_id:
        return jsonify({"error": "agentId is required"}), 400

    profiles = {}
    if PROFILES_PATH.exists():
        try:
            profiles = json.loads(PROFILES_PATH.read_text(encoding="utf-8"))
        except Exception:
            profiles = {}
    profiles[agent_id] = {**(profiles.get(agent_id) or {}), **patch}
    PROFILES_PATH.write_text(json.dumps(profiles, ensure_ascii=False, indent=2), encoding="utf-8")

    # Sync public/data/agent_profiles.json as well
    pub_data = BASE_DIR / "public" / "data"
    if pub_data.exists():
        try:
            (pub_data / "agent_profiles.json").write_text(json.dumps(profiles, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            pass

    # If custom agent, also update custom_agents.json
    if str(agent_id).startswith("custom-") and CUSTOM_AGENTS_PATH.exists():
        try:
            custom_list = json.loads(CUSTOM_AGENTS_PATH.read_text(encoding="utf-8"))
            custom_list = [
                {**a, **patch} if a.get("id") == agent_id else a
                for a in custom_list
            ]
            CUSTOM_AGENTS_PATH.write_text(json.dumps(custom_list, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            pass

    # Update SKILL.md for this colleague
    builtin_match = next((b for b in BUILTIN_COLLEAGUES if b["id"] == agent_id), {})
    colleague_dict = {
        **builtin_match,
        **full_agent,
        **patch,
        "id": agent_id,
    }
    skill_info = write_colleague_skill_files(colleague_dict)
    SKILL_INDEX[agent_id] = skill_info
    return jsonify({"ok": True, "profiles": profiles, "skill": skill_info})


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_spa(path: str):
    if path.startswith("api/"):
        return jsonify({"error": "Not found"}), 404
    # Check public folder (e.g. avatars, mimi-reference.png)
    pub_file = (BASE_DIR / "public") / path
    if path and pub_file.exists() and pub_file.is_file():
        return send_from_directory(BASE_DIR / "public", path)
    if DIST_DIR.exists():
        candidate = DIST_DIR / path
        if path and candidate.exists() and candidate.is_file():
            return send_from_directory(DIST_DIR, path)
        index_file = DIST_DIR / "index.html"
        if index_file.exists():
            return send_from_directory(DIST_DIR, "index.html")
    return jsonify({
        "ok": True,
        "message": "AI Office API Server running. Run 'npm run build' to bundle frontend into dist/.",
    })


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    host = os.getenv("HOST", "0.0.0.0")
    app.run(host=host, port=port, debug=False)
