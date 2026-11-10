import { initialOffice } from "./mockOffice";
import type { ActivityEvent, Agent, AgentStatus, MeetingSummary, OfficeState, OfficeTask, ToolRecord } from "./types";

export type OfficeAction =
  | { type: "agent.status"; agentId: string; status: AgentStatus; bubble: string; zoneId?: string; progress?: number; tool?: ToolRecord; event: ActivityEvent }
  | { type: "agent.create"; agent: Agent; task?: OfficeTask; event: ActivityEvent }
  | { type: "agent.remove"; agentId: string; event: ActivityEvent }
  | { type: "agent.hydrateCustom"; agents: Agent[] }
  | { type: "agent.avatar"; agentId: string; avatar: string; event: ActivityEvent }
  | { type: "agent.hydrateAvatars"; avatars: Record<string, string> }
  | { type: "task.create"; task: OfficeTask; ownerId: string; event: ActivityEvent }
  | { type: "task.approve"; taskId: string; event: ActivityEvent }
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
  reviewing: "meeting",
  blocked: "tasks",
  error: "tasks",
};

export class LocalOfficeDataSource implements OfficeDataSource {
  private snapshot: OfficeState = structuredClone(initialOffice);
  private listeners = new Set<() => void>();

  getSnapshot = (): OfficeState => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispatch = (action: OfficeAction): void => {
    switch (action.type) {
      case "agent.status":
        this.snapshot = {
          ...this.snapshot,
          agents: this.snapshot.agents.map((agent) => agent.id === action.agentId
            ? {
                ...agent,
                status: action.status,
                zoneId: action.zoneId ?? zoneByStatus[action.status],
                bubble: action.bubble,
                progress: action.progress ?? agent.progress,
                tools: action.tool ? [action.tool, ...agent.tools.slice(0, 5)] : agent.tools,
              }
            : agent),
          events: [action.event, ...this.snapshot.events],
        };
        break;
      case "agent.create":
        this.snapshot = {
          ...this.snapshot,
          agents: [...this.snapshot.agents.filter((a) => a.id !== action.agent.id), action.agent],
          tasks: action.task ? [action.task, ...this.snapshot.tasks] : this.snapshot.tasks,
          events: [action.event, ...this.snapshot.events],
        };
        break;
      case "agent.remove":
        this.snapshot = {
          ...this.snapshot,
          agents: this.snapshot.agents.filter((a) => a.id !== action.agentId),
          events: [action.event, ...this.snapshot.events],
        };
        break;
      case "agent.hydrateCustom": {
        const existingIds = new Set(this.snapshot.agents.map((a) => a.id));
        const toAdd = action.agents.filter((a) => !existingIds.has(a.id));
        if (!toAdd.length) return;
        this.snapshot = {
          ...this.snapshot,
          agents: [...this.snapshot.agents, ...toAdd],
        };
        break;
      }
      case "agent.avatar":
        this.snapshot = {
          ...this.snapshot,
          agents: this.snapshot.agents.map((a) => a.id === action.agentId ? { ...a, avatar: action.avatar } : a),
          events: [action.event, ...this.snapshot.events],
        };
        break;
      case "agent.hydrateAvatars":
        this.snapshot = {
          ...this.snapshot,
          agents: this.snapshot.agents.map((a) => action.avatars[a.id] ? { ...a, avatar: action.avatars[a.id] } : a),
        };
        break;
      case "task.create":
        this.snapshot = {
          ...this.snapshot,
          tasks: [action.task, ...this.snapshot.tasks],
          agents: this.snapshot.agents.map((agent) => agent.id === action.ownerId
            ? { ...agent, taskId: action.task.id, status: "thinking", zoneId: "board", bubble: "💭 收到新任務，拆解中…", progress: 18 }
            : agent),
          events: [action.event, ...this.snapshot.events],
        };
        break;
      case "task.approve": {
        const task = this.snapshot.tasks.find((item) => item.id === action.taskId);
        this.snapshot = {
          ...this.snapshot,
          tasks: this.snapshot.tasks.map((item) => item.id === action.taskId
            ? { ...item, status: "已核准", progress: 100, steps: item.steps.map((s) => ({ ...s, done: true })) }
            : item),
          agents: this.snapshot.agents.map((agent) => agent.taskId === task?.id
            ? { ...agent, status: "idle", zoneId: "rest", progress: 100, bubble: "✨ 已核准結案！喝杯咖啡" }
            : agent),
          events: [action.event, ...this.snapshot.events],
        };
        break;
      }
      case "task.revise":
        this.snapshot = {
          ...this.snapshot,
          tasks: this.snapshot.tasks.map((item) => item.id === action.taskId ? { ...item, status: "需修改", progress: 55 } : item),
          agents: this.snapshot.agents.map((agent) => agent.id === action.ownerId
            ? { ...agent, status: "writing", zoneId: "work", bubble: "💭 收到修改方向，重新推論…", progress: 55 }
            : agent),
          events: [action.event, ...this.snapshot.events],
        };
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
        break;
      case "task.addAttachment":
        this.snapshot = {
          ...this.snapshot,
          tasks: this.snapshot.tasks.map((task) => task.id === action.taskId
            ? { ...task, attachments: [...task.attachments, action.fileName] }
            : task),
          events: [action.event, ...this.snapshot.events],
        };
        break;
      case "meeting.update":
        this.snapshot = {
          ...this.snapshot,
          meeting: action.meeting,
          events: [action.event, ...this.snapshot.events],
        };
        break;
      case "activity.append":
        this.snapshot = { ...this.snapshot, events: [action.event, ...this.snapshot.events] };
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
        break;
    }

    this.listeners.forEach((listener) => listener());
  };
}

export const officeDataSource: OfficeDataSource = new LocalOfficeDataSource();
