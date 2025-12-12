import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { MassiveCpcDto, MessageDto, SendTemplateExternalDto, TemplateVariableDto } from './dto/massive-cpc.dto';
import { TagsService } from '../tags/tags.service';
import { ApiLogsService } from '../api-logs/api-logs.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ContactsService } from '../contacts/contacts.service';
import axios from 'axios';

@Injectable()
export class ApiMessagesService {
  constructor(
    private prisma: PrismaService,
    private tagsService: TagsService,
    private apiLogsService: ApiLogsService,
    private conversationsService: ConversationsService,
    private contactsService: ContactsService,
  ) {}

  /**
   * Verifica se pode enviar mensagem CPC (Contato por Cliente)
   * Regras:
   * - Cliente só pode receber novo contato se:
   *   - Respondeu à mensagem enviada
   *   - Ou após 24h da primeira interação
   */
  private async canSendCpcMessage(phone: string): Promise<{ canSend: boolean; reason?: string }> {
    // Buscar todas as conversas com este telefone
    const conversations = await this.prisma.conversation.findMany({
      where: { contactPhone: phone },
      orderBy: { datetime: 'asc' },
    });

    if (conversations.length === 0) {
      // Se não há conversa anterior, pode enviar
      return { canSend: true };
    }

    // Buscar primeira mensagem do operador (primeira interação)
    const firstOperatorMessage = conversations.find(c => c.sender === 'operator');
    
    if (!firstOperatorMessage) {
      // Se não há mensagem do operador, pode enviar
      return { canSend: true };
    }

    // Verificar se o cliente respondeu (há mensagem do cliente após a primeira do operador)
    const hasResponse = conversations.some(
      c => c.sender === 'contact' && c.datetime > firstOperatorMessage.datetime
    );

    if (hasResponse) {
      // Cliente respondeu, pode enviar
      return { canSend: true };
    }

    // Verificar se passaram 24h desde a primeira interação (primeira mensagem do operador)
    const now = new Date();
    const firstInteractionTime = firstOperatorMessage.datetime;
    const hoursDiff = (now.getTime() - firstInteractionTime.getTime()) / (1000 * 60 * 60);

    if (hoursDiff >= 24) {
      return { canSend: true };
    }

    return {
      canSend: false,
      reason: `Cliente já recebeu mensagem há menos de 24h. Próximo envio permitido em ${(24 - hoursDiff).toFixed(1)} horas`,
    };
  }

  /**
   * Busca operador pelo specialistCode (email antes do @)
   */
  private async findOperatorBySpecialistCode(specialistCode: string) {
    // Buscar usuário cujo email começa com specialistCode@
    const user = await this.prisma.user.findFirst({
      where: {
        email: {
          startsWith: `${specialistCode}@`,
        },
        role: 'operator',
      },
    });

    if (!user) {
      throw new NotFoundException(`Operador com specialistCode '${specialistCode}' não encontrado`);
    }

    if (!user.line) {
      throw new BadRequestException(`Operador '${specialistCode}' não possui linha atribuída`);
    }

    return user;
  }

  /**
   * Envia mensagem via Evolution API
   */
  private async sendMessageViaEvolution(
    line: any,
    evolution: any,
    phone: string,
    message: string,
  ): Promise<boolean> {
    try {
      const instanceName = `line_${line.phone.replace(/\D/g, '')}`;
      const cleanPhone = phone.replace(/\D/g, '');

      await axios.post(
        `${evolution.evolutionUrl}/message/sendText/${instanceName}`,
        {
          number: cleanPhone,
          text: message,
        },
        {
          headers: { 'apikey': evolution.evolutionKey },
        }
      );

      return true;
    } catch (error) {
      console.error('Erro ao enviar mensagem via Evolution:', error);
      return false;
    }
  }

  /**
   * Processa disparo CPC
   */
  async sendMassiveCpc(dto: MassiveCpcDto, ipAddress?: string, userAgent?: string) {
    const errors: Array<{ phone: string; reason: string }> = [];
    let processed = 0;

    // Validar tag
    const tag = await this.tagsService.findByName(dto.tag);
    if (!tag) {
      const errorResponse = {
        status: 'error',
        message: `Tag '${dto.tag}' não encontrada`,
        processed: 0,
        errors: [],
      };

      // Registrar log de erro
      await this.apiLogsService.createLog({
        endpoint: '/api/messages/massivocpc',
        method: 'POST',
        requestPayload: dto,
        responsePayload: errorResponse,
        statusCode: 400,
        ipAddress,
        userAgent,
      });

      throw new NotFoundException(`Tag '${dto.tag}' não encontrada`);
    }

    // Processar cada mensagem
    for (const message of dto.messages) {
      try {
        // Verificar CPC
        const cpcCheck = await this.canSendCpcMessage(message.phone);
        if (!cpcCheck.canSend) {
          errors.push({
            phone: message.phone,
            reason: cpcCheck.reason || 'Bloqueado por regra CPC',
          });
          continue;
        }

        // Buscar operador
        const operator = await this.findOperatorBySpecialistCode(message.specialistCode);

        // Buscar linha do operador
        const line = await this.prisma.linesStock.findUnique({
          where: { id: operator.line! },
        });

        if (!line || line.lineStatus !== 'active') {
          errors.push({
            phone: message.phone,
            reason: 'Linha do operador não disponível',
          });
          continue;
        }

        // Buscar Evolution
        const evolution = await this.prisma.evolution.findUnique({
          where: { evolutionName: line.evolutionName },
        });

        if (!evolution) {
          errors.push({
            phone: message.phone,
            reason: 'Evolution não encontrada',
          });
          continue;
        }

        // Verificar blocklist
        const isBlocked = await this.prisma.blockList.findFirst({
          where: {
            OR: [
              { phone: message.phone },
              { cpf: message.contract },
            ],
          },
        });

        if (isBlocked) {
          errors.push({
            phone: message.phone,
            reason: 'Número ou CPF na lista de bloqueio',
          });
          continue;
        }

        // Determinar se deve usar template oficial
        const useTemplate = message.useOfficialTemplate || dto.useOfficialTemplate;
        const templateId = message.templateId || dto.defaultTemplateId;
        const templateVariables = message.templateVariables || [];

        let sent = false;
        let finalMessage = message.mainTemplate;

        if (useTemplate && templateId) {
          // Enviar via template oficial
          const template = await this.prisma.template.findUnique({
            where: { id: templateId },
          });

          if (!template) {
            errors.push({
              phone: message.phone,
              reason: `Template com ID ${templateId} não encontrado`,
            });
            continue;
          }

          // Substituir variáveis no template
          let templateText = template.bodyText;
          templateVariables.forEach((v: TemplateVariableDto, index: number) => {
            templateText = templateText.replace(`{{${index + 1}}}`, v.value);
            templateText = templateText.replace(`{{${v.key}}}`, v.value);
          });
          finalMessage = templateText;

          // Se linha oficial, enviar via Cloud API
          if (line.oficial && line.token && line.numberId) {
            sent = await this.sendTemplateViaCloudApi(line, template, message.phone, templateVariables);
          } else {
            // Enviar via Evolution
            sent = await this.sendTemplateViaEvolution(line, evolution, template, message.phone, templateVariables);
          }

          // Registrar envio de template
          if (sent) {
            await this.prisma.templateMessage.create({
              data: {
                templateId: template.id,
                contactPhone: message.phone,
                contactName: message.clientId,
                lineId: line.id,
                status: 'SENT',
                variables: templateVariables.length > 0 ? JSON.stringify(templateVariables) : null,
              },
            });
          }
        } else {
          // Enviar mensagem de texto normal via Evolution
          sent = await this.sendMessageViaEvolution(
            line,
            evolution,
            message.phone,
            message.mainTemplate,
          );
        }

        if (!sent) {
          errors.push({
            phone: message.phone,
            reason: useTemplate ? 'Falha ao enviar template' : 'Falha ao enviar mensagem via Evolution',
          });
          continue;
        }

        // Buscar ou criar contato
        let contact = await this.contactsService.findByPhone(message.phone);
        if (!contact) {
          contact = await this.contactsService.create({
            name: message.clientId || 'Cliente',
            phone: message.phone,
            segment: tag.segment || operator.segment || null,
            cpf: message.clientId || null,
            contract: message.contract || null,
          });
        } else {
          // Atualizar contato se necessário
          if (message.contract && !contact.contract) {
            await this.prisma.contact.update({
              where: { id: contact.id },
              data: { contract: message.contract },
            });
          }
        }

        // Criar conversa
        await this.conversationsService.create({
          contactName: contact.name,
          contactPhone: message.phone,
          segment: tag.segment || operator.segment || null,
          userName: operator.name,
          userLine: operator.line!,
          message: useTemplate ? `[TEMPLATE] ${finalMessage}` : finalMessage,
          sender: 'operator',
          messageType: useTemplate ? 'template' : 'text',
        });

        processed++;
      } catch (error) {
        errors.push({
          phone: message.phone,
          reason: error.message || 'Erro ao processar mensagem',
        });
      }
    }

    const response = {
      status: errors.length === 0 ? 'success' : errors.length < dto.messages.length ? 'partial' : 'error',
      message: errors.length === 0
        ? 'Mensagens enviadas com sucesso'
        : `${processed} mensagens processadas, ${errors.length} com erro`,
      processed,
      errors,
    };

    // Registrar log
    await this.apiLogsService.createLog({
      endpoint: '/api/messages/massivocpc',
      method: 'POST',
      requestPayload: dto,
      responsePayload: response,
      statusCode: errors.length === 0 ? 200 : errors.length === dto.messages.length ? 400 : 207,
      ipAddress,
      userAgent,
    });

    return response;
  }

  /**
   * Envia template via WhatsApp Cloud API
   */
  private async sendTemplateViaCloudApi(
    line: any,
    template: any,
    phone: string,
    variables: TemplateVariableDto[],
  ): Promise<boolean> {
    try {
      const cleanPhone = phone.replace(/\D/g, '');

      // Montar componentes com variáveis
      const components: any[] = [];

      // Body com variáveis
      if (variables.length > 0) {
        components.push({
          type: 'body',
          parameters: variables.map(v => ({
            type: 'text',
            text: v.value,
          })),
        });
      }

      await axios.post(
        `https://graph.facebook.com/v18.0/${line.numberId}/messages`,
        {
          messaging_product: 'whatsapp',
          to: cleanPhone,
          type: 'template',
          template: {
            name: template.name,
            language: { code: template.language },
            components: components.length > 0 ? components : undefined,
          },
        },
        {
          headers: {
            'Authorization': `Bearer ${line.token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return true;
    } catch (error) {
      console.error('Erro ao enviar template via Cloud API:', error.response?.data || error.message);
      return false;
    }
  }

  /**
   * Envia template via Evolution API
   */
  private async sendTemplateViaEvolution(
    line: any,
    evolution: any,
    template: any,
    phone: string,
    variables: TemplateVariableDto[],
  ): Promise<boolean> {
    try {
      const instanceName = `line_${line.phone.replace(/\D/g, '')}`;
      const cleanPhone = phone.replace(/\D/g, '');

      // Substituir variáveis no texto do template
      let messageText = template.bodyText;
      variables.forEach((v: TemplateVariableDto, index: number) => {
        messageText = messageText.replace(`{{${index + 1}}}`, v.value);
        messageText = messageText.replace(`{{${v.key}}}`, v.value);
      });

      // Tenta enviar como template primeiro
      try {
        if (line.token && line.numberId) {
          await axios.post(
            `${evolution.evolutionUrl}/message/sendTemplate/${instanceName}`,
            {
              number: cleanPhone,
              name: template.name,
              language: template.language,
              components: variables.length > 0 ? [{
                type: 'body',
                parameters: variables.map(v => ({
                  type: 'text',
                  text: v.value,
                })),
              }] : undefined,
            },
            {
              headers: { 'apikey': evolution.evolutionKey },
            }
          );
          return true;
        }
      } catch (templateError) {
        console.log('Fallback para mensagem de texto:', templateError.message);
      }

      // Fallback: envia como mensagem de texto
      await axios.post(
        `${evolution.evolutionUrl}/message/sendText/${instanceName}`,
        {
          number: cleanPhone,
          text: messageText,
        },
        {
          headers: { 'apikey': evolution.evolutionKey },
        }
      );

      return true;
    } catch (error) {
      console.error('Erro ao enviar template via Evolution:', error.response?.data || error.message);
      return false;
    }
  }

  /**
   * Envia template 1x1 via API externa
   */
  async sendTemplateExternal(dto: SendTemplateExternalDto, ipAddress?: string, userAgent?: string) {
    try {
      // Buscar operador
      const operator = await this.findOperatorBySpecialistCode(dto.specialistCode);

      // Buscar linha do operador
      const line = await this.prisma.linesStock.findUnique({
        where: { id: operator.line! },
      });

      if (!line || line.lineStatus !== 'active') {
        throw new BadRequestException('Linha do operador não disponível');
      }

      // Buscar Evolution
      const evolution = await this.prisma.evolution.findUnique({
        where: { evolutionName: line.evolutionName },
      });

      if (!evolution) {
        throw new NotFoundException('Evolution não encontrada');
      }

      // Verificar blocklist
      const isBlocked = await this.prisma.blockList.findFirst({
        where: { phone: dto.phone },
      });

      if (isBlocked) {
        throw new BadRequestException('Número está na lista de bloqueio');
      }

      // Verificar CPC
      const cpcCheck = await this.canSendCpcMessage(dto.phone);
      if (!cpcCheck.canSend) {
        throw new BadRequestException(cpcCheck.reason || 'Bloqueado por regra CPC');
      }

      // Buscar template
      const template = await this.prisma.template.findUnique({
        where: { id: dto.templateId },
      });

      if (!template) {
        throw new NotFoundException(`Template com ID ${dto.templateId} não encontrado`);
      }

      const variables = dto.variables || [];

      // Substituir variáveis no template
      let templateText = template.bodyText;
      variables.forEach((v: TemplateVariableDto, index: number) => {
        templateText = templateText.replace(`{{${index + 1}}}`, v.value);
        templateText = templateText.replace(`{{${v.key}}}`, v.value);
      });

      // Enviar template
      let sent = false;
      let messageId: string | undefined;

      if (line.oficial && line.token && line.numberId) {
        sent = await this.sendTemplateViaCloudApi(line, template, dto.phone, variables);
      } else {
        sent = await this.sendTemplateViaEvolution(line, evolution, template, dto.phone, variables);
      }

      if (!sent) {
        const errorResponse = {
          success: false,
          message: 'Falha ao enviar template',
        };

        await this.apiLogsService.createLog({
          endpoint: '/api/messages/template',
          method: 'POST',
          requestPayload: dto,
          responsePayload: errorResponse,
          statusCode: 500,
          ipAddress,
          userAgent,
        });

        throw new BadRequestException('Falha ao enviar template');
      }

      // Registrar envio de template
      const templateMessage = await this.prisma.templateMessage.create({
        data: {
          templateId: dto.templateId,
          contactPhone: dto.phone,
          contactName: dto.contactName,
          lineId: line.id,
          status: 'SENT',
          messageId,
          variables: variables.length > 0 ? JSON.stringify(variables) : null,
        },
      });

      // Buscar ou criar contato
      let contact = await this.contactsService.findByPhone(dto.phone);
      if (!contact) {
        // Buscar tag para obter segmento
        let segment = operator.segment;
        if (dto.tag) {
          const tag = await this.tagsService.findByName(dto.tag);
          if (tag?.segment) {
            segment = tag.segment;
          }
        }

        contact = await this.contactsService.create({
          name: dto.contactName || 'Cliente',
          phone: dto.phone,
          segment,
        });
      }

      // Criar conversa
      await this.conversationsService.create({
        contactName: contact.name,
        contactPhone: dto.phone,
        segment: contact.segment,
        userName: operator.name,
        userLine: operator.line!,
        message: `[TEMPLATE: ${template.name}] ${templateText}`,
        sender: 'operator',
        messageType: 'template',
      });

      const response = {
        success: true,
        message: 'Template enviado com sucesso',
        templateMessageId: templateMessage.id,
        templateName: template.name,
      };

      await this.apiLogsService.createLog({
        endpoint: '/api/messages/template',
        method: 'POST',
        requestPayload: dto,
        responsePayload: response,
        statusCode: 200,
        ipAddress,
        userAgent,
      });

      return response;
    } catch (error) {
      const errorResponse = {
        success: false,
        message: error.message,
      };

      await this.apiLogsService.createLog({
        endpoint: '/api/messages/template',
        method: 'POST',
        requestPayload: dto,
        responsePayload: errorResponse,
        statusCode: error.status || 500,
        ipAddress,
        userAgent,
      });

      throw error;
    }
  }
}

