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
import { HumanizationService } from '../humanization/humanization.service';
import { RateLimitingService } from '../rate-limiting/rate-limiting.service';
import { SpintaxService } from '../spintax/spintax.service';
import { HealthCheckCacheService } from '../health-check-cache/health-check-cache.service';
import { LineReputationService } from '../line-reputation/line-reputation.service';
import { PhoneValidationService } from '../phone-validation/phone-validation.service';
import { LineAssignmentService } from '../line-assignment/line-assignment.service';
import { MessageValidationService } from '../message-validation/message-validation.service';
import { MessageSendingService } from '../message-sending/message-sending.service';
import { AppLoggerService } from '../logger/logger.service';
import { TemplatesService } from '../templates/templates.service';
import { TemplateVariableDto } from '../templates/dto/send-template.dto';
import { OperatorQueueService } from '../operator-queue/operator-queue.service';
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
    private humanizationService: HumanizationService,
    private rateLimitingService: RateLimitingService,
    private spintaxService: SpintaxService,
    private healthCheckCacheService: HealthCheckCacheService,
    private lineReputationService: LineReputationService,
    private phoneValidationService: PhoneValidationService,
    private lineAssignmentService: LineAssignmentService,
    private messageValidationService: MessageValidationService,
    private messageSendingService: MessageSendingService,
    private logger: AppLoggerService,
    private templatesService: TemplatesService,
    @Inject(forwardRef(() => OperatorQueueService))
    private queueService: OperatorQueueService,
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

      // Log apenas para operadores (fluxo principal)
      if (user.role === 'operator') {
        console.log(`✅ Operador ${user.name} conectado`);
      }

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
                } catch (error) {
                  console.error(`❌ [WebSocket] Erro ao sincronizar linha ${user.line} para ${user.name}:`, error.message);
                }
              }
            } else {
              // Remover linha inválida do operador
              await this.prisma.user.update({
                where: { id: user.id },
                data: { line: null },
              });
              user.line = null;
            }
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
            // Usar LineAssignmentService (centralizado)
            const assignmentResult = await this.lineAssignmentService.findAvailableLineForOperator(user.id, user.segment);
            if (assignmentResult.success && assignmentResult.lineId) {
              availableLine = await this.prisma.linesStock.findUnique({ where: { id: assignmentResult.lineId } });
            }
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
              
              // Notificação removida - operador não precisa saber
                } catch (error) {
                  console.error(`❌ [WebSocket] Erro ao vincular linha ${availableLine.id} ao operador ${user.id}:`, error.message);
                  // Continuar para tentar outra linha
                  availableLine = null;
                }
              }
            }
          }
          
          // Se ainda não tem linha, tentar busca mais ampla (linhas do segmento "Padrão")
          if (!availableLine || !user.line) {
            // Buscar o segmento "Padrão" pelo nome (criado na seed)
            const defaultSegment = await this.prisma.segment.findUnique({
              where: { name: 'Padrão' },
            });
            
            if (defaultSegment) {
              // Buscar linhas ativas do segmento "Padrão"
              const anyActiveLines = await this.prisma.linesStock.findMany({
                where: {
                  lineStatus: 'active',
                  segment: defaultSegment.id, // Segmento "Padrão" pelo ID
                },
              });
              
              if (anyActiveLines.length === 0) {
                console.warn(`⚠️ [WebSocket] Não existem linhas do segmento "Padrão" disponíveis para o operador ${user.name} (ID: ${user.id})`);
              }
              
              // Filtrar por evolutions ativas
              const filteredAnyLines = await this.controlPanelService.filterLinesByActiveEvolutions(anyActiveLines, user.segment);
              const fallbackLine = await this.findAvailableLineForOperator(filteredAnyLines, user.id, user.segment);
              
              if (!fallbackLine && anyActiveLines.length > 0) {
                console.warn(`⚠️ [WebSocket] Linhas do segmento "Padrão" existem, mas nenhuma está disponível (todas já têm 2 operadores ou evoluções inativas) para o operador ${user.name} (ID: ${user.id})`);
              }
              
              if (fallbackLine) {
                const currentOperatorsCount = await (this.prisma as any).lineOperator.count({
                  where: { lineId: fallbackLine.id },
                });
                
                // Linha do segmento "Padrão" pode ter até 2 operadores
                // Aceita qualquer operador (é linha padrão/compartilhada)
                if (currentOperatorsCount < 2) {
                  // Vincular operador à linha usando método com transaction + lock
                  try {
                    await this.linesService.assignOperatorToLine(fallbackLine.id, user.id);
                    
                    // Atualizar segmento da linha se operador tem segmento
                    // Isso faz a linha deixar de ser "Padrão" e passa a ser do segmento do operador
                    if (user.segment && fallbackLine.segment === defaultSegment.id) {
                      await this.prisma.linesStock.update({
                        where: { id: fallbackLine.id },
                        data: { segment: user.segment },
                      });
                      console.log(`🔄 [WebSocket] Segmento da linha ${fallbackLine.phone} atualizado de "Padrão" para segmento do operador ${user.name}`);
                    }
                    
                    user.line = fallbackLine.id;
                    
                    // Notificação removida - operador não precisa saber
                  } catch (error) {
                    console.error(`❌ [WebSocket] Erro ao vincular linha ${fallbackLine.id} ao operador ${user.id}:`, error.message);
                    // Continuar para tentar outra linha
                  }
                }
              }
            }
            
            // Verificar se ainda não tem linha após todas as tentativas
            if (!user.line) {
              console.error(`❌ [WebSocket] Nenhuma linha disponível para o operador ${user.name} após todas as tentativas`);

              // Adicionar operador à fila de espera
              await this.queueService.addToQueue(user.id, user.segment || null, 0);
              console.log(`📋 [WebSocket] Operador ${user.name} adicionado à fila de espera`);
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

            // Remover limite de 10 - processar todas as mensagens pendentes
            const pendingMessages = await (this.prisma as any).messageQueue.findMany({
              where: whereClause,
              orderBy: { createdAt: 'asc' },
              // Processar em lotes de 50 para não sobrecarregar
              take: 50,
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
      
      try {
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
        
        // Log apenas para operadores (fluxo principal)
        if (client.data.user.role === 'operator') {
          console.log(`❌ Operador ${client.data.user.name} desconectado`);
        }
      } catch (error) {
        console.error(`❌ [WebSocket] Erro ao atualizar status na desconexão:`, error);
      } finally {
        // SEMPRE remover do Map, mesmo com erro
        this.connectedUsers.delete(userId);
      }
    }
  }

  @SubscribeMessage('send-message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { contactPhone: string; message: string; messageType?: string; mediaUrl?: string; fileName?: string; isNewConversation?: boolean; templateId?: number; templateVariables?: TemplateVariableDto[]; base64?: string; mediaBase64?: string },
  ) {
    const startTime = Date.now(); // Para métricas de latência
    const user = client.data.user;

    if (!user) {
      console.error('❌ [WebSocket] Usuário não autenticado');
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
              segment: defaultSegment.id, // Segmento "Padrão" pelo ID
            },
          });

          // Filtrar por evolutions ativas
          const filteredDefaultLines = await this.controlPanelService.filterLinesByActiveEvolutions(defaultLines, user.segment);
          
          // Buscar linha disponível (com menos de 2 operadores)
          for (const line of filteredDefaultLines) {
            const operatorsCount = await (this.prisma as any).lineOperator.count({
              where: { lineId: line.id },
            });
            
            if (operatorsCount < 2) {
              availableLine = line;
              break;
            }
          }

          // Se encontrou linha padrão e operador tem segmento, atualizar o segmento da linha
          if (availableLine && user.segment) {
            await this.prisma.linesStock.update({
              where: { id: availableLine.id },
              data: { segment: user.segment },
            });
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
              
              // Notificação removida - operador não precisa saber
            } catch (error) {
              console.error(`❌ [WebSocket] Erro ao vincular linha ${availableLine.id} ao operador ${user.id}:`, error.message);
              // Continuar para tentar outra linha
              availableLine = null;
            }
          }
        }
      }

      // 3. Se ainda não tem linha, fazer busca ULTRA AMPLA (qualquer linha ativa com menos de 2 operadores, ignorando validações de segmento)
      if (!currentLineId) {
        console.log(`🔄 [WebSocket] Buscando qualquer linha ativa disponível para operador ${user.name}...`);
        
        // Buscar qualquer linha ativa (sem filtro de segmento)
        const anyActiveLines = await this.prisma.linesStock.findMany({
          where: {
            lineStatus: 'active',
          },
        });
        
        // Filtrar por evolutions ativas
        const filteredAnyLines = await this.controlPanelService.filterLinesByActiveEvolutions(anyActiveLines, user.segment);
        
        // Buscar QUALQUER linha com menos de 2 operadores (ignorar validação de segmento)
        for (const line of filteredAnyLines) {
          const currentOperatorsCount = await (this.prisma as any).lineOperator.count({
            where: { lineId: line.id },
          });
          
          // Se tem menos de 2 operadores, pode atribuir (mesmo que tenha operador de outro segmento)
          if (currentOperatorsCount < 2) {
            try {
              await this.linesService.assignOperatorToLine(line.id, user.id);
              
              // Atualizar segmento da linha se operador tem segmento e linha não tem
              if (user.segment && !line.segment) {
                await this.prisma.linesStock.update({
                  where: { id: line.id },
                  data: { segment: user.segment },
                });
              }
              
              user.line = line.id;
              currentLineId = line.id;
              
              console.log(`✅ [WebSocket] Linha ${line.phone} atribuída ao operador ${user.name} (busca ampla, segmento: ${line.segment || 'sem segmento'})`);
              break; // Encontrou e atribuiu, sair do loop
            } catch (error: any) {
              // Se o erro for "já está vinculado", usar essa linha mesmo assim
              if (error.message?.includes('já está vinculado')) {
                user.line = line.id;
                currentLineId = line.id;
                console.log(`✅ [WebSocket] Operador ${user.name} já estava vinculado à linha ${line.phone}`);
                break;
              }
              // Se der outro erro, tentar próxima linha
              console.warn(`⚠️ [WebSocket] Erro ao vincular linha ${line.id} (${line.phone}) ao operador ${user.id}:`, error.message);
            }
          }
        }
      }
      
      // 4. ÚLTIMA TENTATIVA: Se ainda não tem linha, buscar linhas do segmento "Padrão" SEM filtrar por evolutions
      // Isso garante que se há linhas padrão cadastradas, sempre encontra uma
      if (!currentLineId) {
        console.log(`🔄 [WebSocket] Última tentativa: buscando linhas do segmento "Padrão" sem filtro de evolutions...`);
        
        const defaultSegment = await this.prisma.segment.findUnique({
          where: { name: 'Padrão' },
        });
        
        if (defaultSegment) {
          const defaultLines = await this.prisma.linesStock.findMany({
            where: {
              lineStatus: 'active',
              segment: defaultSegment.id, // Segmento "Padrão" pelo ID
            },
          });
          
          // Buscar QUALQUER linha padrão com menos de 2 operadores (SEM filtrar por evolutions)
          for (const line of defaultLines) {
            const currentOperatorsCount = await (this.prisma as any).lineOperator.count({
              where: { lineId: line.id },
            });
            
            if (currentOperatorsCount < 2) {
              try {
                await this.linesService.assignOperatorToLine(line.id, user.id);
                
                // Atualizar segmento da linha se operador tem segmento
                if (user.segment) {
                  await this.prisma.linesStock.update({
                    where: { id: line.id },
                    data: { segment: user.segment },
                  });
                }
                
                user.line = line.id;
                currentLineId = line.id;
                
                console.log(`✅ [WebSocket] Linha padrão ${line.phone} atribuída ao operador ${user.name} (última tentativa)`);
                break;
              } catch (error: any) {
                if (error.message?.includes('já está vinculado')) {
                  user.line = line.id;
                  currentLineId = line.id;
                  break;
                }
              }
            }
          }
        }
      }
      
      // Se DEPOIS DE TODAS AS TENTATIVAS ainda não tem linha, fazer log mas NÃO retornar erro
      // Em vez disso, tentar continuar (mesmo que possa falhar depois)
      if (!currentLineId) {
        const defaultSegment = await this.prisma.segment.findUnique({
          where: { name: 'Padrão' },
        });
        const defaultSegmentId = defaultSegment?.id || null;
        
        console.error(`❌ [WebSocket] CRÍTICO: Nenhuma linha disponível após todas as tentativas para operador ${user.name} (ID: ${user.id})`);
        console.error(`❌ [WebSocket] Total de linhas ativas no banco: ${await this.prisma.linesStock.count({ where: { lineStatus: 'active' } })}`);
        console.error(`❌ [WebSocket] Total de linhas do segmento "Padrão": ${defaultSegmentId ? await this.prisma.linesStock.count({ where: { lineStatus: 'active', segment: defaultSegmentId } }) : 0}`);
        // NÃO retornar erro aqui - deixar continuar e tentar enviar mesmo assim (pode dar erro depois, mas pelo menos tentou)
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


      if (!fullUser?.oneToOneActive) {
        console.error('❌ [WebSocket] Operador sem permissão para 1x1');
        return { error: 'Você não tem permissão para iniciar conversas 1x1' };
      }
    }

    try {
      // Verificar CPC
      const cpcCheck = await this.controlPanelService.canContactCPC(data.contactPhone, user.segment);
      if (!cpcCheck.allowed) {
        return { error: cpcCheck.reason };
      }

      // Verificar repescagem
      const repescagemCheck = await this.controlPanelService.checkRepescagem(
        data.contactPhone,
        user.id,
        user.segment
      );
      if (!repescagemCheck.allowed) {
        return { error: repescagemCheck.reason };
      }

      // Normalizar telefone (remover espaços, hífens, adicionar 55 se necessário)
      const normalizedPhone = this.phoneValidationService.cleanPhone(data.contactPhone);
      data.contactPhone = normalizedPhone;
      
      // Validação de número: Verificar se o número é válido antes de enviar
      const phoneValidation = this.phoneValidationService.isValidFormat(data.contactPhone);
      if (!phoneValidation) {
        return { error: 'Número de telefone inválido' };
      }

      // Buscar linha atual do operador (sempre usar a linha atual, não a linha antiga da conversa)
      let line = await this.prisma.linesStock.findUnique({
        where: { id: currentLineId },
      });

      if (!line || line.lineStatus !== 'active') {
        return { error: 'Linha não disponível' };
      }

      const evolution = await this.prisma.evolution.findUnique({
        where: { evolutionName: line.evolutionName },
      });
      const instanceName = `line_${line.phone.replace(/\D/g, '')}`;

      // Rate Limiting: Verificar se a linha pode enviar mensagem
      const canSend = await this.rateLimitingService.canSendMessage(currentLineId);
      if (!canSend) {
        return { error: 'Limite de mensagens atingido' };
      }

      // Verificar se o segmento permite mensagem livre (APENAS para novas conversas 1x1)
      // Se não permitir e não for template, bloquear envio apenas em novas conversas
      if (data.isNewConversation && user.segment && !data.templateId) {
        const segment = await this.prisma.segment.findUnique({
          where: { id: user.segment },
        });

        // Verificar allowsFreeMessage (campo pode não existir ainda se Prisma não foi regenerado)
        const allowsFreeMessage = (segment as any)?.allowsFreeMessage;
        if (segment && allowsFreeMessage === false) {
          return { 
            error: 'Este segmento não permite mensagens livres. Use apenas templates para enviar mensagens no 1x1.' 
          };
        }
      }

      // Humanização: Simular comportamento humano antes de enviar
      const messageLength = data.message?.length || 0;
      const isResponse = !data.isNewConversation; // Se não é nova conversa, é resposta
      const humanizedDelay = await this.humanizationService.getHumanizedDelay(messageLength, isResponse);
      
      await this.humanizationService.sleep(humanizedDelay);

      // Se templateId foi fornecido, usar TemplatesService para enviar template
      if (data.templateId) {
        try {
          // Buscar contato para obter nome
          const contact = await this.prisma.contact.findFirst({
            where: { phone: data.contactPhone },
          });

          // Enviar template via TemplatesService
          const templateResult = await this.templatesService.sendTemplate({
            templateId: data.templateId,
            phone: data.contactPhone,
            contactName: contact?.name || data.message || 'Contato',
            variables: data.templateVariables || [],
            lineId: currentLineId,
          });

          if (templateResult.success) {
            // Buscar conversa criada pelo template
            const conversation = await this.prisma.conversation.findFirst({
              where: {
                contactPhone: data.contactPhone,
                userLine: currentLineId,
              },
              orderBy: { datetime: 'desc' },
            });

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
                messageType: 'template',
                lineId: currentLineId,
                linePhone: line?.phone,
                templateId: data.templateId,
              },
              user.id,
              EventSeverity.INFO,
            );

            // Emitir mensagem para o usuário
            if (conversation) {
              client.emit('message-sent', { message: conversation });
              this.emitToSupervisors(user.segment, 'new_message', { message: conversation });
            }

            return { success: true, conversation, templateMessageId: templateResult.templateMessageId };
          } else {
            return { error: templateResult.error || 'Erro ao enviar template' };
          }
        } catch (templateError: any) {
          console.error('❌ [WebSocket] Erro ao enviar template:', templateError);
          return { error: templateError.message || 'Erro ao enviar template' };
        }
      }

      // Health check: Verificar se a linha está realmente conectada no Evolution (com cache)
      let connectionState: string;
      try {
        connectionState = await this.healthCheckCacheService.getConnectionStatus(
          evolution.evolutionUrl,
          evolution.evolutionKey,
          instanceName,
        );
        // Verificar se status é realmente desconectado
        // "unknown" não é considerado desconectado (pode ser cache ou API não retornou status)
        // Apenas status explicitamente desconectados devem acionar realocação
        const isConnected = connectionState === 'open' || 
                           connectionState === 'OPEN' || 
                           connectionState === 'connected' || 
                           connectionState === 'CONNECTED';
        
        const isExplicitlyDisconnected = connectionState === 'close' || 
                                        connectionState === 'CLOSE' || 
                                        connectionState === 'disconnected' ||
                                        connectionState === 'DISCONNECTED' ||
                                        connectionState === 'closeTimeout';
        
        // Se não está explicitamente desconectado, considerar como conectado (incluindo "unknown")
        if (isExplicitlyDisconnected && !isConnected) {
          // Realocação automática: buscar nova linha para o operador
          console.warn(`⚠️ [WebSocket] Linha ${line.phone} desconectada. Realocando para ${user.name}...`);
          const reallocationResult = await this.lineAssignmentService.reallocateLineForOperator(user.id, user.segment, currentLineId);
          
          // Verificar se realmente conseguiu uma NOVA linha (diferente da atual)
          if (reallocationResult.success && reallocationResult.lineId && reallocationResult.lineId !== currentLineId) {
            // Atualizar user object
            user.line = reallocationResult.lineId;
            currentLineId = reallocationResult.lineId;
            
            console.log(`✅ [WebSocket] Linha realocada: ${line.phone} → ${reallocationResult.linePhone}`);
            
            // Tentar enviar mensagem novamente com a nova linha
            // Recarregar dados da nova linha
            const newLine = await this.prisma.linesStock.findUnique({
              where: { id: reallocationResult.lineId },
            });
            
            if (newLine) {
              // Atualizar variável line para usar a nova linha
              line = newLine;
              // Continuar o fluxo normalmente com a nova linha
            } else {
              return { error: 'Linha desconectada e realocada, mas nova linha não encontrada' };
            }
          } else {
            return { error: 'Linha não está conectada e não foi possível realocar' };
          }
        }
      } catch (healthError: any) {
        // Erro no health check não deve bloquear envio (pode ser problema temporário da API)
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
          // PRIORIDADE 1: Base64 do cliente (direto, sem ler do servidor)
          let base64File: string | null = data.base64 || data.mediaBase64 || null;
          
          // Se não veio base64 do cliente E tem mediaUrl, tentar ler do servidor
          let filePath: string | null = null;
          if (!base64File && data.mediaUrl) {
            if (data.mediaUrl.startsWith('/media/')) {
              // URL relativa do nosso servidor
              const filename = data.mediaUrl.replace('/media/', '');
              try {
                filePath = await this.mediaService.getFilePath(filename);
              } catch {
                console.warn(`⚠️ [WebSocket] Arquivo não encontrado no storage: ${filename}`);
              }
            } else if (data.mediaUrl.startsWith('http')) {
              // URL completa - verificar se é do nosso servidor
              const appUrl = process.env.APP_URL || 'https://api.newvend.taticamarketing.com.br';
              if (data.mediaUrl.startsWith(appUrl)) {
                const urlPath = new URL(data.mediaUrl).pathname;
                const filename = urlPath.replace('/media/', '');
                try {
                  filePath = await this.mediaService.getFilePath(filename);
                } catch {
                  console.warn(`⚠️ [WebSocket] Arquivo não encontrado no storage: ${filename}`);
                }
              }
              // Se for URL externa, não tentar ler - usar URL diretamente
            }
            
            // Se encontrou arquivo no servidor, ler e converter para base64
            if (filePath) {
              try {
                const fileBuffer = await fs.readFile(filePath);
                base64File = fileBuffer.toString('base64');
              } catch (fileError: any) {
                console.error(`❌ [WebSocket] Erro ao ler arquivo ${filePath}:`, fileError.message);
                base64File = null;
              }
            }
          }
          
          // Estratégia: Priorizar base64, depois URL
          const cleanPhone = data.contactPhone.replace(/\D/g, '');
          let payload: any = {
            number: cleanPhone,
            mediatype: getMediaType(cleanFileName),
            fileName: cleanFileName,
          };
          
          if (data.message && data.message.trim()) {
            payload.caption = data.message;
          }
          
          // Tentar com base64 primeiro (mais confiável)
          if (base64File && typeof base64File === 'string') {
            payload.base64 = base64File;
            
            try {
              console.log(`📤 [WebSocket] Enviando mídia via base64 para ${cleanPhone} via linha ${line.phone}`);
              apiResponse = await axios.post(
                `${evolution.evolutionUrl}/message/sendMedia/${instanceName}`,
                payload,
                {
                  headers: { 'apikey': evolution.evolutionKey },
                  timeout: 30000,
                }
              );
              console.log(`✅ [WebSocket] Mídia enviada com sucesso (base64)`);
            } catch (base64Error: any) {
              // Se base64 falhar, tentar com campo "media"
              delete payload.base64;
              payload.media = base64File;
              
              try {
                console.log(`📤 [WebSocket] Tentando enviar mídia via campo "media"...`);
                apiResponse = await axios.post(
                  `${evolution.evolutionUrl}/message/sendMedia/${instanceName}`,
                  payload,
                  {
                    headers: { 'apikey': evolution.evolutionKey },
                    timeout: 30000,
                  }
                );
                console.log(`✅ [WebSocket] Mídia enviada com sucesso (campo media)`);
              } catch (mediaError: any) {
                throw mediaError;
              }
            }
          } else if (data.mediaUrl) {
            // Se não tem base64, tentar com URL
            const appUrl = process.env.APP_URL || 'https://api.newvend.taticamarketing.com.br';
            let fullMediaUrl: string;
            
            if (data.mediaUrl.startsWith('/media/')) {
              fullMediaUrl = `${appUrl}${data.mediaUrl}`;
            } else if (data.mediaUrl.startsWith('http')) {
              fullMediaUrl = data.mediaUrl;
            } else {
              fullMediaUrl = `${appUrl}/media/${data.mediaUrl.replace(/^\/media\//, '')}`;
            }
            
            payload.mediaUrl = fullMediaUrl;
            
            console.log(`📤 [WebSocket] Enviando mídia via URL para ${cleanPhone} via linha ${line.phone}`);
            apiResponse = await axios.post(
              `${evolution.evolutionUrl}/message/sendMedia/${instanceName}`,
              payload,
              {
                headers: { 'apikey': evolution.evolutionKey },
                timeout: 30000,
              }
            );
            console.log(`✅ [WebSocket] Mídia enviada com sucesso (URL)`);
          } else {
            throw new Error('Nenhum arquivo fornecido (base64, mediaBase64 ou mediaUrl)');
          }
          
          // Limpar arquivo temporário se foi criado
          if (filePath && filePath.includes('temp-')) {
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
        // Usar o telefone já normalizado (data.contactPhone já foi normalizado acima)
        // Ainda assim, garantir que só tem números para a Evolution API
        const cleanPhone = data.contactPhone.replace(/\D/g, '');
        
        console.log(`📤 [WebSocket] Enviando mensagem de texto para ${cleanPhone} via linha ${line.phone}`);
        
        apiResponse = await axios.post(
          `${evolution.evolutionUrl}/message/sendText/${instanceName}`,
          {
            number: cleanPhone,
            text: data.message,
          },
          {
            headers: { 'apikey': evolution.evolutionKey },
            timeout: 30000, // 30 segundos
          }
        );
        
        console.log(`✅ [WebSocket] Resposta da Evolution API:`, {
          status: apiResponse?.status,
          data: apiResponse?.data,
        });
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

      // Log apenas para mensagens enviadas com sucesso (fluxo principal)
      console.log(`✅ Mensagem enviada: ${user.name} → ${data.contactPhone}`);
      
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

      // Tentar recuperar automaticamente: realocar linha e tentar novamente
      const recoveryResult = await this.recoverAndRetryMessage(client, user, data, error);
      
      if (recoveryResult.success) {
        // Sucesso após recuperação - não mostrar erro para o operador
        return { success: true, conversation: recoveryResult.conversation };
      } else {
        // Falhou após todas as tentativas - não notificar operador
        return { error: 'Não foi possível enviar a mensagem' };
      }
    }
  }

  /**
   * Tenta recuperar de erros e reenviar a mensagem automaticamente
   * Retorna sucesso se conseguiu enviar, ou falha após todas as tentativas
   */
  private async recoverAndRetryMessage(
    client: Socket,
    user: any,
    data: { contactPhone: string; message: string; messageType?: string; mediaUrl?: string; fileName?: string; isNewConversation?: boolean },
    originalError: any,
  ): Promise<{ success: boolean; conversation?: any; reason?: string }> {
    const maxRetries = 3;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // 1. Realocar linha
        const reallocationResult = await this.reallocateLineForOperator(user.id, user.segment);
        
        if (!reallocationResult.success) {
          console.warn(`⚠️ [WebSocket] Falha ao realocar linha na tentativa ${attempt}:`, reallocationResult.reason);
          if (attempt < maxRetries) {
            // Aguardar um pouco antes de tentar novamente
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            continue;
          }
          console.error(`❌ [WebSocket] Não foi possível realocar linha após ${maxRetries} tentativas`);
          return { success: false, reason: 'Não foi possível realocar linha após múltiplas tentativas' };
        }
        
        // 2. Atualizar user object com nova linha
        user.line = reallocationResult.newLineId;
        
        // 3. Buscar dados da nova linha
        const newLine = await this.prisma.linesStock.findUnique({
          where: { id: reallocationResult.newLineId },
        });
        
        if (!newLine || newLine.lineStatus !== 'active') {
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            continue;
          }
          return { success: false, reason: 'Nova linha não está ativa' };
        }
        
        // 4. Buscar Evolution da nova linha
        const evolution = await this.prisma.evolution.findUnique({
          where: { evolutionName: newLine.evolutionName },
        });
        
        if (!evolution) {
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            continue;
          }
          return { success: false, reason: 'Evolution não encontrada' };
        }
        
        // 5. Verificar health da nova linha
        try {
          const instanceName = `line_${newLine.phone.replace(/\D/g, '')}`;
          const connectionState = await this.healthCheckCacheService.getConnectionStatus(
            evolution.evolutionUrl,
            evolution.evolutionKey,
            instanceName,
          );
          if (connectionState !== 'open' && connectionState !== 'OPEN' && connectionState !== 'connected' && connectionState !== 'CONNECTED') {
            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
              continue;
            }
            return { success: false, reason: 'Nova linha não está conectada' };
          }
        } catch (healthError) {
          // Continuar mesmo assim - tentar enviar
        }
      
        // 6. Tentar enviar mensagem novamente com a nova linha
        const instanceName = `line_${newLine.phone.replace(/\D/g, '')}`;
        let apiResponse;
        
        if (data.messageType === 'image' && data.mediaUrl) {
          apiResponse = await axios.post(
            `${evolution.evolutionUrl}/message/sendMedia/${instanceName}`,
            {
              number: data.contactPhone.replace(/\D/g, ''),
              mediaUrl: data.mediaUrl,
              caption: data.message,
              mediatype: 'image',
            },
            {
              headers: { 'apikey': evolution.evolutionKey },
              timeout: 30000,
            }
          );
        } else if (data.messageType === 'document' && data.mediaUrl) {
          // Para documentos, usar sendMedia com base64
          const fileName = data.fileName || data.mediaUrl.split('/').pop() || 'document.pdf';
          let filePath: string;
          let tempPath: string | null = null;
          
          try {
            if (data.mediaUrl.startsWith('/media/')) {
              const filename = data.mediaUrl.replace('/media/', '');
              filePath = await this.mediaService.getFilePath(filename);
            } else if (data.mediaUrl.startsWith('http')) {
              const appUrl = process.env.APP_URL || 'https://api.newvend.taticamarketing.com.br';
              if (data.mediaUrl.startsWith(appUrl)) {
                const urlPath = new URL(data.mediaUrl).pathname;
                const filename = urlPath.replace('/media/', '');
                filePath = await this.mediaService.getFilePath(filename);
              } else {
                const response = await axios.get(data.mediaUrl, { 
                  responseType: 'arraybuffer',
                  timeout: 30000,
                });
                tempPath = path.join('./uploads', `temp-${Date.now()}-${fileName}`);
                await fs.mkdir('./uploads', { recursive: true });
                await fs.writeFile(tempPath, response.data);
                filePath = tempPath;
              }
            } else {
              const relativePath = data.mediaUrl.replace(/^\/media\//, '');
              filePath = path.join('./uploads', relativePath);
              
              // Verificar se o arquivo existe antes de tentar ler
              try {
                await fs.access(filePath);
              } catch {
                console.error(`❌ [WebSocket] Arquivo não encontrado na recuperação: ${filePath}`);
                throw new Error(`Arquivo não encontrado: ${relativePath}`);
              }
            }
            
            const fileBuffer = await fs.readFile(filePath);
            const base64File = fileBuffer.toString('base64');
            
            apiResponse = await axios.post(
              `${evolution.evolutionUrl}/message/sendMedia/${instanceName}`,
              {
                number: data.contactPhone.replace(/\D/g, ''),
                mediatype: 'document',
                media: `data:application/pdf;base64,${base64File}`,
                fileName: fileName,
                caption: data.message,
              },
              {
                headers: { 'apikey': evolution.evolutionKey },
                timeout: 30000,
              }
            );
          } finally {
            // SEMPRE limpar arquivo temporário, mesmo com erro
            if (tempPath) {
              try {
                await fs.unlink(tempPath).catch(err =>
                  console.error(`❌ [WebSocket] Erro ao limpar arquivo temporário ${tempPath}:`, err)
                );
              } catch (error) {
                console.error(`❌ [WebSocket] Erro ao limpar arquivo temporário:`, error);
              }
            }
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
              timeout: 30000,
            }
          );
        }
        
        // 7. Se chegou aqui, mensagem foi enviada com sucesso!
        console.log(`✅ Mensagem enviada após recuperação: ${user.name} → ${data.contactPhone} (tentativa ${attempt})`);
        
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
          userLine: newLine.id,
          userId: user.id,
          message: data.message,
          sender: 'operator',
          messageType: data.messageType || 'text',
          mediaUrl: data.mediaUrl,
        });
        
        // Registrar mensagem do operador
        await this.controlPanelService.registerOperatorMessage(
          data.contactPhone,
          user.id,
          user.segment
        );
        
        // Emitir mensagem para o usuário
        client.emit('message-sent', { message: conversation });
        this.emitToSupervisors(user.segment, 'new_message', { message: conversation });
        
        return { success: true, conversation };
        
      } catch (retryError: any) {
        console.error(`❌ [WebSocket] Erro na tentativa ${attempt} de recuperação:`, {
          message: retryError.message,
          status: retryError.response?.status,
          data: retryError.response?.data,
        });
        
        // Se não for a última tentativa, continuar
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          continue;
        }
        
        // Última tentativa falhou
        console.error(`❌ [WebSocket] Falha após ${maxRetries} tentativas de recuperação`);
        return { success: false, reason: `Falha após ${maxRetries} tentativas: ${retryError.message}` };
      }
    }
    
    return { success: false, reason: 'Todas as tentativas de recuperação falharam' };
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
          
          // Buscar linha disponível manualmente (sem usar findAvailableLineForOperator que pode ser muito restritivo)
          for (const line of filteredDefaultLines) {
            const operatorsCount = await (this.prisma as any).lineOperator.count({
              where: { lineId: line.id },
            });
            
            if (operatorsCount < 2) {
              availableLine = line;
              break;
            }
          }

          // Se encontrou linha padrão e operador tem segmento, atualizar o segmento da linha
          if (availableLine && userSegment) {
            await this.prisma.linesStock.update({
              where: { id: availableLine.id },
              data: { segment: userSegment },
            });
          }
        }
      }

      // 3. ÚLTIMA TENTATIVA: Se ainda não encontrou, buscar QUALQUER linha ativa com menos de 2 operadores (ignorando segmento)
      if (!availableLine) {
        console.log(`🔄 [WebSocket] Realocação: Buscando qualquer linha ativa disponível...`);
        const anyActiveLines = await this.prisma.linesStock.findMany({
          where: {
            lineStatus: 'active',
          },
        });

        // Filtrar por evolutions ativas
        const filteredAnyLines = await this.controlPanelService.filterLinesByActiveEvolutions(anyActiveLines, userSegment || undefined);

        // Buscar QUALQUER linha com menos de 2 operadores
        for (const line of filteredAnyLines) {
          const operatorsCount = await (this.prisma as any).lineOperator.count({
            where: { lineId: line.id },
          });
          
          if (operatorsCount < 2) {
            availableLine = line;
            console.log(`✅ [WebSocket] Realocação: Linha ${line.phone} encontrada (busca ampla)`);
            break;
          }
        }
      }

      if (!availableLine) {
        const totalActiveLines = await this.prisma.linesStock.count({ where: { lineStatus: 'active' } });
        const linesWithoutOperators = await this.prisma.linesStock.count({
          where: {
            lineStatus: 'active',
            operators: { none: {} },
          },
        });
        console.error(`❌ [WebSocket] Realocação: Nenhuma linha disponível. Total ativas: ${totalActiveLines}, Sem operadores: ${linesWithoutOperators}`);
        return { success: false, reason: 'Nenhuma linha disponível' };
      }

      // Verificar quantos operadores já estão vinculados
      const currentOperatorsCount = await (this.prisma as any).lineOperator.count({
        where: { lineId: availableLine.id },
      });

      // Vincular operador à nova linha usando método com transaction + lock
      try {
        await this.linesService.assignOperatorToLine(availableLine.id, userId); // ✅ COM LOCK


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
