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
import { UseGuards, Inject, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ControlPanelService } from '../control-panel/control-panel.service';
import { MediaService } from '../media/media.service';
import { LinesService } from '../lines/lines.service';
import { SystemEventsService, EventType, EventModule, EventSeverity } from '../system-events/system-events.service';
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
    @Inject(forwardRef(() => LinesService))
    private linesService: LinesService,
    private systemEventsService: SystemEventsService,
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
                try {
                  await this.linesService.assignOperatorToLine(user.line, user.id); // ✅ COM LOCK
                  console.log(`✅ [WebSocket] Linha ${user.line} sincronizada para operador ${user.name}`);
                } catch (error) {
                  console.warn(`⚠️ [WebSocket] Erro ao sincronizar linha ${user.line} para ${user.name}:`, error.message);
                }
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

            // Filtrar por evolutions ativas
            const filteredLines = await this.controlPanelService.filterLinesByActiveEvolutions(segmentLines, user.segment);
            availableLine = await this.findAvailableLineForOperator(filteredLines, user.id, user.segment);
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

              // Filtrar por evolutions ativas
              const filteredDefaultLines = await this.controlPanelService.filterLinesByActiveEvolutions(defaultLines, user.segment);
              availableLine = await this.findAvailableLineForOperator(filteredDefaultLines, user.id, user.segment);

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
              // IMPORTANTE: Verificar se a linha já tem operadores de outro segmento
              const existingOperators = await (this.prisma as any).lineOperator.findMany({
                where: { lineId: availableLine.id },
                include: { user: true },
              });

              // Se a linha já tem operadores, verificar se são do mesmo segmento
              if (existingOperators.length > 0) {
                const allSameSegment = existingOperators.every((lo: any) => 
                  lo.user.segment === user.segment
                );
                
                if (!allSameSegment) {
                  // Linha já tem operador de outro segmento, não pode atribuir
                  console.warn(`⚠️ [WebSocket] Linha ${availableLine.phone} já tem operador de outro segmento, pulando para operador ${user.name}`);
                  availableLine = null; // Forçar busca de outra linha
                }
              }

              // Só vincular se passou na validação de segmento
              if (availableLine) {
                // Vincular operador à linha usando método com transaction + lock
                try {
                  await this.linesService.assignOperatorToLine(availableLine.id, user.id);
                  
                  // Atualizar user object
                  user.line = availableLine.id;

                  console.log(`✅ [WebSocket] Linha ${availableLine.phone} vinculada automaticamente ao operador ${user.name} (segmento ${availableLine.segment || 'sem segmento'})`);
                  
                  // Notificar o operador
                  client.emit('line-assigned', {
                    lineId: availableLine.id,
                    linePhone: availableLine.phone,
                    message: `Você foi vinculado à linha ${availableLine.phone} automaticamente.`,
                  });
                } catch (error) {
                  console.error(`❌ [WebSocket] Erro ao vincular linha ${availableLine.id} ao operador ${user.id}:`, error.message);
                  // Continuar para tentar outra linha
                  availableLine = null;
                }
              }
            }
          }
          
          // Se ainda não tem linha, tentar busca mais ampla (qualquer linha ativa)
          if (!availableLine || !user.line) {
            console.warn(`⚠️ [WebSocket] Nenhuma linha disponível (do segmento ou padrão) para o operador ${user.name}. Tentando busca ampla...`);
            
            // Buscar qualquer linha ativa (sem filtro de segmento)
            const anyActiveLines = await this.prisma.linesStock.findMany({
              where: {
                lineStatus: 'active',
              },
            });
            
            // Filtrar por evolutions ativas
            const filteredAnyLines = await this.controlPanelService.filterLinesByActiveEvolutions(anyActiveLines, user.segment);
            const fallbackLine = await this.findAvailableLineForOperator(filteredAnyLines, user.id, user.segment);
            
            if (fallbackLine) {
              const currentOperatorsCount = await (this.prisma as any).lineOperator.count({
                where: { lineId: fallbackLine.id },
              });
              
              if (currentOperatorsCount < 2) {
                // Verificar se não tem operadores de outro segmento
                const existingOperators = await (this.prisma as any).lineOperator.findMany({
                  where: { lineId: fallbackLine.id },
                  include: { user: true },
                });
                
                const canAssign = existingOperators.length === 0 || 
                  existingOperators.every((lo: any) => lo.user.segment === user.segment);
                
                if (canAssign) {
                  // Vincular operador à linha usando método com transaction + lock
                  try {
                    await this.linesService.assignOperatorToLine(fallbackLine.id, user.id);
                    
                    // Atualizar segmento da linha se operador tem segmento
                    if (user.segment && fallbackLine.segment !== user.segment) {
                      await this.prisma.linesStock.update({
                        where: { id: fallbackLine.id },
                        data: { segment: user.segment },
                      });
                    }
                    
                    user.line = fallbackLine.id;
                    console.log(`✅ [WebSocket] Linha ${fallbackLine.phone} atribuída ao operador ${user.name} (busca ampla)`);
                    
                    client.emit('line-assigned', {
                      lineId: fallbackLine.id,
                      linePhone: fallbackLine.phone,
                      message: `Você foi vinculado à linha ${fallbackLine.phone} automaticamente.`,
                    });
                  } catch (error) {
                    console.error(`❌ [WebSocket] Erro ao vincular linha ${fallbackLine.id} ao operador ${user.id}:`, error.message);
                    // Continuar para tentar outra linha
                  }
                }
              }
            } else {
              console.error(`❌ [WebSocket] Nenhuma linha disponível para o operador ${user.name} após todas as tentativas`);
            }
          }
        }
      }

      // Enviar conversas ativas ao conectar (apenas para operators)
      // Buscar por userId mesmo se não tiver linha, pois as conversas estão vinculadas ao operador
      if (user.role === 'operator') {
        // Buscar conversas apenas por userId (não por userLine)
        // Isso permite que as conversas continuem aparecendo mesmo se a linha foi banida
        const activeConversations = await this.conversationsService.findActiveConversations(undefined, user.id);
        client.emit('active-conversations', activeConversations);

        // Processar mensagens pendentes na fila quando operador fica online
        if (user.line) {
          try {
            // Buscar mensagens pendentes do segmento do operador
            const whereClause: any = { status: 'pending' };
            if (user.segment) {
              whereClause.segment = user.segment;
            }

            const pendingMessages = await (this.prisma as any).messageQueue.findMany({
              where: whereClause,
              orderBy: { createdAt: 'asc' },
              take: 10,
            });

            for (const queuedMessage of pendingMessages) {
              try {
                await (this.prisma as any).messageQueue.update({
                  where: { id: queuedMessage.id },
                  data: { status: 'processing', attempts: { increment: 1 } },
                });

                // Criar conversa
                await this.conversationsService.create({
                  contactPhone: queuedMessage.contactPhone,
                  contactName: queuedMessage.contactName || queuedMessage.contactPhone,
                  message: queuedMessage.message,
                  sender: 'contact',
                  messageType: queuedMessage.messageType,
                  mediaUrl: queuedMessage.mediaUrl,
                  segment: queuedMessage.segment,
                  userId: user.id,
                  userLine: user.line,
                });

                await (this.prisma as any).messageQueue.update({
                  where: { id: queuedMessage.id },
                  data: { status: 'sent', processedAt: new Date() },
                });

                this.emitToUser(user.id, 'queued-message-processed', {
                  messageId: queuedMessage.id,
                  contactPhone: queuedMessage.contactPhone,
                });
              } catch (error) {
                console.error(`❌ [WebSocket] Erro ao processar mensagem ${queuedMessage.id}:`, error);
                if (queuedMessage.attempts >= 3) {
                  await (this.prisma as any).messageQueue.update({
                    where: { id: queuedMessage.id },
                    data: { status: 'failed', errorMessage: error.message },
                  });
                } else {
                  await (this.prisma as any).messageQueue.update({
                    where: { id: queuedMessage.id },
                    data: { status: 'pending' },
                  });
                }
              }
            }

            if (pendingMessages.length > 0) {
              console.log(`✅ [WebSocket] ${pendingMessages.length} mensagem(ns) da fila processada(s) para operador ${user.name}`);
            }
          } catch (error) {
            console.error('❌ [WebSocket] Erro ao processar fila de mensagens:', error);
          }
        }
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

      // Registrar evento de desconexão
      if (client.data.user.role === 'operator') {
        await this.systemEventsService.logEvent(
          EventType.OPERATOR_DISCONNECTED,
          EventModule.WEBSOCKET,
          { userId: userId, userName: client.data.user.name, email: client.data.user.email },
          userId,
          EventSeverity.INFO,
        );
      }
      
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

    if (!user) {
      console.error('❌ [WebSocket] Usuário não autenticado');
      client.emit('message-error', { error: 'Usuário não autenticado' });
      return { error: 'Usuário não autenticado' };
    }

    // Buscar linha atual do operador (pode estar na tabela LineOperator ou no campo legacy)
    let currentLineId = user.line;
    if (!currentLineId) {
      const lineOperator = await (this.prisma as any).lineOperator.findFirst({
        where: { userId: user.id },
        select: { lineId: true },
      });
      currentLineId = lineOperator?.lineId || null;
    }

    // Se operador não tem linha, tentar atribuir automaticamente
    if (!currentLineId) {
      console.log(`🔄 [WebSocket] Operador ${user.name} sem linha, tentando atribuir automaticamente...`);
      
      let availableLine = null;

      // 1. Primeiro, tentar buscar linha do mesmo segmento do operador
      if (user.segment) {
        const segmentLines = await this.prisma.linesStock.findMany({
          where: {
            lineStatus: 'active',
            segment: user.segment,
          },
        });

        // Filtrar por evolutions ativas
        const filteredLines = await this.controlPanelService.filterLinesByActiveEvolutions(segmentLines, user.segment);
        availableLine = await this.findAvailableLineForOperator(filteredLines, user.id, user.segment);
      }

      // 2. Se não encontrou linha do segmento, buscar linha padrão (segmento "Padrão")
      if (!availableLine) {
        const defaultSegment = await this.prisma.segment.findUnique({
          where: { name: 'Padrão' },
        });

        if (defaultSegment) {
          const defaultLines = await this.prisma.linesStock.findMany({
            where: {
              lineStatus: 'active',
              segment: defaultSegment.id,
            },
          });

          // Filtrar por evolutions ativas
          const filteredDefaultLines = await this.controlPanelService.filterLinesByActiveEvolutions(defaultLines, user.segment);
          availableLine = await this.findAvailableLineForOperator(filteredDefaultLines, user.id, user.segment);

          // Se encontrou linha padrão e operador tem segmento, atualizar o segmento da linha
          if (availableLine && user.segment) {
            await this.prisma.linesStock.update({
              where: { id: availableLine.id },
              data: { segment: user.segment },
            });
            console.log(`🔄 [WebSocket] Linha padrão ${availableLine.phone} atualizada para o segmento ${user.segment} do operador ${user.name}`);
          }
        }
      }

      if (availableLine) {
        // Verificar quantos operadores já estão vinculados
        const currentOperatorsCount = await (this.prisma as any).lineOperator.count({
          where: { lineId: availableLine.id },
        });

        if (currentOperatorsCount < 2) {
          // Verificar se a linha já tem operadores de outro segmento
          const existingOperators = await (this.prisma as any).lineOperator.findMany({
            where: { lineId: availableLine.id },
            include: { user: true },
          });

          // Se a linha já tem operadores, verificar se são do mesmo segmento
          if (existingOperators.length > 0) {
            const allSameSegment = existingOperators.every((lo: any) => 
              lo.user.segment === user.segment
            );
            
            if (!allSameSegment) {
              // Linha já tem operador de outro segmento, não pode atribuir
              console.warn(`⚠️ [WebSocket] Linha ${availableLine.phone} já tem operador de outro segmento, não pode atribuir para ${user.name}`);
              availableLine = null;
            }
          }

          // Só vincular se passou na validação de segmento
          if (availableLine) {
            // Vincular operador à linha usando método com transaction + lock
            try {
              await this.linesService.assignOperatorToLine(availableLine.id, user.id);
              
              // Atualizar user object e currentLineId
              user.line = availableLine.id;
              currentLineId = availableLine.id;

              console.log(`✅ [WebSocket] Linha ${availableLine.phone} atribuída automaticamente ao operador ${user.name} (segmento ${availableLine.segment || 'sem segmento'})`);
              
              // Notificar o operador
              client.emit('line-assigned', {
                lineId: availableLine.id,
                linePhone: availableLine.phone,
                message: `Você foi vinculado à linha ${availableLine.phone} automaticamente.`,
              });
            } catch (error) {
              console.error(`❌ [WebSocket] Erro ao vincular linha ${availableLine.id} ao operador ${user.id}:`, error.message);
              // Continuar para tentar outra linha
              availableLine = null;
            }
          }
        }
      }

      // Se ainda não tem linha após tentar atribuir, fazer busca ampla (qualquer linha ativa)
      if (!currentLineId) {
        console.warn(`⚠️ [WebSocket] Operador ${user.name} ainda sem linha, tentando busca ampla...`);
        
        // Buscar qualquer linha ativa (sem filtro de segmento)
        const anyActiveLines = await this.prisma.linesStock.findMany({
          where: {
            lineStatus: 'active',
          },
        });
        
        // Filtrar por evolutions ativas
        const filteredAnyLines = await this.controlPanelService.filterLinesByActiveEvolutions(anyActiveLines, user.segment);
        const fallbackLine = await this.findAvailableLineForOperator(filteredAnyLines, user.id, user.segment);
        
        if (fallbackLine) {
          const currentOperatorsCount = await (this.prisma as any).lineOperator.count({
            where: { lineId: fallbackLine.id },
          });
          
          if (currentOperatorsCount < 2) {
            // Verificar se não tem operadores de outro segmento
            const existingOperators = await (this.prisma as any).lineOperator.findMany({
              where: { lineId: fallbackLine.id },
              include: { user: true },
            });
            
            const canAssign = existingOperators.length === 0 || 
              existingOperators.every((lo: any) => lo.user.segment === user.segment);
            
            if (canAssign) {
              // Vincular operador à linha usando método com transaction + lock
              try {
                await this.linesService.assignOperatorToLine(fallbackLine.id, user.id);
                
                // Atualizar segmento da linha se operador tem segmento
                if (user.segment && fallbackLine.segment !== user.segment) {
                  await this.prisma.linesStock.update({
                    where: { id: fallbackLine.id },
                    data: { segment: user.segment },
                  });
                }
                
                user.line = fallbackLine.id;
                currentLineId = fallbackLine.id;
                console.log(`✅ [WebSocket] Linha ${fallbackLine.phone} atribuída ao operador ${user.name} (busca ampla no envio de mensagem)`);
                
                client.emit('line-assigned', {
                  lineId: fallbackLine.id,
                  linePhone: fallbackLine.phone,
                  message: `Você foi vinculado à linha ${fallbackLine.phone} automaticamente.`,
                });
              } catch (error) {
                console.error(`❌ [WebSocket] Erro ao vincular linha ${fallbackLine.id} ao operador ${user.id}:`, error.message);
                // Continuar para tentar outra linha
              }
            }
          }
        }
        
        // Se ainda não tem linha após todas as tentativas
        if (!currentLineId) {
          console.error('❌ [WebSocket] Operador sem linha atribuída e nenhuma linha disponível após todas as tentativas');
          client.emit('message-error', { error: 'Você não possui uma linha atribuída e não há linhas disponíveis no momento. Entre em contato com o administrador.' });
          return { error: 'Você não possui uma linha atribuída' };
        }
      }
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

      // Buscar linha atual do operador (sempre usar a linha atual, não a linha antiga da conversa)
      let line = await this.prisma.linesStock.findUnique({
        where: { id: currentLineId },
      });

      if (!line || line.lineStatus !== 'active') {
        client.emit('message-error', { error: 'Linha não disponível' });
        return { error: 'Linha não disponível' };
      }

      const evolution = await this.prisma.evolution.findUnique({
        where: { evolutionName: line.evolutionName },
      });
      const instanceName = `line_${line.phone.replace(/\D/g, '')}`;

      // Health check: Verificar se a linha está realmente conectada no Evolution
      try {
        const healthCheck = await axios.get(
          `${evolution.evolutionUrl}/instance/connectionState/${instanceName}`,
          {
            headers: { 'apikey': evolution.evolutionKey },
            timeout: 5000, // 5 segundos para health check
          }
        );

        const connectionState = healthCheck.data?.state || healthCheck.data?.status;
        if (connectionState !== 'open' && connectionState !== 'OPEN' && connectionState !== 'connected' && connectionState !== 'CONNECTED') {
          console.warn(`⚠️ [WebSocket] Linha ${line.phone} não está conectada no Evolution (status: ${connectionState})`);
          
          // Realocação automática: buscar nova linha para o operador
          console.log(`🔄 [WebSocket] Iniciando realocação automática de linha para operador ${user.name}...`);
          const reallocationResult = await this.reallocateLineForOperator(user.id, user.segment);
          
          if (reallocationResult.success) {
            // Atualizar user object
            user.line = reallocationResult.newLineId;
            currentLineId = reallocationResult.newLineId;
            
            console.log(`✅ [WebSocket] Linha realocada automaticamente: ${reallocationResult.oldLinePhone} → ${reallocationResult.newLinePhone}`);
            
            // Tentar enviar mensagem novamente com a nova linha
            // Recarregar dados da nova linha
            const newLine = await this.prisma.linesStock.findUnique({
              where: { id: reallocationResult.newLineId },
            });
            
            if (newLine) {
              // Atualizar variável line para usar a nova linha
              line = newLine;
              // Continuar o fluxo normalmente com a nova linha
              console.log(`🔄 [WebSocket] Continuando envio de mensagem com nova linha ${newLine.phone}`);
            } else {
              client.emit('message-error', { 
                error: `Linha ${reallocationResult.oldLinePhone} desconectada. Nova linha atribuída, mas não foi possível enviar a mensagem. Tente novamente.` 
              });
              return { error: 'Linha desconectada e realocada, mas nova linha não encontrada' };
            }
          } else {
            client.emit('message-error', { 
              error: `Linha ${line.phone} não está conectada e não foi possível realocar outra linha. ${reallocationResult.reason || ''}` 
            });
            return { error: 'Linha não está conectada e não foi possível realocar' };
          }
        }
      } catch (healthError: any) {
        console.error(`❌ [WebSocket] Erro ao verificar health da linha ${line.phone}:`, healthError.message);
        // Continuar mesmo se o health check falhar (pode ser problema temporário)
        console.warn(`⚠️ [WebSocket] Continuando envio apesar do erro no health check`);
      }

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
            timeout: 30000, // 30 segundos
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
              const response = await axios.get(data.mediaUrl, { 
                responseType: 'arraybuffer',
                timeout: 30000, // 30 segundos
              });
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
                timeout: 30000, // 30 segundos
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
                  timeout: 30000, // 30 segundos
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
                  timeout: 30000, // 30 segundos
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
            timeout: 30000, // 30 segundos
          }
        );
      }

      // Buscar contato
      const contact = await this.prisma.contact.findFirst({
        where: { phone: data.contactPhone },
      });

      // Salvar conversa usando a linha ATUAL do operador
      // Isso garante que mesmo se a linha foi trocada, a mensagem vai pela linha atual
      const conversation = await this.conversationsService.create({
        contactName: contact?.name || 'Desconhecido',
        contactPhone: data.contactPhone,
        segment: user.segment,
        userName: user.name,
        userLine: currentLineId, // Sempre usar a linha atual
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
      
      // Registrar evento de mensagem enviada
      await this.systemEventsService.logEvent(
        EventType.MESSAGE_SENT,
        EventModule.WEBSOCKET,
        {
          userId: user.id,
          userName: user.name,
          contactPhone: data.contactPhone,
          messageType: data.messageType || 'text',
          lineId: currentLineId,
          linePhone: line?.phone,
        },
        user.id,
        EventSeverity.INFO,
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
        code: error.code,
        stack: error.stack,
      });
      
      // Registrar evento de erro
      await this.systemEventsService.logEvent(
        error.code === 'ECONNABORTED' || error.message?.includes('timeout')
          ? EventType.TIMEOUT_ERROR
          : EventType.API_ERROR,
        EventModule.WEBSOCKET,
        {
          userId: user.id,
          userName: user.name,
          contactPhone: data.contactPhone,
          errorCode: error.code,
          errorMessage: error.message,
          status: error.response?.status,
        },
        user.id,
        EventSeverity.ERROR,
      );

      // Detectar timeout específico - realocar linha automaticamente
      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        console.error('⏱️ [WebSocket] Timeout na requisição para Evolution API - Realocando linha...');
        
        // Realocar linha para o operador
        const realocationResult = await this.reallocateLineForOperator(user.id, user.segment);
        
        if (realocationResult.success) {
          const timeoutMessage = `A requisição demorou muito. Nova linha ${realocationResult.newLinePhone} foi atribuída automaticamente. Tente novamente.`;
          console.log(`✅ [WebSocket] Linha realocada: ${realocationResult.oldLinePhone} → ${realocationResult.newLinePhone}`);
          
          // Atualizar user object
          user.line = realocationResult.newLineId;
          
          // Notificar o operador sobre a nova linha
          client.emit('line-reallocated', {
            oldLinePhone: realocationResult.oldLinePhone,
            newLinePhone: realocationResult.newLinePhone,
            newLineId: realocationResult.newLineId,
            message: timeoutMessage,
          });
          
          client.emit('message-error', { error: timeoutMessage });
          return { error: timeoutMessage };
        } else {
          const timeoutMessage = 'A requisição demorou muito para responder. Não foi possível realocar linha. Tente novamente mais tarde.';
          console.error('❌ [WebSocket] Falha ao realocar linha:', realocationResult.reason);
          client.emit('message-error', { error: timeoutMessage });
          return { error: timeoutMessage };
        }
      }
      
      // Detectar erro 504 Gateway Timeout
      if (error.response?.status === 504) {
        const timeoutMessage = 'O servidor demorou muito para processar a mensagem. Tente novamente.';
        console.error('⏱️ [WebSocket] Gateway Timeout (504) - servidor demorou muito para responder');
        client.emit('message-error', { error: timeoutMessage });
        return { error: timeoutMessage };
      }
      
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
  private async findAvailableLineForOperator(availableLines: any[], userId: number, userSegment: number | null) {
    for (const line of availableLines) {
      // IMPORTANTE: Verificar se a linha pertence ao mesmo segmento do operador
      // Se a linha tem segmento diferente e não é padrão (null), pular
      if (line.segment !== null && line.segment !== userSegment) {
        continue;
      }

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
          // Verificar se a linha já tem operadores de outro segmento
          const existingOperators = await (this.prisma as any).lineOperator.findMany({
            where: { lineId: line.id },
            include: { user: true },
          });

          // Se a linha já tem operadores, verificar se são do mesmo segmento
          if (existingOperators.length > 0) {
            const allSameSegment = existingOperators.every((lo: any) => 
              lo.user.segment === userSegment
            );
            
            if (!allSameSegment) {
              // Linha já tem operador de outro segmento, não pode atribuir
              continue;
            }
          }

          return line;
        }
      }
    }
    return null;
  }

  // Método para realocar linha quando houver problemas (timeout, etc)
  private async reallocateLineForOperator(userId: number, userSegment: number | null): Promise<{
    success: boolean;
    oldLinePhone?: string;
    newLinePhone?: string;
    newLineId?: number;
    reason?: string;
  }> {
    try {
      // Buscar operador atual
      const operator = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!operator || operator.role !== 'operator') {
        return { success: false, reason: 'Operador não encontrado' };
      }

      // Buscar linha atual
      let currentLineId = operator.line;
      if (!currentLineId) {
        // Tentar buscar na tabela LineOperator
        const lineOperator = await (this.prisma as any).lineOperator.findFirst({
          where: { userId },
        });
        currentLineId = lineOperator?.lineId || null;
      }

      let oldLinePhone = null;
      if (currentLineId) {
        const oldLine = await this.prisma.linesStock.findUnique({
          where: { id: currentLineId },
        });
        oldLinePhone = oldLine?.phone || null;

        // Remover operador da linha antiga
        await (this.prisma as any).lineOperator.deleteMany({
          where: { userId, lineId: currentLineId },
        });
      }

      // Buscar nova linha disponível
      let availableLine = null;

      // 1. Primeiro, tentar buscar linha do mesmo segmento do operador
      if (userSegment) {
        const segmentLines = await this.prisma.linesStock.findMany({
          where: {
            lineStatus: 'active',
            segment: userSegment,
          },
        });

        // Filtrar por evolutions ativas
        const filteredLines = await this.controlPanelService.filterLinesByActiveEvolutions(segmentLines, userSegment);
        availableLine = await this.findAvailableLineForOperator(filteredLines, userId, userSegment);
      }

      // 2. Se não encontrou linha do segmento, buscar linha padrão
      if (!availableLine) {
        const defaultSegment = await this.prisma.segment.findUnique({
          where: { name: 'Padrão' },
        });

        if (defaultSegment) {
          const defaultLines = await this.prisma.linesStock.findMany({
            where: {
              lineStatus: 'active',
              segment: defaultSegment.id,
            },
          });

          // Filtrar por evolutions ativas
          const filteredDefaultLines = await this.controlPanelService.filterLinesByActiveEvolutions(defaultLines, userSegment);
          availableLine = await this.findAvailableLineForOperator(filteredDefaultLines, userId, userSegment);

          // Se encontrou linha padrão e operador tem segmento, atualizar o segmento da linha
          if (availableLine && userSegment) {
            await this.prisma.linesStock.update({
              where: { id: availableLine.id },
              data: { segment: userSegment },
            });
          }
        }
      }

      if (!availableLine) {
        return { success: false, reason: 'Nenhuma linha disponível' };
      }

      // Verificar quantos operadores já estão vinculados
      const currentOperatorsCount = await (this.prisma as any).lineOperator.count({
        where: { lineId: availableLine.id },
      });

      // Vincular operador à nova linha usando método com transaction + lock
      try {
        await this.linesService.assignOperatorToLine(availableLine.id, userId); // ✅ COM LOCK

        console.log(`✅ [WebSocket] Linha realocada para operador ${operator.name}: ${oldLinePhone || 'sem linha'} → ${availableLine.phone}`);

        // Registrar evento de realocação
        await this.systemEventsService.logEvent(
          EventType.LINE_REALLOCATED,
          EventModule.WEBSOCKET,
          {
            userId: userId,
            userName: operator.name,
            oldLinePhone: oldLinePhone || null,
            newLinePhone: availableLine.phone,
            newLineId: availableLine.id,
          },
          userId,
          EventSeverity.WARNING,
        );

        return {
          success: true,
          oldLinePhone: oldLinePhone || undefined,
          newLinePhone: availableLine.phone,
          newLineId: availableLine.id,
        };
      } catch (error: any) {
        console.error(`❌ [WebSocket] Erro ao vincular nova linha:`, error.message);
        return { success: false, reason: error.message };
      }
    } catch (error: any) {
      console.error('❌ [WebSocket] Erro ao realocar linha:', error);
      return { success: false, reason: error.message || 'Erro desconhecido' };
    }
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

  /**
   * Método público para enviar mensagem via Evolution API
   * Usado por serviços externos (ex: AutoMessageService)
   */
  async sendMessageToEvolution(
    evolutionUrl: string,
    evolutionKey: string,
    instanceName: string,
    contactPhone: string,
    message: string,
    messageType: string = 'text',
  ): Promise<void> {
    try {
      if (messageType === 'text') {
        await axios.post(
          `${evolutionUrl}/message/sendText/${instanceName}`,
          {
            number: contactPhone.replace(/\D/g, ''),
            text: message,
          },
          {
            headers: { 'apikey': evolutionKey },
            timeout: 30000, // 30 segundos
          }
        );
      } else {
        // Para outros tipos de mensagem, usar o método completo do handleSendMessage
        throw new Error('Tipo de mensagem não suportado neste método. Use handleSendMessage para mídia.');
      }
    } catch (error: any) {
      console.error(`❌ [WebSocket] Erro ao enviar mensagem via Evolution API:`, error.message);
      throw error;
    }
  }
}
