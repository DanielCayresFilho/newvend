import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { UpdateControlPanelDto } from './dto/control-panel.dto';

@Injectable()
export class ControlPanelService {
  constructor(private prisma: PrismaService) {}

  // Buscar configurações (global ou por segmento)
  async findOne(segmentId?: number) {
    const config = await this.prisma.controlPanel.findFirst({
      where: { segmentId: segmentId ?? null },
    });

    if (!config) {
      // Retornar configuração padrão se não existir
      return {
        id: null,
        segmentId: segmentId ?? null,
        blockPhrasesEnabled: true,
        blockPhrases: [],
        blockTabulationId: null,
        cpcCooldownEnabled: true,
        cpcCooldownHours: 24,
        resendCooldownEnabled: true,
        resendCooldownHours: 24,
        repescagemEnabled: false,
        repescagemMaxMessages: 2,
        repescagemCooldownHours: 24,
        repescagemMaxAttempts: 2,
      };
    }

    return {
      ...config,
      blockPhrases: config.blockPhrases ? JSON.parse(config.blockPhrases) : [],
    };
  }

  // Criar ou atualizar configurações
  async upsert(dto: UpdateControlPanelDto) {
    const existing = await this.prisma.controlPanel.findFirst({
      where: { segmentId: dto.segmentId ?? null },
    });

    const data = {
      segmentId: dto.segmentId ?? null,
      blockPhrasesEnabled: dto.blockPhrasesEnabled,
      blockPhrases: dto.blockPhrases ? JSON.stringify(dto.blockPhrases) : undefined,
      blockTabulationId: dto.blockTabulationId,
      cpcCooldownEnabled: dto.cpcCooldownEnabled,
      cpcCooldownHours: dto.cpcCooldownHours,
      resendCooldownEnabled: dto.resendCooldownEnabled,
      resendCooldownHours: dto.resendCooldownHours,
      repescagemEnabled: dto.repescagemEnabled,
      repescagemMaxMessages: dto.repescagemMaxMessages,
      repescagemCooldownHours: dto.repescagemCooldownHours,
      repescagemMaxAttempts: dto.repescagemMaxAttempts,
    };

    // Remover campos undefined
    Object.keys(data).forEach(key => {
      if (data[key] === undefined) {
        delete data[key];
      }
    });

    if (existing) {
      const updated = await this.prisma.controlPanel.update({
        where: { id: existing.id },
        data,
      });
      return {
        ...updated,
        blockPhrases: updated.blockPhrases ? JSON.parse(updated.blockPhrases) : [],
      };
    }

    const created = await this.prisma.controlPanel.create({
      data: {
        ...data,
        blockPhrases: data.blockPhrases ?? '[]',
      },
    });
    return {
      ...created,
      blockPhrases: created.blockPhrases ? JSON.parse(created.blockPhrases) : [],
    };
  }

  // Adicionar frase de bloqueio
  async addBlockPhrase(phrase: string, segmentId?: number) {
    const config = await this.findOne(segmentId);
    const phrases = config.blockPhrases || [];

    if (!phrases.includes(phrase)) {
      phrases.push(phrase);
    }

    return this.upsert({
      segmentId: segmentId ?? undefined,
      blockPhrases: phrases,
    });
  }

  // Remover frase de bloqueio
  async removeBlockPhrase(phrase: string, segmentId?: number) {
    const config = await this.findOne(segmentId);
    const phrases = (config.blockPhrases || []).filter((p: string) => p !== phrase);

    return this.upsert({
      segmentId: segmentId ?? undefined,
      blockPhrases: phrases,
    });
  }

  // Verificar se uma mensagem contém uma frase de bloqueio
  async checkBlockPhrases(message: string, segmentId?: number): Promise<boolean> {
    const config = await this.findOne(segmentId);
    
    // Se frases de bloqueio estiverem desativadas, retornar false
    if (!config.blockPhrasesEnabled) {
      return false;
    }
    
    const phrases = config.blockPhrases || [];
    const messageLower = message.toLowerCase();
    return phrases.some((phrase: string) => messageLower.includes(phrase.toLowerCase()));
  }

  // Verificar se pode enviar para um CPC (baseado no temporizador)
  async canContactCPC(contactPhone: string, segmentId?: number): Promise<{ allowed: boolean; reason?: string; hoursRemaining?: number }> {
    const config = await this.findOne(segmentId);

    // Se temporizador de CPC estiver desativado, permitir sempre
    if (!config.cpcCooldownEnabled) {
      return { allowed: true };
    }

    const contact = await this.prisma.contact.findFirst({
      where: { phone: contactPhone },
    });

    if (!contact || !contact.isCPC) {
      return { allowed: true };
    }

    if (!contact.lastCPCAt) {
      return { allowed: true };
    }

    const cooldownMs = config.cpcCooldownHours * 60 * 60 * 1000;
    const timeSinceLastCPC = Date.now() - new Date(contact.lastCPCAt).getTime();

    if (timeSinceLastCPC < cooldownMs) {
      const hoursRemaining = Math.ceil((cooldownMs - timeSinceLastCPC) / (60 * 60 * 1000));
      return {
        allowed: false,
        reason: `CPC em período de espera. Aguarde ${hoursRemaining} hora(s).`,
        hoursRemaining,
      };
    }

    return { allowed: true };
  }

  // Verificar se pode reenviar para um telefone
  async canResend(contactPhone: string, segmentId?: number): Promise<{ allowed: boolean; reason?: string; hoursRemaining?: number }> {
    const config = await this.findOne(segmentId);

    // Se controle de reenvio estiver desativado, permitir sempre
    if (!config.resendCooldownEnabled) {
      return { allowed: true };
    }

    const lastSend = await this.prisma.sendHistory.findFirst({
      where: { contactPhone },
      orderBy: { sentAt: 'desc' },
    });

    if (!lastSend) {
      return { allowed: true };
    }

    const cooldownMs = config.resendCooldownHours * 60 * 60 * 1000;
    const timeSinceLastSend = Date.now() - new Date(lastSend.sentAt).getTime();

    if (timeSinceLastSend < cooldownMs) {
      const hoursRemaining = Math.ceil((cooldownMs - timeSinceLastSend) / (60 * 60 * 1000));
      return {
        allowed: false,
        reason: `Aguarde ${hoursRemaining} hora(s) para reenviar para este contato.`,
        hoursRemaining,
      };
    }

    return { allowed: true };
  }

  // Verificar repescagem (controle de mensagens seguidas)
  async checkRepescagem(contactPhone: string, operatorId: number, segmentId?: number): Promise<{ allowed: boolean; reason?: string }> {
    const config = await this.findOne(segmentId);

    if (!config.repescagemEnabled) {
      return { allowed: true };
    }

    let repescagem = await this.prisma.contactRepescagem.findFirst({
      where: { contactPhone, operatorId },
    });

    if (!repescagem) {
      return { allowed: true };
    }

    // Se tem bloqueio permanente (atingiu limite de repescagens)
    if (repescagem.permanentBlock) {
      return {
        allowed: false,
        reason: 'Limite de repescagens atingido. Aguarde o cliente entrar em contato.',
      };
    }

    // Se está bloqueado temporariamente
    if (repescagem.blockedUntil && new Date() < new Date(repescagem.blockedUntil)) {
      const hoursRemaining = Math.ceil(
        (new Date(repescagem.blockedUntil).getTime() - Date.now()) / (60 * 60 * 1000)
      );
      return {
        allowed: false,
        reason: `Aguarde ${hoursRemaining} hora(s) para enviar nova mensagem.`,
      };
    }

    return { allowed: true };
  }

  // Registrar mensagem enviada pelo operador (para controle de repescagem)
  async registerOperatorMessage(contactPhone: string, operatorId: number, segmentId?: number): Promise<void> {
    const config = await this.findOne(segmentId);

    if (!config.repescagemEnabled) {
      return;
    }

    let repescagem = await this.prisma.contactRepescagem.findFirst({
      where: { contactPhone, operatorId },
    });

    if (!repescagem) {
      repescagem = await this.prisma.contactRepescagem.create({
        data: {
          contactPhone,
          operatorId,
          messagesCount: 1,
          lastMessageAt: new Date(),
        },
      });
      return;
    }

    // Se bloqueio permanente, não faz nada
    if (repescagem.permanentBlock) {
      return;
    }

    // Incrementar contador
    const newCount = repescagem.messagesCount + 1;

    // Verificar se atingiu o limite de mensagens seguidas
    if (newCount >= config.repescagemMaxMessages) {
      const newAttempts = repescagem.attempts + 1;

      // Verificar se atingiu o limite de repescagens
      if (config.repescagemMaxAttempts > 0 && newAttempts >= config.repescagemMaxAttempts) {
        // Bloqueio permanente
        await this.prisma.contactRepescagem.update({
          where: { id: repescagem.id },
          data: {
            messagesCount: 0,
            attempts: newAttempts,
            permanentBlock: true,
            lastMessageAt: new Date(),
          },
        });
      } else {
        // Bloqueio temporário
        const blockedUntil = new Date();
        blockedUntil.setHours(blockedUntil.getHours() + config.repescagemCooldownHours);

        await this.prisma.contactRepescagem.update({
          where: { id: repescagem.id },
          data: {
            messagesCount: 0,
            attempts: newAttempts,
            blockedUntil,
            lastMessageAt: new Date(),
          },
        });
      }
    } else {
      // Apenas incrementar
      await this.prisma.contactRepescagem.update({
        where: { id: repescagem.id },
        data: {
          messagesCount: newCount,
          lastMessageAt: new Date(),
        },
      });
    }
  }

  // Registrar resposta do cliente (reseta repescagem)
  async registerClientResponse(contactPhone: string): Promise<void> {
    // Resetar todos os controles de repescagem para este contato
    await this.prisma.contactRepescagem.updateMany({
      where: { contactPhone },
      data: {
        messagesCount: 0,
        blockedUntil: null,
        permanentBlock: false,
        // Não resetar attempts para manter histórico
      },
    });
  }

  // Registrar envio para histórico (para controle de reenvio)
  async registerSend(contactPhone: string, campaignId?: number, lineId?: number): Promise<void> {
    await this.prisma.sendHistory.create({
      data: {
        contactPhone,
        campaignId,
        lineId,
      },
    });
  }

  // Marcar contato como CPC
  async markAsCPC(contactPhone: string, isCPC: boolean): Promise<void> {
    await this.prisma.contact.updateMany({
      where: { phone: contactPhone },
      data: {
        isCPC,
        lastCPCAt: isCPC ? new Date() : null,
      },
    });
  }
}

