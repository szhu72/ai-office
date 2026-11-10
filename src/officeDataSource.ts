import { initialOffice } from "./mockOffice";
import type { ActivityEvent, Agent, AgentStatus, MeetingSummary, OfficeState, OfficeTask, OfficeWorkspaceMode, ToolRecord, Zone } from "./types";

export type OfficeAction =
  | { type: "workspace.setMode"; mode: OfficeWorkspaceMode }
  | { type: "workspace.resetDemo" }
  | { type: "agent.status"; agentId: string; status: AgentStatus; bubble: string; zoneId?: string; progress?: number; tool?: ToolRecord; event: ActivityEvent }
  | { type: "agent.create"; agent: Agent; task?: OfficeTask; event: ActivityEvent }
  | { type: "agent.remove"; agentId: string; event: ActivityEvent }
  | { type: "agent.hydrateCustom"; agents: Agent[] }
  | { type: "agent.avatar"; agentId: string; avatar: string; event: ActivityEvent }
  | { type: "agent.hydrateAvatars"; avatars: Record<string, string> }
  | { type: "agent.updateProfile"; agentId: string; patch: Partial<Agent>; event: ActivityEvent }
  | { type: "agent.hydrateProfiles"; profiles: Record<string, Partial<Agent>> }
  | { type: "task.create"; task: OfficeTask; ownerId: string; event: ActivityEvent }
  | { type: "task.approve"; taskId: string; event: ActivityEvent }
  | { type: "task.finish"; taskId: string; event: ActivityEvent }
  | { type: "task.revise"; taskId?: string; ownerId: string; event: ActivityEvent }
  | { type: "task.toggleStep"; taskId: string; stepIndex: number; event: ActivityEvent }
  | { type: "task.addAttachment"; taskId: string; fileName: string; event: ActivityEvent }
  | { type: "meeting.update"; meeting: MeetingSummary; event: ActivityEvent }
  | { type: "activity.append"; event: ActivityEvent }
  | {
      type: "agent.output";
      agentId: string;
      status: AgentStatus;
      bubble: string;
      output: string;
      tool?: ToolRecord;
      taskId?: string;
      taskStatus?: OfficeTask["status"];
      event: ActivityEvent;
    };

export interface OfficeDataSource {
  getSnapshot(): OfficeState;
  subscribe(listener: () => void): () => void;
  dispatch(action: OfficeAction): void;
}

const zoneByStatus: Record<AgentStatus, string> = {
  idle: "rest",
  thinking: "board",
  researching: "work",
  writing: "work",
  coding: "work",
  reviewing: "board",
  blocked: "board",
  error: "work",
};

const LS_RUNTIME_SAVE = "aioffice_runtime_save_v2";
const LS_ACTIVE_MODE = "aioffice_active_mode_v2";

function formatTimestamp(): string {
  try {
    return new Date().toLocaleTimeString("zh-TW", { hour12: false });
  } catch {
    return "";
  }
}

function detectInitialMode(): OfficeWorkspaceMode {
  try {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("demo") === "1" || params.get("demo") === "true" || params.get("mode") === "demo") {
        return "demo";
      }
      const saved = localStorage.getItem(LS_ACTIVE_MODE);
      if (saved === "demo") return "demo";
    }
  } catch {
    // ignore
  }
  return "work";
}

function loadSavedWorkState(): OfficeState | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(LS_RUNTIME_SAVE);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.tasks) && Array.isArray(parsed.agents)) {
        return parsed as OfficeState;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export class LocalOfficeDataSource implements OfficeDataSource {
  private snapshot: OfficeState;
  private listeners = new Set<() => void>();

  constructor() {
    const initialMode = detectInitialMode();
    if (initialMode === "demo") {
      this.snapshot = {
        ...structuredClone(initialOffice),
        mode: "demo",
        lastSavedAt: "",
      };
    } else {
      const saved = loadSavedWorkState();
      if (saved) {
        // Re-align zones to the latest 4-room layout (tasks, work, board, rest)
        const updatedZones: Zone[] = structuredClone(initialOffice.zones);
        this.snapshot = {
          ...saved,
          zones: updatedZones,
          mode: "work",
          lastSavedAt: saved.lastSavedAt || formatTimestamp(),
        };
      } else {
        this.snapshot = {
          ...structuredClone(initialOffice),
          mode: "work",
          lastSavedAt: formatTimestamp(),
        };
        this.persistWorkState();
      }
    }
  }

  getSnapshot = (): OfficeState => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private persistWorkState = () => {
    if (this.snapshot.mode === "demo") return; // 展示模式絕對不覆蓋作業存檔！
    try {
      if (typeof window === "undefined") return;
      const cleanState: OfficeState = {
        ...this.snapshot,
        mode: "work",
        lastSavedAt: formatTimestamp(),
        events: this.snapshot.events.slice(0, 50), // 保留最新 50 筆事件，防止儲存爆滿
      };
      this.snapshot = cleanState;
      localStorage.setItem(LS_RUNTIME_SAVE, JSON.stringify(cleanState));
      localStorage.setItem(LS_ACTIVE_MODE, "work");
    } catch {
      // QuotaExceeded or disabled
    }
  };

  dispatch = (action: OfficeAction): void => {
    switch (action.type) {
      case "workspace.setMode": {
        if (action.mode === "demo") {
          // 進入展示模式前，先把當前作業狀態強制存檔，保證安全無虞
          this.persistWorkState();
          const demoClone = structuredClone(initialOffice);
          // Preserve custom avatars and custom agents for presentation
          const avatarMap: Record<string, string> = {};
          this.snapshot.agents.forEach((a) => {
            if (a.avatar) avatarMap[a.id] = a.avatar;
          });
          demoClone.agents = demoClone.agents.map((a) => avatarMap[a.id] ? { ...a, avatar: avatarMap[a.id] } : a);
          this.snapshot = {
            ...demoClone,
            mode: "demo",
            lastSavedAt: "",
          };
          try {
            localStorage.setItem(LS_ACTIVE_MODE, "demo");
          } catch {
            // ignore
          }
        } else {
          // 切回作業模式：自持久化存檔點 100% 完整還原
          const saved = loadSavedWorkState();
          if (saved) {
            this.snapshot = {
              ...saved,
              zones: structuredClone(initialOffice.zones),
              mode: "work",
              lastSavedAt: saved.lastSavedAt || formatTimestamp(),
            };
          } else {
            this.snapshot = {
              ...structuredClone(initialOffice),
              mode: "work",
              lastSavedAt: formatTimestamp(),
            };
          }
          try {
            localStorage.setItem(LS_ACTIVE_MODE, "work");
          } catch {
            // ignore
          }
        }
        break;
      }

      case "workspace.resetDemo": {
        // 展示模式下的重新整理沙盒（不影響作業存檔）
        const demoClone = structuredClone(initialOffice);
        const avatarMap: Record<string, string> = {};
        this.snapshot.agents.forEach((a) => {
          if (a.avatar) avatarMap[a.id] = a.avatar;
        });
        demoClone.agents = demoClone.agents.map((a) => avatarMap[a.id] ? { ...a, avatar: avatarMap[a.id] } : a);
        this.snapshot = {
          ...demoClone,
          mode: "demo",
          lastSavedAt: "",
        };
        break;
      }

      case "agent.status": {
        const rawZone = action.zoneId ?? zoneByStatus[action.status];
        const safeZone = rawZone === "tasks" ? "work" : rawZone === "lounge" ? "rest" : rawZone === "meeting" ? "board" : rawZone;
        this.snapshot = {
          ...this.snapshot,
          agents: this.snapshot.agents.map((agent) => agent.id === action.agentId
            ? {
                ...agent,
                status: action.status,
                zoneId: safeZone,
                bubble: action.bubble,
                progress: action.progress ?? agent.progress,
                tools: action.tool ? [action.tool, ...agent.tools.slice(0, 5)] : agent.tools,
              }
            : agent),
          events: [action.event, ...this.snapshot.events],
        };
        this.persistWorkState();
        break;
      }

      case "agent.create":
        this.snapshot = {
          ...this.snapshot,
          agents: [...this.snapshot.agents.filter((a) => a.id !== action.agent.id), action.agent],
          tasks: action.task ? [action.task, ...this.snapshot.tasks] : this.snapshot.tasks,
          events: [action.event, ...this.snapshot.events],
        };
        this.persistWorkState();
        break;

      case "agent.remove":
        this.snapshot = {
          ...this.snapshot,
          agents: this.snapshot.agents.filter((a) => a.id !== action.agentId),
          events: [action.event, ...this.snapshot.events],
        };
        this.persistWorkState();
        break;

      case "agent.hydrateCustom": {
        const existingIds = new Set(this.snapshot.agents.map((a) => a.id));
        const toAdd = action.agents.filter((a) => !existingIds.has(a.id));
        if (!toAdd.length) return;
        this.snapshot = {
          ...this.snapshot,
          agents: [...this.snapshot.agents, ...toAdd],
        };
        this.persistWorkState();
        break;
      }

      case "agent.avatar":
        this.snapshot = {
          ...this.snapshot,
          agents: this.snapshot.agents.map((a) => a.id === action.agentId ? { ...a, avatar: action.avatar } : a),
          events: [action.event, ...this.snapshot.events],
        };
        this.persistWorkState();
        break;

      case "agent.hydrateAvatars":
        this.snapshot = {
          ...this.snapshot,
          agents: this.snapshot.agents.map((a) => action.avatars[a.id] ? { ...a, avatar: action.avatars[a.id] } : a),
        };
        this.persistWorkState();
        break;

      case "agent.updateProfile":
        this.snapshot = {
          ...this.snapshot,
          agents: this.snapshot.agents.map((a) => a.id === action.agentId ? { ...a, ...action.patch } : a),
          events: [action.event, ...this.snapshot.events],
        };
        this.persistWorkState();
        break;

      case "agent.hydrateProfiles":
        this.snapshot = {
          ...this.snapshot,
          agents: this.snapshot.agents.map((a) => {
            const patch = action.profiles[a.id];
            return patch ? { ...a, ...patch } : a;
          }),
        };
        this.persistWorkState();
        break;

      case "task.create":
        this.snapshot = {
          ...this.snapshot,
          tasks: [action.task, ...this.snapshot.tasks],
          agents: this.snapshot.agents.map((agent) => agent.id === action.ownerId
            ? { ...agent, taskId: action.task.id, status: "thinking", zoneId: "board", bubble: "🎯 收到新交辦，拆解中…", progress: 18 }
            : agent),
          events: [action.event, ...this.snapshot.events],
        };
        this.persistWorkState();
        break;

      case "task.approve": {
        const task = this.snapshot.tasks.find((item) => item.id === action.taskId);
        this.snapshot = {
          ...this.snapshot,
          tasks: this.snapshot.tasks.map((item) => item.id === action.taskId
            ? { ...item, status: "已核准", progress: 100, steps: item.steps.map((s) => ({ ...s, done: true })) }
            : item),
          agents: this.snapshot.agents.map((agent) => agent.taskId === task?.id
            ? { ...agent, status: "idle", zoneId: "rest", progress: 100, bubble: "✓ 已核准結案，休息喝咖啡" }
            : agent),
          events: [action.event, ...this.snapshot.events],
        };
        this.persistWorkState();
        break;
      }

      case "task.finish": {
        const task = this.snapshot.tasks.find((item) => item.id === action.taskId);
        this.snapshot = {
          ...this.snapshot,
          tasks: this.snapshot.tasks.map((item) => item.id === action.taskId
            ? { ...item, status: "已結束", progress: 100, steps: item.steps.map((s) => ({ ...s, done: true })) }
            : item),
          agents: this.snapshot.agents.map((agent) => agent.taskId === task?.id
            ? { ...agent, status: "idle", zoneId: "rest", progress: 100, bubble: "🏁 任務已手動結案，在休息區充電中～" }
            : agent),
          events: [action.event, ...this.snapshot.events],
        };
        this.persistWorkState();
        break;
      }

      case "task.revise":
        this.snapshot = {
          ...this.snapshot,
          tasks: this.snapshot.tasks.map((item) => item.id === action.taskId ? { ...item, status: "需修改", progress: 55 } : item),
          agents: this.snapshot.agents.map((agent) => agent.id === action.ownerId
            ? { ...agent, status: "writing", zoneId: "work", bubble: "📝 收到修改回饋，重新調整中…", progress: 55 }
            : agent),
          events: [action.event, ...this.snapshot.events],
        };
        this.persistWorkState();
        break;

      case "task.toggleStep":
        this.snapshot = {
          ...this.snapshot,
          tasks: this.snapshot.tasks.map((task) => {
            if (task.id !== action.taskId) return task;
            const steps = task.steps.map((s, idx) => idx === action.stepIndex ? { ...s, done: !s.done } : s);
            const doneCount = steps.filter((s) => s.done).length;
            const progress = steps.length ? Math.round((doneCount / steps.length) * 100) : task.progress;
            return { ...task, steps, progress };
          }),
          events: [action.event, ...this.snapshot.events],
        };
        this.persistWorkState();
        break;

      case "task.addAttachment":
        this.snapshot = {
          ...this.snapshot,
          tasks: this.snapshot.tasks.map((task) => task.id === action.taskId
            ? { ...task, attachments: [...task.attachments, action.fileName] }
            : task),
          events: [action.event, ...this.snapshot.events],
        };
        this.persistWorkState();
        break;

      case "meeting.update":
        this.snapshot = {
          ...this.snapshot,
          meeting: action.meeting,
          events: [action.event, ...this.snapshot.events],
        };
        this.persistWorkState();
        break;

      case "activity.append":
        this.snapshot = { ...this.snapshot, events: [action.event, ...this.snapshot.events] };
        this.persistWorkState();
        break;

      case "agent.output":
        this.snapshot = {
          ...this.snapshot,
          agents: this.snapshot.agents.map((agent) => agent.id === action.agentId
            ? {
                ...agent,
                status: action.status,
                zoneId: zoneByStatus[action.status],
                bubble: action.bubble,
                latestOutput: action.output,
                progress: action.status === "error" ? agent.progress : 100,
                tools: action.tool
                  ? [action.tool, ...agent.tools.filter((t) => t.kind !== "running").slice(0, 5)]
                  : agent.tools,
              }
            : agent),
          tasks: action.taskId
            ? this.snapshot.tasks.map((task) => task.id === action.taskId
              ? {
                  ...task,
                  status: action.taskStatus ?? task.status,
                  progress: action.status === "error" ? task.progress : 100,
                  steps: task.steps.map((step) => ({ ...step, done: action.status !== "error" })),
                }
              : task)
            : this.snapshot.tasks,
          events: [action.event, ...this.snapshot.events],
        };
        this.persistWorkState();
        break;
    }

    this.listeners.forEach((listener) => listener());
  };
}

export const officeDataSource: OfficeDataSource = new LocalOfficeDataSource();
