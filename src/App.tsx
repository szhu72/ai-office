import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { officeDataSource } from "./officeDataSource";
import { askAgent, askMeetingBrainstorm, askUiEvolve, deleteCustomAgentApi, extractProfileFromSkillMarkdown, fetchAgentProfiles, fetchAvatarOverrides, fetchColleagueSkills, fetchCustomAgents, fetchSavedUiPatch, getBrowserApiKey, resetUiEvolve, saveAgentProfileApi, saveAvatarOverrideApi, saveColleagueSkillApi, saveCustomAgentApi, setBrowserApiKey, type ColleagueSkillInfo, type UiEvolutionPatch } from "./aiClient";
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

const eventIcons: Record<ActivityEvent["type"], string> = {
  tool: "⌘",
  file: "▧",
  message: "✳",
  error: "!",
  handoff: "↗",
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
  | { kind: "director" }
  | { kind: "summary-active" }
  | { kind: "summary-tasks" }
  | { kind: "summary-blocked" }
  | { kind: "zone"; zoneId: string }
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
  "👩🏻‍🎨", "🧑🏻‍🚀", "🥷🏻", "🤖", "🦊", "🐱", "🐼", "🦉",
  "🦁", "🐸", "🐶", "🦄", "👾", "🎮", "💎", "⚡",
];

function isImageAvatar(avatar: string): boolean {
  return /^(data:image\/|https?:\/\/|\/)/i.test(avatar.trim());
}

function AvatarView({ avatar, role }: { avatar: string; role?: string }) {
  if (isImageAvatar(avatar)) {
    return <img src={avatar} alt="" className="custom-avatar-img" />;
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
    avatar: "🕵🏻‍♂️",
    zoneId: "work",
    status: "thinking" as AgentStatus,
    bubble: "隨時準備支援團隊！",
    specialty: "",
    initialTask: "",
  });
  const [editAgentForm, setEditAgentForm] = useState({
    id: "planner",
    name: "",
    role: "",
    avatar: "🧑🏻‍💼",
    zoneId: "work",
    status: "thinking" as AgentStatus,
    bubble: "",
    specialty: "",
    latestOutput: "",
  });
  const [skillsMap, setSkillsMap] = useState<Record<string, ColleagueSkillInfo>>({});
  const [browserApiKey, setBrowserApiKeyState] = useState<string>(() => getBrowserApiKey());

  // Load saved AI UI patch, custom agents, profile overrides, avatar overrides & generated SKILL.md index on startup
  useEffect(() => {
    void fetchCustomAgents().then(async (savedAgents) => {
      if (savedAgents.length) {
        officeDataSource.dispatch({ type: "agent.hydrateCustom", agents: savedAgents });
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
  const today = new Intl.DateTimeFormat("zh-TW", { weekday: "long", month: "long", day: "numeric" }).format(new Date());
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
    const avatar = newAgentForm.avatar.trim() || "🧑🏻‍💻";
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
      avatar,
      status: newAgentForm.status,
      taskId,
      progress: 25,
      zoneId: newAgentForm.zoneId,
      bubble: newAgentForm.bubble.trim() || "報到完畢！",
      latestOutput: `嗨總監！我是新加入的「${name}」（負責：${role}），已經進駐辦公室隨時待命。`,
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
    void saveCustomAgentApi({
      ...newAgent,
      ...(newAgentForm.specialty.trim() ? { specialty: newAgentForm.specialty.trim() } : {}),
    } as Agent).then(async () => {
      const updatedSkills = await fetchColleagueSkills();
      setSkillsMap(updatedSkills);
    });
    setSelection({ kind: "agent", id });
    setPopup(null);

    if (newAgentForm.initialTask.trim()) {
      void runAgent(newAgent, newAgentForm.initialTask.trim(), { taskId });
    }
    setNewAgentForm({
      name: "",
      role: "",
      avatar: "🕵🏻‍♂️",
      zoneId: "work",
      status: "thinking",
      bubble: "隨時準備支援團隊！",
      specialty: "",
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
      avatar: agent.avatar,
      zoneId: agent.zoneId,
      status: agent.status,
      bubble: agent.bubble,
      specialty: agent.specialty ?? parsedFromSkill.specialty ?? `以「${agent.role}」專業視角執行任務、分析問題並提供高品質交付成果`,
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
      avatar: editAgentForm.avatar.trim() || target.avatar,
      zoneId: editAgentForm.zoneId || target.zoneId,
      status: editAgentForm.status || target.status,
      bubble: editAgentForm.bubble.trim() || target.bubble,
      specialty: editAgentForm.specialty.trim() || target.specialty,
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
        `頭頂對話：「${patch.bubble}」｜專長：${patch.specialty ?? ""}`,
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
    setPopup(null);
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

  return (
    <div className={mobile916 ? "mobile-916-stage" : ""}>
      <div className={`office-app ${mobile916 ? "viewport-mobile-916" : ""}`}>
        <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span>O</span></div>
          <div>
            <div className="brand-name">
              {uiPatch?.brandTitle || "無所事事辦公室"}
              <span className="status-icon-badge" title="系統連線正常"><i className="live-dot" /> {today}</span>
            </div>
          </div>
        </div>
        <div className="topbar-right">
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
            onClick={() => setPopup({ kind: "agent-create" })}
            title="招募新 AI 角色"
          >
            🧑🏻‍🎨 ＋新角色
          </button>
          <button
            type="button"
            className="secondary-top-button"
            onClick={() => openEditAgent(selectedAgent ?? office.agents[0])}
            title="編輯目前選取角色的名稱、職稱、對話氣泡、頭像與專長"
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
          <button className="primary-button assign-button" onClick={() => setModal("assign")}>
            <span>＋</span> 派任務
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="main-column" aria-label="辦公室工作空間">
          <div className="overview-row">
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
                <div><strong>{office.tasks.filter((task) => task.status !== "已核准").length}<small> 項</small></strong><span>任務</span></div>
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
            onSelectAgent={(id) => setSelection({ kind: "agent", id })}
            onOpenAgentChat={(id) => { setSelection({ kind: "agent", id }); setPopup({ kind: "agent-chat", agentId: id }); setPopupInput(""); }}
            onSelectTask={(id) => setSelection({ kind: "task", id })}
            onSelectZone={(zoneId) => {
              if (zoneId === "meeting") setSelection({ kind: "meeting" });
              setPopup({ kind: "zone", zoneId });
            }}
          />

          <div className="scene-footer">
            <div>
              <span className="footer-indicator" title="Gemini 連線就緒" />
              <button type="button" onClick={() => { setShowMonitor(true); setMonitorMinimized(false); }}>
                🧠 思考監控 ({thoughts.length})
              </button>
            </div>
            <div className="scene-footer-actions">
              <button type="button" onClick={() => { setPopup({ kind: "meeting-brainstorm" }); setPopupInput(""); }}>
                🧠 腦力激盪 <span>↗</span>
              </button>
              <button type="button" onClick={() => setSelection({ kind: "meeting" })}>
                📋 團隊決策 <span>↗</span>
              </button>
            </div>
          </div>
        </section>

        <aside className="side-panel" aria-label="選取項目的詳細資訊">
          <div className="panel-topline">
            <span>{selection?.kind === "meeting" ? "團隊同步" : selection?.kind === "task" ? "任務詳情" : "同事狀態"}</span>
            <button
              type="button"
              className="more-button"
              aria-label="更多選項"
              title="開啟進階操作選單"
              onClick={() => setPopup({ kind: "panel-menu" })}
            >
              ···
            </button>
          </div>
          {selectedAgent && activeTask && (
            <AgentPanel
              agent={selectedAgent}
              task={activeTask}
              thinkingStage={thinkingAgents[selectedAgent.id]}
              latestThought={thoughts.find((t) => t.agentId === selectedAgent.id)}
              onSelectTask={() => setSelection({ kind: "task", id: activeTask.id })}
              onStatus={(status) => changeAgentStatus(selectedAgent, status)}
              onAction={setModal}
              onApprove={approveCurrent}
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
          {selectedTask && (
            <TaskPanel
              task={selectedTask}
              agent={office.agents.find((item) => item.id === selectedTask.ownerId)}
              onSelectAgent={(id) => setSelection({ kind: "agent", id })}
              onToggleStep={(idx) => {
                const step = selectedTask.steps[idx];
                officeDataSource.dispatch({
                  type: "task.toggleStep",
                  taskId: selectedTask.id,
                  stepIndex: idx,
                  event: createEvent(selectedTask.ownerId, "file", `更新步驟：${step?.label ?? ""}`, `任務「${selectedTask.title}」步驟狀態已切換。`),
                });
              }}
              onOpenAttachment={(file) => { setPopup({ kind: "attachment", taskId: selectedTask.id, file }); setPopupInput(""); }}
              onAction={setModal}
              onApprove={approveCurrent}
            />
          )}
          {selection?.kind === "meeting" && (
            <MeetingPanel
              office={office}
              onSelectAgent={(id) => setSelection({ kind: "agent", id })}
              onApprove={approveCurrent}
              onOpenBrainstorm={() => { setPopup({ kind: "meeting-brainstorm" }); setPopupInput(""); }}
            />
          )}
          {!selectedAgent && !selectedTask && selection?.kind !== "meeting" && (
            <EmptyPanel onAssign={() => setModal("assign")} />
          )}
        </aside>
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
          onSelectAgent={(id) => { setSelection({ kind: "agent", id }); setPopup(null); }}
          onSelectTask={(id) => { setSelection({ kind: "task", id }); setPopup(null); }}
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
            setPopup(null);
          }}
          onRunBrainstorm={async (topic) => {
            setPopup(null);
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
          }}
          onOpenAssign={() => { setPopup(null); setModal("assign"); }}
          onApprove={approveCurrent}
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
            setPopup(null);
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
              ...(extracted.specialty ? { specialty: extracted.specialty } : {}),
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
            setPopup(null);
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

interface OfficeSceneProps {
  office: OfficeState;
  selectedAgentId?: string;
  thinkingAgents: Record<string, string>;
  onSelectAgent: (id: string) => void;
  onOpenAgentChat: (id: string) => void;
  onSelectTask: (id: string) => void;
  onSelectZone: (zoneId: string) => void;
}

function OfficeScene({
  office,
  selectedAgentId,
  thinkingAgents,
  onSelectAgent,
  onOpenAgentChat,
  onSelectTask,
  onSelectZone,
}: OfficeSceneProps) {
  return (
    <div className="office-map">
      <div className="map-grid" aria-hidden="true" />
      <div className="floor-shadow" aria-hidden="true" />
      <div className="room-grid">
        {office.zones.map((zone) => {
          const agents = office.agents.filter((agent) => agent.zoneId === zone.id);
          return (
            <section
              key={zone.id}
              className={`zone-card zone-${zone.id} zone-${zone.kind} zone-interactive`}
              style={{ gridColumn: zone.position.column, gridRow: zone.position.row }}
              onClick={() => onSelectZone(zone.id)}
              onKeyDown={(event) => event.key === "Enter" && onSelectZone(zone.id)}
              role="button"
              tabIndex={0}
              aria-label={`點擊查看${zone.name}詳情與調度`}
            >
              <div className="zone-head">
                <div className="zone-label">
                  <span className="zone-marker">{zone.marker}</span>
                  <h2>{zone.name}</h2>
                </div>
                <div className="zone-status-icons">
                  {zone.kind === "work" && <span className="zone-live" title="工作中人數"><i /> {agents.length}</span>}
                  {zone.kind === "tasks" && <span className="task-wall-count" title="進行中任務">{office.tasks.filter((task) => task.status !== "已核准").length} ⌁</span>}
                  {zone.kind !== "work" && zone.kind !== "tasks" && agents.length > 0 && (
                    <span className="zone-live" title="房內人數"><i /> {agents.length}</span>
                  )}
                  <button
                    type="button"
                    className="zone-arrow"
                    aria-label={`開啟${zone.name}視窗`}
                    onClick={(event) => { event.stopPropagation(); onSelectZone(zone.id); }}
                  >
                    ↗
                  </button>
                </div>
              </div>
              {zone.kind === "work" && <WorkProps />}
              {zone.kind === "break" && <BreakProps lounge={zone.id === "lounge"} />}
              {zone.kind === "board" && <BoardProps />}
              {zone.kind === "meeting" && <MeetingProps />}
              {zone.kind === "tasks" && (
                <div className="mini-task-list">
                  {office.tasks.slice(0, 3).map((task) => {
                    const owner = office.agents.find((agent) => agent.id === task.ownerId);
                    return (
                      <button
                        type="button"
                        key={task.id}
                        className="mini-task-card"
                        onClick={(event) => { event.stopPropagation(); onSelectTask(task.id); }}
                      >
                        <span className={`task-priority ${task.status === "需修改" ? "priority-warn" : ""}`} />
                        <span className="mini-task-title">{task.title}</span>
                        <span className="mini-task-owner">{owner ? <AvatarView avatar={owner.avatar} role={owner.role} /> : null}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {agents.length > 0 && (
                <div className={`zone-agents agent-count-${Math.min(agents.length, 3)}`}>
                  {agents.map((agent, index) => (
                    <AgentSprite
                      key={agent.id}
                      agent={agent}
                      thinkingStage={thinkingAgents[agent.id]}
                      selected={selectedAgentId === agent.id}
                      onClick={() => onSelectAgent(agent.id)}
                      onDoubleClick={() => onOpenAgentChat(agent.id)}
                      delay={index * 0.13}
                    />
                  ))}
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
  delay,
}: {
  agent: Agent;
  thinkingStage?: string;
  selected: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  delay: number;
}) {
  const isThinking = Boolean(thinkingStage) || agent.status === "thinking";
  const dialogueText = thinkingStage || agent.bubble;
  const isLongDialogue = dialogueText.length > 14;
  return (
    <button
      type="button"
      className={`agent-sprite agent-state-${agent.status} ${selected ? "agent-selected" : ""} ${agent.status === "idle" ? "agent-resting" : ""} ${isThinking ? "agent-thinking-active" : ""}`}
      onClick={(event) => { event.stopPropagation(); onClick(); }}
      onDoubleClick={(event) => { event.stopPropagation(); onDoubleClick(); }}
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
        ) : agent.bubble}
      </span>
      <span className="sprite-figure">
        <span className="sprite-shadow" />
        <span className={`sprite-avatar ${agent.role === "吉祥物" ? "mascot-avatar" : ""}`}>
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

function BreakProps({ lounge }: { lounge: boolean }) {
  return (
    <div className={`break-props ${lounge ? "lounge-props" : ""}`} aria-hidden="true">
      {lounge ? <><div className="beanbag" /><div className="floor-lamp"><i /></div><div className="tiny-plant"><i /><i /><b /></div></> : <><div className="coffee-table"><i>☕</i></div><div className="sofa"><span /><span /></div></>}
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

function MeetingProps() {
  return (
    <div className="meeting-props" aria-hidden="true">
      <div className="meeting-table"><i /><i /><i /><i /></div>
      <div className="meeting-signal" title="同步中"><span /></div>
    </div>
  );
}

function AgentPanel({
  agent,
  task,
  thinkingStage,
  latestThought,
  onSelectTask,
  onStatus,
  onAction,
  onApprove,
  onOpenChat,
  onOpenTools,
  onOpenOutput,
  onOpenAvatarPicker,
  onOpenEditProfile,
  skillInfo,
  onOpenSkill,
}: {
  agent: Agent;
  task: OfficeTask;
  thinkingStage?: string;
  latestThought?: ThoughtRecord;
  onSelectTask: () => void;
  onStatus: (status: AgentStatus) => void;
  onAction: (action: "assign" | "context" | "revision") => void;
  onApprove: () => void;
  onOpenChat: () => void;
  onOpenTools: () => void;
  onOpenOutput: () => void;
  onOpenAvatarPicker: () => void;
  onOpenEditProfile: () => void;
  skillInfo?: ColleagueSkillInfo;
  onOpenSkill: () => void;
}) {
  return (
    <div className="panel-content">
      <div className="person-heading">
        <button
          type="button"
          className={`person-avatar person-avatar-clickable ${agent.role === "吉祥物" ? "person-mascot" : ""}`}
          onClick={onOpenAvatarPicker}
          title="點擊更換頭像"
        >
          <span className="avatar-clip-box">
            <AvatarView avatar={agent.avatar} role={agent.role} />
          </span>
          <i className={`person-online ${agent.status === "idle" ? "online-idle" : ""}`} />
        </button>
        <div className="person-meta">
          <h2>{agent.name}</h2>
          <span>
            {agent.role} <i /> <button type="button" className="change-avatar-link" onClick={onOpenEditProfile}>✎ 編輯個人資訊</button>
            <i /> <button type="button" className="change-avatar-link" onClick={onOpenSkill} title={skillInfo?.skillName ?? "SKILL.md"}>📘 Skill</button>
          </span>
        </div>
        <span className={`status-pill ${statusClasses[agent.status]}`}><i />{thinkingStage ? "推論中" : statusNames[agent.status]}</span>
      </div>

      <div className="character-dialogue-stage">
        <div className={`attention-note adaptive-dialogue-card ${thinkingStage ? "note-thinking" : agent.status === "blocked" || agent.status === "error" ? "note-warning" : ""}`}>
          <span className="note-icon">{thinkingStage ? "💭" : agent.status === "blocked" || agent.status === "error" ? "!" : "💬"}</span>
          <div className="adaptive-dialogue-body">
            <strong>{thinkingStage ? thinkingStage : `${agent.name}：「${agent.bubble}」`}</strong>
            {latestThought && !thinkingStage && (
              <p>🧠 {latestThought.thought}</p>
            )}
            {agent.specialty && (
              <p className="agent-specialty-tag">🎯 專長：{agent.specialty}</p>
            )}
          </div>
        </div>
      </div>

      <PanelSection title="正在處理" action="詳情" onAction={onSelectTask}>
        <button type="button" className="current-task-card" onClick={onSelectTask}>
          <div className="task-card-top"><span className="task-category">任務</span><span className="task-due">◷ {task.due}</span></div>
          <strong>{task.title}</strong>
          <span className="task-card-description">{task.goal}</span>
          <ProgressBar value={agent.progress} />
          <div className="progress-caption"><span>進度</span><strong>{agent.progress}%</strong></div>
        </button>
      </PanelSection>

      <PanelSection title="最近工具" action="紀錄" onAction={onOpenTools}>
        <div className="tool-list">
          {agent.tools.slice(0, 3).map((tool, idx) => (
            <button
              type="button"
              className="tool-row tool-row-clickable"
              key={`${tool.name}-${tool.time}-${idx}`}
              onClick={onOpenTools}
            >
              <span className={`tool-mark tool-${tool.kind}`}>{tool.kind === "success" ? "✓" : tool.kind === "warning" ? "!" : "↻"}</span>
              <div className="tool-copy"><strong>{tool.name}</strong><span>{tool.detail}</span></div>
              <time>{tool.time}</time>
            </button>
          ))}
        </div>
      </PanelSection>

      <PanelSection title="最新對話與產出" action="展開" onAction={onOpenOutput}>
        <button type="button" className="output-card output-card-clickable adaptive-output-card" onClick={onOpenOutput}>
          <span className="output-quote">“</span>
          <p>{agent.latestOutput}</p>
        </button>
      </PanelSection>

      <PanelSection title="角色操作">
        <div className="quick-actions">
          <button type="button" className="quick-chat" onClick={onOpenChat}><span>💬</span> 對話</button>
          <button type="button" onClick={onOpenEditProfile}><span>✎</span> 編輯個人資訊</button>
          <button type="button" onClick={() => onAction("context")}><span>＋</span> 補充資料</button>
          <button type="button" onClick={() => onAction("revision")}><span>↻</span> 要求修改</button>
          <button type="button" className="quick-approve" onClick={onApprove}><span>✓</span> 核准結案</button>
          <button type="button" className="quick-stop" onClick={() => onStatus(agent.status === "idle" ? "thinking" : "idle")}>
            <span>■</span> {agent.status === "idle" ? "喚醒工作" : "請去休息"}
          </button>
          <button type="button" onClick={onOpenAvatarPicker}><span>🖼️</span> 更換頭像</button>
          <button type="button" onClick={onOpenSkill}>
            <span>📘</span> 編輯 Skill
          </button>
        </div>
      </PanelSection>
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
}: {
  task: OfficeTask;
  agent?: Agent;
  onSelectAgent: (id: string) => void;
  onToggleStep: (stepIndex: number) => void;
  onOpenAttachment: (file?: string) => void;
  onAction: (action: "assign" | "context" | "revision") => void;
  onApprove: () => void;
}) {
  return (
    <div className="panel-content">
      <div className="task-detail-heading">
        <span className={`task-status-mark ${task.status === "需修改" ? "mark-warning" : ""}`}>{task.status === "待審核" ? "◷" : task.status === "已核准" ? "✓" : "↗"}</span>
        <div><span className="task-detail-eyebrow">工作項目 <i>·</i> {task.due}</span><h2>{task.title}</h2></div>
      </div>
      <div className="task-review-row"><span className={`review-chip review-${task.status === "已核准" ? "approved" : task.status === "需修改" ? "revision" : task.status === "待審核" ? "pending" : "active"}`}><i />{task.status}</span><span className="review-separator" /><span className="task-team">產品團隊</span></div>
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
      <PanelSection title="下一步">
        <div className="quick-actions">
          <button type="button" onClick={() => onAction("context")}><span>＋</span> 補充資料</button>
          <button type="button" onClick={() => onAction("revision")}><span>↻</span> 要求修改</button>
          <button type="button" className="quick-approve" onClick={onApprove}><span>✓</span> 核准</button>
          <button type="button" className="quick-stop" onClick={() => onAction("assign")}><span>＋</span> 派任務</button>
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
}: {
  office: OfficeState;
  onSelectAgent: (id: string) => void;
  onApprove: () => void;
  onOpenBrainstorm: () => void;
}) {
  return (
    <div className="panel-content meeting-panel-content">
      <div className="meeting-heading-visual"><span>◷</span><div><h2>晨間快速同步</h2><p>今天 09:30 <i>·</i> {office.agents.length} 位參與</p></div><span className="meeting-live-chip"><i />進行中</span></div>
      <div className="meeting-attendees">
        {office.agents.map((agent) => (
          <button type="button" key={agent.id} title={`${agent.name} · ${agent.role}`} onClick={() => onSelectAgent(agent.id)}>
            <AvatarView avatar={agent.avatar} role={agent.role} />
          </button>
        ))}
        <button type="button" className="meeting-more-btn" title="召開 AI 腦力激盪" onClick={onOpenBrainstorm}>+AI</button>
      </div>
      <PanelSection title="討論摘要" action="AI 重新開會" onAction={onOpenBrainstorm}>
        <div className="meeting-summary"><span>✳</span><p>{office.meeting.summary}</p></div>
      </PanelSection>
      <PanelSection title="主要分歧" action={`${office.meeting.disagreements.length} 個議題`}>
        <div className="discussion-list">
          {office.meeting.disagreements.map((item, index) => <div className="discussion-item" key={item}><span className="discussion-index">0{index + 1}</span><p>{item}</p></div>)}
        </div>
      </PanelSection>
      <PanelSection title="已形成決策">
        <div className="decision-list">{office.meeting.decisions.map((decision) => <div className="decision-item" key={decision}><span>✓</span><p>{decision}</p></div>)}</div>
      </PanelSection>
      <PanelSection title="待人工確認">
        {office.meeting.humanConfirmations.map((item) => <div className="human-confirmation" key={item}><span>!</span><p>{item}</p></div>)}
        <button type="button" className="confirm-button" onClick={onApprove}>確認並核准相關任務 <span>→</span></button>
        <button type="button" className="confirm-button brainstorm-btn" onClick={onOpenBrainstorm}>🧠 給定新議題讓 AI 團隊重新討論 <span>→</span></button>
      </PanelSection>
      <PanelSection title="會議活動">
        <div className="meeting-event-line"><span className="event-line-dot" /><span>策劃提交 MVP 範圍草案</span><time>09:41</time></div>
        <div className="meeting-event-line"><span className="event-line-dot event-line-blue" /><span>分析師分享研究洞察</span><time>09:40</time></div>
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
    { id: "all", label: "全部" },
    { id: "tool", label: "工具" },
    { id: "file", label: "檔案" },
    { id: "message", label: "訊息" },
    { id: "error", label: "需要注意" },
    { id: "handoff", label: "交接" },
  ];
  return (
    <section className="activity-feed">
      <div className="feed-heading">
        <div className="feed-title"><span className="feed-pulse" /><h2>活動流</h2></div>
        <div className="feed-filters" role="group" aria-label="活動類型篩選">
          {filters.map((item) => <button type="button" key={item.id} className={filter === item.id ? "filter-active" : ""} onClick={() => onFilter(item.id)}>{item.label}{item.id === "error" && events.some((event) => event.type === "error") && <i />}</button>)}
        </div>
        <button type="button" className="feed-expand" onClick={onOpenAll}>紀錄 ({events.length}) <span>↗</span></button>
      </div>
      <div className="feed-events">
        {events.length ? events.slice(0, 6).map((event) => {
          const agent = agents.find((item) => item.id === event.agentId);
          return (
            <article
              className={`feed-event event-${event.type} feed-event-clickable`}
              key={event.id}
              onClick={() => onOpenEvent(event.id)}
              role="button"
              tabIndex={0}
            >
              <span className="event-icon">{eventIcons[event.type]}</span>
              <time>{event.time}</time>
              <span className="event-agent"><i>{agent ? <AvatarView avatar={agent.avatar} role={agent.role} /> : "🏢"}</i>{agent?.name ?? "辦公室"}</span>
              <div className="event-copy"><strong>{event.summary}</strong><span>{event.detail}</span></div>
              <span className={`event-tag tag-${event.type}`}>{event.type === "tool" ? "工具呼叫" : event.type === "file" ? "檔案修改" : event.type === "message" ? "訊息" : event.type === "error" ? "需關注" : "任務交接"}</span>
            </article>
          );
        }) : <div className="feed-empty">目前沒有此類型的活動。</div>}
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
  onSelectAgent,
  onSelectTask,
  onMoveAgent,
  onRunAgent,
  onAddAttachment,
  onRunBrainstorm,
  onOpenAssign,
  onApprove,
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
  onSelectAgent: (id: string) => void;
  onSelectTask: (id: string) => void;
  onMoveAgent: (agent: Agent, status: AgentStatus, zoneId?: string) => void;
  onRunAgent: (agent: Agent, prompt: string, context?: string, taskId?: string) => void;
  onAddAttachment: (taskId: string, fileName: string) => void;
  onRunBrainstorm: (topic: string) => void;
  onOpenAssign: () => void;
  onApprove: () => void;
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
    role: string;
    avatar: string;
    zoneId: string;
    status: AgentStatus;
    bubble: string;
    specialty: string;
    initialTask: string;
  };
  onChangeNewAgentForm: (next: {
    name: string;
    role: string;
    avatar: string;
    zoneId: string;
    status: AgentStatus;
    bubble: string;
    specialty: string;
    initialTask: string;
  }) => void;
  onSubmitCreateAgent: () => void;
  editAgentForm: {
    id: string;
    name: string;
    role: string;
    avatar: string;
    zoneId: string;
    status: AgentStatus;
    bubble: string;
    specialty: string;
    latestOutput: string;
  };
  onChangeEditAgentForm: (next: {
    id: string;
    name: string;
    role: string;
    avatar: string;
    zoneId: string;
    status: AgentStatus;
    bubble: string;
    specialty: string;
    latestOutput: string;
  }) => void;
  onOpenEditAgent: (agent: Agent) => void;
  onSubmitEditAgent: () => void;
  onDeleteCustomAgent: (agentId: string) => void;
  onUpdateAgentAvatar: (agentId: string, newAvatar: string) => void;
  skillsMap: Record<string, ColleagueSkillInfo>;
  onSelectSkillAgent: (agentId: string) => void;
  onSaveSkillMarkdown: (agentId: string, mdContent: string) => void;
  browserApiKey: string;
  onSaveBrowserApiKey: (key: string) => void;
}) {
  const renderBody = () => {
    switch (popup.kind) {
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
                    popup.zoneId === "rest" || popup.zoneId === "lounge" ? "idle" : popup.zoneId === "meeting" ? "reviewing" : "thinking",
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
                  <AvatarView avatar={agent.avatar} role={agent.role} />
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
                2. 職稱與定位
                <input
                  type="text"
                  className="ui-field-input"
                  value={editAgentForm.role}
                  onChange={(e) => onChangeEditAgentForm({ ...editAgentForm, role: e.target.value })}
                />
              </label>

              <label className="modal-label">
                3. 角色頭像 (圖示 / 網址 / 上傳圖片)
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
                  <label className="upload-avatar-btn" title="上傳圖片">
                    📁 上傳
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => {
                          if (typeof reader.result === "string") {
                            onChangeEditAgentForm({ ...editAgentForm, avatar: reader.result });
                          }
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                  </label>
                </div>
              </label>
              <label className="modal-label">
                4. 所在辦公室房間
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
                5. 目前工作狀態
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
                6. 頭頂對話氣泡（對話框會依字數自動伸縮）
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
              7. 角色核心專長（同步寫入 SKILL.md）
            </label>
            <input
              id="edit-agent-specialty"
              type="text"
              className="ui-field-input"
              value={editAgentForm.specialty}
              onChange={(e) => onChangeEditAgentForm({ ...editAgentForm, specialty: e.target.value })}
              placeholder="輸入此角色的核心專長與工作規範…"
            />

            <label className="modal-label" htmlFor="edit-agent-output" style={{ marginTop: 8 }}>
              8. 目前對話／最新產出內容
            </label>
            <textarea
              id="edit-agent-output"
              value={editAgentForm.latestOutput}
              onChange={(e) => onChangeEditAgentForm({ ...editAgentForm, latestOutput: e.target.value })}
              rows={3}
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
        return (
          <>
            <h2>▤ {popup.file ? `附件：${popup.file}` : `新增附件至「${task.title}」`}</h2>
            {popup.file ? (
              <>
                <div className="rpg-output-full">
                  檔案名稱：{popup.file}{"\n"}
                  所屬任務：{task.title}{"\n"}
                  任務目標：{task.goal}
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
                2. 職稱與專業定位
                <input
                  type="text"
                  className="ui-field-input"
                  placeholder="例如：量化籌碼分析師 / 法務顧問"
                  value={newAgentForm.role}
                  onChange={(e) => onChangeNewAgentForm({ ...newAgentForm, role: e.target.value })}
                />
              </label>

              <label className="modal-label">
                3. 角色頭像
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
                  <label className="upload-avatar-btn" title="從電腦上傳圖片檔">
                    📁 上傳
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => {
                          if (typeof reader.result === "string") {
                            onChangeNewAgentForm({ ...newAgentForm, avatar: reader.result });
                          }
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                  </label>
                </div>
              </label>
              <label className="modal-label">
                4. 進駐辦公室房間
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
                5. 初始工作狀態
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
                6. 頭頂對話氣泡
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
              7. 核心專長與規範（自動生成 SKILL.md）
            </label>
            <input
              id="new-agent-specialty"
              type="text"
              className="ui-field-input"
              value={newAgentForm.specialty}
              onChange={(e) => onChangeNewAgentForm({ ...newAgentForm, specialty: e.target.value })}
              placeholder="例如：負責台美股三大法人籌碼比對、異常買超篩選與風險控管建議"
            />

            <label className="modal-label" htmlFor="new-agent-task" style={{ marginTop: 8 }}>
              8. 首項交辦任務（選填）
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
        return (
          <>
            <h2>🖼️ 更換「{target.name}（{target.role}）」頭像</h2>
            <div className="avatar-picker-hero">
              <div className="avatar-preview-large">
                <AvatarView avatar={currentAvatar} role={target.role} />
              </div>
              <div className="avatar-picker-controls">
                <label className="modal-label">
                  Emoji 或圖片網址 (URL)
                  <input
                    type="text"
                    className="ui-field-input"
                    value={input.startsWith("data:") ? "" : input}
                    onChange={(e) => onInput(e.target.value)}
                    placeholder={input.startsWith("data:") ? "已套用上傳圖片" : "輸入 Emoji 或 https://... 圖片網址"}
                  />
                </label>
                <div className="avatar-upload-row">
                  <label className="upload-avatar-btn upload-avatar-btn-large">
                    📁 從電腦上傳圖片 (PNG / JPG / GIF / WebP)
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => {
                          if (typeof reader.result === "string") {
                            onInput(reader.result);
                          }
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="avatar-preset-grid" style={{ marginTop: 10 }}>
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
