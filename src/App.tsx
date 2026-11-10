import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { officeDataSource } from "./officeDataSource";
import { askAgent, askMeetingBrainstorm, askUiEvolve, deleteCustomAgentApi, fetchAvatarOverrides, fetchColleagueSkills, fetchCustomAgents, fetchSavedUiPatch, getBrowserApiKey, resetUiEvolve, saveAvatarOverrideApi, saveColleagueSkillApi, saveCustomAgentApi, setBrowserApiKey, type ColleagueSkillInfo, type UiEvolutionPatch } from "./aiClient";
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
  | { kind: "avatar-picker"; agentId: string }
  | { kind: "skill-viewer"; agentId?: string }
  | { kind: "api-key" };

const AVATAR_PRESETS = [
  "🧑🏻‍💼", "🧑🏻‍🔬", "👩🏻‍💻", "👨🏻‍💼", "🧑🏻‍⚖️", "🕵🏻‍♂️", "🧙🏻‍♀️", "🦸🏻‍♂️",
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
  const [skillsMap, setSkillsMap] = useState<Record<string, ColleagueSkillInfo>>({});
  const [browserApiKey, setBrowserApiKeyState] = useState<string>(() => getBrowserApiKey());

  // Load saved AI UI patch, custom agents, avatar overrides & generated SKILL.md index on startup
  useEffect(() => {
    void fetchCustomAgents().then(async (savedAgents) => {
      if (savedAgents.length) {
        officeDataSource.dispatch({ type: "agent.hydrateCustom", agents: savedAgents });
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
            <div className="brand-name">{uiPatch?.brandTitle || "無所事事辦公室"} <span>AI OFFICE · RPG EDITION</span></div>
            <div className="brand-subtitle">第三方總監指揮空間 <i /> {today}</div>
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
            title="設定手機 / GitHub Pages 瀏覽器端直連 Gemini API Key（僅保存在你的裝置本機）"
          >
            🔑 {browserApiKey ? "金鑰已設定" : "金鑰設定"}
          </button>
          <button
            type="button"
            className={`secondary-top-button ${mobile916 ? "hud-pulsing" : ""}`}
            onClick={() => setMobile916((v) => !v)}
            title="一鍵切換 9:16 手機直向介面模板與桌機寬螢幕"
          >
            {mobile916 ? "🖥️ 切回桌機版" : "📱 9:16 手機版"}
          </button>
          <button
            type="button"
            className="secondary-top-button ui-studio-btn"
            onClick={() => { setPopup({ kind: "ui-studio" }); setPopupInput(""); }}
            title="填寫結構化欄位讓阿研更新網站介面"
          >
            🎨 AI 改介面
          </button>
          <button
            type="button"
            className="secondary-top-button"
            onClick={() => setPopup({ kind: "agent-create" })}
            title="建立全新的 AI 角色並自動生成專屬 SKILL.md"
          >
            🧑🏻‍🎨 ＋ 新角色
          </button>
          <button
            type="button"
            className="secondary-top-button"
            onClick={() => {
              const targetId = selectedAgent?.id ?? office.agents[0].id;
              setPopup({ kind: "skill-viewer", agentId: targetId });
              setPopupInput(skillsMap[targetId]?.content ?? "");
            }}
            title="檢視或編輯每位同事自動生成的 Antigravity SKILL.md 技能包"
          >
            📘 同事 Skills ({Object.keys(skillsMap).length || office.agents.length})
          </button>
          <button
            type="button"
            className={`hud-toggle-button ${anyRunning ? "hud-pulsing" : ""}`}
            onClick={() => { setShowMonitor(true); setMonitorMinimized(false); }}
            title="開啟 AI 思考狀態監控窗"
          >
            <span className="live-dot" />
            🧠 思考監控 ({anyRunning ? `${Object.keys(thinkingAgents).length} 思考中` : `${thoughts.length} 筆`})
          </button>
          <button
            type="button"
            className="secondary-top-button"
            onClick={runOfficeRound}
            disabled={anyRunning}
            title="讓正在工作的 AI 同事自動推進一回合"
          >
            ⚡ {anyRunning ? "AI 推論中…" : "推進一回合"}
          </button>
          <button
            type="button"
            className="secondary-top-button"
            onClick={() => { setPopup({ kind: "director" }); setPopupInput(""); }}
          >
            🎮 總監指令台
          </button>
          <button
            type="button"
            className="topbar-avatar"
            title="點擊查看總監個人檔案與系統狀態"
            onClick={() => { setPopup({ kind: "director" }); setPopupInput(""); }}
          >
            Y
          </button>
          <button className="primary-button assign-button" onClick={() => setModal("assign")}>
            <span>＋</span> 派任務
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="main-column" aria-label="辦公室工作空間">
          <div className="overview-row">
            <div>
              <div className="eyebrow">DIRECTOR COMMAND MODE <span className="eyebrow-line" /></div>
              <h1>{uiPatch?.headline || "早安，總監"} <span className="wave">✳</span></h1>
              <p className="overview-copy">點擊任何房間、同事、數據卡或按鈕都會彈出互動視窗；點右上「🎨 AI 改介面」可直接叫 AI 修改網站外觀與排版。</p>
            </div>
            <div className="summary-cards">
              <button
                type="button"
                className="summary-card summary-card-clickable"
                onClick={() => setPopup({ kind: "summary-active" })}
              >
                <span className="summary-icon icon-orange">✳</span>
                <div><strong>{activeAgents}<small> / {office.agents.length}</small></strong><span>正在工作 ↗</span></div>
              </button>
              <button
                type="button"
                className="summary-card summary-card-clickable"
                onClick={() => setPopup({ kind: "summary-tasks" })}
              >
                <span className="summary-icon icon-blue">⌁</span>
                <div><strong>{office.tasks.filter((task) => task.status !== "已核准").length}<small> 項</small></strong><span>進行中任務 ↗</span></div>
              </button>
              <button
                type="button"
                className={`summary-card summary-card-clickable ${blockedAgents ? "attention-card" : ""}`}
                onClick={() => setPopup({ kind: "summary-blocked" })}
              >
                <span className="summary-icon icon-amber">!</span>
                <div><strong>{blockedAgents}<small> 項</small></strong><span>需要你看看 ↗</span></div>
              </button>
            </div>
          </div>

          <div className="scene-toolbar">
            <div className="scene-title">
              <span className="scene-spark">✳</span> 今日辦公室 <span className="scene-count">0{office.agents.length} 位 AI 同事</span>
              {anyRunning && <span className="thinking-banner">💭 {Object.values(thinkingAgents)[0]}</span>}
            </div>
            <div className="scene-key">
              <button type="button" className="key-chip" onClick={() => setPopup({ kind: "summary-active" })}><i className="key-dot working" />工作中</button>
              <button type="button" className="key-chip" onClick={() => setPopup({ kind: "zone", zoneId: "rest" })}><i className="key-dot break" />休息區</button>
              <button type="button" className="key-chip" onClick={() => setPopup({ kind: "summary-blocked" })}><i className="key-dot stuck" />需要協助</button>
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
              <span className="footer-indicator" /> Gemini 即時連線中
              <span className="footer-divider">·</span>
              <button type="button" onClick={() => { setShowMonitor(true); setMonitorMinimized(false); }}>
                開啟思考狀態監控窗 ({thoughts.length})
              </button>
            </div>
            <div className="scene-footer-actions">
              <button type="button" onClick={() => { setPopup({ kind: "meeting-brainstorm" }); setPopupInput(""); }}>
                🧠 召開 AI 腦力激盪 <span>↗</span>
              </button>
              <button type="button" onClick={() => setSelection({ kind: "meeting" })}>
                查看團隊決策 <span>↗</span>
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
            if (target?.id.startsWith("custom-")) {
              void saveCustomAgentApi({ ...target, avatar: newAvatar });
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
            const saved = await saveColleagueSkillApi(ag.id, ag.name, ag.role, mdContent);
            if (saved) {
              setSkillsMap((prev) => ({ ...prev, [ag.id]: saved }));
              addEvent(ag.id, "file", `已更新 ${ag.name} 的 SKILL.md`, saved.paths[0] ?? "");
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
                  <div><h2>{zone.name}</h2><span>{zone.subtitle}</span></div>
                </div>
                {zone.kind === "work" && <span className="zone-live"><i /> {agents.length} 位忙碌</span>}
                {zone.kind === "tasks" && <span className="task-wall-count">{office.tasks.filter((task) => task.status !== "已核准").length} OPEN</span>}
                <button
                  type="button"
                  className="zone-arrow"
                  aria-label={`開啟${zone.name}視窗`}
                  onClick={(event) => { event.stopPropagation(); onSelectZone(zone.id); }}
                >
                  ↗
                </button>
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
              {zone.id === "work" && <DeskShape />}
            </section>
          );
        })}
      </div>
      <div className="map-caption">
        <span className="pixel-sun">✳</span> 辦公室平面圖（單擊角色查看狀態 · 雙擊角色直接對話 · 點擊房間開啟區域選單）
        <span>ISOMETRIC RPG VIEW · 2D</span>
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
  return (
    <button
      type="button"
      className={`agent-sprite agent-state-${agent.status} ${selected ? "agent-selected" : ""} ${agent.status === "idle" ? "agent-resting" : ""} ${isThinking ? "agent-thinking-active" : ""}`}
      onClick={(event) => { event.stopPropagation(); onClick(); }}
      onDoubleClick={(event) => { event.stopPropagation(); onDoubleClick(); }}
      style={{ animationDelay: `${delay}s` }}
      aria-label={`查看${agent.name}，${agent.role}，${statusNames[agent.status]}`}
      title="單擊查看面板 · 雙擊開啟 RPG 對話視窗"
    >
      <span className={`speech-bubble ${isThinking ? "speech-bubble-thinking" : ""}`}>
        {thinkingStage ? (
          <>
            {thinkingStage}
            <i className="thinking-dots"><b>.</b><b>.</b><b>.</b></i>
          </>
        ) : agent.bubble}
      </span>
      <span className="sprite-shadow" />
      <span className={`sprite-avatar ${agent.role === "吉祥物" ? "mascot-avatar" : ""}`}>
        <AvatarView avatar={agent.avatar} role={agent.role} />
        {isThinking && <i className="sprite- halo-ring" />}
      </span>
      <span className="sprite-status-dot" />
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

function DeskShape() {
  return <div className="work-zone-sticker" aria-hidden="true"><span />FOCUS MODE</div>;
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
      <div className="meeting-signal"><span /> 正在同步</div>
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
          title="點擊自由更換角色頭像（支援上傳圖片或挑選圖示）"
        >
          <span className="avatar-clip-box">
            <AvatarView avatar={agent.avatar} role={agent.role} />
          </span>
          <i className={`person-online ${agent.status === "idle" ? "online-idle" : ""}`} />
        </button>
        <div className="person-meta">
          <h2>{agent.name}</h2>
          <span>
            {agent.role} <i /> <button type="button" className="change-avatar-link" onClick={onOpenAvatarPicker}>更換頭像 ✎</button>
            <i /> <button type="button" className="change-avatar-link" onClick={onOpenSkill}>📘 {skillInfo?.skillName ?? "SKILL.md"}</button>
          </span>
        </div>
        <span className={`status-pill ${statusClasses[agent.status]}`}><i />{thinkingStage ? "Gemini 推論中" : statusNames[agent.status]}</span>
      </div>

      {thinkingStage ? (
        <div className="attention-note note-thinking">
          <span className="note-icon">💭</span>
          <div>
            <strong>{thinkingStage}</strong>
            <p>正在透過 Gemini 進行角色推理，請稍候 1~3 秒…</p>
          </div>
        </div>
      ) : (
        <div className={`attention-note ${agent.status === "blocked" || agent.status === "error" ? "note-warning" : ""}`}>
          <span className="note-icon">{agent.status === "blocked" || agent.status === "error" ? "!" : "✳"}</span>
          <div>
            <strong>{agent.status === "blocked" || agent.status === "error" ? "需要你的協助" : "內心思考摘要"}</strong>
            <p>{latestThought ? latestThought.thought : agent.bubble}</p>
          </div>
        </div>
      )}

      <PanelSection title="正在處理" action="查看任務" onAction={onSelectTask}>
        <button type="button" className="current-task-card" onClick={onSelectTask}>
          <div className="task-card-top"><span className="task-category">產品開發</span><span className="task-due">◷ {task.due}</span></div>
          <strong>{task.title}</strong>
          <span className="task-card-description">{task.goal}</span>
          <ProgressBar value={agent.progress} />
          <div className="progress-caption"><span>任務進度</span><strong>{agent.progress}%</strong></div>
        </button>
      </PanelSection>

      <PanelSection title="最近工具使用" action="完整紀錄" onAction={onOpenTools}>
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

      <PanelSection title="最新輸出" action="查看全部" onAction={onOpenOutput}>
        <button type="button" className="output-card output-card-clickable" onClick={onOpenOutput}>
          <span className="output-quote">“</span>
          <p>{agent.latestOutput}</p>
          <span className="output-time">點擊展開完整報告與追問 <i>·</i> {agent.name}</span>
        </button>
      </PanelSection>

      <PanelSection title="快速操作（RPG 指令）">
        <div className="quick-actions">
          <button type="button" className="quick-chat" onClick={onOpenChat}><span>💬</span> 直接對話</button>
          <button type="button" onClick={() => onAction("context")}><span>＋</span> 補充資料</button>
          <button type="button" onClick={() => onAction("revision")}><span>↻</span> 要求修改</button>
          <button type="button" className="quick-approve" onClick={onApprove}><span>✓</span> 核准結案</button>
          <button type="button" className="quick-stop" onClick={() => onStatus(agent.status === "idle" ? "thinking" : "idle")}>
            <span>■</span> {agent.status === "idle" ? "喚醒工作" : "請去休息"}
          </button>
          <button type="button" onClick={onOpenAvatarPicker}><span>🖼️</span> 更換頭像</button>
          <button type="button" onClick={onOpenSkill} style={{ gridColumn: "1 / -1" }}>
            <span>📘</span> 查看／編輯專屬 Skill ({skillInfo?.skillName ?? "SKILL.md"})
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
        <div className="feed-title"><span className="feed-pulse" /><div><h2>全辦公室活動流</h2><p>點擊任一事件可彈出完整紀錄視窗</p></div></div>
        <div className="feed-filters" role="group" aria-label="活動類型篩選">
          {filters.map((item) => <button type="button" key={item.id} className={filter === item.id ? "filter-active" : ""} onClick={() => onFilter(item.id)}>{item.label}{item.id === "error" && events.some((event) => event.type === "error") && <i />}</button>)}
        </div>
        <button type="button" className="feed-expand" onClick={onOpenAll}>查看全部活動紀錄 ({events.length}) <span>↗</span></button>
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
            <span className="modal-eyebrow">DIRECTOR COMMAND CONSOLE · 總監指令台</span>
            <h2>🎮 第三方總監全局控制台</h2>
            <p>你是這間 AI 辦公室的總監。你可以在這裡對全體或指定角色下達戰略指令，或直接調度角色位置。</p>
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
                    <button type="button" onClick={() => onRunAgent(a, `請回報你目前針對任務的最新想法與下一步行動。`)}>🧠 立即詢問</button>
                    <button type="button" onClick={() => onMoveAgent(a, "coding", "work")}>💻 派去工作區</button>
                    <button type="button" onClick={() => onMoveAgent(a, "idle", "rest")}>☕ 派去休息</button>
                  </div>
                </div>
              ))}
            </div>
            <label className="modal-label" htmlFor="director-broadcast">📢 對全辦公室廣播指令（由策劃小橘統籌拆解）</label>
            <textarea
              id="director-broadcast"
              value={input}
              onChange={(e) => onInput(e.target.value)}
              placeholder="例如：今天下午三點前要完成投資儀表板與 AI 辦公室串接，請小橘列出所有人的分工！"
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
                發送廣播並啟動 AI 推論 <span>→</span>
              </button>
            </div>
          </>
        );

      case "summary-active":
        return (
          <>
            <span className="modal-eyebrow">ACTIVE AGENTS · 工作狀態總覽</span>
            <h2>✳ 目前正在工作的 AI 同事</h2>
            <p>點擊任一同事可立即切換視角或指派他執行即時推論：</p>
            <div className="popup-list">
              {office.agents.map((a) => (
                <div key={a.id} className="popup-list-row">
                  <span className="row-with-avatar"><span className="inline-avatar"><AvatarView avatar={a.avatar} role={a.role} /></span> <strong>{a.name}</strong> · {a.role}</span>
                  <span className={`status-pill ${statusClasses[a.status]}`}><i />{statusNames[a.status]}</span>
                  <div className="popup-row-btns">
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
            <span className="modal-eyebrow">TASK BOARD · 任務看板總覽</span>
            <h2>⌁ 所有任務與審核進度</h2>
            <p>可在此快速檢視或一鍵核准任務：</p>
            <div className="popup-list">
              {office.tasks.map((t) => {
                const owner = office.agents.find((a) => a.id === t.ownerId);
                return (
                  <div key={t.id} className="popup-list-row">
                    <div>
                      <strong>{t.title}</strong>
                      <div className="popup-sub">{owner?.avatar} {owner?.name} · 進度 {t.progress}% · {t.status}</div>
                    </div>
                    <div className="popup-row-btns">
                      <button type="button" onClick={() => onSelectTask(t.id)}>詳情</button>
                      {owner && <button type="button" onClick={() => onRunAgent(owner, `請針對任務「${t.title}」產出最新交付內容。`, t.goal, t.id)}>🧠 AI 執行</button>}
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
            <span className="modal-eyebrow">ATTENTION REQUIRED · 卡關救援中心</span>
            <h2>⚠️ 需要總監決策的卡關項目</h2>
            <p>{blocked.length ? "以下同事正在等待你的指示或授權：" : "太棒了！目前沒有任何同事卡關。"}</p>
            <div className="popup-list">
              {(blocked.length ? blocked : office.agents.slice(0, 2)).map((a) => (
                <div key={a.id} className="popup-list-row">
                  <div>
                    <strong>{a.avatar} {a.name}（{a.role}）</strong>
                    <div className="popup-sub">{a.latestOutput}</div>
                  </div>
                  <div className="popup-row-btns">
                    <button type="button" onClick={() => onRunAgent(a, "總監已授權通過，請繼續完成你的審核與後續方案！")}>✓ 授權並繼續</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={onClose}>關閉</button>
              <button type="button" className="primary-button" onClick={() => { onApprove(); onClose(); }}>一鍵核准目前卡關任務</button>
            </div>
          </>
        );
      }

      case "zone": {
        const zone: Zone | undefined = office.zones.find((z) => z.id === popup.zoneId);
        const zoneAgents = office.agents.filter((a) => a.zoneId === popup.zoneId);
        return (
          <>
            <span className="modal-eyebrow">ROOM INSPECTOR · 區域編號 {zone?.marker}</span>
            <h2>🏠 {zone?.name} — {zone?.subtitle}</h2>
            <p>目前此房間內有 {zoneAgents.length} 位同事。你可以把其他同事調度過來，或直接對房內同事下指令：</p>
            <div className="popup-list">
              {zoneAgents.length ? zoneAgents.map((a) => (
                <div key={a.id} className="popup-list-row">
                  <span className="row-with-avatar"><span className="inline-avatar"><AvatarView avatar={a.avatar} role={a.role} /></span> <strong>{a.name}</strong> · {a.bubble}</span>
                  <div className="popup-row-btns">
                    <button type="button" onClick={() => onSelectAgent(a.id)}>選取</button>
                    <button type="button" onClick={() => onRunAgent(a, `你在「${zone?.name}」有什麼新發現或進度？`)}>💬 搭話</button>
                  </div>
                </div>
              )) : <div className="popup-empty">這個房間目前沒有人。</div>}
            </div>
            <div className="modal-label" style={{ marginTop: 12 }}>調度其他同事進入「{zone?.name}」：</div>
            <div className="zone-summon-row">
              {office.agents.filter((a) => a.zoneId !== popup.zoneId).map((a) => (
                <button
                  type="button"
                  key={a.id}
                  className="summon-chip"
                  onClick={() => onMoveAgent(
                    a,
                    popup.zoneId === "rest" || popup.zoneId === "lounge" ? "idle" : popup.zoneId === "meeting" ? "reviewing" : "thinking",
                    popup.zoneId,
                  )}
                >
                  ＋ 召喚 {a.avatar} {a.name}
                </button>
              ))}
            </div>
            <div className="modal-actions"><button type="button" className="primary-button" onClick={onClose}>關閉視窗</button></div>
          </>
        );
      }

      case "agent-chat": {
        const agent = office.agents.find((a) => a.id === popup.agentId) ?? office.agents[0];
        const lastThought = thoughts.find((t) => t.agentId === agent.id);
        return (
          <>
            <span className="modal-eyebrow">RPG DIALOGUE · 一對一深度對話</span>
            <h2>{agent.avatar} 與「{agent.name}」（{agent.role}）對話</h2>
            <div className="rpg-dialogue-box">
              <div className="rpg-thought-line">💭 內心思考：{lastThought?.thought ?? agent.bubble}</div>
              <div className="rpg-speech-line">「{agent.latestOutput}」</div>
            </div>
            <label className="modal-label" htmlFor="rpg-chat-input">你想對 {agent.name} 說什麼或交辦什麼？</label>
            <textarea
              id="rpg-chat-input"
              value={input}
              onChange={(e) => onInput(e.target.value)}
              placeholder={`直接對 ${agent.name} 下指令，例如：幫我列出 3 個具體改善方案…`}
              rows={3}
              autoFocus
            />
            <div className="rpg-quick-prompts">
              {["報告目前進度與瓶頸", "給我 3 個可立即執行的點子", "幫我檢查這份任務有沒有遺漏風險"].map((p) => (
                <button type="button" key={p} onClick={() => onInput(p)}>{p}</button>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={onClose}>結束對話</button>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  const q = input.trim() || "請跟我報告你目前的想法與建議。";
                  onRunAgent(agent, q, `先前對話輸出：${agent.latestOutput}`, agent.taskId);
                }}
              >
                送出並看 {agent.name} 思考反應 <span>→</span>
              </button>
            </div>
          </>
        );
      }

      case "agent-tools": {
        const agent = office.agents.find((a) => a.id === popup.agentId) ?? office.agents[0];
        return (
          <>
            <span className="modal-eyebrow">TOOL EXECUTION LOG · 工具呼叫紀錄</span>
            <h2>⌘ {agent.avatar} {agent.name} 的工具與 API 紀錄</h2>
            <p>顯示此角色在辦公室中呼叫過的所有內部工具與 Gemini 模型紀錄：</p>
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
                ⚡ 觸發新一次 AI 工具呼叫
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
            <span className="modal-eyebrow">FULL DELIVERABLE · 完整產出報告</span>
            <h2>📄 {agent.avatar} {agent.name} 的最新產出與思考脈絡</h2>
            {lastThought && (
              <div className="rpg-thought-box">
                <strong>🧠 思考推理過程（{lastThought.model} · {((lastThought.elapsedMs ?? 1200) / 1000).toFixed(1)}s）：</strong>
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
                📋 複製報告文字
              </button>
              <button type="button" className="primary-button" onClick={() => onRunAgent(agent, "請把上面這份產出再擴充得更具體，加入執行檢核表。", agent.latestOutput, agent.taskId)}>
                🧠 讓 {agent.name} 深入展開 <span>→</span>
              </button>
            </div>
          </>
        );
      }

      case "panel-menu": {
        const agent = selectedAgent ?? office.agents[0];
        return (
          <>
            <span className="modal-eyebrow">QUICK COMMAND MENU · 進階操作選單</span>
            <h2>⚙️ 角色與任務快速調度</h2>
            <p>針對目前選取的「{agent.name}」執行快速狀態切換或 AI 指令：</p>
            <div className="rpg-quick-prompts" style={{ marginBottom: 14 }}>
              {(["thinking", "researching", "writing", "coding", "reviewing", "blocked", "idle"] as AgentStatus[]).map((st) => (
                <button type="button" key={st} onClick={() => onMoveAgent(agent, st)}>
                  設為「{statusNames[st]}」
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={onClose}>取消</button>
              <button type="button" className="primary-button" onClick={() => onRunAgent(agent, "請總結你今天的產出並提出一個創新建議。")}>
                ⚡ 立即呼叫 Gemini
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
            <span className="modal-eyebrow">ATTACHMENT MANAGER · 任務附件視窗</span>
            <h2>▤ {popup.file ? `預覽附件：${popup.file}` : `新增附件至「${task.title}」`}</h2>
            {popup.file ? (
              <>
                <p>這是任務「{task.title}」的關聯檔案。你可以請負責同事 {owner.name} 直接用 AI 分析這份附件：</p>
                <div className="rpg-output-full">
                  檔案名稱：{popup.file}{"\n"}
                  所屬任務：{task.title}{"\n"}
                  任務目標：{task.goal}
                </div>
                <div className="modal-actions">
                  <button type="button" className="cancel-button" onClick={onClose}>關閉</button>
                  <button type="button" className="primary-button" onClick={() => onRunAgent(owner, `請針對附件「${popup.file}」撰寫重點摘要與審核意見。`, task.goal, task.id)}>
                    🧠 請 {owner.name} 分析此附件
                  </button>
                </div>
              </>
            ) : (
              <>
                <label className="modal-label" htmlFor="new-attachment">輸入附件檔名或規格連結</label>
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
                    ＋ 加入附件清單
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
            <span className="modal-eyebrow">AI TEAM BRAINSTORM · 全員會議腦力激盪</span>
            <h2>🧠 召開 AI 團隊即時同步會議</h2>
            <p>輸入你想討論的議題，Gemini 會模擬小橘、阿研、阿碼、數據、小處的觀點，自動更新會議摘要、分歧與決策：</p>
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
                開始 AI 腦力激盪 <span>→</span>
              </button>
            </div>
          </>
        );

      case "activity-log": {
        const chosen = popup.eventId ? office.events.find((e) => e.id === popup.eventId) : undefined;
        return (
          <>
            <span className="modal-eyebrow">ACTIVITY CHRONICLE · 辦公室完整事件紀錄</span>
            <h2>📜 {chosen ? chosen.summary : `全辦公室事件日誌（共 ${office.events.length} 筆）`}</h2>
            {chosen && (
              <div className="rpg-thought-box" style={{ marginBottom: 12 }}>
                <strong>時間：{chosen.time} · 類型：{chosen.type}</strong>
                <p style={{ whiteSpace: "pre-wrap" }}>{chosen.detail}</p>
              </div>
            )}
            <div className="popup-list" style={{ maxHeight: 260, overflow: "auto" }}>
              {office.events.map((ev) => {
                const ag = office.agents.find((a) => a.id === ev.agentId);
                return (
                  <div key={ev.id} className="popup-list-row">
                    <div>
                      <strong>[{ev.time}] {ag?.avatar} {ag?.name ?? "系統"}：{ev.summary}</strong>
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
            <span className="modal-eyebrow">THOUGHT INSPECTOR · 思考狀態明細</span>
            <h2>🧠 {rec.avatar} {rec.agentName}（{rec.role}）的思考鏈</h2>
            <p>階段：<strong>{rec.stage}</strong> · 模型：<code>{rec.model}</code> · 耗時：{((rec.elapsedMs ?? 1200) / 1000).toFixed(2)} 秒</p>
            <div className="rpg-thought-box">
              <strong>📥 接收到的指令：</strong>
              <p>{rec.prompt}</p>
            </div>
            <div className="rpg-thought-box">
              <strong>💭 角色內心思考（Thought Process）：</strong>
              <p>{rec.thought}</p>
            </div>
            <div className="rpg-output-full">{rec.outputPreview || "（推論進行中…）"}</div>
            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={onClose}>關閉</button>
              <button type="button" className="primary-button" onClick={() => onRunAgent(ag, `請延續你剛才的想法「${rec.thought}」，再往下推演一步具體行動。`)}>
                🔄 讓他繼續往下思考 <span>→</span>
              </button>
            </div>
          </>
        );
      }

      case "ui-studio":
        return (
          <>
            <span className="modal-eyebrow">STRUCTURED UI CONFIG · 阿研介面參數設定表</span>
            <h2>🎨 交由研究員「🧑🏻‍🔬 阿研」更新網站固定介面欄位</h2>
            <p>直接填寫下方固有欄位並按確認，阿研會立即套用參數並透過 Gemini 進行介面調整與紀錄：</p>
            {uiPatch?.summary && (
              <div className="rpg-thought-box">
                <strong>✨ 阿研上次完成的介面更新回報：</strong>
                <p>{uiPatch.summary}</p>
              </div>
            )}

            <div className="ui-config-grid">
              <label className="modal-label">
                1. 網站主標題 (Brand Title)
                <input
                  type="text"
                  className="ui-field-input"
                  value={uiForm.brandTitle}
                  onChange={(e) => onChangeUiForm({ ...uiForm, brandTitle: e.target.value })}
                />
              </label>
              <label className="modal-label">
                2. 總監歡迎大標 (Headline)
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
                4. 面板與卡片底色 (--paper)
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
                5. 邊框與文字主色 (--charcoal)
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
                6. 整體字級倍率 (0.85 ~ 1.35)
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
                7. 右側資訊欄寬度 (px, 280 ~ 500)
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
                8. 卡片與按鈕圓角 (px, 0 ~ 20)
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
              9. 給阿研的補充細節指令（選填，阿研會額外生成對應 CSS）
            </label>
            <textarea
              id="ui-evolve-note"
              value={uiForm.note}
              onChange={(e) => onChangeUiForm({ ...uiForm, note: e.target.value })}
              placeholder="選填：若有其他特定區塊想微調（例如房間底色、陰影粗細）可填寫於此…"
              rows={2}
            />

            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={onResetUi}>↩ 還原預設值</button>
              <button type="button" className="cancel-button" onClick={onClose}>取消</button>
              <button
                type="button"
                className="primary-button"
                onClick={onSubmitUiForm}
              >
                ✓ 確認送出並由阿研更新介面 <span>→</span>
              </button>
            </div>
          </>
        );

      case "agent-create": {
        const customAgents = office.agents.filter((a) => a.id.startsWith("custom-"));
        return (
          <>
            <span className="modal-eyebrow">CHARACTER CREATOR · 建立新 AI 角色固定欄位表</span>
            <h2>🧑🏻‍🎨 招募新 AI 同事進駐辦公室</h2>
            <p>填寫下方固有角色設定欄位並確認，新角色會立即出現在你指定的房間，並以該專業身分接上 Gemini：</p>

            <div className="ui-config-grid">
              <label className="modal-label">
                1. 角色名稱 (必填，例如：小財)
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
                2. 職稱與專業定位 (作為 Gemini 人設)
                <input
                  type="text"
                  className="ui-field-input"
                  placeholder="例如：量化籌碼分析師 / 法務顧問"
                  value={newAgentForm.role}
                  onChange={(e) => onChangeNewAgentForm({ ...newAgentForm, role: e.target.value })}
                />
              </label>

              <label className="modal-label">
                3. 角色頭像 (可點選圖示、貼網址或上傳圖片)
                <div className="avatar-input-row">
                  <span className="avatar-preview-box">
                    <AvatarView avatar={newAgentForm.avatar || "🕵🏻‍♂️"} />
                  </span>
                  <input
                    type="text"
                    className="ui-field-input"
                    placeholder="輸入 Emoji 或圖片網址…"
                    value={newAgentForm.avatar}
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
                    <option key={z.id} value={z.id}>{z.marker} {z.name}（{z.subtitle}）</option>
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
                6. 頭頂口頭禪氣泡
                <input
                  type="text"
                  className="ui-field-input"
                  value={newAgentForm.bubble}
                  onChange={(e) => onChangeNewAgentForm({ ...newAgentForm, bubble: e.target.value })}
                />
              </label>
            </div>

            <div className="modal-label" style={{ marginTop: 6 }}>點選可快速切換角色圖示：</div>
            <div className="avatar-preset-grid">
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
              7. 角色專屬 Skill 核心專長與規範（將自動寫入 `.agents/skills/office-colleague-.../SKILL.md`）
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
              8. 首項交辦任務（選填：若填寫，角色報到後會立即呼叫 Gemini 開始思考產出）
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
                <div className="modal-label">目前你已招募的自訂角色：</div>
                {customAgents.map((ca) => (
                  <div key={ca.id} className="popup-list-row">
                    <span className="row-with-avatar"><span className="inline-avatar"><AvatarView avatar={ca.avatar} role={ca.role} /></span> <strong>{ca.name}</strong> · {ca.role}</span>
                    <div className="popup-row-btns">
                      <button type="button" onClick={() => onSelectAgent(ca.id)}>查看</button>
                      <button type="button" onClick={() => onDeleteCustomAgent(ca.id)}>移除角色</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={onClose}>取消</button>
              <button type="button" className="primary-button" onClick={onSubmitCreateAgent}>
                ✓ 確認招募並派駐辦公室 <span>→</span>
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
            <span className="modal-eyebrow">AVATAR CUSTOMIZER · 角色頭像自由更換器</span>
            <h2>🖼️ 更換「{target.name}（{target.role}）」的頭像</h2>
            <p>你可以直接點選下方 24 款圖示、輸入任何 Emoji／圖片網址，或從電腦上傳 PNG / JPG / GIF 圖片檔：</p>

            <div className="avatar-picker-hero">
              <div className="avatar-preview-large">
                <AvatarView avatar={currentAvatar} role={target.role} />
              </div>
              <div className="avatar-picker-controls">
                <label className="modal-label">
                  直接輸入 Emoji 或圖片網址 (URL / Data URI)
                  <input
                    type="text"
                    className="ui-field-input"
                    value={input}
                    onChange={(e) => onInput(e.target.value)}
                    placeholder="輸入 Emoji 或 https://... 圖片網址"
                  />
                </label>
                <div className="avatar-upload-row">
                  <label className="upload-avatar-btn upload-avatar-btn-large">
                    📁 從電腦選擇圖片上傳 (PNG / JPG / GIF / WebP)
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

            <div className="modal-label" style={{ marginTop: 10 }}>快速點選圖示庫：</div>
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
                ✓ 確認套用新頭像 <span>→</span>
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
            <span className="modal-eyebrow">ANTIGRAVITY SKILL REGISTRY · 同事專屬技能包管理</span>
            <h2>📘 {target.name}（{target.role}）的專屬 Skill 檔案</h2>
            <p>每位既有同事與新招募同事都會自動建置為標準 Antigravity Skill（支援點名 <code>/{target.name}</code> 觸發，並在呼叫 Gemini 時自動掛載）：</p>

            <div className="zone-summon-row" style={{ marginBottom: 10 }}>
              {office.agents.map((ag) => (
                <button
                  type="button"
                  key={ag.id}
                  className={`summon-chip ${ag.id === target.id ? "avatar-cell-active" : ""}`}
                  onClick={() => onSelectSkillAgent(ag.id)}
                >
                  <span className="inline-avatar"><AvatarView avatar={ag.avatar} role={ag.role} /></span> {ag.name} ({skillsMap[ag.id]?.skillName ?? "skill"})
                </button>
              ))}
            </div>

            {skill?.paths?.length ? (
              <div className="rpg-thought-box" style={{ marginBottom: 8 }}>
                <strong>📂 已自動同步寫入的實體 Skill 路徑：</strong>
                {skill.paths.map((p) => (
                  <div key={p} style={{ fontFamily: "monospace", fontSize: "8.5px", marginTop: 2 }}>{p}</div>
                ))}
              </div>
            ) : null}

            <label className="modal-label" htmlFor="skill-md-editor">
              SKILL.md 內容（可直接修改並儲存寫回磁碟）：
            </label>
            <textarea
              id="skill-md-editor"
              value={input}
              onChange={(e) => onInput(e.target.value)}
              rows={10}
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
                💾 儲存並寫入 SKILL.md <span>→</span>
              </button>
            </div>
          </>
        );
      }

      case "api-key":
        return (
          <>
            <span className="modal-eyebrow">GITHUB PAGES & MOBILE DIRECT MODE · 金鑰設定</span>
            <h2>🔑 手機 / GitHub Pages 直連金鑰設定</h2>
            <p>
              當你在電腦關機、使用手機連上 <strong>GitHub Pages</strong> 時，網站會自動切換為「純前端瀏覽器直連模式」。
              請在下方填入你的 <code>GEMINI_API_KEY</code>，金鑰<strong>只會儲存在你目前手機或瀏覽器的本機儲存空間 (localStorage)</strong>，絕對不會上傳至 GitHub 公開儲存庫！
            </p>
            <div className="rpg-thought-box" style={{ marginBottom: 10 }}>
              <strong>💡 運作狀態：</strong>{" "}
              {browserApiKey
                ? `目前已設定瀏覽器金鑰（${browserApiKey.slice(0, 6)}...${browserApiKey.slice(-4)}），手機隨時可直接呼叫 Gemini！`
                : "尚未設定瀏覽器端金鑰（若在桌機本機執行則會自動使用 app.py 的 .env 金鑰）。"}
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
                ✓ 儲存金鑰到本機瀏覽器 <span>→</span>
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
    assign: { eyebrow: "NEW ASSIGNMENT", title: "派一個新任務", description: "說明希望團隊完成什麼，並選擇負責的 AI 同事。", label: "任務目標", placeholder: "例如：整理本週產品研究重點…" },
    context: { eyebrow: "ADD CONTEXT", title: "補充工作資料", description: "提供額外背景或資訊，讓同事更好地繼續工作。", label: "補充內容", placeholder: "輸入背景資訊、連結或注意事項…" },
    revision: { eyebrow: "REQUEST REVISION", title: "要求修改", description: "清楚描述希望調整的方向，這會加入工作活動紀錄。", label: "修改方向", placeholder: "例如：請再確認數據來源並補上限制…" },
  }[kind];
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="action-modal" onSubmit={onSubmit}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="關閉">×</button>
        <div className="modal-icon">{kind === "assign" ? "＋" : kind === "context" ? "▤" : "↻"}</div>
        <span className="modal-eyebrow">{copy.eyebrow}</span>
        <h2>{copy.title}</h2>
        <p>{copy.description}</p>
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
