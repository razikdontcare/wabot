import {proto} from 'baileys';
import {SessionService} from '../../domain/services/SessionService.js';
import {WebSocketInfo} from '../../shared/types/types.js';

export interface CommandInfo {
    name: string;
    aliases?: string[];
    description: string;
    helpText?: string; // Inline command documentation
    category: 'game' | 'general' | 'admin' | 'utility';
    commandClass: new () => CommandInterface;
    cooldown?: number;
    maxUses?: number;
    requiredRoles?: import('../../infrastructure/config/config.js').UserRole[];
    vipOnly?: boolean; // Whether command is VIP-only
    vipBypassCooldown?: boolean; // Whether VIP users bypass cooldown (default: true)
    disabled?: boolean;
    disabledReason?: string;
}

export interface BaseInterface {
    handleCommand(
        args: string[],
        jid: string,
        user: string,
        sock: WebSocketInfo,
        sessionService: SessionService,
        msg: proto.IWebMessageInfo
    ): Promise<void>;
}

export abstract class CommandInterface implements BaseInterface {
    static commandInfo: CommandInfo;

    abstract handleCommand(
        args: string[],
        jid: string,
        user: string,
        sock: WebSocketInfo,
        sessionService: SessionService,
        msg: proto.IWebMessageInfo
    ): Promise<void>;
}
