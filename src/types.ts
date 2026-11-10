export type AgentStatus =
  | "idle"
  | "thinking"
  | "researching"
  | "writing"
  | "coding"
  | "reviewing"
  | "blocked"
  | "error";

export type TaskStatus = "進行中" | "待審核" | "已核准" | "需修改";

export interface ToolRecord {
  name: string;
  detail: string;
  time: string;
  kind: "success" | "running" | "warning";
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  avatar: string;
  status: AgentStatus;
  taskId: string;
  progress: number;
  zoneId: string;
  bubble: string;
  latestOutput: string;
  tools: ToolRecord[];
}

export interface TaskStep {
  label: string;
  done: boolean;
}

export interface OfficeTask {
  id: string;
  title: string;
  goal: string;
  ownerId: string;
  status: TaskStatus;
  progress: number;
  steps: TaskStep[];
  attachments: string[];
  due: string;
}

export interface Zone {
  id: string;
  name: string;
  kind: "work" | "break" | "meeting" | "board" | "tasks";
  subtitle: string;
  marker: string;
  position: { column: number; row: number };
}

export interface ActivityEvent {
  id: string;
  time: string;
  type: "tool" | "file" | "message" | "error" | "handoff";
  agentId: string;
  summary: string;
  detail: string;
}

export interface MeetingSummary {
  summary: string;
  disagreements: string[];
  decisions: string[];
  humanConfirmations: string[];
}

export interface OfficeState {
  agents: Agent[];
  tasks: OfficeTask[];
  zones: Zone[];
  events: ActivityEvent[];
  meeting: MeetingSummary;
}

export type PanelSelection =
  | { kind: "agent"; id: string }
  | { kind: "task"; id: string }
  | { kind: "meeting" }
  | null;
