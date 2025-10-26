import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

interface ChatToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

export class ChatTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor(options: ChatToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.logger = options.logger;
  }

  getToolDefinitions() {
    return [
      {
        name: 'send-chat-message',
        description: 'Send a message to Foundry VTT chat. Can be sent as GM (default), as a specific character, or as an NPC. Supports public messages (visible to all) and private whispers (visible only to specified players and GM). Use this to post narration, NPC dialog, quest updates, or any text content that should appear in the game chat.',
        inputSchema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'The message text to send to chat. Supports basic HTML formatting.'
            },
            speaker: {
              type: 'object',
              description: 'Optional speaker configuration. If omitted, message is sent as GM.',
              properties: {
                type: {
                  type: 'string',
                  enum: ['gm', 'character', 'npc'],
                  default: 'gm',
                  description: 'Who is speaking: "gm" (Game Master), "character" (player character), or "npc" (non-player character)'
                },
                characterName: {
                  type: 'string',
                  description: 'Name of the character or NPC (required if type is "character" or "npc"). Will be resolved by searching actors in the world.'
                },
                characterId: {
                  type: 'string',
                  description: 'Optional Foundry actor ID for direct lookup. If provided, characterName is not required.'
                }
              }
            },
            isPrivate: {
              type: 'boolean',
              description: 'If true, message is whispered to GM only. If false (default), message is public (visible to all players). Use for GM-only notes or private information.',
              default: false
            },
            whisperTo: {
              type: 'array',
              description: 'Optional list of player names to whisper the message to. If provided, overrides isPrivate. Players must be online and connected.',
              items: { type: 'string' }
            },
            flavor: {
              type: 'string',
              description: 'Optional flavor text that appears above the message in a distinct style. Use for context like "Narration:", "Quest Update:", or character actions.'
            }
          },
          required: ['message']
        }
      },
      {
        name: 'get-chat-history',
        description: 'Retrieve recent chat messages from Foundry VTT. Returns messages in chronological order (most recent first). Useful for understanding ongoing conversations, reviewing what players discussed, or checking recent events. Can filter by time and include/exclude whispered messages.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum number of messages to retrieve. Default is 20, maximum is 100.',
              default: 20,
              minimum: 1,
              maximum: 100
            },
            includeWhispers: {
              type: 'boolean',
              description: 'Whether to include whispered (private) messages. Default is true. Only messages whispered to/from the GM are included (for security).',
              default: true
            },
            since: {
              type: 'string',
              description: 'Optional ISO 8601 timestamp. If provided, only returns messages sent after this time. Useful for checking for new messages since last check.'
            }
          }
        }
      }
    ];
  }

  async handleSendChatMessage(args: any) {
    const schema = z.object({
      message: z.string().min(1, 'Message cannot be empty'),
      speaker: z.object({
        type: z.enum(['gm', 'character', 'npc']).default('gm'),
        characterName: z.string().optional(),
        characterId: z.string().optional()
      }).optional(),
      isPrivate: z.boolean().default(false),
      whisperTo: z.array(z.string()).optional(),
      flavor: z.string().optional()
    });

    try {
      const params = schema.parse(args);

      // Validate speaker configuration
      if (params.speaker && (params.speaker.type === 'character' || params.speaker.type === 'npc')) {
        if (!params.speaker.characterName && !params.speaker.characterId) {
          return 'Error: When using speaker type "character" or "npc", you must provide either characterName or characterId.';
        }
      }

      const response = await this.foundryClient.query('foundry-mcp-bridge.send-chat-message', params);

      if (response.success) {
        return `Message sent successfully to Foundry chat! Message ID: ${response.messageId}`;
      } else {
        throw new Error(response.error || 'Failed to send chat message');
      }
    } catch (error) {
      this.logger.error('Error sending chat message', error);
      if (error instanceof z.ZodError) {
        const messages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
        return `Parameter error: ${messages.join(', ')}`;
      }
      throw error;
    }
  }

  async handleGetChatHistory(args: any) {
    const schema = z.object({
      limit: z.number().min(1).max(100).default(20),
      includeWhispers: z.boolean().default(true),
      since: z.string().optional()
    });

    try {
      const params = schema.parse(args);

      // Validate ISO 8601 timestamp if provided
      if (params.since) {
        const date = new Date(params.since);
        if (isNaN(date.getTime())) {
          return 'Error: "since" parameter must be a valid ISO 8601 timestamp (e.g., "2025-01-15T10:30:00Z")';
        }
      }

      const response = await this.foundryClient.query('foundry-mcp-bridge.get-chat-history', params);

      if (response.success) {
        const messages = response.messages || [];
        if (messages.length === 0) {
          return 'No chat messages found matching the criteria.';
        }
        return {
          totalMessages: messages.length,
          messages: messages,
          summary: `Retrieved ${messages.length} chat message${messages.length !== 1 ? 's' : ''} from Foundry.`
        };
      } else {
        throw new Error(response.error || 'Failed to get chat history');
      }
    } catch (error) {
      this.logger.error('Error getting chat history', error);
      if (error instanceof z.ZodError) {
        const messages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
        return `Parameter error: ${messages.join(', ')}`;
      }
      throw error;
    }
  }
}
