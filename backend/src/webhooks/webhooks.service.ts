import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { LinesService } from '../lines/lines.service';

@Injectable()
export class WebhooksService {
  constructor(
    private prisma: PrismaService,
    private conversationsService: ConversationsService,
    private websocketGateway: WebsocketGateway,
    private linesService: LinesService,
  ) {}

  async handleEvolutionMessage(data: any) {
    try {
      console.log('📩 Webhook recebido:', JSON.stringify(data, null, 2));

      // Verificar se é uma mensagem recebida
      if (data.event === 'messages.upsert' || data.event === 'MESSAGES_UPSERT') {
        // Extrair o objeto completo da mensagem (com key, message, pushName, etc)
        const message = data.data || data.message;

        if (!message || !message.key) {
          return { status: 'ignored', reason: 'No message data or key' };
        }

        // Ignorar mensagens enviadas pelo próprio bot
        if (message.key.fromMe) {
          return { status: 'ignored', reason: 'Message from self' };
        }

        // Ignorar mensagens de grupos (remoteJid termina com @g.us)
        if (message.key.remoteJid?.includes('@g.us')) {
          console.log('🚫 Mensagem de grupo ignorada:', message.key.remoteJid);
          return { status: 'ignored', reason: 'Group message' };
        }

        // Extrair número do remetente (remoteJid quando fromMe=false é o remetente)
        const from = message.key.remoteJid
          ?.replace('@s.whatsapp.net', '')
          ?.replace('@lid', '');

        if (!from) {
          console.warn('⚠️ Webhook sem remoteJid; ignorando.', { key: message.key });
          return { status: 'ignored', reason: 'Missing remoteJid' };
        }

        console.log('📱 Mensagem de:', from, '| fromMe:', message.key.fromMe);

        // Extrair texto da mensagem
        const messageText = message.message?.conversation
          || message.message?.extendedTextMessage?.text
          || message.message?.imageMessage?.caption
          || message.message?.videoMessage?.caption
          || message.message?.documentMessage?.caption
          || (message.message?.imageMessage ? 'Imagem recebida' : undefined)
          || (message.message?.videoMessage ? 'Vídeo recebido' : undefined)
          || (message.message?.audioMessage ? 'Áudio recebido' : undefined)
          || (message.message?.documentMessage ? 'Documento recebido' : undefined)
          || 'Mensagem recebida';

        console.log('💬 Texto:', messageText);

        const messageType = this.getMessageType(message.message);
        const mediaUrl = this.getMediaUrl(message.message);

        // Buscar a linha que recebeu a mensagem
        const instanceName = data.instance || data.instanceName;
        const phoneNumber = instanceName?.replace('line_', '');

        const line = await this.prisma.linesStock.findFirst({
          where: {
            phone: {
              contains: phoneNumber,
            },
          },
        });

        if (!line) {
          console.warn('Linha não encontrada para o número:', phoneNumber);
          return { status: 'ignored', reason: 'Line not found' };
        }

        // Buscar contato
        let contact = await this.prisma.contact.findFirst({
          where: { phone: from },
        });

        if (!contact) {
          // Criar contato se não existir
          contact = await this.prisma.contact.create({
            data: {
              name: message.pushName || from,
              phone: from,
              segment: line.segment,
            },
          });
        }

        // Criar conversa
        const conversation = await this.conversationsService.create({
          contactName: contact.name,
          contactPhone: from,
          segment: line.segment,
          userName: null,
          userLine: line.id,
          message: messageText,
          sender: 'contact',
          messageType,
          mediaUrl,
        });

        // Emitir via WebSocket
        await this.websocketGateway.emitNewMessage(conversation);

        return { status: 'success', conversation };
      }

      // Verificar status de conexão
      if (data.event === 'connection.update' || data.event === 'CONNECTION_UPDATE') {
        const state = data.data?.state || data.state;

        if (state === 'close' || state === 'DISCONNECTED') {
          // Linha foi desconectada/banida
          const instanceName = data.instance || data.instanceName;
          const phoneNumber = instanceName?.replace('line_', '');

          const line = await this.prisma.linesStock.findFirst({
            where: {
              phone: {
                contains: phoneNumber,
              },
            },
          });

          if (line) {
            // Marcar como banida e trocar automaticamente
            await this.linesService.handleBannedLine(line.id);
          }

          return { status: 'line_disconnected', lineId: line?.id };
        }
      }

      return { status: 'processed' };
    } catch (error) {
      console.error('Erro ao processar webhook:', error);
      return { status: 'error', error: error.message };
    }
  }

  private getMessageType(message: any): string {
    if (message?.imageMessage) return 'image';
    if (message?.videoMessage) return 'video';
    if (message?.audioMessage) return 'audio';
    if (message?.documentMessage) return 'document';
    return 'text';
  }

  private getMediaUrl(message: any): string | undefined {
    if (message?.imageMessage?.url) return message.imageMessage.url;
    if (message?.videoMessage?.url) return message.videoMessage.url;
    if (message?.audioMessage?.url) return message.audioMessage.url;
    if (message?.documentMessage?.url) return message.documentMessage.url;
    return undefined;
  }
}
