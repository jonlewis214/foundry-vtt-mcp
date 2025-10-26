// Shared TypeScript types for Foundry MCP Integration

/**
 * MCP Query types
 */
export interface MCPQuery {
  method: string;
  data?: unknown;
}

export interface MCPResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Character/Actor types
 */
export interface CharacterInfo {
  id: string;
  name: string;
  type: string;
  img?: string;
  system: Record<string, unknown>;
  items: CharacterItem[];
  effects: CharacterEffect[];
}

export interface CharacterItem {
  id: string;
  name: string;
  type: string;
  img?: string;
  system: Record<string, unknown>;
}

export interface CharacterEffect {
  id: string;
  name: string;
  icon?: string;
  disabled: boolean;
  duration?: {
    type: string;
    duration?: number;
    remaining?: number;
  };
}

/**
 * Compendium types
 */
export interface CompendiumSearchResult {
  id: string;
  name: string;
  type: string;
  img?: string;
  pack: string;
  packLabel: string;
  system?: Record<string, unknown>;
}

export interface CompendiumPack {
  id: string;
  label: string;
  type: string;
  system: string;
  private: boolean;
}

/**
 * Scene types
 */
export interface SceneInfo {
  id: string;
  name: string;
  img?: string;
  background?: string;
  width: number;
  height: number;
  padding: number;
  active: boolean;
  navigation: boolean;
  tokens: SceneToken[];
  walls: number;
  lights: number;
  sounds: number;
  notes: SceneNote[];
}

export interface SceneToken {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  actorId?: string;
  img: string;
  hidden: boolean;
  disposition: number;
}

export interface SceneNote {
  id: string;
  text: string;
  x: number;
  y: number;
}

/**
 * Configuration types
 */
export interface FoundryMCPConfig {
  enabled: boolean;
  mcpHost: string;
  mcpPort: number;
  connectionTimeout: number;
  debugLogging: boolean;
}

export interface MCPServerConfig {
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  foundry: {
    host: string;
    port: number;
    namespace: string;
    reconnectAttempts: number;
    reconnectDelay: number;
  };
}

/**
 * World info types
 */
export interface WorldInfo {
  id: string;
  title: string;
  system: string;
  systemVersion: string;
  foundryVersion: string;
  users: WorldUser[];
}

export interface WorldUser {
  id: string;
  name: string;
  active: boolean;
  isGM: boolean;
}

/**
 * Bridge status types
 */
export interface BridgeStatus {
  isRunning: boolean;
  config: FoundryMCPConfig;
  timestamp: number;
}

/**
 * Multipart Campaign types
 */
export type CampaignPartStatus = 'not_started' | 'in_progress' | 'completed' | 'skipped';
export type CampaignPartType = 'main_part' | 'sub_part' | 'chapter' | 'session' | 'optional';

export interface LevelRecommendation {
  start: number;
  end: number;
}

export interface NPCReference {
  id: string;
  name: string;
  actorId?: string;
}

export interface ScalingOptions {
  adjustForPartySize: boolean;
  adjustForLevel: boolean;
  difficultyModifier: number;
}

export interface CampaignSubPart {
  id: string;
  title: string;
  description: string;
  type: CampaignPartType;
  status: CampaignPartStatus;
  journalId?: string;
  createdAt?: number;
  completedAt?: number;
}

export interface CampaignPart {
  id: string;
  title: string;
  description: string;
  type: CampaignPartType;
  status: CampaignPartStatus;
  dependencies: string[];
  subParts?: CampaignSubPart[];
  questGiver?: NPCReference;
  levelRecommendation: LevelRecommendation;
  gmNotes: string;
  playerContent: string;
  scaling: ScalingOptions;
  journalId?: string;
  createdAt?: number;
  completedAt?: number;
}

export interface CampaignMetadata {
  defaultQuestGiver?: NPCReference;
  defaultLocation?: string;
  theme?: string;
  estimatedSessions?: number;
  targetLevelRange?: LevelRecommendation;
  tags: string[];
}

export interface CampaignStructure {
  id: string;
  title: string;
  description: string;
  parts: CampaignPart[];
  metadata: CampaignMetadata;
  dashboardJournalId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CampaignTemplate {
  id: string;
  name: string;
  description: string;
  parts: Array<{
    title: string;
    description: string;
    type: CampaignPartType;
    dependencies: string[];
    subParts?: Array<{
      title: string;
      description: string;
      type: CampaignPartType;
    }>;
    levelRecommendation: LevelRecommendation;
  }>;
  metadata: Partial<CampaignMetadata>;
}

/**
 * Chat message types
 */
export interface ChatSpeaker {
  scene?: string;
  actor?: string;
  token?: string;
  alias?: string;
}

export interface ChatMessage {
  id: string;
  content: string;
  speaker: ChatSpeaker;
  timestamp: number;
  whisper: string[];
  blind: boolean;
  flavor?: string;
  user: string;
  type: number;
  sound?: string;
  flags?: Record<string, unknown>;
}

export interface ChatMessageSummary {
  id: string;
  speaker: string;
  content: string;
  timestamp: string;
  isWhisper: boolean;
  flavor?: string;
}

export interface SendChatMessageRequest {
  message: string;
  speaker?: {
    type: 'gm' | 'character' | 'npc';
    characterName?: string;
    characterId?: string;
  };
  isPrivate?: boolean;
  whisperTo?: string[];
  flavor?: string;
}

export interface GetChatHistoryRequest {
  limit?: number;
  includeWhispers?: boolean;
  since?: string;
}

export interface GetChatHistoryResponse {
  success: boolean;
  messages?: ChatMessageSummary[];
  error?: string;
}

export interface SendChatMessageResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}