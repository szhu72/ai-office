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
        "avatar": "🧑🏻‍💼",
        "specialty": "產品路線圖規劃、MVP 範圍定義、跨角色任務拆解與優先級排序",
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
        "avatar": "🧑🏻‍🔬",
        "specialty": "UX 使用者研究、競品分析、網站內部介面參數改造與視覺體驗優化",
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
        "name": "阿碼",
        "role": "程式工程師",
        "avatar": "👩🏻‍💻",
        "specialty": "React/TypeScript 前端架構、Flask API 串接、CSS 外框與排版除錯、自動化測試",
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
        "avatar": "👨🏻‍💼",
        "specialty": "量化指標分析、問卷與事件流統計、轉換率與異常診斷、圖表洞察解讀",
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
        "avatar": "🧑🏻‍⚖️",
        "specialty": "品質把關、邊界條件審查、風險與合規檢查、交付物驗收清單",
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
        "name": "麻糬",
        "role": "吉祥物",
        "avatar": "🐩",
        "specialty": "團隊士氣激勵、品牌語氣靈感、創意破冰點子與療癒支援",
        "triggers": ["/麻糬", "吉祥物", "靈感", "打氣"],
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
    avatar = colleague.get("avatar", "🧑🏻‍💻")
    specialty = colleague.get("specialty") or f"以「{role}」專業視角執行任務、分析問題並提供高品質交付成果"
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

## 角色定位與核心專長
- **姓名**：{name}
- **職稱 / 角色**：{role}
- **核心專長**：{specialty}
- **喚醒指令 / 觸發詞**：{trigger_str}

## 標準作業程序 (SOP)
{sop_lines}

## 回覆與產出準則
- 始終以第一人稱（我是{name}）與繁體中文回應總監。
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


def load_all_skills_index() -> dict[str, dict]:
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


@app.get("/api/agents/profile")
def get_agent_profiles():
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
