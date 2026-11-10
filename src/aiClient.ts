import type { Agent, MeetingSummary } from "./types";

export interface AgentReply {
  ok: boolean;
  text: string;
  thought: string;
  model: string;
  elapsedMs: number;
  needsApiKey?: boolean;
}

const LS_API_KEY = "ai_office_gemini_api_key";
const LS_UI_PATCH = "ai_office_ui_patch_v1";
const LS_CUSTOM_AGENTS = "ai_office_custom_agents_v1";
const LS_AVATARS = "ai_office_avatars_v1";
const LS_SKILLS = "ai_office_skills_v1";
const LS_PROFILES = "ai_office_agent_profiles_v1";

const BROWSER_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-2.0-flash",
];

export function getBrowserApiKey(): string {
  try {
    return (localStorage.getItem(LS_API_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function setBrowserApiKey(key: string): void {
  try {
    const clean = key.trim();
    if (clean) {
      localStorage.setItem(LS_API_KEY, clean);
    } else {
      localStorage.removeItem(LS_API_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

interface BuiltinColleagueMeta {
  id: string;
  skillName: string;
  name: string;
  role: string;
  department: string;
  positioning: string;
  avatar: string;
  specialty: string;
  personality: string;
  triggers: string[];
  sop: string[];
}

const BUILTIN_COLLEAGUES_META: BuiltinColleagueMeta[] = [
  {
    id: "planner",
    skillName: "office-planner-xiaoju",
    name: "小橘",
    role: "策劃",
    department: "產品策劃與專案管理部",
    positioning: "首席產品策劃 ／ 敏捷衝刺與路線圖統籌",
    avatar: "🧑🏻‍💼",
    specialty: "產品路線圖規劃、MVP 範圍定義、跨角色任務拆解、P0/P1/P2 優先級排序與跨部門交接",
    personality: "前新創團隊王牌 PM，隨身帶著貼滿彩色索引貼的橘色筆記本。個性熱情果斷、思考結構極度清晰，口頭禪是「先對齊目標！」，擅長在混亂需求中抓出 20% 核心價值，是總監最信賴的開局先鋒。",
    triggers: ["/小橘", "策劃", "MVP", "排程", "拆解任務"],
    sop: [
      "釐清總監目標與核心使用情境，將大目標拆成可驗證的 3 個子步驟。",
      "評估各步驟對其他同事（阿研、阿碼、數據、小處）的依賴關係與優先級（P0/P1/P2）。",
      "輸出清晰的執行清單與下一步交接建議。",
    ],
  },
  {
    id: "researcher",
    skillName: "office-researcher-ayan",
    name: "阿研",
    role: "研究",
    department: "使用者體驗與前沿設計研究室",
    positioning: "首席 UX 研究員 ／ 遊戲化介面與互動設計師",
    avatar: "🧑🏻‍🔬",
    specialty: "UX 使用者訪談研究、競品交互拆解、RPG 遊戲化視覺設計、網站內部介面參數與 CSS 變數即時改造",
    personality: "出身數位互動媒體實驗室的跨域研究員，對復古手繪紙感與像素風 RPG 介面有著極高審美堅持。觀察力敏銳，總能一眼看出使用者視線卡關處，並親手把介面調校到賞心悅目。",
    triggers: ["/阿研", "研究", "改介面", "UX", "洞察"],
    sop: [
      "從使用者體驗與 RPG 遊戲化互動角度分析目前畫面與操作痛點。",
      "針對介面固定欄位（標題、強調色、底色、字級、側欄寬度、圓角）提出具體設定與 CSS 調整。",
      "驗證視覺層次與閱讀清晰度，向總監回報改版摘要。",
    ],
  },
  {
    id: "engineer",
    skillName: "office-engineer-ama",
    name: "阿碼",
    role: "程式工程師",
    department: "全端系統工程與架構部",
    positioning: "資深全端工程師 ／ 系統穩定度與互動實作擔當",
    avatar: "👩🏻‍💻",
    specialty: "React/TypeScript 前端架構、Flask API 與純前端無伺服器雙模式串接、CSS 外框與 9:16 手機排版除錯、GitHub Pages 自動化部署",
    personality: "理性冷靜的鍵盤快手，工作桌永遠架著雙螢幕與一杯特濃黑咖啡。對型別安全與 DOM 容器邊界有著極高潔癖，看到破版或 bug 就會立刻進入高專注除錯模式，口頭禪是「給我五分鐘修好它」。",
    triggers: ["/阿碼", "工程師", "修 bug", "程式碼", "排版"],
    sop: [
      "精準定位 DOM/CSS 或 API 錯誤根因（例如容器爆框、型別錯誤、狀態同步問題）。",
      "以最小侵入且符合型別安全的方式修改元件與樣式，確保 tsc 編譯零錯誤。",
      "提供修改前後對照與驗證結果。",
    ],
  },
  {
    id: "analyst",
    skillName: "office-analyst-shuju",
    name: "數據",
    role: "資料分析師",
    department: "商業智慧與量化科學部",
    positioning: "首席資料分析師 ／ 量化指標與異常診斷專家",
    avatar: "👨🏻‍💼",
    specialty: "量化指標建模、問卷樣本與事件流統計、轉換率漏斗分析、代理人卡關異常診斷、圖表洞察解讀",
    personality: "統計學與行為經濟學雙碩士，說話溫和有禮但邏輯極度嚴謹，不接受模糊臆測，只相信有效樣本數與信賴區間。常駐會議室白板前比對事件流，是替團隊決策把關的理性大腦。",
    triggers: ["/數據", "分析師", "統計", "指標", "數據"],
    sop: [
      "盤點手頭樣本數、事件紀錄與核心指標分布，找出異常值或關鍵瓶頸百分比。",
      "用結構化數據與比例佐證推論，避免空泛形容詞。",
      "給出可量化的決策建議與追蹤指標。",
    ],
  },
  {
    id: "virgo",
    skillName: "office-supervisor-xiaochu",
    name: "小處",
    role: "處女座監督",
    department: "品質保證與風險合規監督室",
    positioning: "處女座首席監督 ／ 交付驗收與風險合規守門員",
    avatar: "🧑🏻‍⚖️",
    specialty: "交付物品質驗收、邊界條件與極端情境審查、品牌素材授權與合規檢查、上線前 Checklist 風險攔截",
    personality: "典型處女座完美主義監督官，隨身帶著放大鏡與紅筆駐守在任務牆前。外冷內熱、責任感極強；雖然常因攔截缺漏附件讓同事緊張，但只要經過小處蓋章放行的專案絕對穩如泰山。",
    triggers: ["/小處", "監督", "審核", "檢查", "風險"],
    sop: [
      "逐項檢查任務步驟、附件完整度與潛在破綻（授權、極端輸入、RWD 破版）。",
      "明確標出「通過項目」與「必須修正才能放行的卡關點」。",
      "提供具體可執行的補強方案，協助總監做出核准決策。",
    ],
  },
  {
    id: "momo",
    skillName: "office-mascot-mochi",
    name: "麻糬",
    role: "吉祥物",
    department: "企業文化與心靈療癒部",
    positioning: "首席辦公室吉祥物 ／ 團隊士氣與靈感破冰大使",
    avatar: "🐩",
    specialty: "團隊士氣激勵、品牌溫暖語氣調校、創意破冰點子發想、高壓衝刺期的情緒價值與療癒支援",
    personality: "一隻蓬鬆潔白、聰明機靈的貴賓犬吉祥物，最喜歡窩在休息區沙發旁待命。當辦公室氣氛緊繃或大家燒腦過度時，總會搖著尾巴叼來讓人眼睛一亮的趣味彩蛋點子，瞬間補滿全員能量。",
    triggers: ["/麻糬", "吉祥物", "靈感", "打氣"],
    sop: [
      "用活潑溫暖的語氣為總監與團隊注入活力，緩解高壓開發節奏。",
      "從直覺與玩家樂趣角度提供意想不到的趣味彩蛋或文案靈感。",
    ],
  },
];

function slugifySkillName(agentId: string): string {
  const found = BUILTIN_COLLEAGUES_META.find((b) => b.id === agentId);
  if (found) return found.skillName;
  const clean = agentId.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return `office-colleague-${clean || "custom"}`;
}

export function renderColleagueSkillMarkdown(colleague: {
  id: string;
  name: string;
  role: string;
  department?: string;
  positioning?: string;
  avatar?: string;
  specialty?: string;
  personality?: string;
  triggers?: string[];
  sop?: string[];
  customSkillMarkdown?: string;
}): string {
  if (colleague.customSkillMarkdown && colleague.customSkillMarkdown.trim().startsWith("---")) {
    return colleague.customSkillMarkdown.trim();
  }
  const builtin = BUILTIN_COLLEAGUES_META.find((b) => b.id === colleague.id);
  const skillName = slugifySkillName(colleague.id);
  const name = colleague.name || builtin?.name || "同事";
  const role = colleague.role || builtin?.role || "專案顧問";
  const department = colleague.department || builtin?.department || `${role}專業部門`;
  const positioning = colleague.positioning || builtin?.positioning || `${role} ／ 專案核心協力夥伴`;
  const rawAvatar = colleague.avatar || builtin?.avatar || "🧑🏻‍💻";
  const safeAvatar = rawAvatar.startsWith("data:") || rawAvatar.startsWith("http") ? "🧑🏻‍💻" : rawAvatar;
  const specialty =
    colleague.specialty ||
    builtin?.specialty ||
    `以「${role}」專業視角執行任務、分析問題並提供高品質交付成果`;
  const personality =
    colleague.personality ||
    builtin?.personality ||
    `認真負責、充滿熱忱的辦公室夥伴，總是以「${name}」的專業觀點協助總監解決難題。`;
  const triggers = colleague.triggers || builtin?.triggers || [`/${name}`, name, role];
  const sop = colleague.sop ||
    builtin?.sop || [
      `以「${name}（${role}）」的專業職責拆解總監交辦的任務與背景資料。`,
      "運用該領域的最佳實踐產出結構化、可立即執行的方案或程式碼修改。",
      "在結尾明確列出驗證方式與下一步合作建議。",
    ];
  const sopLines = sop.map((s, idx) => `${idx + 1}. ${s}`).join("\n");
  const triggerStr = triggers.map((t) => `\`${t}\``).join("、");

  return `---
name: ${skillName}
description: >-
  AI 辦公室同事「${name}（${role}）」專屬技能包。專長：${specialty}。
  當使用者點名 ${triggerStr} 或交辦與「${role}」相關的工作時，必須載入並遵循此技能規範。
---

# ${safeAvatar} ${name} — ${role}（AI Office 同事技能規範）

## 角色個人資訊與核心定位
- **姓名**：${name}
- **職能部門**：${department}
- **職稱 / 角色**：${role}
- **專業定位**：${positioning}
- **核心專長**：${specialty}
- **個性與背景**：${personality}
- **喚醒指令 / 觸發詞**：${triggerStr}

## 標準作業程序 (SOP)
${sopLines}

## 回覆與產出準則
- 始終以第一人稱（我是${name}）與繁體中文回應總監，展現符合上述「個性與背景」的說話風格。
- 先在【內心思考】說明你的專業判斷切入點，再於【正式產出】提供精煉、條列分明的成果與下一步建議。
`;
}

function buildBrowserSystemPrompt(agent: { id: string; name: string; role: string }): string {
  const skills = getLocalSkillsIndex();
  const skillContent = skills[agent.id]?.content || renderColleagueSkillMarkdown(agent);
  return (
    `你是「無所事事辦公室」AI 團隊中的成員「${agent.name}」，職責是「${agent.role}」。` +
    "請用繁體中文、以第一人稱回覆，語氣有個性、像遊戲裡的可靠夥伴。\n" +
    "請用以下格式回覆（方便系統拆出你的內心思考與正式產出）：\n" +
    "【內心思考】（用 1~2 句話簡述你正在分析什麼關鍵點、打算用什麼方法處理）\n" +
    "【正式產出】（你的具體執行成果或回覆，300 字以內，必要時條列重點，最後一行給出下一步建議）\n\n" +
    `以下是你專屬的 SKILL.md 技能規範，請嚴格遵循：\n${skillContent}`
  );
}

function splitThoughtAndOutputBrowser(raw: string): { thought: string; output: string } {
  const text = (raw || "").trim();
  const match = text.match(/【內心思考】([\s\S]*?)【正式產出】([\s\S]*)/);
  if (match) {
    const thought = match[1].trim() || "已梳理任務脈絡並完成推論。";
    const output = match[2].trim() || text;
    return { thought, output };
  }
  const firstLine = text.split("\n").map((l) => l.trim()).find(Boolean) || "正在整合團隊上下文並產出結論…";
  return { thought: firstLine.slice(0, 90), output: text };
}

async function callGeminiDirectBrowser(
  contents: string,
  systemInstruction: string,
): Promise<{ ok: boolean; text: string; model: string; error?: string; needsApiKey?: boolean }> {
  const apiKey = getBrowserApiKey();
  if (!apiKey) {
    return {
      ok: false,
      text: "",
      model: "no-key",
      needsApiKey: true,
      error: "目前運行於 GitHub Pages 純前端模式，請先點擊上方「🔑 金鑰設定」輸入你的 GEMINI_API_KEY（僅儲存在你手機/瀏覽器本機）。",
    };
  }

  const errors: string[] = [];
  for (const model of BROWSER_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemInstruction }],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: contents }],
            },
          ],
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = data?.error?.message || `HTTP ${resp.status}`;
        errors.push(`${model}: ${msg}`);
        if (resp.status === 400 && msg.toLowerCase().includes("api key")) {
          return { ok: false, text: "", model: "invalid-key", needsApiKey: true, error: `API 金鑰無效：${msg}` };
        }
        continue;
      }
      const parts = data?.candidates?.[0]?.content?.parts;
      const text = Array.isArray(parts) ? parts.map((p: { text?: string }) => p.text || "").join("") : "";
      if (text) {
        return { ok: true, text, model };
      }
      errors.push(`${model}: empty response`);
    } catch (err) {
      errors.push(`${model}: ${String(err)}`);
    }
  }
  return {
    ok: false,
    text: "",
    model: "error",
    error: `所有 Gemini 模型暫時無法回應：\n${errors.join("\n")}`,
  };
}

/** Ask the real AI (via Flask backend if available, or directly via Browser Gemini API on GitHub Pages). */
export async function askAgent(agent: Agent, prompt: string, context = ""): Promise<AgentReply> {
  const started = Date.now();
  try {
    const resp = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: agent.id, agentName: agent.name, role: agent.role, prompt, context }),
    });
    const contentType = resp.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await resp.json().catch(() => ({}));
      const elapsedMs = data.elapsedMs ?? (Date.now() - started);
      if (resp.ok && data.response) {
        return {
          ok: true,
          text: data.response ?? "",
          thought: data.thought ?? "已完成推論並產出結果。",
          model: data.model ?? "gemini",
          elapsedMs,
        };
      }
      if (resp.status !== 404 && resp.status !== 405 && data.error) {
        return {
          ok: false,
          text: data.error,
          thought: "連線或模型呼叫發生例外，等待重試。",
          model: "error",
          elapsedMs,
        };
      }
    }
  } catch {
    // Fallback to browser direct mode below
  }

  const fullPrompt = context.trim() ? `背景資料：\n${context.trim()}\n\n任務：\n${prompt}` : prompt;
  const direct = await callGeminiDirectBrowser(fullPrompt, buildBrowserSystemPrompt(agent));
  const elapsedMs = Date.now() - started;
  if (!direct.ok) {
    return {
      ok: false,
      text: direct.error || "呼叫失敗",
      thought: direct.needsApiKey ? "等待總監在「🔑 金鑰設定」填入 Gemini API Key…" : "瀏覽器直連模型失敗。",
      model: direct.model,
      elapsedMs,
      needsApiKey: direct.needsApiKey,
    };
  }
  const { thought, output } = splitThoughtAndOutputBrowser(direct.text);
  return {
    ok: true,
    text: output,
    thought,
    model: `${direct.model} (Web直連)`,
    elapsedMs,
  };
}

export async function askMeetingBrainstorm(
  topic: string,
): Promise<{ ok: boolean; meeting?: MeetingSummary; model?: string; elapsedMs?: number; error?: string; needsApiKey?: boolean }> {
  const started = Date.now();
  try {
    const resp = await fetch("/api/meeting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic }),
    });
    const contentType = resp.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.meeting) {
        return { ok: true, meeting: data.meeting, model: data.model, elapsedMs: data.elapsedMs };
      }
    }
  } catch {
    // Fallback to browser direct mode
  }

  const sys =
    "你是「無所事事辦公室」的會議紀錄 AI。團隊成員有：小橘(策劃)、阿研(研究)、阿碼(程式工程師)、數據(資料分析師)、小處(處女座監督)、麻糬(吉祥物)。" +
    "請針對使用者給的會議主題，輸出純 JSON（不要加 markdown code fence），格式為：" +
    '{"summary":"一句話總結","disagreements":["分歧1","分歧2"],"decisions":["決策1","決策2"],"humanConfirmations":["需總監確認事項1"]}';
  const direct = await callGeminiDirectBrowser(`會議主題：${topic}`, sys);
  const elapsedMs = Date.now() - started;
  if (!direct.ok) {
    return { ok: false, error: direct.error, needsApiKey: direct.needsApiKey };
  }
  const cleaned = direct.text.replace(/^```(?:json)?|```$/gm, "").trim();
  let parsed: MeetingSummary;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = {
      summary: cleaned.slice(0, 160) || `已完成「${topic}」快速同步。`,
      disagreements: ["小橘希望加快上線節奏；小處要求先補齊驗收清單。"],
      decisions: [`優先聚焦：${topic}`, "由阿碼與數據同步驗證指標。"],
      humanConfirmations: ["請總監確認最終優先順序與資源配置。"],
    };
  }
  return { ok: true, meeting: parsed, model: `${direct.model} (Web直連)`, elapsedMs };
}

export interface UiEvolutionPatch {
  thought?: string;
  summary?: string;
  brandTitle?: string | null;
  headline?: string | null;
  primaryColor?: string;
  paperColor?: string;
  borderColor?: string;
  cardRadius?: number;
  cssVars?: Record<string, string>;
  fontScale?: number;
  sidePanelWidth?: number;
  note?: string;
  customCss?: string;
  model?: string;
  elapsedMs?: number;
}

export async function fetchSavedUiPatch(): Promise<UiEvolutionPatch | null> {
  try {
    const localRaw = localStorage.getItem(LS_UI_PATCH);
    if (localRaw) {
      const parsed = JSON.parse(localRaw);
      if (parsed && Object.keys(parsed).length) return parsed;
    }
  } catch {
    // ignore
  }
  try {
    const resp = await fetch("/api/ui-evolve");
    const ct = resp.headers.get("content-type") || "";
    if (resp.ok && ct.includes("application/json")) {
      const data = await resp.json();
      if (data && Object.keys(data).length) {
        try {
          localStorage.setItem(LS_UI_PATCH, JSON.stringify(data));
        } catch {
          // ignore
        }
        return data;
      }
    }
  } catch {
    // fallback to static ./data/custom_ui_state.json
  }
  try {
    const staticResp = await fetch("./data/custom_ui_state.json");
    if (staticResp.ok) {
      const data = await staticResp.json();
      return data && Object.keys(data).length ? data : null;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function askUiEvolve(
  instruction: string,
  currentUi: UiEvolutionPatch | null,
): Promise<{ ok: boolean; patch?: UiEvolutionPatch; error?: string; needsApiKey?: boolean }> {
  const started = Date.now();
  try {
    const resp = await fetch("/api/ui-evolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction, currentUi }),
    });
    const ct = resp.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.patch) {
        try {
          localStorage.setItem(LS_UI_PATCH, JSON.stringify(data.patch));
        } catch {
          // ignore
        }
        return { ok: true, patch: data.patch };
      }
    }
  } catch {
    // Fallback to browser direct mode
  }

  const sys = `你是「無所事事辦公室」的使用者體驗與介面研究員「阿研」。使用者會直接在網站裡用自然語言要求你研究並修改、優化這個網站的內部介面。
請根據使用者的介面修改要求，輸出純 JSON（絕對不要加 \`\`\`json 標籤），格式如下：
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
}`;
  const prompt = `目前 UI 設定：${JSON.stringify(currentUi || {})}\n\n總監的介面優化指令：${instruction}`;
  const direct = await callGeminiDirectBrowser(prompt, sys);
  const elapsedMs = Date.now() - started;
  if (!direct.ok) {
    return { ok: false, error: direct.error, needsApiKey: direct.needsApiKey };
  }
  const cleaned = direct.text.replace(/^```(?:json)?|```$/gm, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  try {
    const parsed = JSON.parse(match ? match[0] : cleaned);
    const merged: UiEvolutionPatch = {
      ...(currentUi || {}),
      ...parsed,
      model: `${direct.model} (Web直連)`,
      elapsedMs,
    };
    try {
      localStorage.setItem(LS_UI_PATCH, JSON.stringify(merged));
    } catch {
      // ignore
    }
    return { ok: true, patch: merged };
  } catch (err) {
    return { ok: false, error: `AI 回傳的介面結構解析失敗：${String(err)}` };
  }
}

export async function resetUiEvolve(): Promise<void> {
  try {
    localStorage.removeItem(LS_UI_PATCH);
  } catch {
    // ignore
  }
  try {
    await fetch("/api/ui-evolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reset: true }),
    });
  } catch {
    // ignore
  }
}

function enrichCustomAgentDefaults(agent: Agent): Agent {
  if (agent.id === "custom-1794277128232" || agent.name === "東東") {
    return {
      department: "企業文化與快樂應援部",
      positioning: "吉祥物 2 號（米米的好朋友） ／ 跨區巡邏與快樂應援小隊長",
      specialty: "跨房間巡邏打氣、陪伴米米與麻糬炒熱辦公室氣氛、提供天馬行空的玩家視角回饋與趣味互動靈感",
      personality: "米米最要好的摯友，活力滿滿、好奇心旺盛的辦公室第二號吉祥物。喜歡在討論板與工作區之間串門子，用最純粹熱情的快樂能量感染每一位同事，是團隊裡不可或缺的開心果。",
      ...agent,
    };
  }
  return {
    department: agent.department || `${agent.role}專業部門`,
    positioning: agent.positioning || `${agent.role} ／ 專案核心協力夥伴`,
    specialty: agent.specialty || `以「${agent.role}」專業視角執行任務、分析問題並提供高品質交付成果`,
    personality: agent.personality || `充滿熱忱、自主性極高的「${agent.name}」，總能從「${agent.role}」專業切入點提供可靠支援。`,
    ...agent,
  };
}

export async function fetchCustomAgents(): Promise<Agent[]> {
  try {
    const localRaw = localStorage.getItem(LS_CUSTOM_AGENTS);
    if (localRaw) {
      const parsed = JSON.parse(localRaw);
      if (Array.isArray(parsed)) return parsed.map(enrichCustomAgentDefaults);
    }
  } catch {
    // ignore
  }
  try {
    const resp = await fetch("/api/custom-agents");
    const ct = resp.headers.get("content-type") || "";
    if (resp.ok && ct.includes("application/json")) {
      const data = await resp.json();
      if (Array.isArray(data)) {
        const enriched = data.map(enrichCustomAgentDefaults);
        try {
          localStorage.setItem(LS_CUSTOM_AGENTS, JSON.stringify(enriched));
        } catch {
          // ignore
        }
        return enriched;
      }
    }
  } catch {
    // fallback to static ./data/custom_agents.json
  }
  try {
    const staticResp = await fetch("./data/custom_agents.json");
    if (staticResp.ok) {
      const data = await staticResp.json();
      if (Array.isArray(data)) {
        const enriched = data.map(enrichCustomAgentDefaults);
        try {
          localStorage.setItem(LS_CUSTOM_AGENTS, JSON.stringify(enriched));
        } catch {
          // ignore
        }
        return enriched;
      }
    }
  } catch {
    // ignore
  }
  return [];
}

export async function saveCustomAgentApi(agent: Agent): Promise<void> {
  try {
    const existing = await fetchCustomAgents();
    const next = [...existing.filter((a) => a.id !== agent.id), agent];
    localStorage.setItem(LS_CUSTOM_AGENTS, JSON.stringify(next));
    // Also auto-generate SKILL.md in localStorage
    const skills = getLocalSkillsIndex();
    const skillName = slugifySkillName(agent.id);
    skills[agent.id] = {
      agentId: agent.id,
      name: agent.name,
      role: agent.role,
      skillName,
      paths: [`.agents/skills/${skillName}/SKILL.md`],
      content: renderColleagueSkillMarkdown(agent),
    };
    localStorage.setItem(LS_SKILLS, JSON.stringify(skills));
  } catch {
    // ignore
  }
  try {
    await fetch("/api/custom-agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent }),
    });
  } catch {
    // ignore
  }
}

export async function deleteCustomAgentApi(deleteId: string): Promise<void> {
  try {
    const existing = await fetchCustomAgents();
    const next = existing.filter((a) => a.id !== deleteId);
    localStorage.setItem(LS_CUSTOM_AGENTS, JSON.stringify(next));
    const skills = getLocalSkillsIndex();
    delete skills[deleteId];
    localStorage.setItem(LS_SKILLS, JSON.stringify(skills));
  } catch {
    // ignore
  }
  try {
    await fetch("/api/custom-agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deleteId }),
    });
  } catch {
    // ignore
  }
}

export async function fetchAvatarOverrides(): Promise<Record<string, string>> {
  let baseAvatars: Record<string, string> = {};
  try {
    const resp = await fetch("/api/avatars");
    const ct = resp.headers.get("content-type") || "";
    if (resp.ok && ct.includes("application/json")) {
      const data = await resp.json();
      if (data && typeof data === "object") baseAvatars = data;
    }
  } catch {
    // ignore
  }
  if (!Object.keys(baseAvatars).length) {
    try {
      const staticResp = await fetch("./data/avatar_overrides.json");
      if (staticResp.ok) {
        const data = await staticResp.json();
        if (data && typeof data === "object") baseAvatars = data;
      }
    } catch {
      // ignore
    }
  }
  try {
    const localRaw = localStorage.getItem(LS_AVATARS);
    if (localRaw) {
      const localObj = JSON.parse(localRaw);
      if (localObj && typeof localObj === "object") {
        return { ...baseAvatars, ...localObj };
      }
    }
  } catch {
    // ignore
  }
  return baseAvatars;
}

export async function saveAvatarOverrideApi(agentId: string, avatar: string): Promise<void> {
  try {
    const localRaw = localStorage.getItem(LS_AVATARS);
    const existing = localRaw ? JSON.parse(localRaw) : {};
    existing[agentId] = avatar;
    localStorage.setItem(LS_AVATARS, JSON.stringify(existing));
  } catch {
    // ignore
  }
  try {
    await fetch("/api/avatars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, avatar }),
    });
  } catch {
    // ignore
  }
}

export interface ColleagueSkillInfo {
  agentId: string;
  name: string;
  role: string;
  skillName: string;
  paths: string[];
  content: string;
}

function getLocalSkillsIndex(customAgents: Agent[] = []): Record<string, ColleagueSkillInfo> {
  const index: Record<string, ColleagueSkillInfo> = {};
  for (const b of BUILTIN_COLLEAGUES_META) {
    index[b.id] = {
      agentId: b.id,
      name: b.name,
      role: b.role,
      skillName: b.skillName,
      paths: [
        `d:/AI/.agents/skills/${b.skillName}/SKILL.md`,
        `ai-office-prototype/.agents/skills/${b.skillName}/SKILL.md`,
      ],
      content: renderColleagueSkillMarkdown(b),
    };
  }
  for (const c of customAgents) {
    const skillName = slugifySkillName(c.id);
    index[c.id] = {
      agentId: c.id,
      name: c.name,
      role: c.role,
      skillName,
      paths: [
        `d:/AI/.agents/skills/${skillName}/SKILL.md`,
        `ai-office-prototype/.agents/skills/${skillName}/SKILL.md`,
      ],
      content: renderColleagueSkillMarkdown(c),
    };
  }
  try {
    const savedRaw = localStorage.getItem(LS_SKILLS);
    if (savedRaw) {
      const saved = JSON.parse(savedRaw);
      if (saved && typeof saved === "object") {
        Object.assign(index, saved);
      }
    }
  } catch {
    // ignore
  }
  return index;
}

export async function fetchColleagueSkills(): Promise<Record<string, ColleagueSkillInfo>> {
  try {
    const resp = await fetch("/api/skills");
    const ct = resp.headers.get("content-type") || "";
    if (resp.ok && ct.includes("application/json")) {
      const data = await resp.json();
      if (data?.skills) {
        try {
          localStorage.setItem(LS_SKILLS, JSON.stringify(data.skills));
        } catch {
          // ignore
        }
        return data.skills;
      }
    }
  } catch {
    // fallback to browser skills index
  }
  const customAgents = await fetchCustomAgents();
  return getLocalSkillsIndex(customAgents);
}

export async function saveColleagueSkillApi(
  agentId: string,
  name: string,
  role: string,
  content: string,
): Promise<ColleagueSkillInfo | null> {
  const skillName = slugifySkillName(agentId);
  const localInfo: ColleagueSkillInfo = {
    agentId,
    name,
    role,
    skillName,
    paths: [
      `d:/AI/.agents/skills/${skillName}/SKILL.md`,
      `ai-office-prototype/.agents/skills/${skillName}/SKILL.md`,
    ],
    content: renderColleagueSkillMarkdown({ id: agentId, name, role, customSkillMarkdown: content }),
  };
  try {
    const current = getLocalSkillsIndex();
    current[agentId] = localInfo;
    localStorage.setItem(LS_SKILLS, JSON.stringify(current));
  } catch {
    // ignore
  }
  try {
    const resp = await fetch("/api/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, name, role, content }),
    });
    const ct = resp.headers.get("content-type") || "";
    if (resp.ok && ct.includes("application/json")) {
      const data = await resp.json();
      return data.skill ?? localInfo;
    }
  } catch {
    // ignore
  }
  return localInfo;
}

export function extractProfileFromSkillMarkdown(md: string): Partial<Agent> {
  const patch: Partial<Agent> = {};
  const nameMatch = md.match(/-\s*\*\*姓名\*\*[：:]\s*([^\r\n]+)/);
  if (nameMatch?.[1]?.trim()) patch.name = nameMatch[1].trim();
  const deptMatch = md.match(/-\s*\*\*職能(?:部門)?\*\*[：:]\s*([^\r\n]+)/);
  if (deptMatch?.[1]?.trim()) patch.department = deptMatch[1].trim();
  const roleMatch = md.match(/-\s*\*\*職稱\s*\/?\s*角色\*\*[：:]\s*([^\r\n]+)/);
  if (roleMatch?.[1]?.trim()) patch.role = roleMatch[1].trim();
  const posMatch = md.match(/-\s*\*\*專業定位\*\*[：:]\s*([^\r\n]+)/);
  if (posMatch?.[1]?.trim()) patch.positioning = posMatch[1].trim();
  const specMatch = md.match(/-\s*\*\*核心專長\*\*[：:]\s*([^\r\n]+)/);
  if (specMatch?.[1]?.trim()) patch.specialty = specMatch[1].trim();
  const persMatch = md.match(/-\s*\*\*個性與背景\*\*[：:]\s*([^\r\n]+)/);
  if (persMatch?.[1]?.trim()) patch.personality = persMatch[1].trim();
  return patch;
}

export async function fetchAgentProfiles(): Promise<Record<string, Partial<Agent>>> {
  try {
    const raw = localStorage.getItem(LS_PROFILES);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch {
    // ignore
  }
  return {};
}

export async function saveAgentProfileApi(
  agent: Agent,
  patch: Partial<Agent>,
): Promise<ColleagueSkillInfo | null> {
  const mergedAgent: Agent = { ...agent, ...patch };
  try {
    const currentProfiles = await fetchAgentProfiles();
    currentProfiles[agent.id] = { ...(currentProfiles[agent.id] || {}), ...patch };
    localStorage.setItem(LS_PROFILES, JSON.stringify(currentProfiles));
    if (patch.avatar) {
      await saveAvatarOverrideApi(agent.id, patch.avatar);
    }
    if (agent.id.startsWith("custom-")) {
      await saveCustomAgentApi(mergedAgent);
    }
    await fetch("/api/agents/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: agent.id, patch, agent: mergedAgent }),
    }).catch(() => {});
  } catch {
    // ignore
  }
  const newSkillMd = renderColleagueSkillMarkdown({
    id: mergedAgent.id,
    name: mergedAgent.name,
    role: mergedAgent.role,
    department: mergedAgent.department,
    positioning: mergedAgent.positioning,
    avatar: mergedAgent.avatar,
    specialty: mergedAgent.specialty,
    personality: mergedAgent.personality,
  });
  return saveColleagueSkillApi(mergedAgent.id, mergedAgent.name, mergedAgent.role, newSkillMd);
}
