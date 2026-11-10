import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { officeDataSource } from "./officeDataSource";
import { askAgent, askMeetingBrainstorm, askUiEvolve, deleteCustomAgentApi, extractProfileFromSkillMarkdown, fetchAgentProfiles, fetchAvatarOverrides, fetchColleagueSkills, fetchCustomAgents, fetchHrRosterMarkdown, fetchSavedUiPatch, getBrowserApiKey, isGifAvatar, isImageAvatar, resetUiEvolve, saveAgentProfileApi, saveAvatarOverrideApi, saveColleagueSkillApi, saveCustomAgentApi, saveHrRosterMarkdownApi, setBrowserApiKey, uploadAvatarFileApi, type ColleagueSkillInfo, type UiEvolutionPatch } from "./aiClient";
import MascotAvatar from "./MascotAvatar";
import type {
  ActivityEvent,
  Agent,
  AgentStatus,
  OfficeState,
  OfficeTask,
  PanelSelection,
  Zone,
} from "./types";

const statusNames: Record<AgentStatus, string> = {
  idle: "待命",
  thinking: "思考中",
  researching: "研究中",
  writing: "撰寫中",
  coding: "開發中",
  reviewing: "審核中",
  blocked: "卡關",
  error: "錯誤",
};

const statusClasses: Record<AgentStatus, string> = {
  idle: "status-idle",
  thinking: "status-thinking",
  researching: "status-researching",
  writing: "status-writing",
  coding: "status-coding",
  reviewing: "status-reviewing",
  blocked: "status-blocked",
  error: "status-error",
};

export interface ThoughtRecord {
  id: string;
  agentId: string;
  agentName: string;
  avatar: string;
  role: string;
  prompt: string;
  stage: "拆解問題" | "檢索脈絡" | "呼叫 Gemini" | "完成推論" | "發生錯誤";
  thought: string;
  outputPreview: string;
  model: string;
  startedAt: number;
  elapsedMs?: number;
  running: boolean;
}

type GamePopup =
  | { kind: "toolbar-menu" }
  | { kind: "director" }
  | { kind: "summary-active" }
  | { kind: "summary-tasks" }
  | { kind: "summary-blocked" }
  | { kind: "zone"; zoneId: string }
  | { kind: "agent-status"; agentId: string }
  | { kind: "team-decisions" }
  | { kind: "task-detail"; taskId: string }
  | { kind: "hr-roster" }
  | { kind: "agent-chat"; agentId: string }
  | { kind: "agent-tools"; agentId: string }
  | { kind: "agent-output"; agentId: string }
  | { kind: "panel-menu" }
  | { kind: "attachment"; taskId: string; file?: string }
  | { kind: "meeting-brainstorm" }
  | { kind: "activity-log"; eventId?: string }
  | { kind: "thought-detail"; recordId: string }
  | { kind: "ui-studio" }
  | { kind: "agent-create" }
  | { kind: "agent-edit"; agentId: string }
  | { kind: "avatar-picker"; agentId: string }
  | { kind: "skill-viewer"; agentId?: string }
  | { kind: "api-key" };

const AVATAR_PRESETS = [
  "💼", "🔬", "👩🏻‍💻", "👨🏻‍💼", "‍⚖️", "🕵🏻‍♂️", "🧙🏻‍♀️", "🦸🏻‍♂️",
  "👩🏻‍🎨", "🚀", "🥷🏻", "🤖", "🦊", "🐱", "🐼", "🦉",
  "🦁", "🐸", "🐶", "🦄", "👾", "🎮", "💎", "⚡",
];

export const GIF_AVATAR_PRESETS = [
  { url: "./avatars/mimi.gif", label: "🐩 米米 (專屬動態動畫)", role: "吉祥物" },
  { url: "./avatars/dongdong.gif", label: "🐕 東東 (專屬動態動畫)", role: "吉祥物" },
  { url: "./avatars/dongdong_walk.gif", label: "🐕 東東 (像素散步)", role: "吉祥物" },
  { url: "./avatars/mochi_cheer.gif", label: "🐩 麻糬 (像素歡呼)", role: "吉祥物" },
  { url: "./avatars/cat_typing.gif", label: "🐱 橘貓 (瘋狂打字)", role: "策劃/開發" },
  { url: "./avatars/robot_pulse.gif", label: "🤖 機器人 (信號心跳)", role: "工程師/數據" },
];

function AvatarView({ avatar, role }: { avatar: string; role?: string }) {
  if (isImageAvatar(avatar)) {
    const isGif = isGifAvatar(avatar);
    return (
      <img
        src={avatar}
        alt=""
        className={`custom-avatar-img ${isGif ? "avatar-gif-animated" : ""}`}
        loading="eager"
      />
    );
  }
  if (role === "吉祥物" && avatar === "🐩") {
    return <MascotAvatar />;
  }
  return <>{avatar}</>;
}

function nowClock(): string {
  const now = new Date();
  return [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function nowShortClock(): string {
  const now = new Date();
  return [now.getHours(), now.getMinutes()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function App() {
  const office = useSyncExternalStore(officeDataSource.subscribe, officeDataSource.getSnapshot, officeDataSource.getSnapshot);
  const [selection, setSelection] = useState<PanelSelection>({ kind: "agent", id: "virgo" });
  const [activeFilter, setActiveFilter] = useState<"all" | ActivityEvent["type"]>("all");
  const [modal, setModal] = useState<"assign" | "context" | "revision" | null>(null);
  const [formValue, setFormValue] = useState("");
  const [selectedAssignee, setSelectedAssignee] = useState("planner");

  // New game-style popups & real-time AI thought monitor
  const [popup, setPopup] = useState<GamePopup | null>(null);
  const [popupInput, setPopupInput] = useState("");
  const [thinkingAgents, setThinkingAgents] = useState<Record<string, string>>({});
  const [thoughts, setThoughts] = useState<ThoughtRecord[]>([
    {
      id: "seed-1",
      agentId: "planner",
      agentName: "小橘",
      avatar: "🧑🏻‍💼",
      role: "策劃",
      prompt: "梳理本週 MVP 優先順序",
      stage: "完成推論",
      thought: "先比對訪談痛點與開發成本，把「可視化辦公室＋即時卡關提醒」列為 P0。",
      outputPreview: "已整理出三個核心使用情境，正在確認本週 MVP 的優先順序。",
      model: "gemini-3.5-flash",
      startedAt: Date.now() - 42000,
      elapsedMs: 1840,
      running: false,
    },
    {
      id: "seed-2",
      agentId: "virgo",
      agentName: "小處",
      avatar: "🧑🏻‍⚖️",
      role: "處女座監督",
      prompt: "檢查原型上線前合規與素材授權",
      stage: "完成推論",
      thought: "發現 brand-colors.pdf 沒有附上外部字型授權條款，必須先攔截提醒總監。",
      outputPreview: "原型缺少最後一份品牌素材授權說明。已先標註風險，等待人工確認。",
      model: "gemini-3.5-flash",
      startedAt: Date.now() - 19000,
      elapsedMs: 1520,
      running: false,
    },
  ]);
  const [showMonitor, setShowMonitor] = useState(true);
  const [monitorMinimized, setMonitorMinimized] = useState(false);
  const [mobile916, setMobile916] = useState(false);
  const [autoTick, setAutoTick] = useState(0);
  const [uiPatch, setUiPatch] = useState<UiEvolutionPatch | null>(null);
  const [uiForm, setUiForm] = useState({
    brandTitle: "無所事事辦公室",
    headline: "早安，總監",
    primaryColor: "#ee6c29",
    paperColor: "#fbfaf6",
    borderColor: "#282b2b",
    fontScale: "1.0",
    sidePanelWidth: "338",
    cardRadius: "4",
    note: "",
  });
  const [newAgentForm, setNewAgentForm] = useState({
    name: "",
    role: "",
    department: "",
    positioning: "",
    avatar: "🕵🏻‍♂️",
    zoneId: "work",
    status: "thinking" as AgentStatus,
    bubble: "隨時準備支援團隊！",
    specialty: "",
    personality: "",
    initialTask: "",
  });
  const [editAgentForm, setEditAgentForm] = useState({
    id: "planner",
    name: "",
    role: "",
    department: "",
    positioning: "",
    avatar: "🧑🏻‍💼",
    zoneId: "work",
    status: "thinking" as AgentStatus,
    bubble: "",
    specialty: "",
    personality: "",
    latestOutput: "",
  });
  const [skillsMap, setSkillsMap] = useState<Record<string, ColleagueSkillInfo>>({});
  const [hrRosterMd, setHrRosterMd] = useState<string>("");
  const [browserApiKey, setBrowserApiKeyState] = useState<string>(() => getBrowserApiKey());

  // Load saved AI UI patch, custom agents, profile overrides, avatar overrides & generated SKILL.md index on startup
  useEffect(() => {
    void fetchCustomAgents().then(async (savedAgents) => {
      if (savedAgents.length) {
        officeDataSource.dispatch({ type: "agent.hydrateCustom", agents: savedAgents });
      }
      const md = await fetchHrRosterMarkdown();
      if (md) {
        setHrRosterMd(md);
      }
      const profiles = await fetchAgentProfiles();
      if (Object.keys(profiles).length) {
        officeDataSource.dispatch({ type: "agent.hydrateProfiles", profiles });
      }
      const overrides = await fetchAvatarOverrides();
      if (Object.keys(overrides).length) {
        officeDataSource.dispatch({ type: "agent.hydrateAvatars", avatars: overrides });
      }
      const skills = await fetchColleagueSkills();
      setSkillsMap(skills);
    });
    void fetchSavedUiPatch().then((saved) => {
      if (saved) {
        setUiPatch(saved);
        setUiForm((prev) => ({
          brandTitle: saved.brandTitle || prev.brandTitle,
          headline: saved.headline || prev.headline,
          primaryColor: saved.primaryColor || saved.cssVars?.["--orange"] || prev.primaryColor,
          paperColor: saved.paperColor || saved.cssVars?.["--paper"] || prev.paperColor,
          borderColor: saved.borderColor || saved.cssVars?.["--charcoal"] || prev.borderColor,
          fontScale: String(saved.fontScale ?? prev.fontScale),
          sidePanelWidth: String(saved.sidePanelWidth ?? prev.sidePanelWidth),
          cardRadius: String(saved.cardRadius ?? prev.cardRadius),
          note: saved.note ?? "",
        }));
      }
    });
  }, []);

  // Apply live UI patch to document root & dynamic <style> tag
  useEffect(() => {
    let styleEl = document.getElementById("ai-live-ui-patch") as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "ai-live-ui-patch";
      document.head.appendChild(styleEl);
    }
    const root = document.documentElement;
    if (!uiPatch) {
      styleEl.textContent = "";
      root.style.removeProperty("--orange");
      root.style.removeProperty("--charcoal");
      root.style.removeProperty("--paper");
      root.style.removeProperty("font-size");
      return;
    }
    const vars: Record<string, string> = {
      ...(uiPatch.cssVars ?? {}),
      ...(uiPatch.primaryColor ? { "--orange": uiPatch.primaryColor } : {}),
      ...(uiPatch.paperColor ? { "--paper": uiPatch.paperColor } : {}),
      ...(uiPatch.borderColor ? { "--charcoal": uiPatch.borderColor } : {}),
    };
    Object.entries(vars).forEach(([k, v]) => {
      if (k.startsWith("--") && v) root.style.setProperty(k, v);
    });
    if (uiPatch.fontScale && uiPatch.fontScale >= 0.75 && uiPatch.fontScale <= 1.5) {
      root.style.fontSize = `${Math.round(13 * uiPatch.fontScale)}px`;
    }
    const rules: string[] = [];
    if (uiPatch.sidePanelWidth) {
      rules.push(`.workspace { grid-template-columns: minmax(0, 1fr) ${uiPatch.sidePanelWidth}px !important; }`);
    }
    if (uiPatch.paperColor) {
      rules.push(`.side-panel, .summary-card, .action-modal { background: ${uiPatch.paperColor} !important; }`);
    }
    if (uiPatch.cardRadius !== undefined) {
      rules.push(`.zone-card, .side-panel, .summary-card, .action-modal, .primary-button, .secondary-top-button { border-radius: ${uiPatch.cardRadius}px !important; }`);
    }
    if (uiPatch.customCss) {
      rules.push(uiPatch.customCss);
    }
    styleEl.textContent = rules.join("\n");
  }, [uiPatch]);

  // Tick every 500ms while any agent is actively thinking so elapsed time animates smoothly
  const anyRunning = Object.keys(thinkingAgents).length > 0;
  useEffect(() => {
    if (!anyRunning) return;
    const timer = window.setInterval(() => setAutoTick((n) => n + 1), 400);
    return () => window.clearInterval(timer);
  }, [anyRunning]);
  void autoTick;

  const activeAgents = office.agents.filter((agent) => agent.status !== "idle").length;
  const blockedAgents = office.agents.filter((agent) => agent.status === "blocked" || agent.status === "error").length;

  const formatClock = () => {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const min = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    return `${mm}:${dd} ${hh}:${min}:${ss}`;
  };

  const [officeClock, setOfficeClock] = useState(formatClock);
  const [bubbleCycle, setBubbleCycle] = useState(0);

  useEffect(() => {
    const clockTimer = setInterval(() => {
      setOfficeClock(formatClock());
    }, 1000);
    const bubbleTimer = setInterval(() => {
      setBubbleCycle((c) => (c + 1) % 1000);
    }, 5000);
    return () => {
      clearInterval(clockTimer);
      clearInterval(bubbleTimer);
    };
  }, []);
  const selectedAgent = selection?.kind === "agent"
    ? office.agents.find((agent) => agent.id === selection.id)
    : undefined;
  const selectedTask = selection?.kind === "task"
    ? office.tasks.find((task) => task.id === selection.id)
    : undefined;
  const activeTask = selectedAgent
    ? office.tasks.find((task) => task.id === selectedAgent.taskId) ?? office.tasks[0]
    : undefined;
  const visibleEvents = useMemo(
    () => office.events.filter((event) => activeFilter === "all" || event.type === activeFilter),
    [activeFilter, office.events],
  );

  const createEvent = (agentId: string, type: ActivityEvent["type"], summary: string, detail: string): ActivityEvent => ({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    time: nowClock(),
    type,
    agentId,
    summary,
    detail,
  });

  const addEvent = (agentId: string, type: ActivityEvent["type"], summary: string, detail: string) => {
    officeDataSource.dispatch({ type: "activity.append", event: createEvent(agentId, type, summary, detail) });
  };

  const changeAgentStatus = (agent: Agent, status: AgentStatus, customZoneId?: string) => {
    const bubble = status === "idle"
      ? "☕ 已完成，隨時待命"
      : status === "blocked"
        ? "❗ 我需要總監協助"
        : "💭 收到，馬上處理！";
    officeDataSource.dispatch({
      type: "agent.status",
      agentId: agent.id,
      status,
      zoneId: customZoneId,
      bubble,
      event: createEvent(agent.id, status === "blocked" ? "error" : "message", `${agent.name}：${statusNames[status]}`, `狀態已更新為「${statusNames[status]}」。`),
    });
  };

  const runAgent = async (
    agent: Agent,
    prompt: string,
    options: { context?: string; taskId?: string; taskStatus?: OfficeTask["status"] } = {},
  ) => {
    const thoughtId = `th-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const startedAt = Date.now();

    // Stage 1: Visual reaction on sprite + thought monitor entry
    setShowMonitor(true);
    setThinkingAgents((prev) => ({ ...prev, [agent.id]: "💭 拆解指令中…" }));
    setThoughts((prev) => [
      {
        id: thoughtId,
        agentId: agent.id,
        agentName: agent.name,
        avatar: agent.avatar,
        role: agent.role,
        prompt,
        stage: "拆解問題",
        thought: `正在理解總監指令：「${prompt.slice(0, 48)}」…`,
        outputPreview: "",
        model: "連線準備中",
        startedAt,
        running: true,
      },
      ...prev.slice(0, 14),
    ]);

    officeDataSource.dispatch({
      type: "agent.status",
      agentId: agent.id,
      status: "thinking",
      bubble: "💭 正在拆解問題…",
      progress: Math.min(85, Math.max(25, agent.progress)),
      tool: { name: "gemini.think", detail: prompt.slice(0, 28), time: nowShortClock(), kind: "running" },
      event: createEvent(agent.id, "tool", `${agent.name} 開始深度思考`, prompt),
    });

    // Stage 2: Context & API call indicator
    const stageTimer1 = window.setTimeout(() => {
      setThinkingAgents((prev) => (prev[agent.id] ? { ...prev, [agent.id]: "🧠 Gemini 推論中…" } : prev));
      setThoughts((prev) => prev.map((item) => item.id === thoughtId
        ? { ...item, stage: "呼叫 Gemini", thought: `已載入「${agent.role}」專業視角，正在等待 Gemini 生成方案…` }
        : item));
    }, 550);

    const reply = await askAgent(agent, prompt, options.context);
    window.clearTimeout(stageTimer1);
    if (reply.needsApiKey) {
      setPopup({ kind: "api-key" });
      setPopupInput(browserApiKey);
    }

    setThinkingAgents((prev) => {
      const next = { ...prev };
      delete next[agent.id];
      return next;
    });

    setThoughts((prev) => prev.map((item) => item.id === thoughtId
      ? {
          ...item,
          stage: reply.ok ? "完成推論" : "發生錯誤",
          thought: reply.thought,
          outputPreview: reply.text,
          model: reply.model,
          elapsedMs: reply.elapsedMs,
          running: false,
        }
      : item));

    const shortBubble = reply.ok
      ? `✨ ${reply.thought.replace(/[。！!？?\s]+$/g, "").slice(0, 13)}！`
      : "⚠️ AI 連線異常";

    officeDataSource.dispatch({
      type: "agent.output",
      agentId: agent.id,
      status: reply.ok ? "reviewing" : "error",
      bubble: shortBubble,
      output: reply.text,
      tool: {
        name: `gemini.reply (${reply.model})`,
        detail: reply.thought.slice(0, 32),
        time: nowShortClock(),
        kind: reply.ok ? "success" : "warning",
      },
      taskId: options.taskId,
      taskStatus: reply.ok ? (options.taskStatus ?? "待審核") : undefined,
      event: createEvent(
        agent.id,
        reply.ok ? "message" : "error",
        reply.ok ? `${agent.name} 完成思考與產出` : `${agent.name} 呼叫 AI 失敗`,
        reply.text,
      ),
    });
  };

  // Run live UI evolution via researcher 阿研 using structured form fields
  const submitUiFormToAyan = async () => {
    const researcher = office.agents.find((a) => a.id === "researcher") ?? office.agents[0];
    const basePatch: UiEvolutionPatch = {
      ...uiPatch,
      brandTitle: uiForm.brandTitle.trim() || "無所事事辦公室",
      headline: uiForm.headline.trim() || "早安，總監",
      primaryColor: uiForm.primaryColor.trim() || "#ee6c29",
      paperColor: uiForm.paperColor.trim() || "#fbfaf6",
      borderColor: uiForm.borderColor.trim() || "#282b2b",
      fontScale: Math.min(1.4, Math.max(0.8, Number(uiForm.fontScale) || 1.0)),
      sidePanelWidth: Math.min(520, Math.max(280, Number(uiForm.sidePanelWidth) || 338)),
      cardRadius: Math.min(24, Math.max(0, Number(uiForm.cardRadius) || 4)),
      note: uiForm.note.trim(),
      cssVars: {
        "--orange": uiForm.primaryColor.trim() || "#ee6c29",
        "--paper": uiForm.paperColor.trim() || "#fbfaf6",
        "--charcoal": uiForm.borderColor.trim() || "#282b2b",
      },
    };

    // Immediately apply the confirmed structured fields so the user sees instant changes
    setUiPatch(basePatch);

    const fieldSummary = `標題「${basePatch.brandTitle}」、歡迎詞「${basePatch.headline}」、強調色 ${basePatch.primaryColor}、底色 ${basePatch.paperColor}、字級倍率 ${basePatch.fontScale}、側欄 ${basePatch.sidePanelWidth}px、圓角 ${basePatch.cardRadius}px${basePatch.note ? `；補充需求：${basePatch.note}` : ""}`;

    const thoughtId = `ui-${Date.now()}`;
    const startedAt = Date.now();
    setShowMonitor(true);
    setSelection({ kind: "agent", id: researcher.id });
    setThinkingAgents((prev) => ({ ...prev, [researcher.id]: "🎨 阿研正在套用並研究 UI 參數…" }));
    setThoughts((prev) => [
      {
        id: thoughtId,
        agentId: researcher.id,
        agentName: researcher.name,
        avatar: researcher.avatar,
        role: researcher.role,
        prompt: `【介面欄位更新】${fieldSummary}`,
        stage: "呼叫 Gemini",
        thought: `已先即時套用總監填入的固定欄位參數，正在由阿研生成進階樣式與 UX 評估報告…`,
        outputPreview: "",
        model: "gemini-ui-engine",
        startedAt,
        running: true,
      },
      ...prev.slice(0, 14),
    ]);
    officeDataSource.dispatch({
      type: "agent.status",
      agentId: researcher.id,
      status: "researching",
      zoneId: "work",
      bubble: "🎨 阿研正在更新介面參數…",
      tool: { name: "ui.applyFields", detail: fieldSummary.slice(0, 28), time: nowShortClock(), kind: "running" },
      event: createEvent(researcher.id, "file", `${researcher.name} 套用結構化介面欄位`, fieldSummary),
    });

    const res = await askUiEvolve(fieldSummary, basePatch);
    setThinkingAgents((prev) => {
      const next = { ...prev };
      delete next[researcher.id];
      return next;
    });

    if (res.ok && res.patch) {
      const merged: UiEvolutionPatch = {
        ...basePatch,
        thought: res.patch.thought,
        summary: res.patch.summary,
        customCss: basePatch.note ? (res.patch.customCss ?? "") : basePatch.customCss,
        model: res.patch.model,
        elapsedMs: res.patch.elapsedMs,
      };
      setUiPatch(merged);
      setThoughts((prev) => prev.map((item) => item.id === thoughtId
        ? {
            ...item,
            stage: "完成推論",
            thought: res.patch?.thought ?? "已完成固有欄位驗證與介面更新。",
            outputPreview: res.patch?.summary ?? `已套用：${fieldSummary}`,
            model: res.patch?.model ?? "gemini",
            elapsedMs: res.patch?.elapsedMs ?? (Date.now() - startedAt),
            running: false,
          }
        : item));
      officeDataSource.dispatch({
        type: "agent.output",
        agentId: researcher.id,
        status: "reviewing",
        bubble: "✨ 介面參數已更新！",
        output: res.patch.summary ?? `阿研已完成介面欄位更新：${fieldSummary}`,
        tool: { name: "ui.applyFields", detail: "已寫入 custom_ui_state.json", time: nowShortClock(), kind: "success" },
        event: createEvent(researcher.id, "file", `${researcher.name} 完成介面欄位更新`, res.patch.summary ?? fieldSummary),
      });
    } else {
      setThoughts((prev) => prev.map((item) => item.id === thoughtId
        ? {
            ...item,
            stage: "完成推論",
            thought: "固定欄位已直接生效（AI 補充樣式略過）。",
            outputPreview: `已直接套用欄位：${fieldSummary}`,
            model: "local+fields",
            elapsedMs: Date.now() - startedAt,
            running: false,
          }
        : item));
    }
  };

  // Create a brand new AI colleague from the structured form
  const submitCreateAgent = () => {
    const name = newAgentForm.name.trim() || `新同事${office.agents.length + 1}`;
    const role = newAgentForm.role.trim() || "專案顧問";
    const department = newAgentForm.department.trim() || `${role}專業部門`;
    const positioning = newAgentForm.positioning.trim() || `${role} ／ 專案核心協力夥伴`;
    const avatar = newAgentForm.avatar.trim() || "🧑🏻‍💻";
    const specialty = newAgentForm.specialty.trim() || `以「${role}」專業視角執行任務、分析問題並提供高品質交付成果`;
    const personality = newAgentForm.personality.trim() || `充滿熱忱、自主性極高的「${name}」，總能從「${role}」專業切入點提供可靠支援。`;
    const id = `custom-${Date.now()}`;
    const taskId = newAgentForm.initialTask.trim() ? `task-${Date.now()}` : office.tasks[0].id;
    const newTask: OfficeTask | undefined = newAgentForm.initialTask.trim()
      ? {
          id: taskId,
          title: newAgentForm.initialTask.trim().slice(0, 28),
          goal: newAgentForm.initialTask.trim(),
          ownerId: id,
          status: "進行中",
          progress: 20,
          due: "今天 18:00",
          steps: [
            { label: "完成新角色報到與環境同步", done: true },
            { label: "呼叫 Gemini 執行首項任務", done: false },
          ],
          attachments: [],
        }
      : undefined;

    const newAgent: Agent = {
      id,
      name,
      role,
      department,
      positioning,
      avatar,
      status: newAgentForm.status,
      taskId,
      progress: 25,
      zoneId: newAgentForm.zoneId,
      bubble: newAgentForm.bubble.trim() || "報到完畢！",
      specialty,
      personality,
      latestOutput: `嗨總監！我是新加入的「${name}」（職能：${department}｜定位：${positioning}），已經進駐辦公室隨時待命。`,
      tools: [
        { name: "agent.onboard", detail: `以「${role}」身分報到`, time: nowShortClock(), kind: "success" },
      ],
    };

    officeDataSource.dispatch({
      type: "agent.create",
      agent: newAgent,
      task: newTask,
      event: createEvent(id, "handoff", `新角色「${name}（${role}）」加入團隊並建立專屬 Skill`, newAgent.latestOutput),
    });
    void saveCustomAgentApi(newAgent).then(async () => {
      const updatedSkills = await fetchColleagueSkills();
      setSkillsMap(updatedSkills);
    });
    setSelection({ kind: "agent", id });
    setPopup({ kind: "agent-status", agentId: id });

    if (newAgentForm.initialTask.trim()) {
      void runAgent(newAgent, newAgentForm.initialTask.trim(), { taskId });
    }
    setNewAgentForm({
      name: "",
      role: "",
      department: "",
      positioning: "",
      avatar: "🕵🏻‍♂️",
      zoneId: "work",
      status: "thinking",
      bubble: "隨時準備支援團隊！",
      specialty: "",
      personality: "",
      initialTask: "",
    });
  };

  // Open character personal profile editor for any built-in or custom colleague
  const openEditAgent = (agent: Agent) => {
    const skillMd = skillsMap[agent.id]?.content ?? "";
    const parsedFromSkill = skillMd ? extractProfileFromSkillMarkdown(skillMd) : {};
    setEditAgentForm({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      department: agent.department ?? parsedFromSkill.department ?? `${agent.role}專業部門`,
      positioning: agent.positioning ?? parsedFromSkill.positioning ?? `${agent.role} ／ 專案核心協力夥伴`,
      avatar: agent.avatar,
      zoneId: agent.zoneId,
      status: agent.status,
      bubble: agent.bubble,
      specialty: agent.specialty ?? parsedFromSkill.specialty ?? `以「${agent.role}」專業視角執行任務、分析問題並提供高品質交付成果`,
      personality: agent.personality ?? parsedFromSkill.personality ?? `認真負責、充滿熱忱的辦公室夥伴，總是以「${agent.name}」的專業觀點協助總監解決難題。`,
      latestOutput: agent.latestOutput,
    });
    setPopup({ kind: "agent-edit", agentId: agent.id });
  };

  // Save edited personal profile and immediately reflect on map, side panel, thoughts, and SKILL.md
  const submitEditAgent = async () => {
    const target = office.agents.find((a) => a.id === editAgentForm.id) ?? office.agents[0];
    if (!target) return;
    const patch: Partial<Agent> = {
      name: editAgentForm.name.trim() || target.name,
      role: editAgentForm.role.trim() || target.role,
      department: editAgentForm.department.trim() || target.department,
      positioning: editAgentForm.positioning.trim() || target.positioning,
      avatar: editAgentForm.avatar.trim() || target.avatar,
      zoneId: editAgentForm.zoneId || target.zoneId,
      status: editAgentForm.status || target.status,
      bubble: editAgentForm.bubble.trim() || target.bubble,
      specialty: editAgentForm.specialty.trim() || target.specialty,
      personality: editAgentForm.personality.trim() || target.personality,
      latestOutput: editAgentForm.latestOutput.trim() || target.latestOutput,
    };

    officeDataSource.dispatch({
      type: "agent.updateProfile",
      agentId: target.id,
      patch,
      event: createEvent(
        target.id,
        "file",
        `已更新角色個人資訊：${patch.name}（${patch.role}）`,
        `職能：${patch.department ?? ""}｜定位：${patch.positioning ?? ""}｜專長：${patch.specialty ?? ""}`,
      ),
    });

    setThoughts((prev) =>
      prev.map((t) =>
        t.agentId === target.id
          ? {
              ...t,
              agentName: patch.name ?? t.agentName,
              role: patch.role ?? t.role,
              avatar: patch.avatar ?? t.avatar,
            }
          : t,
      ),
    );

    const updatedAgent: Agent = { ...target, ...patch };
    const savedSkill = await saveAgentProfileApi(updatedAgent, patch);
    if (savedSkill) {
      setSkillsMap((prev) => ({ ...prev, [target.id]: savedSkill }));
    } else {
      const refreshed = await fetchColleagueSkills();
      setSkillsMap(refreshed);
    }
    setSelection({ kind: "agent", id: target.id });
    setPopup({ kind: "agent-status", agentId: target.id });
  };

  // Run one round of autonomous office simulation across active agents
  const runOfficeRound = () => {
    const candidates = office.agents.filter((a) => a.status !== "idle").slice(0, 2);
    const targets = candidates.length ? candidates : [office.agents[0]];
    targets.forEach((agent) => {
      const task = office.tasks.find((t) => t.id === agent.taskId) ?? office.tasks[0];
      void runAgent(
        agent,
        `請主動推進你負責的任務「${task.title}」（目標：${task.goal}），回報你剛剛完成了哪一步與最新具體成果。`,
        { context: `目前進度 ${agent.progress}%，上一版輸出：${agent.latestOutput}`, taskId: task.id },
      );
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = formValue.trim();
    if (!value) return;

    if (modal === "assign") {
      const owner = office.agents.find((agent) => agent.id === selectedAssignee) ?? office.agents[0];
      const taskId = `task-${Date.now()}`;
      const newTask: OfficeTask = {
        id: taskId,
        title: value.slice(0, 28),
        goal: value,
        ownerId: owner.id,
        status: "進行中",
        progress: 15,
        due: "今天 18:00",
        steps: [
          { label: "拆解總監指令與關鍵需求", done: true },
          { label: "呼叫 Gemini 模型推論方案", done: false },
          { label: "產出具體結果並送交審核", done: false },
        ],
        attachments: [],
      };
      setSelection({ kind: "agent", id: owner.id });
      officeDataSource.dispatch({
        type: "task.create",
        task: newTask,
        ownerId: owner.id,
        event: createEvent(owner.id, "handoff", `${owner.name} 接下新任務`, value),
      });
      void runAgent(owner, value, { taskId });
    } else if (modal === "context") {
      const agent = selectedAgent ?? office.agents[0];
      addEvent(agent.id, "message", `補充資料給 ${agent.name}`, value);
      const task = office.tasks.find((item) => item.id === agent.taskId);
      void runAgent(agent, task ? `請根據新補充的資料，更新你在任務「${task.title}」的產出。` : "請閱讀這份補充資料並整理重點。", {
        context: `${agent.latestOutput ? `你先前的產出：${agent.latestOutput}\n\n` : ""}新補充資料：${value}`,
        taskId: task?.id,
      });
    } else if (modal === "revision") {
      const task = activeTask ?? selectedTask;
      const ownerId = task?.ownerId ?? selectedAgent?.id ?? office.agents[0].id;
      officeDataSource.dispatch({
        type: "task.revise",
        taskId: task?.id,
        ownerId,
        event: createEvent(ownerId, "message", "收到修改要求", value),
      });
      const owner = office.agents.find((agent) => agent.id === ownerId) ?? office.agents[0];
      void runAgent(owner, `請依照以下修改要求，重新產出任務「${task?.title ?? "目前任務"}」的結果：${value}`, {
        context: owner.latestOutput ? `你先前的產出：${owner.latestOutput}` : "",
        taskId: task?.id,
      });
    }

    setFormValue("");
    setModal(null);
  };

  const approveCurrent = () => {
    const task = activeTask ?? selectedTask;
    const taskToApprove = task ?? (selection?.kind === "meeting"
      ? office.tasks.find((item) => office.agents.some((agent) => agent.taskId === item.id && agent.status === "blocked"))
        ?? office.tasks.find((item) => item.status !== "已核准")
      : undefined);
    if (!taskToApprove) {
      setModal("assign");
      return;
    }
    officeDataSource.dispatch({
      type: "task.approve",
      taskId: taskToApprove.id,
      event: createEvent(taskToApprove.ownerId, "handoff", `核准任務：${taskToApprove.title}`, "總監人工審核已通過，任務正式結案。"),
    });
  };

  const finishTask = (taskId: string) => {
    const taskToFinish = office.tasks.find((item) => item.id === taskId);
    if (!taskToFinish) return;
    officeDataSource.dispatch({
      type: "task.finish",
      taskId: taskToFinish.id,
      event: createEvent(taskToFinish.ownerId, "handoff", `結束任務：${taskToFinish.title}`, "總監視情況已手動結束此任務，負責人轉入待命狀態。"),
    });
  };

  const moveAgentToZone = (agent: Agent, zoneId: string) => {
    if (zoneId === "tasks") return; // 任務牆不需要調度同事進駐
    if (zoneId === "meeting") {
      // 會議室為虛擬按鈕功能：切換開會狀態並彈出全體會議與決策智庫
      officeDataSource.dispatch({
        type: "agent.status",
        agentId: agent.id,
        status: "reviewing",
        zoneId: agent.zoneId === "rest" ? "board" : agent.zoneId,
        bubble: "📢 正在參與全體同步會議～",
        event: createEvent(agent.id, "handoff", `召集 ${agent.name} 進行會議同步`, "已開啟會議與決策智庫。"),
      });
      setSelection({ kind: "meeting" });
      setPopup({ kind: "team-decisions" });
      return;
    }
    const targetZoneId = zoneId === "lounge" ? "rest" : zoneId;
    const zoneName = office.zones.find((z) => z.id === targetZoneId)?.name ?? targetZoneId;
    const status: AgentStatus = targetZoneId === "rest" ? "idle" : "coding";
    const bubble = targetZoneId === "rest" ? "☕ 在休息區待命充電～" : "💼 回到工作區專注衝刺！";
    officeDataSource.dispatch({
      type: "agent.status",
      agentId: agent.id,
      status,
      zoneId: targetZoneId,
      bubble,
      event: createEvent(agent.id, "handoff", `總監調度 ${agent.name} 前往 ${zoneName}`, `已將同仁工位調動至 ${zoneName}。`),
    });
  };

  return (
    <div className={mobile916 ? "mobile-916-stage" : ""}>
      <div className={`office-app ${mobile916 ? "viewport-mobile-916" : ""}`}>
        <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span>O</span></div>
          <div className="brand-name-group">
            <div className="brand-name">
              <span className="brand-title-text">{uiPatch?.brandTitle || "無所事事辦公室"}</span>
              <span className="office-time-ticker" title="辦公室重要時間與日期 (MM:DD HH:MM:SS)">
                <i className="live-dot" /> {officeClock}
              </span>
            </div>
          </div>
        </div>
        <div className="topbar-right">
          {!mobile916 && (
            <div className="topbar-desktop-tools">
            {office.mode === "demo" ? (
              <button
                type="button"
                className="secondary-top-button mode-switch-btn mode-btn-demo"
                onClick={() => officeDataSource.dispatch({ type: "workspace.setMode", mode: "work" })}
                title="目前處於展示沙盒模式（操作不影響正式作業存檔）。點擊一鍵返回正式作業進度。"
              >
                <span className="live-dot" style={{ background: "#ee6c29" }} />
                🎪 展示沙盒 ➔ <strong>返回作業</strong>
              </button>
            ) : (
              <button
                type="button"
                className="secondary-top-button mode-switch-btn mode-btn-work"
                onClick={() => officeDataSource.dispatch({ type: "workspace.setMode", mode: "demo" })}
                title={`目前處於正式作業模式（所有工位、步驟與任務已自動即時存檔${office.lastSavedAt ? `：${office.lastSavedAt}` : ""}）。點擊可進入安全展示模式供他人試玩。`}
              >
                <span className="live-dot" style={{ background: "#38a169" }} />
                💼 作業存檔中 <small style={{ opacity: 0.85 }}>({office.lastSavedAt || "已同步"})</small>
              </button>
            )}
            <button
              type="button"
              className="secondary-top-button"
              onClick={() => {
                setPopup({ kind: "api-key" });
                setPopupInput(browserApiKey);
              }}
              title="設定手機 / GitHub Pages 瀏覽器端直連 Gemini API Key"
            >
              🔑 {browserApiKey ? "金鑰已設" : "金鑰"}
            </button>
            <button
              type="button"
              className={`secondary-top-button ${mobile916 ? "hud-pulsing" : ""}`}
              onClick={() => setMobile916((v) => !v)}
              title="切換 9:16 手機直向介面與桌機寬螢幕"
            >
              {mobile916 ? "🖥️ 桌機" : "📱 9:16"}
            </button>
            <button
              type="button"
              className="secondary-top-button ui-studio-btn"
              onClick={() => { setPopup({ kind: "ui-studio" }); setPopupInput(""); }}
              title="調整網站外觀與排版"
            >
              🎨 改介面
            </button>
            <button
              type="button"
              className="secondary-top-button"
              onClick={() => setPopup({ kind: "hr-roster" })}
              title="開啟 HR 人事檔案館與同事完整背景 Docs"
            >
              🪪 HR 檔案 ({office.agents.length})
            </button>
            <button
              type="button"
              className="secondary-top-button"
              onClick={() => setPopup({ kind: "agent-create" })}
              title="招募新 AI 角色"
            >
              🧑🏻‍🎨 ＋新角色
            </button>
            <button
              type="button"
              className="secondary-top-button"
              onClick={() => openEditAgent(selectedAgent ?? office.agents[0])}
              title="編輯目前選取角色的名稱、職能、定位、頭像、專長與個性背景"
            >
              ✎ 角色設定
            </button>
            <button
              type="button"
              className="secondary-top-button"
              onClick={() => {
                const targetId = selectedAgent?.id ?? office.agents[0].id;
                setPopup({ kind: "skill-viewer", agentId: targetId });
                setPopupInput(skillsMap[targetId]?.content ?? "");
              }}
              title="檢視或編輯每位同事的 SKILL.md 技能包"
            >
              📘 Skills ({Object.keys(skillsMap).length || office.agents.length})
            </button>
            <button
              type="button"
              className={`hud-toggle-button ${anyRunning ? "hud-pulsing" : ""}`}
              onClick={() => { setShowMonitor(true); setMonitorMinimized(false); }}
              title="開啟 AI 思考狀態監控窗"
            >
              <span className="live-dot" />
              🧠 {anyRunning ? `${Object.keys(thinkingAgents).length} 思考中` : thoughts.length}
            </button>
            <button
              type="button"
              className="secondary-top-button"
              onClick={runOfficeRound}
              disabled={anyRunning}
              title="讓正在工作的 AI 同事自動推進一回合"
            >
              ⚡ {anyRunning ? "推論中…" : "推進"}
            </button>
            <button
              type="button"
              className="secondary-top-button"
              onClick={() => { setPopup({ kind: "director" }); setPopupInput(""); }}
              title="開啟總監指令台"
            >
              🎮 指令台
            </button>
            <button
              type="button"
              className="secondary-top-button"
              onClick={() => { setPopup({ kind: "team-decisions" }); }}
              title="召開全體同步會議與決策智庫"
            >
              📢 開會
            </button>
          </div>
          )}

          <div className="topbar-compact-actions">
            <button
              type="button"
              className="secondary-top-button mobile-toolbar-trigger"
              onClick={() => setPopup({ kind: "toolbar-menu" })}
              title="點擊彈出完整工具列選單視窗"
            >
              ☰ 工具列
            </button>
            <button className="primary-button assign-button" onClick={() => setModal("assign")}>
              <span>＋</span> 派任務
            </button>
          </div>
        </div>
      </header>

      <main className="workspace">
        {office.mode === "demo" && (
          <div className="demo-mode-alert-bar">
            <span className="demo-bar-badge">🎪 展示沙盒模式</span>
            <span className="demo-bar-desc">此模式供他人試玩體驗，所有操作皆為沙盒環境，<strong>不會覆蓋您的日常作業存檔</strong>。</span>
            <div className="demo-bar-actions">
              <button
                type="button"
                className="demo-bar-btn demo-bar-reset"
                onClick={() => officeDataSource.dispatch({ type: "workspace.resetDemo" })}
                title="重新整理展示劇本"
              >
                ↺ 重整展示劇本
              </button>
              <button
                type="button"
                className="demo-bar-btn demo-bar-exit"
                onClick={() => officeDataSource.dispatch({ type: "workspace.setMode", mode: "work" })}
                title="返回我的正式作業存檔"
              >
                ✓ 切回我的作業存檔 ➔
              </button>
            </div>
          </div>
        )}
        <div className="overview-row workspace-overview">
          <div className="overview-title-block">
            <h1>{uiPatch?.headline || "早安，總監"} <span className="wave">✳</span></h1>
          </div>
          <div className="summary-cards">
            <button
              type="button"
              className="summary-card summary-card-clickable"
              onClick={() => setPopup({ kind: "summary-active" })}
              title="查看正在工作的同事"
            >
              <span className="summary-icon icon-orange">✳</span>
              <div><strong>{activeAgents}<small> / {office.agents.length}</small></strong><span>工作中</span></div>
            </button>
            <button
              type="button"
              className="summary-card summary-card-clickable"
              onClick={() => setPopup({ kind: "summary-tasks" })}
              title="查看進行中任務"
            >
              <span className="summary-icon icon-blue">⌁</span>
              <div><strong>{office.tasks.filter((task) => task.status !== "已核准" && task.status !== "已結束").length}<small> 項</small></strong><span>任務</span></div>
            </button>
            <button
              type="button"
              className={`summary-card summary-card-clickable ${blockedAgents ? "attention-card" : ""}`}
              onClick={() => setPopup({ kind: "summary-blocked" })}
              title="查看需要協助的項目"
            >
              <span className="summary-icon icon-amber">!</span>
              <div><strong>{blockedAgents}<small> 項</small></strong><span>待確認</span></div>
            </button>
          </div>
        </div>

        <div className="workspace-deck">
          <section className="main-column" aria-label="辦公室工作空間">
            <div className="scene-toolbar">
              <div className="scene-title">
                <span className="scene-spark">✳</span> 辦公室地圖
                <span className="scene-count" title="在場人數">👥 {office.agents.length}</span>
                {anyRunning && <span className="thinking-banner">💭 {Object.values(thinkingAgents)[0]}</span>}
              </div>
              <div className="scene-key">
                <button type="button" className="key-chip" onClick={() => setPopup({ kind: "summary-active" })} title="工作中"><i className="key-dot working" />工作中</button>
                <button type="button" className="key-chip" onClick={() => setPopup({ kind: "zone", zoneId: "rest" })} title="休息中"><i className="key-dot break" />休息</button>
                <button type="button" className="key-chip" onClick={() => setPopup({ kind: "summary-blocked" })} title="需要協助"><i className="key-dot stuck" />需協助</button>
              </div>
            </div>

            <OfficeScene
              office={office}
              selectedAgentId={selectedAgent?.id}
              thinkingAgents={thinkingAgents}
              onSelectAgent={(id) => {
                setSelection({ kind: "agent", id });
                if (mobile916) {
                  setPopup({ kind: "agent-status", agentId: id });
                }
              }}
              onOpenAgentChat={(id) => {
                setSelection({ kind: "agent", id });
                setPopup({ kind: "agent-chat", agentId: id });
                setPopupInput("");
              }}
              onSelectTask={(id) => {
                setSelection({ kind: "task", id });
                setPopup({ kind: "task-detail", taskId: id });
              }}
              onSelectZone={(zoneId) => {
                if (zoneId === "tasks") {
                  setPopup({ kind: "task-detail", taskId: (office.tasks[0]?.id || "prototype") });
                  return;
                }
                if (zoneId === "meeting") {
                  setSelection({ kind: "meeting" });
                  setPopup({ kind: "team-decisions" });
                  return;
                }
                setPopup({ kind: "zone", zoneId });
              }}
              onFinishTask={finishTask}
              onOpenAssign={() => setModal("assign")}
              bubbleCycle={bubbleCycle}
            />

            <div className="scene-footer">
              <div>
                <span className="footer-indicator" title="Gemini 連線就緒" />
                <button type="button" onClick={() => { setShowMonitor(true); setMonitorMinimized(false); }}>
                  🧠 思考監控 ({thoughts.length})
                </button>
                <button
                  type="button"
                  onClick={() => setPopup({ kind: "agent-status", agentId: selectedAgent?.id ?? office.agents[0].id })}
                >
                  👤 同事狀態 <span>↗</span>
                </button>
              </div>
              <div className="scene-footer-actions">
                <button type="button" onClick={() => setPopup({ kind: "hr-roster" })}>
                  🪪 HR 檔案館 <span>↗</span>
                </button>
                <button type="button" onClick={() => { setPopup({ kind: "meeting-brainstorm" }); setPopupInput(""); }}>
                  🧠 腦力激盪 <span>↗</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelection({ kind: "meeting" });
                    setPopup({ kind: "team-decisions" });
                  }}
                >
                  📋 團隊決策 <span>↗</span>
                </button>
              </div>
            </div>
          </section>

          {!mobile916 && (
            <aside className="side-panel side-ops-console" aria-label="總監戰情副控台">
              <div className="panel-topline">
                <div className="panel-topline-tabs">
                  <button
                    type="button"
                    className={`panel-tab-btn ${selection?.kind === "agent" ? "panel-tab-active" : ""}`}
                    onClick={() => {
                      const targetId = selectedAgent?.id ?? office.agents[0].id;
                      setSelection({ kind: "agent", id: targetId });
                    }}
                    title="切換同事通訊與指揮"
                  >
                    👤 同事聯絡
                  </button>
                  <button
                    type="button"
                    className={`panel-tab-btn ${selection?.kind === "task" ? "panel-tab-active" : ""}`}
                    onClick={() => {
                      const targetTask = selectedTask ?? activeTask ?? office.tasks[0];
                      setSelection({ kind: "task", id: targetTask.id });
                    }}
                    title="切換任務督導與驗收"
                  >
                    🎯 任務看板
                  </button>
                  <button
                    type="button"
                    className={`panel-tab-btn ${selection?.kind === "meeting" ? "panel-tab-active" : ""}`}
                    onClick={() => {
                      setSelection({ kind: "meeting" });
                    }}
                    title="切換決策智庫與會議"
                  >
                    📋 決策智庫
                  </button>
                </div>
                <button
                  type="button"
                  className="more-button"
                  aria-label="開啟全螢幕彈窗視窗"
                  title="開啟全螢幕詳細彈窗"
                  onClick={() => {
                    if (selection?.kind === "task") {
                      setPopup({ kind: "task-detail", taskId: (selectedTask ?? activeTask ?? office.tasks[0]).id });
                    } else if (selection?.kind === "meeting") {
                      setPopup({ kind: "team-decisions" });
                    } else {
                      setPopup({ kind: "agent-status", agentId: (selectedAgent ?? office.agents[0]).id });
                    }
                  }}
                >
                  ↗
                </button>
              </div>

              {selectedAgent && activeTask && selection?.kind !== "task" && selection?.kind !== "meeting" && (
                <AgentPanel
                  agent={selectedAgent}
                  task={activeTask}
                  officeZones={office.zones}
                  thinkingStage={thinkingAgents[selectedAgent.id]}
                  latestThought={thoughts.find((t) => t.agentId === selectedAgent.id)}
                  onSelectTask={() => {
                    setSelection({ kind: "task", id: activeTask.id });
                    setPopup({ kind: "task-detail", taskId: activeTask.id });
                  }}
                  onStatus={(status) => changeAgentStatus(selectedAgent, status)}
                  onAction={setModal}
                  onApprove={approveCurrent}
                  onFinishTask={finishTask}
                  onMoveZone={(zoneId) => moveAgentToZone(selectedAgent, zoneId)}
                  onOpenStatusPopup={() => setPopup({ kind: "agent-status", agentId: selectedAgent.id })}
                  onOpenChat={() => { setPopup({ kind: "agent-chat", agentId: selectedAgent.id }); setPopupInput(""); }}
                  onOpenTools={() => setPopup({ kind: "agent-tools", agentId: selectedAgent.id })}
                  onOpenOutput={() => setPopup({ kind: "agent-output", agentId: selectedAgent.id })}
                  onOpenAvatarPicker={() => { setPopup({ kind: "avatar-picker", agentId: selectedAgent.id }); setPopupInput(selectedAgent.avatar); }}
                  onOpenEditProfile={() => openEditAgent(selectedAgent)}
                  skillInfo={skillsMap[selectedAgent.id]}
                  onOpenSkill={() => {
                    setPopup({ kind: "skill-viewer", agentId: selectedAgent.id });
                    setPopupInput(skillsMap[selectedAgent.id]?.content ?? "");
                  }}
                />
              )}
              {selection?.kind === "task" && (selectedTask || activeTask) && (
                <TaskPanel
                  task={selectedTask ?? activeTask!}
                  agent={office.agents.find((item) => item.id === (selectedTask ?? activeTask!).ownerId)}
                  onSelectAgent={(id) => {
                    setSelection({ kind: "agent", id });
                  }}
                  onToggleStep={(idx) => {
                    const curTask = selectedTask ?? activeTask!;
                    const step = curTask.steps[idx];
                    officeDataSource.dispatch({
                      type: "task.toggleStep",
                      taskId: curTask.id,
                      stepIndex: idx,
                      event: createEvent(curTask.ownerId, "file", `更新步驟：${step?.label ?? ""}`, `任務「${curTask.title}」步驟狀態已切換。`),
                    });
                  }}
                  onOpenAttachment={(file) => {
                    const curTask = selectedTask ?? activeTask!;
                    setPopup({ kind: "attachment", taskId: curTask.id, file });
                    setPopupInput("");
                  }}
                  onAction={setModal}
                  onApprove={approveCurrent}
                  onFinishTask={finishTask}
                />
              )}
              {selection?.kind === "meeting" && (
                <MeetingPanel
                  office={office}
                  onSelectAgent={(id) => {
                    setSelection({ kind: "agent", id });
                  }}
                  onApprove={approveCurrent}
                  onOpenBrainstorm={() => { setPopup({ kind: "meeting-brainstorm" }); setPopupInput(""); }}
                  onOpenDecisionsPopup={() => setPopup({ kind: "team-decisions" })}
                />
              )}
              {!selectedAgent && !selectedTask && selection?.kind !== "meeting" && (
                <EmptyPanel onAssign={() => setModal("assign")} />
              )}

              <div className="panel-footer">
                <span className="panel-footer-tip">📻 總監戰情副控台 · 與地圖切齊連動</span>
                <button
                  type="button"
                  className="panel-expand-btn"
                  onClick={() => {
                    if (selection?.kind === "task") {
                      setPopup({ kind: "task-detail", taskId: (selectedTask ?? activeTask ?? office.tasks[0]).id });
                    } else if (selection?.kind === "meeting") {
                      setPopup({ kind: "team-decisions" });
                    } else {
                      setPopup({ kind: "agent-status", agentId: (selectedAgent ?? office.agents[0]).id });
                    }
                  }}
                  title="開啟全螢幕視窗"
                >
                  彈窗視窗 ↗
                </button>
              </div>
            </aside>
          )}
        </div>
      </main>

      <ActivityFeed
        events={visibleEvents}
        agents={office.agents}
        filter={activeFilter}
        onFilter={setActiveFilter}
        onOpenEvent={(eventId) => setPopup({ kind: "activity-log", eventId })}
        onOpenAll={() => setPopup({ kind: "activity-log" })}
      />

      {/* Floating Real-Time Thought Monitor Window (Requirement #4) */}
      {showMonitor && (
        <ThoughtMonitorWindow
          thoughts={thoughts}
          thinkingAgents={thinkingAgents}
          minimized={monitorMinimized}
          onMinimize={() => setMonitorMinimized((m) => !m)}
          onClose={() => setShowMonitor(false)}
          onSelectThought={(id) => setPopup({ kind: "thought-detail", recordId: id })}
          onRunRound={runOfficeRound}
        />
      )}

      {modal && (
        <ActionModal
          kind={modal}
          value={formValue}
          assignee={selectedAssignee}
          agents={office.agents}
          onValue={setFormValue}
          onAssignee={setSelectedAssignee}
          onClose={() => { setModal(null); setFormValue(""); }}
          onSubmit={handleSubmit}
        />
      )}

      {popup && (
        <GamePopupModal
          popup={popup}
          office={office}
          thoughts={thoughts}
          thinkingAgents={thinkingAgents}
          selectedAgent={selectedAgent}
          selectedTask={selectedTask ?? activeTask}
          input={popupInput}
          onInput={setPopupInput}
          onClose={() => setPopup(null)}
          onNavigatePopup={(nextPopup) => setPopup(nextPopup)}
          onSelectAgent={(id) => {
            setSelection({ kind: "agent", id });
            setPopup({ kind: "agent-status", agentId: id });
          }}
          onSelectTask={(id) => {
            setSelection({ kind: "task", id });
            setPopup({ kind: "task-detail", taskId: id });
          }}
          onMoveAgent={(agent, status, zoneId) => { changeAgentStatus(agent, status, zoneId); setPopup(null); }}
          onRunAgent={(agent, prompt, context, taskId) => {
            setPopup(null);
            setSelection({ kind: "agent", id: agent.id });
            void runAgent(agent, prompt, { context, taskId });
          }}
          onAddAttachment={(taskId, fileName) => {
            const task = office.tasks.find((t) => t.id === taskId);
            officeDataSource.dispatch({
              type: "task.addAttachment",
              taskId,
              fileName,
              event: createEvent(task?.ownerId ?? "planner", "file", `新增附件：${fileName}`, `已附加至任務「${task?.title ?? ""}」`),
            });
            setPopup({ kind: "task-detail", taskId });
          }}
          onToggleTaskStep={(taskId, stepIdx) => {
            const targetTask = office.tasks.find((t) => t.id === taskId);
            const step = targetTask?.steps[stepIdx];
            officeDataSource.dispatch({
              type: "task.toggleStep",
              taskId,
              stepIndex: stepIdx,
              event: createEvent(targetTask?.ownerId ?? "planner", "file", `更新步驟：${step?.label ?? ""}`, `任務「${targetTask?.title ?? ""}」步驟狀態已切換。`),
            });
          }}
          onRunBrainstorm={async (topic) => {
            setSelection({ kind: "meeting" });
            setThinkingAgents((prev) => ({ ...prev, planner: "🧠 主持全員會議中…" }));
            const res = await askMeetingBrainstorm(topic);
            setThinkingAgents((prev) => {
              const next = { ...prev };
              delete next.planner;
              return next;
            });
            if (res.ok && res.meeting) {
              officeDataSource.dispatch({
                type: "meeting.update",
                meeting: res.meeting,
                event: createEvent("planner", "handoff", `完成會議腦力激盪：${topic}`, res.meeting.summary),
              });
            }
            setPopup({ kind: "team-decisions" });
          }}
          onOpenAssign={() => { setPopup(null); setModal("assign"); }}
          onOpenActionModal={(m) => { setPopup(null); setModal(m); }}
          onApprove={approveCurrent}
          onFinishTask={finishTask}
          mobile916={mobile916}
          onToggleMobile916={() => { setMobile916((v) => !v); setPopup(null); }}
          onRunOfficeRound={() => { setPopup(null); runOfficeRound(); }}
          onOpenMonitor={() => { setShowMonitor(true); setMonitorMinimized(false); setPopup(null); }}
          uiPatch={uiPatch}
          uiForm={uiForm}
          onChangeUiForm={setUiForm}
          onSubmitUiForm={() => { setPopup(null); void submitUiFormToAyan(); }}
          onResetUi={() => {
            setUiPatch(null);
            setUiForm({
              brandTitle: "無所事事辦公室",
              headline: "早安，總監",
              primaryColor: "#ee6c29",
              paperColor: "#fbfaf6",
              borderColor: "#282b2b",
              fontScale: "1.0",
              sidePanelWidth: "338",
              cardRadius: "4",
              note: "",
            });
            void resetUiEvolve();
            setPopup(null);
          }}
          newAgentForm={newAgentForm}
          onChangeNewAgentForm={setNewAgentForm}
          onSubmitCreateAgent={submitCreateAgent}
          editAgentForm={editAgentForm}
          onChangeEditAgentForm={setEditAgentForm}
          onOpenEditAgent={openEditAgent}
          onSubmitEditAgent={() => { void submitEditAgent(); }}
          onDeleteCustomAgent={(agentId) => {
            officeDataSource.dispatch({
              type: "agent.remove",
              agentId,
              event: createEvent("planner", "handoff", "移除自訂角色", `已將角色 ${agentId} 移出辦公室。`),
            });
            void deleteCustomAgentApi(agentId);
            setSelection({ kind: "agent", id: "planner" });
            setPopup(null);
          }}
          onUpdateAgentAvatar={(agentId, newAvatar) => {
            const target = office.agents.find((a) => a.id === agentId);
            officeDataSource.dispatch({
              type: "agent.avatar",
              agentId,
              avatar: newAvatar,
              event: createEvent(agentId, "file", `${target?.name ?? "同事"} 更換了新頭像`, "已更新角色個人頭像設定。"),
            });
            void saveAvatarOverrideApi(agentId, newAvatar);
            if (target) {
              void saveAgentProfileApi({ ...target, avatar: newAvatar }, { avatar: newAvatar });
            }
            setPopup({ kind: "agent-status", agentId });
          }}
          skillsMap={skillsMap}
          onSelectSkillAgent={(agentId) => {
            setPopup({ kind: "skill-viewer", agentId });
            setPopupInput(skillsMap[agentId]?.content ?? "");
          }}
          onSaveSkillMarkdown={async (agentId, mdContent) => {
            const ag = office.agents.find((a) => a.id === agentId) ?? office.agents[0];
            const extracted = extractProfileFromSkillMarkdown(mdContent);
            const patch: Partial<Agent> = {
              ...(extracted.name ? { name: extracted.name } : {}),
              ...(extracted.role ? { role: extracted.role } : {}),
              ...(extracted.department ? { department: extracted.department } : {}),
              ...(extracted.positioning ? { positioning: extracted.positioning } : {}),
              ...(extracted.specialty ? { specialty: extracted.specialty } : {}),
              ...(extracted.personality ? { personality: extracted.personality } : {}),
            };
            if (Object.keys(patch).length > 0) {
              officeDataSource.dispatch({
                type: "agent.updateProfile",
                agentId: ag.id,
                patch,
                event: createEvent(
                  ag.id,
                  "file",
                  `從 SKILL.md 同步更新角色資訊：${patch.name ?? ag.name}（${patch.role ?? ag.role}）`,
                  patch.specialty ?? "",
                ),
              });
              setThoughts((prev) =>
                prev.map((t) =>
                  t.agentId === ag.id
                    ? {
                        ...t,
                        agentName: patch.name ?? t.agentName,
                        role: patch.role ?? t.role,
                      }
                    : t,
                ),
              );
              await saveAgentProfileApi({ ...ag, ...patch }, patch);
            }
            const saved = await saveColleagueSkillApi(
              ag.id,
              patch.name ?? ag.name,
              patch.role ?? ag.role,
              mdContent,
            );
            if (saved) {
              setSkillsMap((prev) => ({ ...prev, [ag.id]: saved }));
              addEvent(ag.id, "file", `已更新 ${patch.name ?? ag.name} 的 SKILL.md`, saved.paths[0] ?? "");
            }
            setPopup({ kind: "agent-status", agentId: ag.id });
          }}
          hrRosterMd={hrRosterMd}
          onChangeHrRosterMd={setHrRosterMd}
          onSaveHrRosterMd={async (mdContent) => {
            setHrRosterMd(mdContent);
            const profiles = await saveHrRosterMarkdownApi(mdContent);
            if (Object.keys(profiles).length) {
              officeDataSource.dispatch({ type: "agent.hydrateProfiles", profiles });
              addEvent(
                "planner",
                "file",
                `已根據 HR 檔案館文本同步更新 ${Object.keys(profiles).length} 位同事基礎資料`,
                "所有同事的名稱、職能、定位、頭像、核心專長與個性背景已完成同步。",
              );
            }
            const refreshedSkills = await fetchColleagueSkills();
            setSkillsMap(refreshedSkills);
          }}
          browserApiKey={browserApiKey}
          onSaveBrowserApiKey={(key) => {
            setBrowserApiKey(key);
            setBrowserApiKeyState(key.trim());
            addEvent("planner", "file", key.trim() ? "已儲存瀏覽器端 Gemini API Key" : "已清除瀏覽器端 Gemini API Key", "GitHub Pages 純前端模式可直接使用此金鑰呼叫 Gemini。");
            setPopup(null);
          }}
        />
      )}
      </div>
    </div>
  );
}

function getDynamicBubble(
  agent: Agent,
  office: OfficeState,
  thinkingStage?: string,
  cycle: number = 0
): string {
  if (thinkingStage) return thinkingStage;
  const runningTool = agent.tools?.find((t) => t.kind === "running");
  if (runningTool) {
    return `⚡ 正在執行 ${runningTool.name}`;
  }

  // 1. 會議室互相對話與討論內容
  if (agent.zoneId === "meeting") {
    const attendees = office.agents.filter((a) => a.zoneId === "meeting");
    const myIdx = Math.max(0, attendees.findIndex((a) => a.id === agent.id));
    const turn = (cycle + myIdx) % 4;
    if (agent.id === "planner") {
      const turns = [
        "這版 MVP 先抓最核心流程！",
        "大家先把本週產出標準定下來！",
        "對齊一下，首版活動流要包含卡關原因。",
        "排定優先級：工作區與任務牆為 P0！",
      ];
      return turns[turn];
    }
    if (agent.id === "analyst") {
      const turns = [
        "18% 使用者要求看到卡關原因！",
        "數據顯示目前指標有 3 項健康。",
        "漏斗分析顯示此流程最為關鍵。",
        "我建議第一版先聚焦異常與交接事件。",
      ];
      return turns[turn];
    }
    if (agent.id === "engineer") {
      const turns = [
        "工程底層已支援雙模式，隨時可切！",
        "先跑一次端到端測試，確認零報錯。",
        "01 看板橫幅排版已重構完成！",
        "響應式斷點與手機排版已優化完成。",
      ];
      return turns[turn];
    }
    if (agent.id === "researcher") {
      const turns = [
        "UX 訪談顯示卡關時需要明確引導。",
        "視覺階層要乾淨，不要資訊過載。",
        "字體與 WCAG 對比度已調到最佳。",
        "RPG 紙質手繪質感大家覺得如何？",
      ];
      return turns[turn];
    }
    if (agent.id === "virgo") {
      const turns = [
        "驗收標準不能打折，授權規範要過！",
        "附件缺少授權說明的不能放行！",
        "細節零容忍，上線前 Checklist 逐項驗收中。",
        "檢查 RWD 邊界條件與極端情境。",
      ];
      return turns[turn];
    }
    if (agent.id.includes("1794277128232") || agent.name.includes("東東")) {
      const turns = [
        "汪！會議室好熱鬧，我也來聽聽！",
        "大家討論得好認真，加油～🐾",
        "東東提議：開完會大家一起去散步！",
        "開會辛苦了！東東給大家打打氣～",
      ];
      return turns[turn];
    }
    if (agent.id === "momo" || agent.role.includes("吉祥物")) {
      const turns = [
        "汪！大家深呼吸～開會不要太嚴肅喔！",
        "來點心靈療癒，喝口水再繼續～",
        "麻糬覺得這版好讚！汪汪～",
        "深呼吸～大家休息一下喝杯水！",
      ];
      return turns[turn];
    }
    const defaultTurns = [
      `針對會議議題提供專業意見：${agent.specialty ? agent.specialty.slice(0, 12) + "..." : agent.role}`,
      "認同大家的討論方向，全力配合！",
      `從${agent.role}角度評估可行性中`,
      "會議記錄與後續行動方案對齊中",
    ];
    return defaultTurns[turn];
  }

  // 2. 東東 (Dongdong)：去散步、巡邏、探班
  if (agent.id.includes("1794277128232") || agent.name.includes("東東")) {
    if (agent.zoneId === "lounge" || agent.zoneId === "rest" || agent.status === "idle") {
      const walks = [
        "🐕 東東在辦公室到處散步巡邏～",
        "散步中！來看看大家在忙什麼🐾",
        "剛剛繞了辦公室一圈，氣氛超棒！",
        "找米米跟麻糬玩耍中～",
        "巡邏到沙發區，伸個懶腰🐾",
        "去耍廢室散個步充電一下！",
      ];
      return walks[cycle % walks.length];
    }
    if (agent.zoneId === "work") {
      const workDialogs = [
        "來工作區看阿碼寫程式～",
        "給辛苦工作的大家遞上一杯熱咖啡☕",
        "汪！工作區今天進度飛快！",
      ];
      return workDialogs[cycle % workDialogs.length];
    }
    if (agent.zoneId === "board") {
      const boardDialogs = [
        "研究一下大家在討論什麼好點子～",
        "好有趣的點子，東東也投一票！",
      ];
      return boardDialogs[cycle % boardDialogs.length];
    }
    return "🐕 東東在辦公室散步巡邏中！";
  }

  // 3. 麻糬 (Momo)
  if (agent.id === "momo") {
    if (agent.zoneId === "rest" || agent.zoneId === "lounge" || agent.status === "idle") {
      const momoRest = [
        "汪！窩在沙發旁喝水待命",
        "觀察大家有沒有太累～🐾",
        "需要我搖尾巴打氣嗎？",
        "隨時待命，準備破冰！",
      ];
      return momoRest[cycle % momoRest.length];
    }
  }

  // 4. 阿碼 (Ama)
  if (agent.id === "engineer") {
    if (agent.zoneId === "work") {
      const amaWork = [
        "01 看板全寬橫幅排版中...",
        "檢查 RWD 響應式斷點與手機適配",
        "優化純前端無伺服器雙模式串接",
        "端到端無白屏保護機制測試中",
      ];
      return amaWork[cycle % amaWork.length];
    }
    if (agent.zoneId === "board") {
      return "這個技術選型很可行，架構已對齊！";
    }
    if (agent.zoneId === "rest" || agent.zoneId === "lounge") {
      return "喝口黑咖啡，待會繼續寫代碼☕";
    }
  }

  // 5. 阿研 (Ayan)
  if (agent.id === "researcher") {
    if (agent.zoneId === "work") {
      const ayanWork = [
        "研究使用者動線中...",
        "調校 RPG 紙質手繪質感",
        "字體與 WCAG 對比度檢查完成",
        "競品 UX 交互拆解中",
      ];
      return ayanWork[cycle % ayanWork.length];
    }
    if (agent.zoneId === "board") {
      return "這個版面配色感覺更舒服！";
    }
    if (agent.zoneId === "rest" || agent.zoneId === "lounge") {
      return "翻閱前沿設計雜誌充電中📖";
    }
  }

  // 6. 小橘 (Xiaoju)
  if (agent.id === "planner") {
    if (agent.zoneId === "board") {
      const xiaojuBoard = [
        "先對齊目標！",
        "正在規劃下一個衝刺里程碑",
        "梳理 P0/P1/P2 任務優先級",
        "把總監願景拆解為可執行的 MVP",
      ];
      return xiaojuBoard[cycle % xiaojuBoard.length];
    }
    if (agent.zoneId === "work") {
      return "整理訪談筆記與功能清單中📝";
    }
  }

  // 7. 小處 (Xiaochu)
  if (agent.id === "virgo") {
    const virgoThoughts = [
      "放大鏡準備好了，細節零容忍",
      "請檢視 brand-colors.pdf 規範",
      "驗收標準不能打折，授權規範要過",
      "逐項審核 Checklist 中，零漏洞！",
    ];
    return virgoThoughts[cycle % virgoThoughts.length];
  }

  // 8. 數據 (Shuju)
  if (agent.id === "analyst") {
    const analystThoughts = [
      "樣本信賴區間 95%，數據穩健",
      "分析停留時間與點擊漏斗中",
      "18% 使用者希望看到卡關原因",
      "量化指標持續監控中📊",
    ];
    return analystThoughts[cycle % analystThoughts.length];
  }

  return agent.bubble || "專注思考中…";
}

interface OfficeSceneProps {
  office: OfficeState;
  selectedAgentId?: string;
  thinkingAgents: Record<string, string>;
  onSelectAgent: (id: string) => void;
  onOpenAgentChat: (id: string) => void;
  onSelectTask: (id: string) => void;
  onSelectZone: (zoneId: string) => void;
  onFinishTask: (taskId: string) => void;
  onOpenAssign: () => void;
  bubbleCycle: number;
}

function OfficeScene({
  office,
  selectedAgentId,
  thinkingAgents,
  onSelectAgent,
  onOpenAgentChat,
  onSelectTask,
  onSelectZone,
  onFinishTask,
  onOpenAssign,
  bubbleCycle,
}: OfficeSceneProps) {
  return (
    <div className="office-map">
      <div className="map-grid" aria-hidden="true" />
      <div className="floor-shadow" aria-hidden="true" />
      <div className="room-grid">
        {office.zones.map((zone) => {
          const agents = office.agents.filter((agent) => agent.zoneId === zone.id);
          const isTaskBanner = zone.kind === "tasks";

          return (
            <section
              key={zone.id}
              className={`zone-card zone-${zone.id} zone-${zone.kind} ${isTaskBanner ? "zone-tasks-banner" : ""} zone-interactive`}
              style={
                isTaskBanner
                  ? { gridColumn: "1 / -1", gridRow: 1 }
                  : { gridColumn: zone.position.column, gridRow: zone.position.row }
              }
              onClick={() => {
                if (!isTaskBanner) onSelectZone(zone.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !isTaskBanner) onSelectZone(zone.id);
              }}
              role={isTaskBanner ? "region" : "button"}
              tabIndex={isTaskBanner ? -1 : 0}
              aria-label={isTaskBanner ? "全域任務目標公告看板" : `點擊查看${zone.name}詳情與調度`}
            >
              <div className="zone-head">
                <div className="zone-label">
                  <span className="zone-marker">{zone.marker}</span>
                  <h2>{zone.name}</h2>
                  {isTaskBanner && (
                    <span className="task-wall-subtitle">
                      📢 全域任務目標公告看板 · 員工於工作區提取目標，無須進駐此區
                    </span>
                  )}
                </div>
                <div className="zone-status-icons">
                  {zone.kind === "work" && <span className="zone-live" title="工作中人數"><i /> {agents.length}</span>}
                  {zone.kind === "tasks" && (
                    <span className="task-wall-count" title="進行中任務">
                      {office.tasks.filter((task) => task.status !== "已核准" && task.status !== "已結束").length} / {office.tasks.length} ⌁
                    </span>
                  )}
                  {zone.kind !== "work" && zone.kind !== "tasks" && agents.length > 0 && (
                    <span className="zone-live" title="房內人數"><i /> {agents.length}</span>
                  )}
                  <button
                    type="button"
                    className="zone-arrow"
                    aria-label={isTaskBanner ? "派發新任務" : `開啟${zone.name}視窗`}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (isTaskBanner) {
                        onOpenAssign();
                      } else {
                        onSelectZone(zone.id);
                      }
                    }}
                  >
                    ↗
                  </button>
                </div>
              </div>

              {zone.kind === "work" && <WorkProps />}
              {zone.kind === "break" && <BreakProps />}
              {zone.kind === "board" && <BoardProps />}

              {/* 01 看板：橫幅比例等於頁面寬度，含結束任務功能 */}
              {zone.kind === "tasks" && (
                <div className="task-wall-banner-body">
                  <div className="task-wall-cards-grid">
                    {office.tasks.map((task) => {
                      const owner = office.agents.find((agent) => agent.id === task.ownerId);
                      const isEnded = task.status === "已結束" || task.status === "已核准";
                      return (
                        <div
                          key={task.id}
                          className={`task-wall-banner-card ${isEnded ? "task-ended" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectTask(task.id);
                          }}
                          role="button"
                          tabIndex={0}
                          title="點擊查看任務步驟與詳情"
                        >
                          <div className="tw-card-top">
                            <div className="tw-card-title-group">
                              <span className={`task-priority ${task.status === "需修改" ? "priority-warn" : ""}`} />
                              <h3 className="tw-card-title">{task.title}</h3>
                            </div>
                            <span className={`task-status-pill status-${task.status}`}>{task.status}</span>
                          </div>
                          <p className="tw-card-goal">{task.goal}</p>
                          <div className="tw-card-bottom">
                            <div className="tw-card-owner">
                              {owner ? (
                                <>
                                  <AvatarView avatar={owner.avatar} role={owner.role} />
                                  <span>{owner.name}</span>
                                </>
                              ) : <span>待指派</span>}
                              <span className="tw-card-due">· {task.due}</span>
                            </div>
                            <div className="tw-card-actions">
                              {!isEnded ? (
                                <button
                                  type="button"
                                  className="tw-finish-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onFinishTask(task.id);
                                  }}
                                  title="結束此任務並讓負責人結案待命"
                                >
                                  🏁 結束任務
                                </button>
                              ) : (
                                <span className="tw-ended-label">✓ 已結束</span>
                              )}
                              <span className="tw-progress-badge">{task.progress}%</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="task-banner-footer-actions">
                    <button
                      type="button"
                      className="task-banner-assign-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenAssign();
                      }}
                      title="派發新任務"
                    >
                      ＋ 派發新任務
                    </button>
                  </div>
                </div>
              )}

              {/* 任務牆不讓員工進入區域，其他區域正常渲染思考氣泡與精靈 */}
              {zone.kind !== "tasks" && agents.length > 0 && (
                <div className={`zone-agents agent-count-${Math.min(agents.length, 3)}`}>
                  {agents.map((agent, index) => {
                    const bubble = getDynamicBubble(agent, office, thinkingAgents[agent.id], bubbleCycle);
                    return (
                      <AgentSprite
                        key={agent.id}
                        agent={agent}
                        thinkingStage={thinkingAgents[agent.id]}
                        displayBubble={bubble}
                        selected={selectedAgentId === agent.id}
                        onClick={() => onSelectAgent(agent.id)}
                        onDoubleClick={() => onOpenAgentChat(agent.id)}
                        delay={index * 0.13}
                      />
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function AgentSprite({
  agent,
  thinkingStage,
  selected,
  onClick,
  onDoubleClick,
  delay = 0,
  displayBubble,
}: {
  agent: Agent;
  thinkingStage?: string;
  selected: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  delay?: number;
  displayBubble: string;
}) {
  const isThinking = Boolean(thinkingStage) || agent.status === "thinking";
  const dialogueText = displayBubble;
  const isLongDialogue = dialogueText.length > 14;
  return (
    <button
      type="button"
      className={`agent-sprite agent-state-${agent.status} ${selected ? "agent-selected" : ""} ${agent.status === "idle" ? "agent-resting" : ""} ${isThinking ? "agent-thinking-active" : ""}`}
      onClick={(event) => { event.stopPropagation(); onClick(); }}
      onDoubleClick={(event) => { event.stopPropagation(); onDoubleClick?.(); }}
      style={{ animationDelay: `${delay}s` }}
      aria-label={`查看${agent.name}，${agent.role}，${statusNames[agent.status]}`}
      title="單擊查看面板 · 雙擊開啟對話視窗"
    >
      <span className={`speech-bubble ${isThinking ? "speech-bubble-thinking" : ""} ${isLongDialogue ? "speech-bubble-expanded" : ""}`}>
        {thinkingStage ? (
          <>
            {thinkingStage}
            <i className="thinking-dots"><b>.</b><b>.</b><b>.</b></i>
          </>
        ) : dialogueText}
      </span>
      <span className="sprite-figure">
        <span className="sprite-shadow" />
        <span className={`sprite-avatar ${agent.role.includes("吉祥物") ? "mascot-avatar" : ""}`}>
          <AvatarView avatar={agent.avatar} role={agent.role} />
          {isThinking && <i className="sprite-halo-ring" />}
        </span>
        <span className="sprite-status-dot" title={statusNames[agent.status]} />
      </span>
      <span className="sprite-name">{agent.name}</span>
      <span className="sprite-role">{agent.role}</span>
    </button>
  );
}

function WorkProps() {
  return (
    <div className="work-props" aria-hidden="true">
      <div className="desk desk-one"><span className="monitor" /><span className="chair" /></div>
      <div className="desk desk-two"><span className="monitor" /><span className="chair" /></div>
      <div className="plant"><i /><i /><i /><b /></div>
    </div>
  );
}

function BreakProps() {
  return (
    <div className="break-props" aria-hidden="true">
      <div className="coffee-table"><i>☕</i></div>
      <div className="sofa"><span /><span /></div>
      <div className="beanbag" />
      <div className="floor-lamp"><i /></div>
      <div className="tiny-plant"><i /><i /><b /></div>
    </div>
  );
}

function BoardProps() {
  return (
    <div className="board-props" aria-hidden="true">
      <div className="idea-board"><span className="sticky sticky-peach" /><span className="sticky sticky-blue" /><span className="sticky sticky-yellow" /><i>✳</i></div>
      <div className="board-pencil" />
    </div>
  );
}

function AgentPanel({
  agent,
  task,
  officeZones,
  thinkingStage,
  latestThought,
  onSelectTask,
  onAction,
  onApprove,
  onFinishTask,
  onMoveZone,
  onOpenStatusPopup,
  onOpenChat,
  onOpenAvatarPicker,
  onOpenEditProfile,
  skillInfo,
  onOpenSkill,
}: {
  agent: Agent;
  task: OfficeTask;
  officeZones?: Zone[];
  thinkingStage?: string;
  latestThought?: ThoughtRecord;
  onSelectTask: () => void;
  onStatus?: (status: AgentStatus) => void;
  onAction: (action: "assign" | "context" | "revision") => void;
  onApprove?: () => void;
  onFinishTask?: (taskId: string) => void;
  onMoveZone?: (zoneId: string) => void;
  onOpenStatusPopup: () => void;
  onOpenChat: () => void;
  onOpenTools?: () => void;
  onOpenOutput?: () => void;
  onOpenAvatarPicker: () => void;
  onOpenEditProfile: () => void;
  skillInfo?: ColleagueSkillInfo;
  onOpenSkill: () => void;
}) {
  const currentZone = officeZones?.find((z) => z.id === agent.zoneId);
  return (
    <div className="panel-content streamlined-agent-panel">
      {/* 200px 巨幅相框簡歷舞台 */}
      <div className="hero-resume-stage">
        <button
          type="button"
          className={`hero-resume-avatar person-avatar-clickable ${agent.role.includes("吉祥物") ? "person-mascot" : ""}`}
          onClick={onOpenAvatarPicker}
          title="點擊更換頭像 (200px 巨幅相框)"
        >
          <span className="hero-resume-frame-tag">RESUME</span>
          <span className="hero-avatar-clip-box">
            <AvatarView avatar={agent.avatar} role={agent.role} />
          </span>
          <i className={`hero-online-dot ${agent.status === "idle" ? "online-idle" : ""}`} />
        </button>

        <div className="hero-identity-block">
          <div className="hero-name-row">
            <h2 className="hero-agent-name">
              {agent.name}
              <button
                type="button"
                className="hero-status-popup-btn"
                onClick={onOpenStatusPopup}
                title="點擊彈出同事詳細檔案通知視窗"
              >
                <span>↗</span>
              </button>
            </h2>
            <span className={`status-pill ${statusClasses[agent.status]}`}>
              <i />{thinkingStage ? "推論中" : statusNames[agent.status]}
            </span>
          </div>

          <div className="hero-dept-role">
            {agent.department ? `${agent.department} · ` : ""}{agent.role}
          </div>

          {currentZone && (
            <div className="panel-location-badge">
              📍 {currentZone.name} · {statusNames[agent.status]}
            </div>
          )}

          <div className="hero-bubble-quote" title={latestThought?.thought ? `思考脈絡：${latestThought.thought}` : agent.bubble}>
            <span className="hero-bubble-icon">{thinkingStage ? "💭" : latestThought?.thought ? "🧠" : "💬"}</span>
            <span className="hero-bubble-text">
              {thinkingStage ? thinkingStage : latestThought?.thought ? latestThought.thought : agent.bubble}
            </span>
          </div>
        </div>
      </div>

      {/* 4 大即時核心指揮按鈕（必要按鈕） */}
      <div className="agent-quick-command-bar">
        <button type="button" className="agent-cmd-btn cmd-chat" onClick={onOpenChat} title="與該同事發起對話探班">
          💬 對話探班
        </button>
        <button type="button" className="agent-cmd-btn" onClick={() => onAction("assign")} title="交辦新任務">
          ⚡ 指派任務
        </button>
        <button type="button" className="agent-cmd-btn" onClick={() => onMoveZone?.("meeting")} title="召集至 04 會議室">
          📢 叫去開會
        </button>
        <button type="button" className="agent-cmd-btn" onClick={() => onMoveZone?.(agent.status === "idle" ? "work" : "rest")} title="調度至休息區或喚醒工作">
          ☕ {agent.status === "idle" ? "叫去工作" : "請去休息"}
        </button>
      </div>

      {/* 當前任務進度與結束任務（必要按鈕） */}
      {task && (
        <div className="hero-task-strip" onClick={onSelectTask} role="button" tabIndex={0}>
          <div className="hero-task-strip-head">
            <span className="hero-task-tag">⌁ 當前任務</span>
            <span className="hero-task-title" title={task.title}>{task.title}</span>
            <span className="hero-task-pct">{agent.progress}%</span>
          </div>
          <ProgressBar value={agent.progress} />
          {task.status !== "已核准" && task.status !== "已結束" && onFinishTask && (
            <div className="hero-task-actions">
              <button
                type="button"
                className="tw-finish-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onFinishTask(task.id);
                }}
                title="結束目前任務"
              >
                🏁 結束任務
              </button>
              <button
                type="button"
                className="secondary-task-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectTask();
                }}
              >
                查看步驟 ↗
              </button>
            </div>
          )}
        </div>
      )}

      {/* 簡化實用操作（必要按鈕） */}
      <div className="hero-utility-actions">
        <button type="button" className="hero-util-btn" onClick={onOpenEditProfile}>
          <span>✎</span> 編輯資訊
        </button>
        <button type="button" className="hero-util-btn" onClick={onOpenAvatarPicker}>
          <span>🖼️</span> 更換頭像
        </button>
        <button type="button" className="hero-util-btn" onClick={onOpenSkill} title={skillInfo?.skillName ?? "SKILL.md"}>
          <span>📘</span> 技能規範
        </button>
        {onApprove && (
          <button type="button" className="hero-util-btn hero-util-approve" onClick={onApprove} title="核准結案">
            <span>✓</span> 核准結案
          </button>
        )}
      </div>
    </div>
  );
}

function TaskPanel({
  task,
  agent,
  onSelectAgent,
  onToggleStep,
  onOpenAttachment,
  onAction,
  onApprove,
  onFinishTask,
}: {
  task: OfficeTask;
  agent?: Agent;
  onSelectAgent: (id: string) => void;
  onToggleStep: (stepIndex: number) => void;
  onOpenAttachment: (file?: string) => void;
  onAction: (action: "assign" | "context" | "revision") => void;
  onApprove: () => void;
  onFinishTask?: (taskId: string) => void;
}) {
  return (
    <div className="panel-content">
      <div className="task-detail-heading">
        <span className={`task-status-mark ${task.status === "需修改" ? "mark-warning" : ""}`}>
          {task.status === "待審核" ? "◷" : task.status === "已核准" || task.status === "已結束" ? "✓" : "↗"}
        </span>
        <div><span className="task-detail-eyebrow">工作項目 <i>·</i> {task.due}</span><h2>{task.title}</h2></div>
      </div>
      <div className="task-review-row">
        <span className={`review-chip review-${task.status === "已核准" || task.status === "已結束" ? "approved" : task.status === "需修改" ? "revision" : task.status === "待審核" ? "pending" : "active"}`}>
          <i />{task.status}
        </span>
        <span className="review-separator" />
        <span className="task-team">全域任務</span>
      </div>
      <PanelSection title="任務目標">
        <div className="goal-card"><span>◎</span><p>{task.goal}</p></div>
      </PanelSection>
      <PanelSection title="負責同事" action={agent ? "切換視角" : undefined} onAction={agent ? () => onSelectAgent(agent.id) : undefined}>
        <button type="button" className="assignee-card" onClick={() => agent && onSelectAgent(agent.id)}>
          <span className="assignee-avatar">{agent ? <AvatarView avatar={agent.avatar} role={agent.role} /> : "?"}</span>
          <span><strong>{agent?.name ?? "尚未指派"}</strong><small>{agent?.role ?? "待分配"}</small></span>
          {agent && <span className={`status-pill ${statusClasses[agent.status]}`}><i />{statusNames[agent.status]}</span>}
        </button>
      </PanelSection>
      <PanelSection title="執行步驟（點擊可勾選）" action={`${task.steps.filter((step) => step.done).length}/${task.steps.length} 完成`}>
        <div className="step-list">
          {task.steps.map((step, index) => (
            <button
              type="button"
              key={step.label}
              className={`step-row step-row-clickable ${step.done ? "step-done" : ""}`}
              onClick={() => onToggleStep(index)}
            >
              <span className="step-check">{step.done ? "✓" : String(index + 1).padStart(2, "0")}</span>
              <span>{step.label}</span>
            </button>
          ))}
        </div>
        <ProgressBar value={task.progress} />
        <div className="progress-caption"><span>整體完成度</span><strong>{task.progress}%</strong></div>
      </PanelSection>
      <PanelSection title="附件" action="＋ 新增附件" onAction={() => onOpenAttachment(undefined)}>
        <div className="attachment-list">
          {task.attachments.length ? task.attachments.map((file) => (
            <div className="attachment-row" key={file}>
              <span className="file-mark">▤</span>
              <span>{file}</span>
              <button type="button" aria-label={`查看 ${file}`} onClick={() => onOpenAttachment(file)}>預覽 ···</button>
            </div>
          )) : <div className="empty-attachments">尚未附加檔案（點右上「＋ 新增附件」）</div>}
        </div>
      </PanelSection>
      <PanelSection title="總監處置">
        <div className="quick-actions">
          {task.status !== "已核准" && task.status !== "已結束" && onFinishTask && (
            <button
              type="button"
              className="quick-stop"
              style={{ background: "#a35338", color: "#ffffff", borderColor: "#7d3c26" }}
              onClick={() => onFinishTask(task.id)}
              title="結束此任務並結案"
            >
              <span>🏁</span> 結束任務
            </button>
          )}
          <button type="button" onClick={() => onAction("context")}><span>＋</span> 補充資料</button>
          <button type="button" onClick={() => onAction("revision")}><span>↻</span> 要求修改</button>
          <button type="button" className="quick-approve" onClick={onApprove}><span>✓</span> 核准結案</button>
        </div>
      </PanelSection>
    </div>
  );
}

function MeetingPanel({
  office,
  onSelectAgent,
  onApprove,
  onOpenBrainstorm,
  onOpenDecisionsPopup,
}: {
  office: OfficeState;
  onSelectAgent: (id: string) => void;
  onApprove: () => void;
  onOpenBrainstorm: () => void;
  onOpenDecisionsPopup: () => void;
}) {
  return (
    <div className="panel-content meeting-panel-content">
      <div className="meeting-heading-visual">
        <span>◷</span>
        <div>
          <h2>
            <button type="button" className="person-name-popup-btn" onClick={onOpenDecisionsPopup}>
              團隊決策與同步 <span>↗</span>
            </button>
          </h2>
          <p>今天 09:30 <i>·</i> {office.agents.length} 位參與</p>
        </div>
        <button type="button" className="meeting-live-chip" onClick={onOpenDecisionsPopup} style={{ cursor: "pointer" }}>
          <i />彈出視窗 ↗
        </button>
      </div>
      <div className="meeting-attendees">
        {office.agents.map((agent) => (
          <button type="button" key={agent.id} title={`${agent.name} · ${agent.role}`} onClick={() => onSelectAgent(agent.id)}>
            <AvatarView avatar={agent.avatar} role={agent.role} />
          </button>
        ))}
        <button type="button" className="meeting-more-btn" title="召開 AI 腦力激盪" onClick={onOpenBrainstorm}>+AI</button>
      </div>
      <PanelSection title="討論摘要" action="彈出決策視窗" onAction={onOpenDecisionsPopup}>
        <div className="meeting-summary" onClick={onOpenDecisionsPopup} role="button" tabIndex={0} style={{ cursor: "pointer" }}>
          <span>✳</span><p>{office.meeting.summary}</p>
        </div>
      </PanelSection>
      <PanelSection title="主要分歧" action={`${office.meeting.disagreements.length} 個議題`} onAction={onOpenDecisionsPopup}>
        <div className="discussion-list">
          {office.meeting.disagreements.map((item, index) => <div className="discussion-item" key={item}><span className="discussion-index">0{index + 1}</span><p>{item}</p></div>)}
        </div>
      </PanelSection>
      <PanelSection title="已形成決策" action="查看詳情" onAction={onOpenDecisionsPopup}>
        <div className="decision-list">{office.meeting.decisions.map((decision) => <div className="decision-item" key={decision}><span>✓</span><p>{decision}</p></div>)}</div>
      </PanelSection>
      <PanelSection title="待人工確認">
        {office.meeting.humanConfirmations.map((item) => <div className="human-confirmation" key={item}><span>!</span><p>{item}</p></div>)}
        <button type="button" className="confirm-button" onClick={onApprove}>確認並核准相關任務 <span>→</span></button>
        <button type="button" className="confirm-button brainstorm-btn" onClick={onOpenBrainstorm}>🧠 給定新議題讓 AI 團隊重新討論 <span>→</span></button>
      </PanelSection>
    </div>
  );
}

function EmptyPanel({ onAssign }: { onAssign: () => void }) {
  return <div className="empty-panel"><span>✳</span><h2>選一位同事或任務</h2><p>點擊辦公室裡的角色或任務卡，查看目前進度、工具與下一步。</p><button className="primary-button" onClick={onAssign}>＋ 派出第一個任務</button></div>;
}

function ActivityFeed({
  events,
  agents,
  filter,
  onFilter,
  onOpenEvent,
  onOpenAll,
}: {
  events: ActivityEvent[];
  agents: Agent[];
  filter: "all" | ActivityEvent["type"];
  onFilter: (filter: "all" | ActivityEvent["type"]) => void;
  onOpenEvent: (eventId: string) => void;
  onOpenAll: () => void;
}) {
  const filters: { id: "all" | ActivityEvent["type"]; label: string }[] = [
    { id: "all", label: "--all" },
    { id: "tool", label: "--tool" },
    { id: "file", label: "--file" },
    { id: "message", label: "--msg" },
    { id: "error", label: "--warn" },
    { id: "handoff", label: "--sync" },
  ];
  const typeShortCode: Record<ActivityEvent["type"], string> = {
    tool: "TOOL",
    file: "FILE",
    message: "MSG ",
    error: "WARN",
    handoff: "SYNC",
  };
  return (
    <section className="activity-feed terminal-activity-feed" aria-label="背景終端機活動流">
      <div className="feed-heading terminal-feed-bar">
        <div className="feed-title terminal-prompt-title" onClick={onOpenAll} role="button" tabIndex={0}>
          <span className="terminal-dots" aria-hidden="true"><i className="tdot-r" /><i className="tdot-y" /><i className="tdot-g" /></span>
          <h2>&gt;_ office.activity.log</h2>
        </div>
        <div className="feed-filters terminal-filters" role="group" aria-label="終端機篩選參數">
          {filters.map((item) => (
            <button
              type="button"
              key={item.id}
              className={filter === item.id ? "filter-active" : ""}
              onClick={() => onFilter(item.id)}
            >
              {item.label}
              {item.id === "error" && events.some((event) => event.type === "error") && <i />}
            </button>
          ))}
        </div>
        <button type="button" className="feed-expand terminal-expand-btn" onClick={onOpenAll}>
          [展開完整日誌 ({events.length}) ↗]
        </button>
      </div>
      <div className="feed-events terminal-log-lines">
        {events.length ? events.slice(0, 5).map((event) => {
          const agent = agents.find((item) => item.id === event.agentId);
          return (
            <button
              type="button"
              className={`feed-event terminal-log-row event-${event.type} feed-event-clickable`}
              key={event.id}
              onClick={() => onOpenEvent(event.id)}
              title="點擊開啟通知視窗做詳細閱讀"
            >
              <time className="term-time">[{event.time}]</time>
              <span className={`term-badge term-badge-${event.type}`}>{typeShortCode[event.type]}</span>
              <span className="term-agent">@{agent?.name ?? "system"}</span>
              <span className="term-cmd">$ {event.summary}</span>
              <span className="term-hint">// 點擊詳情 ↗</span>
            </button>
          );
        }) : <div className="feed-empty terminal-empty">&gt;_ no matching activity records found.</div>}
      </div>
    </section>
  );
}

/* ============================================================================
 * Requirement #4: Real-time AI Thought & Operation Monitor Window (HUD)
 * ========================================================================== */
function ThoughtMonitorWindow({
  thoughts,
  thinkingAgents,
  minimized,
  onMinimize,
  onClose,
  onSelectThought,
  onRunRound,
}: {
  thoughts: ThoughtRecord[];
  thinkingAgents: Record<string, string>;
  minimized: boolean;
  onMinimize: () => void;
  onClose: () => void;
  onSelectThought: (id: string) => void;
  onRunRound: () => void;
}) {
  const runningCount = Object.keys(thinkingAgents).length;
  return (
    <aside className={`thought-monitor ${minimized ? "thought-monitor-min" : ""}`} aria-label="AI 思考狀態監控窗">
      <div className="thought-monitor-bar" onClick={onMinimize}>
        <div className="thought-monitor-title">
          <span className={`monitor-led ${runningCount ? "led-busy" : "led-ready"}`} />
          <strong>🧠 AI 思考與運作監控窗</strong>
          <span className="monitor-badge">{runningCount ? `${runningCount} 位推論中` : "IDLE · 待命"}</span>
        </div>
        <div className="thought-monitor-controls" onClick={(e) => e.stopPropagation()}>
          <button type="button" title="推進一回合" onClick={onRunRound}>⚡</button>
          <button type="button" title={minimized ? "展開" : "縮小"} onClick={onMinimize}>{minimized ? "▢" : "—"}</button>
          <button type="button" title="隱藏監控窗" onClick={onClose}>×</button>
        </div>
      </div>

      {!minimized && (
        <div className="thought-monitor-body">
          <div className="thought-stage-pipeline">
            <span className={runningCount ? "stage-on" : ""}>01 拆解指令</span>
            <i>→</i>
            <span className={runningCount ? "stage-on" : ""}>02 載入角色記憶</span>
            <i>→</i>
            <span className={runningCount ? "stage-on" : ""}>03 Gemini 推論</span>
            <i>→</i>
            <span>04 寫回辦公室</span>
          </div>

          <div className="thought-list">
            {thoughts.map((item) => {
              const liveSec = item.running
                ? ((Date.now() - item.startedAt) / 1000).toFixed(1)
                : ((item.elapsedMs ?? 1200) / 1000).toFixed(1);
              return (
                <button
                  type="button"
                  key={item.id}
                  className={`thought-item ${item.running ? "thought-item-running" : ""}`}
                  onClick={() => onSelectThought(item.id)}
                >
                  <div className="thought-item-top">
                    <span className="thought-who"><span className="inline-avatar"><AvatarView avatar={item.avatar} role={item.role} /></span> <strong>{item.agentName}</strong> <small>· {item.role}</small></span>
                    <span className={`thought-stage-chip ${item.running ? "chip-running" : item.stage === "發生錯誤" ? "chip-error" : ""}`}>
                      {item.running ? `⏳ ${item.stage}` : `✓ ${item.stage}`}
                    </span>
                  </div>
                  <div className="thought-prompt">指令：{item.prompt}</div>
                  <div className="thought-reasoning">💭 {item.thought}</div>
                  <div className="thought-meta">
                    <span>模型：{item.model}</span>
                    <span>耗時：{liveSec}s · 點擊展開 ↗</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}

/* ============================================================================
 * Requirement #2 & #3: Game-Style Popup Modal for Every Button & Room
 * ========================================================================== */
function GamePopupModal({
  popup,
  office,
  thoughts,
  thinkingAgents,
  selectedAgent,
  selectedTask,
  input,
  onInput,
  onClose,
  onNavigatePopup,
  onSelectAgent,
  onSelectTask,
  onToggleTaskStep,
  onOpenActionModal,
  onMoveAgent,
  onRunAgent,
  onAddAttachment,
  onRunBrainstorm,
  onOpenAssign,
  onApprove,
  onFinishTask,
  mobile916,
  onToggleMobile916,
  onRunOfficeRound,
  onOpenMonitor,
  uiPatch,
  uiForm,
  onChangeUiForm,
  onSubmitUiForm,
  onResetUi,
  newAgentForm,
  onChangeNewAgentForm,
  onSubmitCreateAgent,
  editAgentForm,
  onChangeEditAgentForm,
  onOpenEditAgent,
  onSubmitEditAgent,
  onDeleteCustomAgent,
  onUpdateAgentAvatar,
  skillsMap,
  onSelectSkillAgent,
  onSaveSkillMarkdown,
  hrRosterMd,
  onChangeHrRosterMd,
  onSaveHrRosterMd,
  browserApiKey,
  onSaveBrowserApiKey,
}: {
  popup: GamePopup;
  office: OfficeState;
  thoughts: ThoughtRecord[];
  thinkingAgents: Record<string, string>;
  selectedAgent?: Agent;
  selectedTask?: OfficeTask;
  input: string;
  onInput: (val: string) => void;
  onClose: () => void;
  onNavigatePopup: (next: GamePopup) => void;
  onSelectAgent: (id: string) => void;
  onSelectTask: (id: string) => void;
  onToggleTaskStep: (taskId: string, stepIndex: number) => void;
  onOpenActionModal: (kind: "assign" | "context" | "revision") => void;
  onMoveAgent: (agent: Agent, status: AgentStatus, zoneId?: string) => void;
  onRunAgent: (agent: Agent, prompt: string, context?: string, taskId?: string) => void;
  onAddAttachment: (taskId: string, fileName: string) => void;
  onRunBrainstorm: (topic: string) => void;
  onOpenAssign: () => void;
  onApprove: () => void;
  onFinishTask: (taskId: string) => void;
  mobile916: boolean;
  onToggleMobile916: () => void;
  onRunOfficeRound: () => void;
  onOpenMonitor: () => void;
  uiPatch: UiEvolutionPatch | null;
  uiForm: {
    brandTitle: string;
    headline: string;
    primaryColor: string;
    paperColor: string;
    borderColor: string;
    fontScale: string;
    sidePanelWidth: string;
    cardRadius: string;
    note: string;
  };
  onChangeUiForm: (next: {
    brandTitle: string;
    headline: string;
    primaryColor: string;
    paperColor: string;
    borderColor: string;
    fontScale: string;
    sidePanelWidth: string;
    cardRadius: string;
    note: string;
  }) => void;
  onSubmitUiForm: () => void;
  onResetUi: () => void;
  newAgentForm: {
    name: string;
    department: string;
    role: string;
    positioning: string;
    avatar: string;
    zoneId: string;
    status: AgentStatus;
    bubble: string;
    specialty: string;
    personality: string;
    initialTask: string;
  };
  onChangeNewAgentForm: (next: {
    name: string;
    department: string;
    role: string;
    positioning: string;
    avatar: string;
    zoneId: string;
    status: AgentStatus;
    bubble: string;
    specialty: string;
    personality: string;
    initialTask: string;
  }) => void;
  onSubmitCreateAgent: () => void;
  editAgentForm: {
    id: string;
    name: string;
    department: string;
    role: string;
    positioning: string;
    avatar: string;
    zoneId: string;
    status: AgentStatus;
    bubble: string;
    specialty: string;
    personality: string;
    latestOutput: string;
  };
  onChangeEditAgentForm: (next: {
    id: string;
    name: string;
    department: string;
    role: string;
    positioning: string;
    avatar: string;
    zoneId: string;
    status: AgentStatus;
    bubble: string;
    specialty: string;
    personality: string;
    latestOutput: string;
  }) => void;
  onOpenEditAgent: (agent: Agent) => void;
  onSubmitEditAgent: () => void;
  onDeleteCustomAgent: (agentId: string) => void;
  onUpdateAgentAvatar: (agentId: string, newAvatar: string) => void;
  skillsMap: Record<string, ColleagueSkillInfo>;
  onSelectSkillAgent: (agentId: string) => void;
  onSaveSkillMarkdown: (agentId: string, mdContent: string) => void;
  hrRosterMd: string;
  onChangeHrRosterMd: (val: string) => void;
  onSaveHrRosterMd: (mdContent: string) => void;
  browserApiKey: string;
  onSaveBrowserApiKey: (key: string) => void;
}) {
  const renderBody = () => {
    switch (popup.kind) {
      case "toolbar-menu": {
        const currentAgent = selectedAgent ?? office.agents[0];
        return (
          <>
            <h2>☰ 辦公室控制工具列（跳出式選單）</h2>
            <div className="toolbar-menu-grid">
              <button
                type="button"
                className={`toolbar-menu-card ${office.mode === "demo" ? "mode-card-demo" : "mode-card-work"}`}
                onClick={() => {
                  officeDataSource.dispatch({
                    type: "workspace.setMode",
                    mode: office.mode === "demo" ? "work" : "demo",
                  });
                  onClose();
                }}
              >
                <span className="toolbar-menu-icon">{office.mode === "demo" ? "🎪" : "💼"}</span>
                <strong>{office.mode === "demo" ? "🎪 展示模式（點擊切回作業）" : "💼 作業模式（點擊切至展示沙盒）"}</strong>
                <small>{office.mode === "demo" ? "目前為沙盒環境，點此滿血返回您的日常作業" : "日常已自動存檔，點此切換為借人試玩沙盒"}</small>
              </button>

              <button
                type="button"
                className="toolbar-menu-card"
                onClick={() => onNavigatePopup({ kind: "agent-status", agentId: currentAgent.id })}
              >
                <span className="toolbar-menu-icon">👤</span>
                <strong>同事狀態視窗</strong>
                <small>檢視 {currentAgent.name} 的個人檔案與即時產出</small>
              </button>

              <button
                type="button"
                className="toolbar-menu-card"
                onClick={() => onNavigatePopup({ kind: "team-decisions" })}
              >
                <span className="toolbar-menu-icon">📋</span>
                <strong>團隊決策視窗</strong>
                <small>檢視跨部門共識、分歧與待核准項目</small>
              </button>

              <button
                type="button"
                className="toolbar-menu-card"
                onClick={() => onNavigatePopup({ kind: "hr-roster" })}
              >
                <span className="toolbar-menu-icon">🪪</span>
                <strong>HR 人事檔案館</strong>
                <small>全體同事 6 大個人欄位與 HR Docs 管理</small>
              </button>

              <button
                type="button"
                className="toolbar-menu-card"
                onClick={() => onOpenEditAgent(currentAgent)}
              >
                <span className="toolbar-menu-icon">✎</span>
                <strong>角色個人設定</strong>
                <small>修改名稱、職能、定位、頭像、專長與個性</small>
              </button>

              <button
                type="button"
                className="toolbar-menu-card"
                onClick={() => onNavigatePopup({ kind: "agent-create" })}
              >
                <span className="toolbar-menu-icon">🧑🏻‍🎨</span>
                <strong>招募新 AI 同事</strong>
                <small>新增自訂角色並自動建立專屬 SKILL.md</small>
              </button>

              <button
                type="button"
                className="toolbar-menu-card"
                onClick={() => onSelectSkillAgent(currentAgent.id)}
              >
                <span className="toolbar-menu-icon">📘</span>
                <strong>Skills 技能包 ({Object.keys(skillsMap).length || office.agents.length})</strong>
                <small>檢視、編輯與下載全體同事 SKILL.md</small>
              </button>

              <button
                type="button"
                className="toolbar-menu-card"
                onClick={() => onNavigatePopup({ kind: "director" })}
              >
                <span className="toolbar-menu-icon">🎮</span>
                <strong>總監指令台</strong>
                <small>全體同事快速調度與廣播指令</small>
              </button>

              <button
                type="button"
                className="toolbar-menu-card"
                onClick={() => onNavigatePopup({ kind: "ui-studio" })}
              >
                <span className="toolbar-menu-icon">🎨</span>
                <strong>改介面 Studio</strong>
                <small>調整配色、字級、圓角與版面寬度</small>
              </button>

              <button
                type="button"
                className="toolbar-menu-card"
                onClick={() => onNavigatePopup({ kind: "attachment", taskId: "prototype", file: "brand-colors.pdf" })}
              >
                <span className="toolbar-menu-icon">📑</span>
                <strong>brand-colors.pdf 視覺規範</strong>
                <small>完整色票系統、WCAG 對比度與品牌授權書</small>
              </button>

              <button
                type="button"
                className="toolbar-menu-card"
                onClick={() => {
                  onInput(browserApiKey);
                  onNavigatePopup({ kind: "api-key" });
                }}
              >
                <span className="toolbar-menu-icon">🔑</span>
                <strong>{browserApiKey ? "金鑰已設定" : "設定 Gemini 金鑰"}</strong>
                <small>管理瀏覽器端 Gemini API Key</small>
              </button>

              <button
                type="button"
                className="toolbar-menu-card"
                onClick={() => {
                  onToggleMobile916();
                  onClose();
                }}
              >
                <span className="toolbar-menu-icon">{mobile916 ? "🖥️" : "📱"}</span>
                <strong>切換為{mobile916 ? "桌機版面" : "手機 9:16"}</strong>
                <small>目前：{mobile916 ? "9:16 直立手機視窗" : "寬螢幕桌機視窗"}</small>
              </button>

              <button
                type="button"
                className="toolbar-menu-card"
                onClick={() => {
                  onOpenMonitor();
                  onClose();
                }}
              >
                <span className="toolbar-menu-icon">🧠</span>
                <strong>AI 思考監控窗 ({thoughts.length})</strong>
                <small>開啟即時推論階段與耗時 HUD</small>
              </button>

              <button
                type="button"
                className="toolbar-menu-card"
                onClick={() => {
                  onRunOfficeRound();
                  onClose();
                }}
              >
                <span className="toolbar-menu-icon">⚡</span>
                <strong>推進辦公室回合</strong>
                <small>讓所有工作中同事同步向前推進一步</small>
              </button>
            </div>
            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={onClose}>關閉選單</button>
              <button type="button" className="primary-button" onClick={() => { onClose(); onOpenAssign(); }}>
                ＋ 立即派發新任務 <span>→</span>
              </button>
            </div>
          </>
        );
      }

      case "agent-status": {
        const agent = office.agents.find((a) => a.id === popup.agentId) ?? selectedAgent ?? office.agents[0];
        const agentTask = office.tasks.find((t) => t.id === agent.taskId) ?? selectedTask ?? office.tasks[0];
        const lastThought = thoughts.find((t) => t.agentId === agent.id);
        return (
          <>
            <div className="chat-modal-header">
              <h2 className="row-with-avatar">
                <span className="inline-avatar"><AvatarView avatar={agent.avatar} role={agent.role} /></span>
                <span>👤 同事狀態 — {agent.name}（{agent.role}）</span>
                <span className={`status-pill ${statusClasses[agent.status]}`}>
                  <i />
                  {thinkingAgents[agent.id] ?? statusNames[agent.status]}
                </span>
              </h2>
              <div className="popup-row-btns">
                <button type="button" className="secondary-top-button" onClick={() => onNavigatePopup({ kind: "hr-roster" })}>
                  🪪 HR 檔案館
                </button>
                <button type="button" className="secondary-top-button" onClick={() => onOpenEditAgent(agent)}>
                  ✎ 編輯個人資訊
                </button>
              </div>
            </div>

            <div className="zone-summon-row" style={{ marginBottom: 10 }}>
              {office.agents.map((ag) => (
                <button
                  type="button"
                  key={ag.id}
                  className={`summon-chip row-with-avatar ${ag.id === agent.id ? "avatar-cell-active" : ""}`}
                  onClick={() => onNavigatePopup({ kind: "agent-status", agentId: ag.id })}
                >
                  <span className="inline-avatar"><AvatarView avatar={ag.avatar} role={ag.role} /></span>
                  <span>{ag.name}</span>
                </button>
              ))}
            </div>

            <div className="rpg-dialogue-stage">
              <div className="rpg-speaker-portrait">
                <button
                  type="button"
                  className="rpg-speaker-avatar"
                  title="更換頭像"
                  onClick={() => {
                    onInput(agent.avatar);
                    onNavigatePopup({ kind: "avatar-picker", agentId: agent.id });
                  }}
                >
                  <span className="avatar-clip-box">
                    <AvatarView avatar={agent.avatar} role={agent.role} />
                  </span>
                </button>
                <strong>{agent.name}</strong>
                <span>{agent.department ?? agent.role}</span>
              </div>
              <div className="rpg-dialogue-bubble-adaptive">
                <div className="rpg-bubble-pill">💬 {agent.bubble}</div>
                <div className="rpg-thought-line">💭 {lastThought?.thought ?? "待命準備執行總監交辦事項"}</div>
                <div className="rpg-speech-line">{agent.latestOutput}</div>
              </div>
            </div>

            <div className="hr-profile-grid">
              <div className="hr-field-box">
                <span>職能部門</span>
                <strong>{agent.department ?? "核心專案組"}</strong>
              </div>
              <div className="hr-field-box">
                <span>專業定位</span>
                <strong>{agent.positioning ?? agent.role}</strong>
              </div>
              <div className="hr-field-box hr-field-wide">
                <span>核心專長</span>
                <strong>{agent.specialty ?? "跨職能協作與專業任務交付"}</strong>
              </div>
              <div className="hr-field-box hr-field-wide">
                <span>個性與背景</span>
                <p>{agent.personality ?? "認真負責的 AI 辦公室成員，隨時支援團隊目標。"}</p>
              </div>
            </div>

            {agentTask && (
              <div className="popup-task-box">
                <div className="popup-task-head">
                  <strong>⌁ 負責任務：{agentTask.title}</strong>
                  <span className="progress-num">{agentTask.progress}% · {agentTask.status}</span>
                </div>
                <ProgressBar value={agentTask.progress} />
                <div className="step-list" style={{ marginTop: 8 }}>
                  {agentTask.steps.map((step, idx) => (
                    <button
                      type="button"
                      key={step.label}
                      className={`step-row step-row-btn ${step.done ? "step-done" : ""}`}
                      onClick={() => onToggleTaskStep(agentTask.id, idx)}
                    >
                      <span className="step-check">{step.done ? "✓" : ""}</span>
                      <span>{step.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={onClose}>關閉</button>
              <button type="button" className="secondary-top-button" onClick={() => onSelectSkillAgent(agent.id)}>
                📘 SKILL.md
              </button>
              <button
                type="button"
                className="secondary-top-button"
                onClick={() => {
                  onInput("");
                  onNavigatePopup({ kind: "agent-chat", agentId: agent.id });
                }}
              >
                💬 對話視窗
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => onRunAgent(agent, `請針對你目前的任務「${agentTask?.title ?? "當前工作"}」進行下一步推論並給出具體結論。`, agentTask?.goal, agentTask?.id)}
              >
                🧠 讓 {agent.name} 立即思考 <span>→</span>
              </button>
            </div>
          </>
        );
      }

      case "team-decisions": {
        const attendees = office.agents;
        return (
          <>
            <div className="chat-modal-header">
              <h2>📋 團隊決策與跨部門共識視窗</h2>
              <span className="status-icon-badge"><i className="live-dot" /> {attendees.length} 位與會</span>
            </div>

            <div className="attendee-row" style={{ marginBottom: 10 }}>
              {attendees.map((agent) => (
                <button
                  type="button"
                  key={agent.id}
                  className="attendee-chip attendee-chip-btn"
                  onClick={() => onNavigatePopup({ kind: "agent-status", agentId: agent.id })}
                >
                  <span className="inline-avatar"><AvatarView avatar={agent.avatar} role={agent.role} /></span>
                  <span>{agent.name} · {agent.role}</span>
                </button>
              ))}
            </div>

            <div className="decision-popup-grid">
              <div className="decision-card">
                <div className="decision-card-head">
                  <strong>💬 討論摘要</strong>
                  <button
                    type="button"
                    className="mini-link-btn"
                    onClick={() => {
                      onInput("");
                      onNavigatePopup({ kind: "meeting-brainstorm" });
                    }}
                  >
                    重新召開 ↗
                  </button>
                </div>
                <p>{office.meeting.summary}</p>
              </div>

              <div className="decision-card decision-card-warn">
                <div className="decision-card-head">
                  <strong>⚡ 主要分歧</strong>
                </div>
                {office.meeting.disagreements.map((item) => (
                  <p key={item}>• {item}</p>
                ))}
              </div>

              <div className="decision-card decision-card-ok">
                <div className="decision-card-head">
                  <strong>✓ 已形成決策</strong>
                </div>
                {office.meeting.decisions.map((item) => (
                  <p key={item}>✓ {item}</p>
                ))}
              </div>

              <div className="decision-card decision-card-pending">
                <div className="decision-card-head">
                  <strong>⏳ 待總監確認</strong>
                </div>
                {office.meeting.humanConfirmations.map((item) => (
                  <p key={item}>! {item}</p>
                ))}
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={onClose}>關閉</button>
              <button
                type="button"
                className="secondary-top-button"
                onClick={() => {
                  onInput("");
                  onNavigatePopup({ kind: "meeting-brainstorm" });
                }}
              >
                🧠 召開新腦力激盪
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  onApprove();
                  onClose();
                }}
              >
                ✓ 核准決策並繼續推進 <span>→</span>
              </button>
            </div>
          </>
        );
      }

      case "task-detail": {
        const task = office.tasks.find((t) => t.id === popup.taskId) ?? selectedTask ?? office.tasks[0];
        const owner = office.agents.find((a) => a.id === task.ownerId) ?? office.agents[0];
        return (
          <>
            <div className="chat-modal-header">
              <h2>⌁ 任務詳情 — {task.title}</h2>
              <span className="status-icon-badge">{task.progress}% · {task.status}</span>
            </div>

            <div className="popup-list-row" style={{ marginBottom: 10 }}>
              <span className="row-with-avatar">
                <span className="inline-avatar"><AvatarView avatar={owner.avatar} role={owner.role} /></span>
                <strong>負責人：{owner.name}（{owner.role}）</strong>
              </span>
              <div className="popup-row-btns">
                <button type="button" onClick={() => onNavigatePopup({ kind: "agent-status", agentId: owner.id })}>
                  👤 同事狀態
                </button>
                <button
                  type="button"
                  onClick={() => onNavigatePopup({ kind: "attachment", taskId: task.id })}
                >
                  ＋ 新增附件
                </button>
              </div>
            </div>

            <div className="rpg-thought-box" style={{ marginBottom: 10 }}>
              <strong>🎯 任務目標：</strong>
              <p>{task.goal}</p>
            </div>

            <ProgressBar value={task.progress} />

            <div className="step-list" style={{ marginTop: 10 }}>
              {task.steps.map((step, idx) => (
                <button
                  type="button"
                  key={step.label}
                  className={`step-row step-row-btn ${step.done ? "step-done" : ""}`}
                  onClick={() => onToggleTaskStep(task.id, idx)}
                >
                  <span className="step-check">{step.done ? "✓" : ""}</span>
                  <span>{step.label}</span>
                </button>
              ))}
            </div>

            {task.attachments.length > 0 && (
              <div className="attachment-list" style={{ marginTop: 10 }}>
                {task.attachments.map((file) => (
                  <button
                    type="button"
                    key={file}
                    className="attachment-chip"
                    onClick={() => onNavigatePopup({ kind: "attachment", taskId: task.id, file })}
                  >
                    ▤ {file}
                  </button>
                ))}
              </div>
            )}

            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={onClose}>關閉</button>
              <button
                type="button"
                className="secondary-top-button"
                onClick={() => {
                  onClose();
                  onOpenActionModal("context");
                }}
              >
                ▤ 補充資料
              </button>
              <button
                type="button"
                className="secondary-top-button"
                onClick={() => {
                  onClose();
                  onOpenActionModal("revision");
                }}
              >
                ↻ 要求修改
              </button>
              {task.status !== "已核准" && task.status !== "已結束" && (
                <button
                  type="button"
                  className="primary-button"
                  style={{ background: "#a35338", borderColor: "#853e27" }}
                  onClick={() => {
                    onFinishTask(task.id);
                    onClose();
                  }}
                  title="視情況結束此任務並讓負責人結案待命"
                >
                  🏁 結束任務
                </button>
              )}
              <button
                type="button"
                className="primary-button"
                onClick={() => onRunAgent(owner, `請針對任務「${task.title}」執行下一步並更新具體成果。`, task.goal, task.id)}
              >
                🧠 讓 {owner.name} 執行任務 <span>→</span>
              </button>
            </div>
          </>
        );
      }

      case "hr-roster": {
        return (
          <>
            <div className="chat-modal-header">
              <h2>🪪 HR 人事檔案館 & Docs（office-hr-manager）</h2>
              <div className="popup-row-btns">
                <a
                  className="secondary-top-button"
                  href="./docs/HR_COLLEAGUE_ROSTER.md"
                  target="_blank"
                  rel="noreferrer"
                >
                  📄 開啟 HR Docs
                </a>
                <button
                  type="button"
                  className="secondary-top-button"
                  onClick={() => onNavigatePopup({ kind: "agent-create" })}
                >
                  ＋ 招募新同事
                </button>
              </div>
            </div>

            <div className="rpg-thought-box" style={{ marginBottom: 10 }}>
              <strong>📝 HR 檔案館文本雙向同步（HR_COLLEAGUE_ROSTER.md）：</strong>
              <p style={{ marginBottom: 6 }}>
                可直接於下方修改或貼上 HR 檔案館文本，點擊「💾 根據 HR 文本更新全體同事資料」即可一鍵同步全體同事的名稱、職能、定位、頭像、專長與個性背景。
              </p>
              <textarea
                value={hrRosterMd}
                onChange={(e) => onChangeHrRosterMd(e.target.value)}
                rows={6}
                placeholder="載入或貼上 HR_COLLEAGUE_ROSTER.md 文本…"
                style={{ fontFamily: "Consolas, Courier New, monospace", fontSize: "9.5px", width: "100%" }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => onSaveHrRosterMd(hrRosterMd)}
                >
                  💾 根據 HR 文本更新全體同事資料 <span>→</span>
                </button>
              </div>
            </div>

            <div className="hr-roster-list">
              {office.agents.map((ag) => (
                <div key={ag.id} className="hr-profile-card">
                  <div className="hr-profile-card-top">
                    <div className="row-with-avatar">
                      <span className="rpg-avatar"><AvatarView avatar={ag.avatar} role={ag.role} /></span>
                      <div>
                        <strong>{ag.name} <small>· {ag.role}</small></strong>
                        <div className="hr-dept-pill">{ag.department ?? "核心專案組"} ｜ {ag.positioning ?? ag.role}</div>
                      </div>
                    </div>
                    <div className="popup-row-btns">
                      <button type="button" onClick={() => onNavigatePopup({ kind: "agent-status", agentId: ag.id })}>
                        👤 狀態
                      </button>
                      <button type="button" onClick={() => onOpenEditAgent(ag)}>
                        ✎ 編輯檔案
                      </button>
                      <button type="button" onClick={() => onSelectSkillAgent(ag.id)}>
                        📘 Skill
                      </button>
                    </div>
                  </div>
                  <div className="hr-profile-card-body">
                    <div><strong>核心專長：</strong>{ag.specialty ?? "跨部門專案協作"}</div>
                    <div><strong>個性與背景：</strong>{ag.personality ?? "認真負責的 AI 辦公室成員"}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={onClose}>關閉</button>
              <button
                type="button"
                className="primary-button"
                onClick={() => onOpenEditAgent(selectedAgent ?? office.agents[0])}
              >
                ✎ 編輯目前選取同事 <span>→</span>
              </button>
            </div>
          </>
        );
      }

      case "director":
        return (
          <>
            <h2>🎮 總監指令台</h2>
            <div className="rpg-roster">
              {office.agents.map((a) => (
                <div key={a.id} className="rpg-roster-card">
                  <div className="rpg-roster-head">
                    <span className="rpg-avatar"><AvatarView avatar={a.avatar} role={a.role} /></span>
                    <div>
                      <strong>{a.name} <small>({a.role})</small></strong>
                      <span className={`status-pill ${statusClasses[a.status]}`}><i />{thinkingAgents[a.id] ?? statusNames[a.status]}</span>
                    </div>
                  </div>
                  <div className="rpg-roster-actions">
                    <button type="button" onClick={() => onOpenEditAgent(a)}>✎ 個人資訊</button>
                    <button type="button" onClick={() => onRunAgent(a, `請回報你目前針對任務的最新想法與下一步行動。`)}>🧠 詢問</button>
                    <button type="button" onClick={() => onMoveAgent(a, "coding", "work")}>💻 工作</button>
                    <button type="button" onClick={() => onMoveAgent(a, "idle", "rest")}>☕ 休息</button>
                  </div>
                </div>
              ))}
            </div>
            <label className="modal-label" htmlFor="director-broadcast">📢 全體廣播指令</label>
            <textarea
              id="director-broadcast"
              value={input}
              onChange={(e) => onInput(e.target.value)}
              placeholder="輸入對團隊的指示…"
              rows={3}
            />
            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={onClose}>關閉</button>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  const text = input.trim() || "請為整個團隊規劃今日衝刺重點與分工";
                  onRunAgent(office.agents[0], `【總監廣播指令】${text}`);
                }}
              >
                發送廣播 <span>→</span>
              </button>
            </div>
          </>
        );

      case "summary-active":
        return (
          <>
            <h2>✳ 工作狀態總覽</h2>
            <div className="popup-list">
              {office.agents.map((a) => (
                <div key={a.id} className="popup-list-row">
                  <span className="row-with-avatar"><span className="inline-avatar"><AvatarView avatar={a.avatar} role={a.role} /></span> <strong>{a.name}</strong> · {a.role}</span>
                  <span className={`status-pill ${statusClasses[a.status]}`}><i />{statusNames[a.status]}</span>
                  <div className="popup-row-btns">
                    <button type="button" onClick={() => onOpenEditAgent(a)}>✎ 編輯</button>
                    <button type="button" onClick={() => onSelectAgent(a.id)}>查看</button>
                    <button type="button" onClick={() => onRunAgent(a, "請匯報你手頭工作的即時進度與遇到的難題。")}>⚡ 催進度</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-actions"><button type="button" className="primary-button" onClick={onClose}>完成</button></div>
          </>
        );

      case "summary-tasks":
        return (
          <>
            <h2>⌁ 任務看板</h2>
            <div className="popup-list">
              {office.tasks.map((t) => {
                const owner = office.agents.find((a) => a.id === t.ownerId);
                return (
                  <div key={t.id} className="popup-list-row">
                    <div>
                      <strong>{t.title}</strong>
                      <div className="popup-sub row-with-avatar">
                        {owner && <span className="inline-avatar"><AvatarView avatar={owner.avatar} role={owner.role} /></span>}
                        <span>{owner?.name} · {t.progress}% · {t.status}</span>
                      </div>
                    </div>
                    <div className="popup-row-btns">
                      <button type="button" onClick={() => onSelectTask(t.id)}>詳情</button>
                      {owner && <button type="button" onClick={() => onRunAgent(owner, `請針對任務「${t.title}」產出最新交付內容。`, t.goal, t.id)}>🧠 執行</button>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={onClose}>關閉</button>
              <button type="button" className="primary-button" onClick={onOpenAssign}>＋ 新增任務</button>
            </div>
          </>
        );

      case "summary-blocked": {
        const blocked = office.agents.filter((a) => a.status === "blocked" || a.status === "error");
        return (
          <>
            <h2>⚠️ 待確認項目</h2>
            <div className="popup-list">
              {(blocked.length ? blocked : office.agents.slice(0, 2)).map((a) => (
                <div key={a.id} className="popup-list-row">
                  <div>
                    <strong className="row-with-avatar"><span className="inline-avatar"><AvatarView avatar={a.avatar} role={a.role} /></span> <span>{a.name}（{a.role}）</span></strong>
                    <div className="popup-sub">{a.latestOutput}</div>
                  </div>
                  <div className="popup-row-btns">
                    <button
                      type="button"
                      onClick={() => onNavigatePopup({ kind: "attachment", taskId: "prototype", file: "brand-colors.pdf" })}
                    >
                      📑 檢視 brand-colors.pdf
                    </button>
                    <button type="button" onClick={() => onRunAgent(a, "總監已授權通過，請繼續完成你的審核與後續方案！")}>✓ 授權繼續</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={onClose}>關閉</button>
              <button type="button" className="primary-button" onClick={() => { onApprove(); onClose(); }}>一鍵核准</button>
            </div>
          </>
        );
      }

      case "zone": {
        if (popup.zoneId === "tasks") {
          return (
            <>
              <h2>📢 01 任務牆 · 全域任務看板</h2>
              <p style={{ margin: "14px 0", color: "#666", fontSize: 13, lineHeight: 1.6 }}>
                全域任務目標公告看板。員工於工作區提取目標，無須進駐此區。
              </p>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => { onOpenActionModal("assign"); onClose(); }}>
                  ＋ 派發新任務
                </button>
                <button type="button" className="primary-button" onClick={onClose}>關閉</button>
              </div>
            </>
          );
        }
        const zone: Zone | undefined = office.zones.find((z) => z.id === popup.zoneId);
        const zoneAgents = office.agents.filter((a) => a.zoneId === popup.zoneId);
        return (
          <>
            <h2>🏠 {zone?.marker} {zone?.name} <span className="status-icon-badge"><i className="live-dot" /> {zoneAgents.length} 人</span></h2>
            <div className="popup-list">
              {zoneAgents.length ? zoneAgents.map((a) => (
                <div key={a.id} className="popup-list-row">
                  <span className="row-with-avatar"><span className="inline-avatar"><AvatarView avatar={a.avatar} role={a.role} /></span> <strong>{a.name}</strong> · {a.bubble}</span>
                  <div className="popup-row-btns">
                    <button type="button" onClick={() => onOpenEditAgent(a)}>✎ 編輯</button>
                    <button type="button" onClick={() => onSelectAgent(a.id)}>選取</button>
                    <button type="button" onClick={() => onRunAgent(a, `你在「${zone?.name}」有什麼新發現或進度？`)}>💬 對話</button>
                  </div>
                </div>
              )) : <div className="popup-empty">目前無人在內</div>}
            </div>
            <div className="modal-label" style={{ marginTop: 12 }}>調度其他同事進入「{zone?.name}」：</div>
            <div className="zone-summon-row">
              {office.agents.filter((a) => a.zoneId !== popup.zoneId).map((a) => (
                <button
                  type="button"
                  key={a.id}
                  className="summon-chip row-with-avatar"
                  onClick={() => onMoveAgent(
                    a,
                    popup.zoneId === "rest" ? "idle" : "thinking",
                    popup.zoneId,
                  )}
                >
                  <span>＋</span>
                  <span className="inline-avatar"><AvatarView avatar={a.avatar} role={a.role} /></span>
                  <span>{a.name}</span>
                </button>
              ))}
            </div>
            <div className="modal-actions"><button type="button" className="primary-button" onClick={onClose}>關閉</button></div>
          </>
        );
      }

      case "agent-chat": {
        const agent = office.agents.find((a) => a.id === popup.agentId) ?? office.agents[0];
        const lastThought = thoughts.find((t) => t.agentId === agent.id);
        return (
          <>
            <div className="chat-modal-header">
              <h2 className="row-with-avatar">
                <span className="inline-avatar"><AvatarView avatar={agent.avatar} role={agent.role} /></span>
                <span>{agent.name}（{agent.role}）</span>
                <span className={`status-pill ${statusClasses[agent.status]}`}><i />{statusNames[agent.status]}</span>
              </h2>
              <button type="button" className="secondary-top-button" onClick={() => onOpenEditAgent(agent)}>
                ✎ 編輯個人資訊
              </button>
            </div>
            <div className="rpg-dialogue-stage">
              <div className="rpg-speaker-portrait">
                <div className="rpg-speaker-avatar">
                  <span className="avatar-clip-box">
                    <AvatarView avatar={agent.avatar} role={agent.role} />
                  </span>
                </div>
                <strong>{agent.name}</strong>
                <span>{agent.role}</span>
              </div>
              <div className="rpg-dialogue-bubble-adaptive">
                <div className="rpg-bubble-pill">💬 {agent.bubble}</div>
                <div className="rpg-thought-line">💭 {lastThought?.thought ?? "隨時準備回應總監指令"}</div>
                <div className="rpg-speech-line">{agent.latestOutput}</div>
              </div>
            </div>
            <label className="modal-label" htmlFor="rpg-chat-input">對 {agent.name} 說話或派發指令</label>
            <textarea
              id="rpg-chat-input"
              value={input}
              onChange={(e) => onInput(e.target.value)}
              placeholder={`輸入訊息給 ${agent.name}…`}
              rows={3}
              autoFocus
            />
            <div className="rpg-quick-prompts">
              {["報告目前進度與瓶頸", "給我 3 個可立即執行的點子", "幫我檢查這份任務有沒有遺漏風險"].map((p) => (
                <button type="button" key={p} onClick={() => onInput(p)}>{p}</button>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={onClose}>關閉</button>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  const q = input.trim() || "請跟我報告你目前的想法與建議。";
                  onRunAgent(agent, q, `先前對話輸出：${agent.latestOutput}`, agent.taskId);
                }}
              >
                送出對話 <span>→</span>
              </button>
            </div>
          </>
        );
      }

      case "agent-edit": {
        const target = office.agents.find((a) => a.id === editAgentForm.id) ?? office.agents[0];
        return (
          <>
            <h2>✎ 編輯角色個人資訊（儲存後畫面與 Skill 即時同步）</h2>
            <div className="zone-summon-row" style={{ marginBottom: 10 }}>
              {office.agents.map((ag) => (
                <button
                  type="button"
                  key={ag.id}
                  className={`summon-chip row-with-avatar ${ag.id === editAgentForm.id ? "avatar-cell-active" : ""}`}
                  onClick={() => onOpenEditAgent(ag)}
                >
                  <span className="inline-avatar"><AvatarView avatar={ag.avatar} role={ag.role} /></span>
                  <span>{ag.name}</span>
                </button>
              ))}
            </div>

            <div className="ui-config-grid">
              <label className="modal-label">
                1. 角色名稱
                <input
                  type="text"
                  className="ui-field-input"
                  value={editAgentForm.name}
                  onChange={(e) => onChangeEditAgentForm({ ...editAgentForm, name: e.target.value })}
                />
              </label>
              <label className="modal-label">
                2. 職能部門
                <input
                  type="text"
                  className="ui-field-input"
                  value={editAgentForm.department}
                  onChange={(e) => onChangeEditAgentForm({ ...editAgentForm, department: e.target.value })}
                />
              </label>

              <label className="modal-label">
                3. 職稱角色
                <input
                  type="text"
                  className="ui-field-input"
                  value={editAgentForm.role}
                  onChange={(e) => onChangeEditAgentForm({ ...editAgentForm, role: e.target.value })}
                />
              </label>
              <label className="modal-label">
                4. 專業定位
                <input
                  type="text"
                  className="ui-field-input"
                  value={editAgentForm.positioning}
                  onChange={(e) => onChangeEditAgentForm({ ...editAgentForm, positioning: e.target.value })}
                />
              </label>

              <label className="modal-label">
                5. 角色頭像 (圖示 / 網址 / 上傳圖片)
                <div className="avatar-input-row">
                  <span className="avatar-preview-box">
                    <AvatarView avatar={editAgentForm.avatar || target.avatar} role={editAgentForm.role} />
                  </span>
                  <input
                    type="text"
                    className="ui-field-input"
                    placeholder={editAgentForm.avatar.startsWith("data:") ? "已使用上傳圖片" : "Emoji 或圖片網址"}
                    value={editAgentForm.avatar.startsWith("data:") ? "" : editAgentForm.avatar}
                    onChange={(e) => onChangeEditAgentForm({ ...editAgentForm, avatar: e.target.value })}
                  />
                  <label className="upload-avatar-btn" title="上傳 GIF 動畫或圖片">
                    📁 上傳
                    <input
                      type="file"
                      accept="image/gif,image/png,image/jpeg,image/webp,image/*,.gif,.png,.jpg,.jpeg,.webp"
                      style={{ display: "none" }}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const uploadedUrl = await uploadAvatarFileApi(file, editAgentForm.id);
                        if (uploadedUrl) {
                          onChangeEditAgentForm({ ...editAgentForm, avatar: uploadedUrl });
                        }
                      }}
                    />
                  </label>
                </div>
              </label>
              <label className="modal-label">
                6. 所在辦公室房間
                <select
                  className="ui-field-input"
                  value={editAgentForm.zoneId}
                  onChange={(e) => onChangeEditAgentForm({ ...editAgentForm, zoneId: e.target.value })}
                >
                  {office.zones.map((z) => (
                    <option key={z.id} value={z.id}>{z.marker} {z.name}</option>
                  ))}
                </select>
              </label>

              <label className="modal-label">
                7. 目前工作狀態
                <select
                  className="ui-field-input"
                  value={editAgentForm.status}
                  onChange={(e) => onChangeEditAgentForm({ ...editAgentForm, status: e.target.value as AgentStatus })}
                >
                  {(Object.keys(statusNames) as AgentStatus[]).map((st) => (
                    <option key={st} value={st}>{statusNames[st]}</option>
                  ))}
                </select>
              </label>
              <label className="modal-label">
                8. 頭頂對話氣泡（對話框會依字數自動伸縮）
                <input
                  type="text"
                  className="ui-field-input"
                  value={editAgentForm.bubble}
                  onChange={(e) => onChangeEditAgentForm({ ...editAgentForm, bubble: e.target.value })}
                />
              </label>
            </div>

            <div className="avatar-preset-grid" style={{ marginTop: 6 }}>
              {AVATAR_PRESETS.map((em) => (
                <button
                  type="button"
                  key={em}
                  className={`avatar-preset-cell ${editAgentForm.avatar === em ? "avatar-cell-active" : ""}`}
                  onClick={() => onChangeEditAgentForm({ ...editAgentForm, avatar: em })}
                >
                  {em}
                </button>
              ))}
            </div>

            <label className="modal-label" htmlFor="edit-agent-specialty" style={{ marginTop: 8 }}>
              9. 角色核心專長（同步寫入 SKILL.md）
            </label>
            <input
              id="edit-agent-specialty"
              type="text"
              className="ui-field-input"
              value={editAgentForm.specialty}
              onChange={(e) => onChangeEditAgentForm({ ...editAgentForm, specialty: e.target.value })}
              placeholder="輸入此角色的核心專長與工作規範…"
            />

            <label className="modal-label" htmlFor="edit-agent-personality" style={{ marginTop: 8 }}>
              10. 個性與背景設定（同步寫入 SKILL.md）
            </label>
            <textarea
              id="edit-agent-personality"
              value={editAgentForm.personality}
              onChange={(e) => onChangeEditAgentForm({ ...editAgentForm, personality: e.target.value })}
              rows={2}
            />

            <label className="modal-label" htmlFor="edit-agent-output" style={{ marginTop: 8 }}>
              11. 目前對話／最新產出內容
            </label>
            <textarea
              id="edit-agent-output"
              value={editAgentForm.latestOutput}
              onChange={(e) => onChangeEditAgentForm({ ...editAgentForm, latestOutput: e.target.value })}
              rows={2}
            />

            <div className="modal-actions">
              {target.id.startsWith("custom-") && (
                <button
                  type="button"
                  className="secondary-top-button"
                  onClick={() => onDeleteCustomAgent(target.id)}
                >
                  🗑️ 移除此自訂角色
                </button>
              )}
              <button type="button" className="cancel-button" onClick={onClose}>取消</button>
              <button
                type="button"
                className="secondary-top-button"
                onClick={() => onSelectSkillAgent(target.id)}
              >
                📘 開啟 SKILL.md
              </button>
              <button type="button" className="primary-button" onClick={onSubmitEditAgent}>
                ✓ 儲存角色設定（畫面即時生效） <span>→</span>
              </button>
            </div>
          </>
        );
      }

      case "agent-tools": {
        const agent = office.agents.find((a) => a.id === popup.agentId) ?? office.agents[0];
        return (
          <>
            <h2 className="row-with-avatar"><span>⌘</span> <span className="inline-avatar"><AvatarView avatar={agent.avatar} role={agent.role} /></span> <span>{agent.name} 的工具紀錄</span></h2>
            <div className="popup-list">
              {agent.tools.map((tool, i) => (
                <div key={`${tool.name}-${i}`} className="popup-list-row">
                  <span><strong>{tool.name}</strong> — {tool.detail}</span>
                  <span className="popup-sub">{tool.time} · {tool.kind}</span>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={onClose}>關閉</button>
              <button type="button" className="primary-button" onClick={() => onRunAgent(agent, "請執行一次全面自我診斷並更新工作摘要。")}>
                ⚡ 觸發 AI 工具呼叫
              </button>
            </div>
          </>
        );
      }

      case "agent-output": {
        const agent = office.agents.find((a) => a.id === popup.agentId) ?? office.agents[0];
        const lastThought = thoughts.find((t) => t.agentId === agent.id);
        return (
          <>
            <h2 className="row-with-avatar"><span>📄</span> <span className="inline-avatar"><AvatarView avatar={agent.avatar} role={agent.role} /></span> <span>{agent.name} 的最新產出</span></h2>
            {lastThought && (
              <div className="rpg-thought-box">
                <strong>🧠 {lastThought.model}（{((lastThought.elapsedMs ?? 1200) / 1000).toFixed(1)}s）：</strong>
                <p>{lastThought.thought}</p>
              </div>
            )}
            <div className="rpg-output-full">{agent.latestOutput}</div>
            <div className="modal-actions">
              <button
                type="button"
                className="cancel-button"
                onClick={() => { void navigator.clipboard?.writeText(agent.latestOutput); }}
              >
                📋 複製文字
              </button>
              <button type="button" className="primary-button" onClick={() => onRunAgent(agent, "請把上面這份產出再擴充得更具體，加入執行檢核表。", agent.latestOutput, agent.taskId)}>
                🧠 深入展開 <span>→</span>
              </button>
            </div>
          </>
        );
      }

      case "panel-menu": {
        const agent = selectedAgent ?? office.agents[0];
        return (
          <>
            <h2>⚙️ 角色快速調度 — {agent.name}</h2>
            <div className="rpg-quick-prompts" style={{ marginBottom: 14 }}>
              {(["thinking", "researching", "writing", "coding", "reviewing", "blocked", "idle"] as AgentStatus[]).map((st) => (
                <button type="button" key={st} onClick={() => onMoveAgent(agent, st)}>
                  設為「{statusNames[st]}」
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={onClose}>取消</button>
              <button type="button" className="secondary-top-button" onClick={() => onOpenEditAgent(agent)}>
                ✎ 編輯個人資訊
              </button>
              <button type="button" className="primary-button" onClick={() => onRunAgent(agent, "請總結你今天的產出並提出一個創新建議。")}>
                ⚡ 呼叫 Gemini
              </button>
            </div>
          </>
        );
      }

      case "attachment": {
        const task = office.tasks.find((t) => t.id === popup.taskId) ?? selectedTask ?? office.tasks[0];
        const owner = office.agents.find((a) => a.id === task.ownerId) ?? office.agents[0];
        const virgoAgent = office.agents.find((a) => a.id === "virgo") ?? owner;

        if (popup.file === "brand-colors.pdf") {
          const corePalette = [
            { name: "品牌主強調橘", token: "--orange", hex: uiForm.primaryColor || "#EE6C29", contrast: "AA 大字 / 雙黑框", usage: "品牌徽章、＋派任務按鈕、選中角色外框、思考光暈" },
            { name: "炭黑粗框主字", token: "--charcoal", hex: uiForm.borderColor || "#282B2B", contrast: "14.1:1 AAA", usage: "通知視窗 2px 實體邊框、立體陰影、主標題與內文" },
            { name: "復古暖紙底色", token: "--paper", hex: uiForm.paperColor || "#E2DAC2", contrast: "基底畫布", usage: "辦公室等距地板、房間外框底板、暖紙主題背景" },
            { name: "象牙白卡片面", token: "--surface", hex: "#FBFAF6", contrast: "最高明度基底", usage: "跳出式通知視窗、右側資訊欄、角色頭頂對話氣泡" },
            { name: "常駐工作綠", token: "--green", hex: "#6B9B72", contrast: "4.9:1 AA", usage: "工作中狀態燈號、已形成決策卡片、完成步驟勾選" },
            { name: "休息研究藍", token: "--blue", hex: "#7AA6B3", contrast: "4.6:1 AA", usage: "休息／研究中狀態、AI 工具呼叫動畫、次要標籤" },
            { name: "警示琥珀橘", token: "--amber", hex: "#F39120", contrast: "5.2:1 AA", usage: "待總監確認項目、團隊分歧提示、監督卡關警示" },
            { name: "合格次要字色", token: "--muted-safe", hex: "#6E6A60", contrast: "5.3:1 AA", usage: "取代過淺灰字，用於職稱、時間戳記與狀態說明" },
          ];

          const terminalPalette = [
            { label: "TERM_BG", hex: "#161B19", desc: "終端機深色背景漸層" },
            { label: "PROMPT", hex: "#7FE0A2", desc: ">_ office.activity.log 主提示綠" },
            { label: "[TOOL]", hex: "#7FC1E0", desc: "AI 工具呼叫事件標籤" },
            { label: "[FILE]", hex: "#8AD694", desc: "檔案與程式碼變更標籤" },
            { label: "[ERROR]", hex: "#F29B58", desc: "監督攔截與異常警示標籤" },
            { label: "[HANDOFF]", hex: "#C7A4E8", desc: "跨部門任務交接標籤" },
            { label: "@AGENT", hex: "#F4B886", desc: "觸發事件之同事帳號高亮" },
          ];

          return (
            <>
              <div className="chat-modal-header">
                <h2>📑 brand-colors.pdf — 品牌視覺化系統與授權合規規範書</h2>
                <div className="popup-row-btns">
                  <a
                    className="secondary-top-button"
                    href="./docs/brand-colors.pdf"
                    target="_blank"
                    rel="noreferrer"
                  >
                    📄 開啟 PDF 原檔
                  </a>
                  <a
                    className="secondary-top-button"
                    href="./docs/BRAND_VISUAL_SYSTEM.md"
                    target="_blank"
                    rel="noreferrer"
                  >
                    📘 完整規範 MD
                  </a>
                </div>
              </div>

              <div className="brand-spec-banner">
                <span><strong>文件編號：</strong>AIO-BRAND-SPEC-v2.4</span>
                <span><strong>處女座監督（🔍 小處）驗收：</strong>✅ 色票、WCAG 對比度、深色終端機與公開授權條款已全數補齊</span>
              </div>

              <div className="modal-label" style={{ marginTop: 8 }}>
                1. 核心品牌色票系統（Core Paper & RPG Palette — 點擊色票可複製 HEX）
              </div>
              <div className="brand-swatch-grid">
                {corePalette.map((sw) => (
                  <button
                    type="button"
                    key={sw.token}
                    className="brand-swatch-card"
                    title={`點擊複製 ${sw.hex}`}
                    onClick={() => { void navigator.clipboard?.writeText(sw.hex); }}
                  >
                    <span className="brand-swatch-chip" style={{ background: sw.hex }} />
                    <div className="brand-swatch-meta">
                      <div className="brand-swatch-top">
                        <strong>{sw.name}</strong>
                        <code>{sw.hex}</code>
                      </div>
                      <div className="brand-swatch-sub">
                        <span>{sw.token}</span>
                        <span className="brand-contrast-pill">{sw.contrast}</span>
                      </div>
                      <p>{sw.usage}</p>
                    </div>
                  </button>
                ))}
              </div>

              <div className="modal-label" style={{ marginTop: 10 }}>
                2. 終端機背景活動流深色色票（Terminal Activity Log Dark Tokens）
              </div>
              <div className="brand-terminal-preview">
                <div className="brand-terminal-header">
                  <span>&gt;_ office.activity.log — Dark Console Token Matrix</span>
                  <code>#161B19 → #111514</code>
                </div>
                <div className="brand-terminal-tokens">
                  {terminalPalette.map((tp) => (
                    <div key={tp.label} className="brand-term-chip">
                      <i style={{ background: tp.hex }} />
                      <strong style={{ color: tp.hex }}>{tp.label}</strong>
                      <code>{tp.hex}</code>
                      <span>{tp.desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="decision-popup-grid" style={{ marginTop: 10 }}>
                <div className="decision-card decision-card-ok">
                  <div className="decision-card-head">
                    <strong>📐 3. 響應式 9:16 與視覺邊界規範</strong>
                  </div>
                  <p>• 手機頂欄強制單行折疊為「☰ 工具列」，零遮擋儀表板。</p>
                  <p>• 角色對話氣泡（68px–188px）依字數自動伸縮不重疊。</p>
                  <p>• 頭像統一包裹於 .avatar-clip-box，嚴格防止圖片溢框。</p>
                </div>

                <div className="decision-card decision-card-pending">
                  <div className="decision-card-head">
                    <strong>⚖️ 4. 品牌素材、字體與公開部署授權聲明</strong>
                  </div>
                  <p>• 色票系統、房間向量道具與像素吉祥物（麻糬、東東）均為專案原創資產，授權於 GitHub Pages（szhu72.github.io/ai-office/）公開展示與修改。</p>
                  <p>• 採用系統安全與開源字型堆疊（Trebuchet MS / Noto Sans TC / Consolas），無第三方商用字體侵權風險。</p>
                </div>
              </div>

              <div className="modal-actions">
                <button type="button" className="cancel-button" onClick={onClose}>關閉</button>
                <button
                  type="button"
                  className="secondary-top-button"
                  onClick={() => onNavigatePopup({ kind: "ui-studio" })}
                >
                  🎨 開啟改介面 Studio
                </button>
                <button
                  type="button"
                  className="secondary-top-button"
                  onClick={() => onRunAgent(virgoAgent, "我已經檢視完補齊後的 brand-colors.pdf（AIO-BRAND-SPEC-v2.4），請以處女座監督身分給出最終驗收簽核報告。", task.goal, task.id)}
                >
                  🔍 請小處出具驗收報告
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    onApprove();
                    onClose();
                  }}
                >
                  ✓ 簽署授權並解除小處卡關 <span>→</span>
                </button>
              </div>
            </>
          );
        }

        const attachmentSpecs: Record<string, string> = {
          "office-wireframe.fig": [
            "【檔案規格】office-wireframe.fig（Figma 互動原型線框稿 v2.2）",
            "• 6 大空間網格：01 工作區、02 討論板、03 任務牆、04 耍廢室、05 會議室、06 休息區",
            "• 手機 9:16 單欄直立佈局：頂部隱藏式工具列（☰ 工具列）＋ 3 卡儀表板 ＋ 2x3 房間網格 ＋ 終端機背景活動流",
            "• 全視窗通知化：所有點擊動作均觸發置中 GamePopupModal（z-index: 10000）",
          ].join("\n"),
          "mvp-scope-v2.md": [
            "【檔案規格】mvp-scope-v2.md（MVP 發布範圍定義書 v2.0 — 策劃「🐱 小橘」主筆）",
            "• P0 必備交付：辦公室 6 區視覺空間、7 位同事即時狀態與自適應對話框、任務詳情步驟勾選",
            "• P0 必備交付：處女座監督卡關原因提示、底部終端機背景活動流（>_ office.activity.log）",
            "• P1 進階交付：HR 人事檔案館（6 大欄位與 SKILL.md 雙向同步）、GitHub Pages 免後端直連 Gemini API",
          ].join("\n"),
          "interview-notes.pdf": [
            "【檔案規格】interview-notes.pdf（核心用戶深度訪談紀錄 — 研究「🧑🏻‍🔬 阿研」整理）",
            "• 受訪對象：12 位產品總監與獨立開發者",
            "• 核心痛點：傳統多 Agent 介面只有冰冷的文字 Log，看不出誰在忙、誰卡關、為什麼卡關",
            "• 關鍵需求：希望像玩經營模擬遊戲一樣俯瞰辦公室，點選角色或工具時跳出乾淨的通知視窗",
          ].join("\n"),
          "survey-results.csv": [
            "【檔案規格】survey-results.csv（126 份有效問卷統計摘要 — 分析師「📊 數據」建模）",
            "• 樣本數 N = 126（信賴水準 95%，抽樣誤差 ±4.2%）",
            "• 84.1% 使用者最常在手機上巡視 AI 團隊進度（驗證 9:16 隱藏式工具列之必要性）",
            "• 18.3% 使用者明確反應「需要第一時間看見代理人卡關原因與待核准附件」",
          ].join("\n"),
          "user-interviews.docx": [
            "【檔案規格】user-interviews.docx（使用者行為觀察與 UX 洞察報告）",
            "• 洞察 1：背景常駐的終端機單行 Log 能提供安心感，又不會搶走主地圖的視覺焦點",
            "• 洞察 2：角色擁有鮮明個性背景與專屬頭像時，使用者的任務派發互動率提升 2.4 倍",
          ].join("\n"),
        };

        return (
          <>
            <h2>▤ {popup.file ? `附件：${popup.file}` : `新增附件至「${task.title}」`}</h2>
            {popup.file ? (
              <>
                <div className="rpg-output-full">
                  {attachmentSpecs[popup.file] ?? (
                    `檔案名稱：${popup.file}\n所屬任務：${task.title}\n任務目標：${task.goal}`
                  )}
                </div>
                <div className="modal-actions">
                  <button type="button" className="cancel-button" onClick={onClose}>關閉</button>
                  <button type="button" className="primary-button" onClick={() => onRunAgent(owner, `請針對附件「${popup.file}」撰寫重點摘要與審核意見。`, task.goal, task.id)}>
                    🧠 請 {owner.name} 分析附件
                  </button>
                </div>
              </>
            ) : (
              <>
                <label className="modal-label" htmlFor="new-attachment">附件檔名或規格連結</label>
                <textarea
                  id="new-attachment"
                  value={input}
                  onChange={(e) => onInput(e.target.value)}
                  placeholder="例如：architecture-v3.pdf 或 api-spec.md"
                  rows={2}
                  autoFocus
                />
                <div className="modal-actions">
                  <button type="button" className="cancel-button" onClick={onClose}>取消</button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => onAddAttachment(task.id, input.trim() || `spec-${Date.now().toString().slice(-4)}.md`)}
                  >
                    ＋ 加入附件
                  </button>
                </div>
              </>
            )}
          </>
        );
      }

      case "meeting-brainstorm":
        return (
          <>
            <h2>🧠 召開 AI 團隊腦力激盪</h2>
            <label className="modal-label" htmlFor="meeting-topic">會議討論議題</label>
            <textarea
              id="meeting-topic"
              value={input}
              onChange={(e) => onInput(e.target.value)}
              placeholder="例如：如何把 AI 辦公室變成更像遊戲的互動體驗？"
              rows={3}
              autoFocus
            />
            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={onClose}>取消</button>
              <button
                type="button"
                className="primary-button"
                onClick={() => onRunBrainstorm(input.trim() || "本週產品衝刺與遊戲化互動升級")}
              >
                開始腦力激盪 <span>→</span>
              </button>
            </div>
          </>
        );

      case "activity-log": {
        const chosen = popup.eventId ? office.events.find((e) => e.id === popup.eventId) : undefined;
        return (
          <>
            <h2>📜 {chosen ? chosen.summary : `事件日誌（${office.events.length} 筆）`}</h2>
            {chosen && (
              <div className="rpg-thought-box" style={{ marginBottom: 12 }}>
                <strong>{chosen.time} · {chosen.type}</strong>
                <p style={{ whiteSpace: "pre-wrap" }}>{chosen.detail}</p>
              </div>
            )}
            <div className="popup-list" style={{ maxHeight: 260, overflow: "auto" }}>
              {office.events.map((ev) => {
                const ag = office.agents.find((a) => a.id === ev.agentId);
                return (
                  <div key={ev.id} className="popup-list-row">
                    <div>
                      <strong className="row-with-avatar">
                        <span>[{ev.time}]</span>
                        {ag && <span className="inline-avatar"><AvatarView avatar={ag.avatar} role={ag.role} /></span>}
                        <span>{ag?.name ?? "系統"}：{ev.summary}</span>
                      </strong>
                      <div className="popup-sub">{ev.detail}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="modal-actions"><button type="button" className="primary-button" onClick={onClose}>關閉</button></div>
          </>
        );
      }

      case "thought-detail": {
        const rec = thoughts.find((t) => t.id === popup.recordId) ?? thoughts[0];
        const ag = office.agents.find((a) => a.id === rec?.agentId) ?? office.agents[0];
        if (!rec) return null;
        return (
          <>
            <h2 className="row-with-avatar"><span>🧠</span> <span className="inline-avatar"><AvatarView avatar={rec.avatar} role={rec.role} /></span> <span>{rec.agentName}（{rec.role}）</span></h2>
            <p><strong>{rec.stage}</strong> · <code>{rec.model}</code> · {((rec.elapsedMs ?? 1200) / 1000).toFixed(2)}s</p>
            <div className="rpg-thought-box">
              <strong>📥 指令：</strong>
              <p>{rec.prompt}</p>
            </div>
            <div className="rpg-thought-box">
              <strong>💭 內心思考：</strong>
              <p>{rec.thought}</p>
            </div>
            <div className="rpg-output-full">{rec.outputPreview || "（推論進行中…）"}</div>
            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={onClose}>關閉</button>
              <button type="button" className="primary-button" onClick={() => onRunAgent(ag, `請延續你剛才的想法「${rec.thought}」，再往下推演一步具體行動。`)}>
                🔄 繼續思考 <span>→</span>
              </button>
            </div>
          </>
        );
      }

      case "ui-studio":
        return (
          <>
            <h2>🎨 介面參數設定（研究員「🧑🏻‍🔬 阿研」）</h2>
            {uiPatch?.summary && (
              <div className="rpg-thought-box">
                <strong>✨ 上次更新：</strong>
                <p>{uiPatch.summary}</p>
              </div>
            )}

            <div className="ui-config-grid">
              <label className="modal-label">
                1. 網站主標題
                <input
                  type="text"
                  className="ui-field-input"
                  value={uiForm.brandTitle}
                  onChange={(e) => onChangeUiForm({ ...uiForm, brandTitle: e.target.value })}
                />
              </label>
              <label className="modal-label">
                2. 總監歡迎大標
                <input
                  type="text"
                  className="ui-field-input"
                  value={uiForm.headline}
                  onChange={(e) => onChangeUiForm({ ...uiForm, headline: e.target.value })}
                />
              </label>

              <label className="modal-label">
                3. 主強調色 (--orange)
                <div className="ui-color-row">
                  <input
                    type="color"
                    value={uiForm.primaryColor}
                    onChange={(e) => onChangeUiForm({ ...uiForm, primaryColor: e.target.value })}
                  />
                  <input
                    type="text"
                    className="ui-field-input"
                    value={uiForm.primaryColor}
                    onChange={(e) => onChangeUiForm({ ...uiForm, primaryColor: e.target.value })}
                  />
                </div>
              </label>
              <label className="modal-label">
                4. 面板底色 (--paper)
                <div className="ui-color-row">
                  <input
                    type="color"
                    value={uiForm.paperColor}
                    onChange={(e) => onChangeUiForm({ ...uiForm, paperColor: e.target.value })}
                  />
                  <input
                    type="text"
                    className="ui-field-input"
                    value={uiForm.paperColor}
                    onChange={(e) => onChangeUiForm({ ...uiForm, paperColor: e.target.value })}
                  />
                </div>
              </label>

              <label className="modal-label">
                5. 邊框與文字色 (--charcoal)
                <div className="ui-color-row">
                  <input
                    type="color"
                    value={uiForm.borderColor}
                    onChange={(e) => onChangeUiForm({ ...uiForm, borderColor: e.target.value })}
                  />
                  <input
                    type="text"
                    className="ui-field-input"
                    value={uiForm.borderColor}
                    onChange={(e) => onChangeUiForm({ ...uiForm, borderColor: e.target.value })}
                  />
                </div>
              </label>
              <label className="modal-label">
                6. 字級倍率 (0.85 ~ 1.35)
                <input
                  type="number"
                  step="0.05"
                  min="0.85"
                  max="1.35"
                  className="ui-field-input"
                  value={uiForm.fontScale}
                  onChange={(e) => onChangeUiForm({ ...uiForm, fontScale: e.target.value })}
                />
              </label>

              <label className="modal-label">
                7. 右側欄寬度 (px)
                <input
                  type="number"
                  step="10"
                  min="280"
                  max="500"
                  className="ui-field-input"
                  value={uiForm.sidePanelWidth}
                  onChange={(e) => onChangeUiForm({ ...uiForm, sidePanelWidth: e.target.value })}
                />
              </label>
              <label className="modal-label">
                8. 圓角 (px)
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="20"
                  className="ui-field-input"
                  value={uiForm.cardRadius}
                  onChange={(e) => onChangeUiForm({ ...uiForm, cardRadius: e.target.value })}
                />
              </label>
            </div>

            <label className="modal-label" htmlFor="ui-evolve-note" style={{ marginTop: 8 }}>
              9. 補充細節指令（選填）
            </label>
            <textarea
              id="ui-evolve-note"
              value={uiForm.note}
              onChange={(e) => onChangeUiForm({ ...uiForm, note: e.target.value })}
              placeholder="選填：輸入想微調的樣式細節…"
              rows={2}
            />

            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={onResetUi}>↩ 還原預設</button>
              <button type="button" className="cancel-button" onClick={onClose}>取消</button>
              <button
                type="button"
                className="primary-button"
                onClick={onSubmitUiForm}
              >
                ✓ 套用介面設定 <span>→</span>
              </button>
            </div>
          </>
        );

      case "agent-create": {
        const customAgents = office.agents.filter((a) => a.id.startsWith("custom-"));
        return (
          <>
            <h2>🧑🏻‍🎨 招募新 AI 同事</h2>
            <div className="ui-config-grid">
              <label className="modal-label">
                1. 角色名稱
                <input
                  type="text"
                  className="ui-field-input"
                  placeholder="輸入角色名字…"
                  value={newAgentForm.name}
                  onChange={(e) => onChangeNewAgentForm({ ...newAgentForm, name: e.target.value })}
                  autoFocus
                />
              </label>
              <label className="modal-label">
                2. 職能部門
                <input
                  type="text"
                  className="ui-field-input"
                  placeholder="例如：量化研究組 / 法務合規室"
                  value={newAgentForm.department}
                  onChange={(e) => onChangeNewAgentForm({ ...newAgentForm, department: e.target.value })}
                />
              </label>

              <label className="modal-label">
                3. 職稱角色
                <input
                  type="text"
                  className="ui-field-input"
                  placeholder="例如：量化籌碼分析師 / 法務顧問"
                  value={newAgentForm.role}
                  onChange={(e) => onChangeNewAgentForm({ ...newAgentForm, role: e.target.value })}
                />
              </label>
              <label className="modal-label">
                4. 專業定位
                <input
                  type="text"
                  className="ui-field-input"
                  placeholder="例如：策略回測與風險歸因專家"
                  value={newAgentForm.positioning}
                  onChange={(e) => onChangeNewAgentForm({ ...newAgentForm, positioning: e.target.value })}
                />
              </label>

              <label className="modal-label">
                5. 角色頭像
                <div className="avatar-input-row">
                  <span className="avatar-preview-box">
                    <AvatarView avatar={newAgentForm.avatar || "🕵🏻‍♂️"} />
                  </span>
                  <input
                    type="text"
                    className="ui-field-input"
                    placeholder={newAgentForm.avatar.startsWith("data:") ? "已載入上傳圖片" : "Emoji 或圖片網址…"}
                    value={newAgentForm.avatar.startsWith("data:") ? "" : newAgentForm.avatar}
                    onChange={(e) => onChangeNewAgentForm({ ...newAgentForm, avatar: e.target.value })}
                  />
                  <label className="upload-avatar-btn" title="上傳 GIF 動畫或圖片檔">
                    📁 上傳
                    <input
                      type="file"
                      accept="image/gif,image/png,image/jpeg,image/webp,image/*,.gif,.png,.jpg,.jpeg,.webp"
                      style={{ display: "none" }}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const uploadedUrl = await uploadAvatarFileApi(file, `custom-${Date.now()}`);
                        if (uploadedUrl) {
                          onChangeNewAgentForm({ ...newAgentForm, avatar: uploadedUrl });
                        }
                      }}
                    />
                  </label>
                </div>
              </label>
              <label className="modal-label">
                6. 進駐辦公室房間
                <select
                  className="ui-field-input"
                  value={newAgentForm.zoneId}
                  onChange={(e) => onChangeNewAgentForm({ ...newAgentForm, zoneId: e.target.value })}
                >
                  {office.zones.map((z) => (
                    <option key={z.id} value={z.id}>{z.marker} {z.name}</option>
                  ))}
                </select>
              </label>

              <label className="modal-label">
                7. 初始工作狀態
                <select
                  className="ui-field-input"
                  value={newAgentForm.status}
                  onChange={(e) => onChangeNewAgentForm({ ...newAgentForm, status: e.target.value as AgentStatus })}
                >
                  {(Object.keys(statusNames) as AgentStatus[]).map((st) => (
                    <option key={st} value={st}>{statusNames[st]}</option>
                  ))}
                </select>
              </label>
              <label className="modal-label">
                8. 頭頂對話氣泡
                <input
                  type="text"
                  className="ui-field-input"
                  value={newAgentForm.bubble}
                  onChange={(e) => onChangeNewAgentForm({ ...newAgentForm, bubble: e.target.value })}
                />
              </label>
            </div>

            <div className="avatar-preset-grid" style={{ marginTop: 6 }}>
              {AVATAR_PRESETS.map((em) => (
                <button
                  type="button"
                  key={em}
                  className={`avatar-preset-cell ${newAgentForm.avatar === em ? "avatar-cell-active" : ""}`}
                  onClick={() => onChangeNewAgentForm({ ...newAgentForm, avatar: em })}
                >
                  {em}
                </button>
              ))}
            </div>

            <label className="modal-label" htmlFor="new-agent-specialty" style={{ marginTop: 8 }}>
              9. 核心專長與規範（自動生成 SKILL.md）
            </label>
            <input
              id="new-agent-specialty"
              type="text"
              className="ui-field-input"
              value={newAgentForm.specialty}
              onChange={(e) => onChangeNewAgentForm({ ...newAgentForm, specialty: e.target.value })}
              placeholder="例如：負責台美股三大法人籌碼比對、異常買超篩選與風險控管建議"
            />

            <label className="modal-label" htmlFor="new-agent-personality" style={{ marginTop: 8 }}>
              10. 個性與背景設定（自動寫入 HR 檔案與 SKILL.md）
            </label>
            <input
              id="new-agent-personality"
              type="text"
              className="ui-field-input"
              value={newAgentForm.personality}
              onChange={(e) => onChangeNewAgentForm({ ...newAgentForm, personality: e.target.value })}
              placeholder="例如：講話精準俐落、重數據證據，習慣在結論附上風險提示"
            />

            <label className="modal-label" htmlFor="new-agent-task" style={{ marginTop: 8 }}>
              11. 首項交辦任務（選填）
            </label>
            <textarea
              id="new-agent-task"
              value={newAgentForm.initialTask}
              onChange={(e) => onChangeNewAgentForm({ ...newAgentForm, initialTask: e.target.value })}
              placeholder="選填：輸入想讓這位新同事馬上開始處理的第一個任務…"
              rows={2}
            />

            {customAgents.length > 0 && (
              <div className="popup-list" style={{ marginTop: 10 }}>
                <div className="modal-label">已招募的自訂角色：</div>
                {customAgents.map((ca) => (
                  <div key={ca.id} className="popup-list-row">
                    <span className="row-with-avatar"><span className="inline-avatar"><AvatarView avatar={ca.avatar} role={ca.role} /></span> <strong>{ca.name}</strong> · {ca.role}</span>
                    <div className="popup-row-btns">
                      <button type="button" onClick={() => onOpenEditAgent(ca)}>✎ 編輯</button>
                      <button type="button" onClick={() => onSelectAgent(ca.id)}>查看</button>
                      <button type="button" onClick={() => onDeleteCustomAgent(ca.id)}>移除</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={onClose}>取消</button>
              <button type="button" className="primary-button" onClick={onSubmitCreateAgent}>
                ✓ 確認招募 <span>→</span>
              </button>
            </div>
          </>
        );
      }

      case "avatar-picker": {
        const target = office.agents.find((a) => a.id === popup.agentId) ?? office.agents[0];
        const currentAvatar = input || target.avatar;
        const isGif = isGifAvatar(currentAvatar);
        return (
          <>
            <h2>🖼️ 更換「{target.name}（{target.role}）」頭像</h2>
            <div className="avatar-picker-hero">
              <div className="avatar-preview-large">
                <AvatarView avatar={currentAvatar} role={target.role} />
                {isGif && <span className="gif-active-pill" title="GIF 動態播放中">🟢 GIF 動態</span>}
              </div>
              <div className="avatar-picker-controls">
                <label className="modal-label">
                  Emoji、圖片網址 或 GIF 檔案路徑
                  <input
                    type="text"
                    className="ui-field-input"
                    value={input.startsWith("data:") ? "" : input}
                    onChange={(e) => onInput(e.target.value)}
                    placeholder={input.startsWith("data:") ? "已套用上傳檔案 (GIF / 圖片)" : "輸入 Emoji、./avatars/*.gif 或圖片網址"}
                  />
                </label>
                <div className="avatar-upload-row">
                  <label className="upload-avatar-btn upload-avatar-btn-large">
                    📁 從電腦上傳 GIF / 圖片 (支援動態 GIF、PNG、WebP)
                    <input
                      type="file"
                      accept="image/gif,image/png,image/jpeg,image/webp,image/*,.gif,.png,.jpg,.jpeg,.webp"
                      style={{ display: "none" }}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const uploadedUrl = await uploadAvatarFileApi(file, target.id);
                        if (uploadedUrl) {
                          onInput(uploadedUrl);
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="gif-presets-shelf">
              <div className="gif-shelf-title">✨ 精選動態 GIF 像素頭像庫（點擊立即預覽循環動畫）：</div>
              <div className="gif-preset-grid">
                {GIF_AVATAR_PRESETS.map((preset) => (
                  <button
                    type="button"
                    key={preset.url}
                    className={`gif-preset-card ${currentAvatar === preset.url ? "avatar-cell-active" : ""}`}
                    onClick={() => onInput(preset.url)}
                    title={`套用 ${preset.label}`}
                  >
                    <img src={preset.url} alt="" className="gif-preset-thumb" />
                    <span className="gif-preset-label">{preset.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="avatar-preset-heading">或選擇傳統 Emoji 圖示：</div>
            <div className="avatar-preset-grid">
              {AVATAR_PRESETS.map((em) => (
                <button
                  type="button"
                  key={em}
                  className={`avatar-preset-cell ${currentAvatar === em ? "avatar-cell-active" : ""}`}
                  onClick={() => onInput(em)}
                >
                  {em}
                </button>
              ))}
            </div>

            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={onClose}>取消</button>
              <button
                type="button"
                className="primary-button"
                onClick={() => onUpdateAgentAvatar(target.id, (input || target.avatar).trim())}
              >
                ✓ 套用新頭像 <span>→</span>
              </button>
            </div>
          </>
        );
      }

      case "skill-viewer": {
        const target = office.agents.find((a) => a.id === popup.agentId) ?? office.agents[0];
        const skill = skillsMap[target.id];
        return (
          <>
            <div className="chat-modal-header">
              <h2>📘 {target.name}（{target.role}）— SKILL.md</h2>
              <button type="button" className="secondary-top-button" onClick={() => onOpenEditAgent(target)}>
                ✎ 編輯角色個人資訊
              </button>
            </div>

            <div className="zone-summon-row" style={{ marginBottom: 10 }}>
              {office.agents.map((ag) => (
                <button
                  type="button"
                  key={ag.id}
                  className={`summon-chip ${ag.id === target.id ? "avatar-cell-active" : ""}`}
                  onClick={() => onSelectSkillAgent(ag.id)}
                >
                  <span className="inline-avatar"><AvatarView avatar={ag.avatar} role={ag.role} /></span> {ag.name}
                </button>
              ))}
            </div>

            <label className="modal-label" htmlFor="skill-md-editor">
              SKILL.md 內容（修改名稱、職稱或專長並儲存，畫面角色資訊也會同步更新）：
            </label>
            <textarea
              id="skill-md-editor"
              value={input}
              onChange={(e) => onInput(e.target.value)}
              rows={11}
              style={{ fontFamily: "Courier New, monospace", fontSize: "9.5px" }}
            />

            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={onClose}>關閉</button>
              <button
                type="button"
                className="secondary-top-button"
                onClick={() => {
                  const blob = new Blob([input], { type: "text/markdown;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${skill?.skillName ?? target.id}-SKILL.md`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                ⬇️ 下載 SKILL.md
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => onSaveSkillMarkdown(target.id, input)}
              >
                💾 儲存並同步至畫面 <span>→</span>
              </button>
            </div>
          </>
        );
      }

      case "api-key":
        return (
          <>
            <h2>🔑 Gemini API Key 設定</h2>
            <div className="rpg-thought-box" style={{ marginBottom: 10 }}>
              <strong>💡 狀態：</strong>{" "}
              {browserApiKey
                ? `已設定本機瀏覽器金鑰（${browserApiKey.slice(0, 6)}...${browserApiKey.slice(-4)}）`
                : "尚未設定瀏覽器端金鑰（僅保存在你的裝置 localStorage，不會公開上傳）。"}
            </div>
            <label className="modal-label" htmlFor="browser-api-key-input">
              Gemini API Key (AIzaSy...)
            </label>
            <input
              id="browser-api-key-input"
              type="password"
              className="ui-field-input"
              value={input}
              onChange={(e) => onInput(e.target.value)}
              placeholder="貼上你的 GEMINI_API_KEY（例如 AIzaSy...）"
              autoFocus
            />
            <div className="modal-actions" style={{ marginTop: 14 }}>
              <button type="button" className="cancel-button" onClick={onClose}>取消</button>
              {browserApiKey && (
                <button
                  type="button"
                  className="secondary-top-button"
                  onClick={() => onSaveBrowserApiKey("")}
                >
                  🗑️ 清除金鑰
                </button>
              )}
              <button
                type="button"
                className="primary-button"
                onClick={() => onSaveBrowserApiKey(input)}
              >
                ✓ 儲存金鑰 <span>→</span>
              </button>
            </div>
          </>
        );
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="action-modal game-popup-modal" role="dialog" aria-modal="true">
        <button type="button" className="modal-close" onClick={onClose} aria-label="關閉">×</button>
        {renderBody()}
      </div>
    </div>
  );
}

function ActionModal({
  kind,
  value,
  assignee,
  agents,
  onValue,
  onAssignee,
  onClose,
  onSubmit,
}: {
  kind: "assign" | "context" | "revision";
  value: string;
  assignee: string;
  agents: Agent[];
  onValue: (value: string) => void;
  onAssignee: (id: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const copy = {
    assign: { title: "派一個新任務", label: "任務目標", placeholder: "例如：整理本週產品研究重點…" },
    context: { title: "補充工作資料", label: "補充內容", placeholder: "輸入背景資訊、連結或注意事項…" },
    revision: { title: "要求修改", label: "修改方向", placeholder: "例如：請再確認數據來源並補上限制…" },
  }[kind];
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="action-modal" onSubmit={onSubmit}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="關閉">×</button>
        <div className="modal-icon">{kind === "assign" ? "＋" : kind === "context" ? "▤" : "↻"}</div>
        <h2>{copy.title}</h2>
        <label className="modal-label" htmlFor="action-input">{copy.label}</label>
        <textarea id="action-input" value={value} onChange={(event) => onValue(event.target.value)} placeholder={copy.placeholder} rows={3} autoFocus />
        {kind === "assign" && (
          <label className="modal-label assignee-label" htmlFor="assignee-select">負責同事
            <select id="assignee-select" value={assignee} onChange={(event) => onAssignee(event.target.value)}>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.role}</option>)}
            </select>
          </label>
        )}
        <div className="modal-actions"><button type="button" className="cancel-button" onClick={onClose}>取消</button><button type="submit" className="primary-button">{kind === "assign" ? "派出任務" : kind === "context" ? "送出資料" : "送出修改要求"} <span>→</span></button></div>
      </form>
    </div>
  );
}

function PanelSection({ title, action, onAction, children }: { title: string; action?: string; onAction?: () => void; children: ReactNode }) {
  return <section className="panel-section"><div className="section-heading"><h3>{title}</h3>{action && <button type="button" onClick={onAction}>{action} <span>↗</span></button>}</div>{children}</section>;
}

function ProgressBar({ value }: { value: number }) {
  return <div className="progress-track" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${value}%` }} /></div>;
}

export default App;
