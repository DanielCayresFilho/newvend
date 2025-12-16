import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ControlPanelService } from '../control-panel/control-panel.service';
import { MediaService } from '../media/media.service';
import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';

@WebSocketGateway({
  cors: {
    origin: (origin, callback) => {
      const allowedOrigins = process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
        : ['http://localhost:5173', 'http://localhost:3001'];
      
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  },
})
export class WebsocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private connectedUsers: Map<number, string> = new Map();

  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private conversationsService: ConversationsService,
    private controlPanelService: ControlPanelService,
    private mediaService: MediaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token || client.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user) {
        client.disconnect();
        return;
      }

      client.data.user = user;
      this.connectedUsers.set(user.id, client.id);

      // Atualizar status do usuário para Online
      await this.prisma.user.update({
        where: { id: user.id },
        data: { status: 'Online' },
      });

      console.log(`✅ Usuário ${user.name} (${user.role}) conectado via WebSocket`);

      // Se for operador, verificar e sincronizar linha
      if (user.role === 'operator') {
        // Se já tem linha no campo legacy, verificar se está na tabela LineOperator
        if (user.line) {
          const existingLink = await (this.prisma as any).lineOperator.findFirst({
            where: {
              lineId: user.line,
              userId: user.id,
            },
          });

          if (!existingLink) {
            // Sincronizar: criar entrada na tabela LineOperator
            console.log(`🔄 [WebSocket] Sincronizando linha ${user.line} para operador ${user.name} na tabela LineOperator`);
            
            // Verificar se a linha ainda existe e está ativa
            const line = await this.prisma.linesStock.findUnique({
              where: { id: user.line },
            });

            if (line && line.lineStatus === 'active') {
              // Verificar quantos operadores já estão vinculados
              const currentOperatorsCount = await (this.prisma as any).lineOperator.count({
                where: { lineId: user.line },
              });

              if (currentOperatorsCount < 2) {
                await (this.prisma as any).lineOperator.create({
                  data: {
                    lineId: user.line,
                    userId: user.id,
                  },
                });
                console.log(`✅ [WebSocket] Linha ${user.line} sincronizada para operador ${user.name}`);
              } else {
                console.warn(`⚠️ [WebSocket] Linha ${user.line} já tem 2 operadores, não foi possível sincronizar para ${user.name}`);
              }
            } else {
              console.warn(`⚠️ [WebSocket] Linha ${user.line} não existe ou não está ativa, removendo do operador ${user.name}`);
              // Remover linha inválida do operador
              await this.prisma.user.update({
                where: { id: user.id },
                data: { line: null },
              });
              user.line = null;
            }
          } else {
            console.log(`✅ [WebSocket] Operador ${user.name} já está sincronizado na tabela LineOperator`);
          }
        }

        // Se for operador sem linha, verificar se há linha disponível para vincular
        if (!user.line) {
          let availableLine = null;

          // 1. Primeiro, tentar buscar linha do mesmo segmento do operador
          if (user.segment) {
            const segmentLines = await this.prisma.linesStock.findMany({
              where: {
                lineStatus: 'active',
                segment: user.segment,
              },
            });

            availableLine = await this.findAvailableLineForOperator(segmentLines, user.id);
          }

          // 2. Se não encontrou linha do segmento, buscar linha padrão (segmento "Padrão")
          if (!availableLine && user.segment) {
            // Buscar o segmento "Padrão" pelo nome
            const defaultSegment = await this.prisma.segment.findUnique({
              where: { name: 'Padrão' },
            });

            if (defaultSegment) {
              const defaultLines = await this.prisma.linesStock.findMany({
                where: {
                  lineStatus: 'active',
                  segment: defaultSegment.id, // Linhas padrão (segmento "Padrão")
                },
              });

              availableLine = await this.findAvailableLineForOperator(defaultLines, user.id);

              // Se encontrou linha padrão e operador tem segmento, atualizar o segmento da linha
              if (availableLine && user.segment) {
                await this.prisma.linesStock.update({
                  where: { id: availableLine.id },
                  data: { segment: user.segment },
                });

                console.log(`🔄 [WebSocket] Linha padrão ${availableLine.phone} atualizada para o segmento ${user.segment} do operador ${user.name}`);
                availableLine.segment = user.segment; // Atualizar objeto local
              }
            }
          }

          if (availableLine) {
            // Verificar quantos operadores já estão vinculados
            const currentOperatorsCount = await (this.prisma as any).lineOperator.count({
              where: { lineId: availableLine.id },
            });

            if (currentOperatorsCount < 2) {
              // Vincular operador à linha usando a nova tabela
              await (this.prisma as any).lineOperator.create({
                data: {
                  lineId: availableLine.id,
                  userId: user.id,
                },
              });

              // Atualizar campos legacy para compatibilidade
              await this.prisma.user.update({
                where: { id: user.id },
                data: { line: availableLine.id },
              });

              if (currentOperatorsCount === 0) {
                // Primeiro operador - atualizar linkedTo
                await this.prisma.linesStock.update({
                  where: { id: availableLine.id },
                  data: { linkedTo: user.id },
                });
              }

              // Atualizar user object
              user.line = availableLine.id;

              console.log(`✅ [WebSocket] Linha ${availableLine.phone} vinculada automaticamente ao operador ${user.name} (segmento ${availableLine.segment || 'sem segmento'})`);
              
              // Notificar o operador
              client.emit('line-assigned', {
                lineId: availableLine.id,
                linePhone: availableLine.phone,
                message: `Você foi vinculado à linha ${availableLine.phone} automaticamente.`,
              });
            }
          } else {
            console.log(`ℹ️ [WebSocket] Nenhuma linha disponível (do segmento ou padrão) para o operador ${user.name}`);
          }
        }
      }

      // Enviar conversas ativas ao conectar (apenas para operators)
      if (user.role === 'operator' && user.line) {
        const activeConversations = await this.conversationsService.findActiveConversations(user.line, user.id);
        client.emit('active-conversations', activeConversations);
      }
    } catch (error) {
      console.error('Erro na autenticação WebSocket:', error);
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    if (client.data.user) {
      const userId = client.data.user.id;
      this.connectedUsers.delete(userId);
      
      // Atualizar status do usuário para Offline
      await this.prisma.user.update({
        where: { id: userId },
        data: { status: 'Offline' },
      });
      
      console.log(`❌ Usuário ${client.data.user.name} desconectado do WebSocket`);
    }
  }

  @SubscribeMessage('send-message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { contactPhone: string; message: string; messageType?: string; mediaUrl?: string; fileName?: string; isNewConversation?: boolean },
  ) {
    console.log(`📤 [WebSocket] Recebido send-message:`, JSON.stringify(data, null, 2));
    
    const user = client.data.user;
    console.log(`👤 [WebSocket] Usuário: ${user?.name}, role: ${user?.role}, line: ${user?.line}`);

    if (!user || !user.line) {
      console.error('❌ [WebSocket] Usuário não autenticado ou sem linha');
      client.emit('message-error', { error: 'Usuário não autenticado ou sem linha atribuída' });
      return { error: 'Usuário não autenticado ou sem linha atribuída' };
    }

    // Verificar se é uma nova conversa (1x1) e se o operador tem permissão
    if (data.isNewConversation) {
      const fullUser = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          oneToOneActive: true,
        },
      });

      console.log(`🔍 [WebSocket] Verificando permissão 1x1 para usuário ${user.id}:`, {
        oneToOneActive: fullUser?.oneToOneActive,
        hasPermission: fullUser?.oneToOneActive === true,
      });

      if (!fullUser?.oneToOneActive) {
        console.error('❌ [WebSocket] Operador sem permissão para 1x1');
        client.emit('message-error', { error: 'Você não tem permissão para iniciar conversas 1x1' });
        return { error: 'Você não tem permissão para iniciar conversas 1x1' };
      }
    }

    try {
      // Verificar CPC
      const cpcCheck = await this.controlPanelService.canContactCPC(data.contactPhone, user.segment);
      if (!cpcCheck.allowed) {
        console.warn('⚠️ [WebSocket] Bloqueio CPC:', cpcCheck.reason);
        client.emit('message-error', { 
          error: cpcCheck.reason,
          hoursRemaining: cpcCheck.hoursRemaining,
        });
        return { error: cpcCheck.reason };
      }

      // Verificar repescagem
      const repescagemCheck = await this.controlPanelService.checkRepescagem(
        data.contactPhone,
        user.id,
        user.segment
      );
      if (!repescagemCheck.allowed) {
        console.warn('⚠️ [WebSocket] Bloqueio Repescagem:', repescagemCheck.reason);
        client.emit('message-error', { error: repescagemCheck.reason });
        return { error: repescagemCheck.reason };
      }

      // Buscar linha do usuário
      const line = await this.prisma.linesStock.findUnique({
        where: { id: user.line },
      });

      if (!line || line.lineStatus !== 'active') {
        client.emit('message-error', { error: 'Linha não disponível' });
        return { error: 'Linha não disponível' };
      }

      const evolution = await this.prisma.evolution.findUnique({
        where: { evolutionName: line.evolutionName },
      });
      const instanceName = `line_${line.phone.replace(/\D/g, '')}`;

      // Enviar mensagem via Evolution API
      let apiResponse;

      if (data.messageType === 'image' && data.mediaUrl) {
        apiResponse = await axios.post(
          `${evolution.evolutionUrl}/message/sendMedia/${instanceName}`,
          {
            number: data.contactPhone.replace(/\D/g, ''),
            mediaUrl: data.mediaUrl,
            caption: data.message,
            mediatype: 'image', // Evolution API requer mediatype
          },
          {
            headers: { 'apikey': evolution.evolutionKey },
          }
        );
      } else if (data.messageType === 'document' && data.mediaUrl) {
        // Para documentos, tentar primeiro com sendMedia, se falhar, tentar sendDocument
        // Extrair nome do arquivo (usar fileName do data se disponível, senão da URL)
        const fileName = data.fileName || data.mediaUrl.split('/').pop() || 'document.pdf';
        // Remover timestamp e IDs do nome se vier da URL
        const cleanFileName = fileName.includes('-') && fileName.match(/^\d+-/) 
          ? fileName.replace(/^\d+-/, '').replace(/-\d+\./, '.')
          : fileName;
        
        // Determinar mediatype baseado na extensão (Evolution API usa "mediatype" não "mimetype")
        const getMediaType = (filename: string): string => {
          const ext = filename.split('.').pop()?.toLowerCase();
          // Evolution API espera: document, image, video, audio
          if (['pdf', 'doc', 'docx', 'xls', 'xlsx'].includes(ext || '')) {
            return 'document';
          }
          if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '')) {
            return 'image';
          }
          if (['mp4', 'mpeg', 'avi', 'mov'].includes(ext || '')) {
            return 'video';
          }
          if (['mp3', 'ogg', 'wav', 'm4a'].includes(ext || '')) {
            return 'audio';
          }
          return 'document'; // Default para documentos
        };
        
        try {
          // Extrair nome do arquivo da URL
          let filePath: string;
          let useBase64 = true; // Por padrão, usar base64
          
          if (data.mediaUrl.startsWith('/media/')) {
            // URL relativa do nosso servidor - pegar arquivo diretamente
            const filename = data.mediaUrl.replace('/media/', '');
            filePath = await this.mediaService.getFilePath(filename);
            console.log(`📁 [WebSocket] Arquivo encontrado no servidor: ${filePath}`);
          } else if (data.mediaUrl.startsWith('http')) {
            // URL completa - verificar se é do nosso servidor
            const appUrl = process.env.APP_URL || 'https://api.newvend.taticamarketing.com.br';
            if (data.mediaUrl.startsWith(appUrl)) {
              // É do nosso servidor - extrair filename e pegar do storage
              const urlPath = new URL(data.mediaUrl).pathname;
              const filename = urlPath.replace('/media/', '');
              filePath = await this.mediaService.getFilePath(filename);
              console.log(`📁 [WebSocket] Arquivo do nosso servidor encontrado: ${filePath}`);
            } else {
              // URL externa - baixar temporariamente
              console.log(`📥 [WebSocket] Baixando arquivo de URL externa: ${data.mediaUrl}`);
              const response = await axios.get(data.mediaUrl, { responseType: 'arraybuffer' });
              const tempPath = path.join('./uploads', `temp-${Date.now()}-${cleanFileName}`);
              await fs.mkdir('./uploads', { recursive: true });
              await fs.writeFile(tempPath, response.data);
              filePath = tempPath;
            }
          } else {
            // Assumir que é um caminho relativo
            filePath = path.join('./uploads', data.mediaUrl.replace(/^\/media\//, ''));
          }

          // Ler arquivo e converter para base64
          console.log(`📖 [WebSocket] Lendo arquivo: ${filePath}`);
          const fileBuffer = await fs.readFile(filePath);
          const base64File = fileBuffer.toString('base64');
          console.log(`✅ [WebSocket] Arquivo convertido para base64: ${base64File.length} caracteres`);
          
          // Determinar mimetype baseado na extensão
          const getMimeType = (filename: string): string => {
            const ext = filename.split('.').pop()?.toLowerCase();
            const mimeTypes: { [key: string]: string } = {
              'pdf': 'application/pdf',
              'doc': 'application/msword',
              'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'xls': 'application/vnd.ms-excel',
              'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'jpg': 'image/jpeg',
              'jpeg': 'image/jpeg',
              'png': 'image/png',
              'gif': 'image/gif',
              'webp': 'image/webp',
              'mp4': 'video/mp4',
              'mpeg': 'video/mpeg',
              'mp3': 'audio/mpeg',
              'ogg': 'audio/ogg',
              'wav': 'audio/wav',
              'm4a': 'audio/mp4',
            };
            return mimeTypes[ext || ''] || 'application/octet-stream';
          };

          const mimeType = getMimeType(cleanFileName);

          // Construir URL completa do arquivo para tentar primeiro
          const appUrl = process.env.APP_URL || 'https://api.newvend.taticamarketing.com.br';
          let fullMediaUrl: string;
          
          if (data.mediaUrl.startsWith('/media/')) {
            fullMediaUrl = `${appUrl}${data.mediaUrl}`;
          } else if (data.mediaUrl.startsWith('http')) {
            fullMediaUrl = data.mediaUrl;
          } else {
            fullMediaUrl = `${appUrl}/media/${data.mediaUrl.replace(/^\/media\//, '')}`;
          }

          // Estratégia: Tentar primeiro com URL, depois base64, depois campo "media"
          // Tentativa 1: URL completa (se o arquivo estiver acessível publicamente)
          let payload: any = {
            number: data.contactPhone.replace(/\D/g, ''),
            mediatype: 'document',
            mediaUrl: fullMediaUrl,
            fileName: cleanFileName,
          };
          
          if (data.message && data.message.trim()) {
            payload.caption = data.message;
          }
          
          console.log(`📤 [WebSocket] Tentativa 1 - Enviando com URL:`, {
            number: payload.number,
            fileName: payload.fileName,
            mediatype: payload.mediatype,
            mediaUrl: fullMediaUrl,
            hasCaption: !!payload.caption,
          });
          
          try {
            apiResponse = await axios.post(
              `${evolution.evolutionUrl}/message/sendMedia/${instanceName}`,
              payload,
              {
                headers: { 'apikey': evolution.evolutionKey },
              }
            );
            
            console.log(`✅ [WebSocket] Documento enviado com sucesso via sendMedia (URL)`);
          } catch (urlError: any) {
            // Tentativa 2: Base64 puro
            console.warn(`⚠️ [WebSocket] Tentativa 1 (URL) falhou, tentando com base64:`, {
              status: urlError.response?.status,
              message: urlError.response?.data?.response?.message || urlError.message,
            });
            
            payload = {
              number: data.contactPhone.replace(/\D/g, ''),
              mediatype: 'document',
              base64: base64File, // Base64 puro, sem prefixo
              fileName: cleanFileName,
            };
            
            if (data.message && data.message.trim()) {
              payload.caption = data.message;
            }
            
            console.log(`📤 [WebSocket] Tentativa 2 - Enviando com base64:`, {
              number: payload.number,
              fileName: payload.fileName,
              mediatype: payload.mediatype,
              base64Length: base64File.length,
              hasCaption: !!payload.caption,
            });
            
            try {
              apiResponse = await axios.post(
                `${evolution.evolutionUrl}/message/sendMedia/${instanceName}`,
                payload,
                {
                  headers: { 'apikey': evolution.evolutionKey },
                }
              );
              
              console.log(`✅ [WebSocket] Documento enviado com sucesso via sendMedia (base64)`);
            } catch (base64Error: any) {
              // Tentativa 3: Campo "media"
              console.warn(`⚠️ [WebSocket] Tentativa 2 (base64) falhou, tentando com campo "media":`, {
                status: base64Error.response?.status,
                message: base64Error.response?.data?.response?.message || base64Error.message,
              });
              
              payload = {
                number: data.contactPhone.replace(/\D/g, ''),
                mediatype: 'document',
                media: base64File, // Campo "media"
                fileName: cleanFileName,
              };
              
              if (data.message && data.message.trim()) {
                payload.caption = data.message;
              }
              
              console.log(`📤 [WebSocket] Tentativa 3 - Enviando com campo "media":`, {
                number: payload.number,
                fileName: payload.fileName,
                mediatype: payload.mediatype,
                mediaLength: base64File.length,
                hasCaption: !!payload.caption,
              });
              
              apiResponse = await axios.post(
                `${evolution.evolutionUrl}/message/sendMedia/${instanceName}`,
                payload,
                {
                  headers: { 'apikey': evolution.evolutionKey },
                }
              );
              
              console.log(`✅ [WebSocket] Documento enviado com sucesso via sendMedia (media)`);
            }
          }
          
          // Limpar arquivo temporário se foi criado
          if (filePath.includes('temp-')) {
            await fs.unlink(filePath).catch(() => {}); // Ignorar erros de limpeza
          }
        } catch (mediaError: any) {
          // Log detalhado do erro
          console.error('❌ [WebSocket] Erro ao enviar documento:', {
            status: mediaError.response?.status,
            statusText: mediaError.response?.statusText,
            data: JSON.stringify(mediaError.response?.data, null, 2),
            message: mediaError.message,
            stack: mediaError.stack,
          });
          throw mediaError;
        }
      } else {
        apiResponse = await axios.post(
          `${evolution.evolutionUrl}/message/sendText/${instanceName}`,
          {
            number: data.contactPhone.replace(/\D/g, ''),
            text: data.message,
          },
          {
            headers: { 'apikey': evolution.evolutionKey },
          }
        );
      }

      // Buscar contato
      const contact = await this.prisma.contact.findFirst({
        where: { phone: data.contactPhone },
      });

      // Salvar conversa
      const conversation = await this.conversationsService.create({
        contactName: contact?.name || 'Desconhecido',
        contactPhone: data.contactPhone,
        segment: user.segment,
        userName: user.name,
        userLine: user.line,
        userId: user.id, // Operador específico que está enviando
        message: data.message,
        sender: 'operator',
        messageType: data.messageType || 'text',
        mediaUrl: data.mediaUrl,
      });

      console.log(`✅ [WebSocket] Mensagem salva no banco, ID: ${conversation.id}`);
      
      // Registrar mensagem do operador para controle de repescagem
      await this.controlPanelService.registerOperatorMessage(
        data.contactPhone,
        user.id,
        user.segment
      );
      
      // Emitir mensagem para o usuário (usar mesmo formato que new_message)
      client.emit('message-sent', { message: conversation });
      console.log(`📤 [WebSocket] Emitido message-sent para o cliente`);

      // Se houver supervisores online do mesmo segmento, enviar para eles também
      this.emitToSupervisors(user.segment, 'new_message', { message: conversation });

      return { success: true, conversation };
    } catch (error: any) {
      console.error('❌ [WebSocket] Erro ao enviar mensagem:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: JSON.stringify(error.response?.data, null, 2),
        message: error.message,
        stack: error.stack,
      });
      
      // Extrair mensagem de erro mais detalhada
      let errorMessage = `Erro ao enviar mensagem: ${error.message}`;
      if (error.response?.data?.message) {
        const errorData = Array.isArray(error.response.data.message) 
          ? error.response.data.message.join(', ')
          : error.response.data.message;
        errorMessage = `Erro ao enviar mensagem: ${errorData}`;
      }
      
      client.emit('message-error', { error: errorMessage });
      return { error: errorMessage };
    }
  }

  @SubscribeMessage('typing')
  async handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { contactPhone: string; typing: boolean },
  ) {
    // Emitir evento de digitação para outros usuários
    client.broadcast.emit('user-typing', {
      contactPhone: data.contactPhone,
      typing: data.typing,
    });
  }

  // Método auxiliar para encontrar linha disponível para o operador
  private async findAvailableLineForOperator(availableLines: any[], userId: number) {
    for (const line of availableLines) {
      const operatorsCount = await (this.prisma as any).lineOperator.count({
        where: { lineId: line.id },
      });

      if (operatorsCount < 2) {
        // Verificar se o operador já está vinculado a esta linha
        const existing = await (this.prisma as any).lineOperator.findUnique({
          where: {
            lineId_userId: {
              lineId: line.id,
              userId,
            },
          },
        });

        if (!existing) {
          return line;
        }
      }
    }
    return null;
  }

  // Método para emitir mensagens recebidas via webhook
  async emitNewMessage(conversation: any) {
    console.log(`📤 Emitindo new_message para contactPhone: ${conversation.contactPhone}`, {
      userId: conversation.userId,
      userLine: conversation.userLine,
    });
    
    // Emitir para o operador específico que está atendendo (userId)
    if (conversation.userId) {
      const socketId = this.connectedUsers.get(conversation.userId);
      if (socketId) {
        const user = await this.prisma.user.findUnique({
          where: { id: conversation.userId },
        });
        if (user) {
          console.log(`  → Enviando para ${user.name} (${user.role}) - operador específico (userId: ${conversation.userId})`);
          // Usar underscore para corresponder ao frontend: new_message
          this.server.to(socketId).emit('new_message', { message: conversation });
        } else {
          console.warn(`  ⚠️ Operador ${conversation.userId} não encontrado no banco`);
        }
      } else {
        console.warn(`  ⚠️ Operador ${conversation.userId} não está conectado via WebSocket`);
      }
    }
    
    // Se não tiver userId OU se o userId não estiver conectado, enviar para todos os operadores online da linha
    if (!conversation.userId || !this.connectedUsers.has(conversation.userId)) {
      if (conversation.userLine) {
        console.log(`  → Fallback: Enviando para todos os operadores online da linha ${conversation.userLine}`);
        const lineOperators = await (this.prisma as any).lineOperator.findMany({
          where: { lineId: conversation.userLine },
          include: { user: true },
        });

        const onlineLineOperators = lineOperators.filter(lo => 
          lo.user.status === 'Online' && lo.user.role === 'operator'
        );

        console.log(`  → Encontrados ${onlineLineOperators.length} operador(es) online na linha ${conversation.userLine}`);

        onlineLineOperators.forEach(lo => {
          const socketId = this.connectedUsers.get(lo.userId);
          if (socketId) {
            console.log(`  → Enviando para ${lo.user.name} (${lo.user.role}) - operador da linha`);
            this.server.to(socketId).emit('new_message', { message: conversation });
          } else {
            console.warn(`  ⚠️ Operador ${lo.user.name} (${lo.userId}) não está conectado via WebSocket`);
          }
        });

        // Se não encontrou nenhum operador online na linha, logar para debug
        if (onlineLineOperators.length === 0) {
          console.warn(`  ⚠️ Nenhum operador online encontrado na linha ${conversation.userLine} para receber a mensagem`);
          console.log(`  → Operadores vinculados à linha:`, lineOperators.map(lo => ({
            userId: lo.userId,
            name: lo.user.name,
            status: lo.user.status,
            role: lo.user.role,
            connected: this.connectedUsers.has(lo.userId),
          })));
        }
      } else {
        console.warn(`  ⚠️ Conversa sem userId e sem userLine - não é possível enviar`);
      }
    }

    // Emitir para supervisores do segmento
    if (conversation.segment) {
      this.emitToSupervisors(conversation.segment, 'new_message', { message: conversation });
    }
  }

  emitToUser(userId: number, event: string, data: any) {
    const socketId = this.connectedUsers.get(userId);
    if (socketId) {
      const client = this.server.sockets.sockets.get(socketId);
      if (client) {
        client.emit(event, data);
      }
    }
  }

  private async emitToSupervisors(segment: number, event: string, data: any) {
    const supervisors = await this.prisma.user.findMany({
      where: {
        role: 'supervisor',
        segment,
      },
    });

    supervisors.forEach(supervisor => {
      const socketId = this.connectedUsers.get(supervisor.id);
      if (socketId) {
        this.server.to(socketId).emit(event, data);
      }
    });
  }

  // Emitir atualização de conversa tabulada
  async emitConversationTabulated(contactPhone: string, tabulationId: number) {
    this.server.emit('conversation-tabulated', { contactPhone, tabulationId });
  }
}
