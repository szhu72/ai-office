import type { Agent } from "./types";

/**
 * Single source of truth for colleague avatars.
 *
 * Avatars are part of the repository (public/avatars), so every device, URL and
 * deploy shows the same picture. Nothing stored in the browser (old work saves,
 * avatar overrides, profile edits) can change them: `enforceAvatars` runs on
 * every data-source update and puts the registered avatar back.
 */

const SLIME = (name: string) => `./avatars/slimes/${name}.svg`;

/** Fixed, locked avatars for the current colleagues and the two mascots. */
export const LOCKED_AVATARS: Readonly<Record<string, string>> = {
  planner: SLIME("planner"),
  researcher: SLIME("researcher"),
  engineer: SLIME("engineer"),
  analyst: SLIME("analyst"),
  virgo: SLIME("virgo"),
  momo: "./avatars/mimi.webp",
  "custom-1794277128232": "./avatars/dongdong.webp",
};

export interface SlimePreset {
  avatar: string;
  label: string;
  keywords: string[];
}

/** Slimes for newly recruited colleagues, matched by role / department / positioning text. */
export const SLIME_PRESETS: readonly SlimePreset[] = [
  { avatar: SLIME("designer"), label: "設計師", keywords: ["設計", "美術", "視覺", "插畫", "ui", "ux", "design", "art"] },
  { avatar: SLIME("marketing"), label: "行銷", keywords: ["行銷", "社群", "公關", "品牌", "廣告", "業務", "銷售", "marketing", "sales", "pr"] },
  { avatar: SLIME("finance"), label: "財務", keywords: ["財務", "會計", "預算", "財會", "出納", "稅", "投資", "finance", "account"] },
  { avatar: SLIME("nightops"), label: "夜班維運", keywords: ["維運", "運維", "夜班", "監控", "伺服器", "系統", "資安", "devops", "sre", "ops", "infra"] },
];

/** Fallback when no preset matches or every matching preset is taken. */
export const NEWCOMER_AVATAR = SLIME("newcomer");

const PRESET_AVATARS = new Set([...SLIME_PRESETS.map((p) => p.avatar), NEWCOMER_AVATAR]);

/**
 * Pick an avatar for a new colleague: the matching preset nobody uses yet,
 * otherwise the newcomer slime (shared if necessary).
 */
export function pickAvatarFor(profileText: string, usedAvatars: ReadonlySet<string>): string {
  const text = profileText.toLowerCase();
  const scored = SLIME_PRESETS
    .map((preset) => ({ preset, score: preset.keywords.filter((k) => text.includes(k)).length }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  const match = scored.find((entry) => !usedAvatars.has(entry.preset.avatar));
  return match ? match.preset.avatar : NEWCOMER_AVATAR;
}

const profileTextOf = (agent: Agent) =>
  [agent.role, agent.department, agent.positioning, agent.specialty, agent.name].filter(Boolean).join(" ");

/**
 * Return agents whose avatars follow the registry. Returns the same array instance
 * when nothing had to change, so callers can cheaply detect "no update".
 */
export function enforceAvatars(agents: Agent[]): Agent[] {
  const used = new Set<string>();
  // Locked colleagues claim their avatars first.
  for (const agent of agents) {
    const locked = LOCKED_AVATARS[agent.id];
    if (locked) used.add(locked);
  }
  let changed = false;
  const next = agents.map((agent) => {
    const locked = LOCKED_AVATARS[agent.id];
    let avatar: string;
    if (locked) {
      avatar = locked;
    } else if (PRESET_AVATARS.has(agent.avatar) && (agent.avatar === NEWCOMER_AVATAR || !used.has(agent.avatar))) {
      avatar = agent.avatar; // already has a valid, unclaimed preset — keep it stable
    } else {
      avatar = pickAvatarFor(profileTextOf(agent), used);
    }
    used.add(avatar);
    if (avatar === agent.avatar) return agent;
    changed = true;
    return { ...agent, avatar };
  });
  return changed ? next : agents;
}
