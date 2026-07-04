import { Message } from 'discord.js';
import { statusCommand } from './status';
import { roomCommand    } from './room';
import { usageCommand   } from './usage';
import { alertsCommand  } from './alerts';
import { helpCommand    } from './help';
import { askCommand     } from './ask';

export interface CommandContext {
  prefix: string;
  uniqueReply: (message: Message, payload: unknown) => Promise<unknown>;
}

export interface CommandHandler {
  name:        string;
  aliases:     string[];
  description: string;
  execute(args: string[], message: Message, ctx: CommandContext): Promise<void>;
}

const ALL_COMMANDS: CommandHandler[] = [
  statusCommand,
  roomCommand,
  usageCommand,
  alertsCommand,
  askCommand,
  helpCommand,
];

const _registry = new Map<string, CommandHandler>();

for (const cmd of ALL_COMMANDS) {
  _registry.set(cmd.name.toLowerCase(), cmd);
  for (const alias of cmd.aliases) {
    _registry.set(alias.toLowerCase(), cmd);
  }
}

export function findCommand(trigger: string): CommandHandler | undefined {
  return _registry.get(trigger.toLowerCase());
}

export function listCommands(): CommandHandler[] {
  return ALL_COMMANDS;
}
