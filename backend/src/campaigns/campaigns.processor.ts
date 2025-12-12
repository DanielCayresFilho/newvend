import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { BlocklistService } from '../blocklist/blocklist.service';
import { ConversationsService } from '../conversations/conversations.service';
import axios from 'axios';

interface TemplateVariable {
  key: string;
  value: string;
}

@Injectable()
@Processor('campaigns')
export class CampaignsProcessor {
  constructor(
    private prisma: PrismaService,
    private blocklistService: BlocklistService,
    private conversationsService: ConversationsService,
  ) {}

  @Process('send-campaign-message')
  async handleSendMessage(job: Job) {
    const { 
      campaignId, 
      contactName, 
      contactPhone, 
      contactSegment, 
      lineId, 
      message,
      useTemplate,
      templateId,
      templateVariables,
    } = job.data;

    try {
      // Verificar se está na blocklist
      const isBlocked = await this.blocklistService.isBlocked(contactPhone);
      if (isBlocked) {
        console.log(`❌ Contato ${contactPhone} está na blocklist`);
        await this.prisma.campaign.update({
          where: { id: campaignId },
          data: { response: false },
        });
        return;
      }

      // Buscar a linha
      const line = await this.prisma.linesStock.findUnique({
        where: { id: lineId },
      });

      if (!line || line.lineStatus !== 'active') {
        throw new Error('Linha não disponível');
      }

      // Buscar evolução
      const evolution = await this.prisma.evolution.findUnique({
        where: { evolutionName: line.evolutionName },
      });

      if (!evolution) {
        throw new Error('Evolution não encontrada');
      }

      const instanceName = `line_${line.phone.replace(/\D/g, '')}`;
      const cleanPhone = contactPhone.replace(/\D/g, '');

      let retries = 0;
      let sent = false;
      let finalMessage = message || 'Olá! Esta é uma mensagem da nossa campanha.';

      while (retries < 3 && !sent) {
        try {
          // Se usar template, enviar via template
          if (useTemplate && templateId) {
            const template = await this.prisma.template.findUnique({
              where: { id: templateId },
            });

            if (!template) {
              throw new Error('Template não encontrado');
            }

            // Substituir variáveis no template
            let templateText = template.bodyText;
            const variables: TemplateVariable[] = templateVariables ? 
              (typeof templateVariables === 'string' ? JSON.parse(templateVariables) : templateVariables) 
              : [];

            variables.forEach((v: TemplateVariable, index: number) => {
              templateText = templateText.replace(`{{${index + 1}}}`, v.value);
              templateText = templateText.replace(`{{${v.key}}}`, v.value);
            });

            finalMessage = templateText;

            // Se linha oficial, enviar via Cloud API
            if (line.oficial && line.token && line.numberId) {
              await this.sendTemplateViaCloudApi(line, template, cleanPhone, variables);
            } else {
              // Enviar via Evolution API
              await this.sendTemplateViaEvolution(evolution, instanceName, template, cleanPhone, variables);
            }

            // Registrar envio de template
            await this.prisma.templateMessage.create({
              data: {
                templateId: template.id,
                contactPhone,
                contactName,
                lineId,
                status: 'SENT',
                variables: variables.length > 0 ? JSON.stringify(variables) : null,
                campaignId,
              },
            });
          } else {
            // Envio de mensagem de texto normal
            await axios.post(
              `${evolution.evolutionUrl}/message/sendText/${instanceName}`,
              {
                number: cleanPhone,
                text: finalMessage,
              },
              {
                headers: {
                  'apikey': evolution.evolutionKey,
                },
              }
            );
          }

          sent = true;

          // Registrar conversa
          await this.conversationsService.create({
            contactName,
            contactPhone,
            segment: contactSegment,
            userName: 'Sistema',
            userLine: lineId,
            message: useTemplate ? `[TEMPLATE] ${finalMessage}` : finalMessage,
            sender: 'operator',
            messageType: useTemplate ? 'template' : 'text',
          });

          // Atualizar campanha
          await this.prisma.campaign.update({
            where: { id: campaignId },
            data: { response: true },
          });

          console.log(`✅ Mensagem ${useTemplate ? '(template)' : ''} enviada para ${contactPhone}`);
        } catch (error) {
          retries++;
          console.error(`Tentativa ${retries} falhou para ${contactPhone}:`, error.message);

          if (retries >= 3) {
            await this.prisma.campaign.update({
              where: { id: campaignId },
              data: {
                response: false,
                retryCount: retries,
              },
            });

            // Se template, registrar falha
            if (useTemplate && templateId) {
              await this.prisma.templateMessage.create({
                data: {
                  templateId,
                  contactPhone,
                  contactName,
                  lineId,
                  status: 'FAILED',
                  errorMessage: error.message,
                  campaignId,
                },
              });
            }
          }
        }
      }
    } catch (error) {
      console.error('Erro ao processar campanha:', error);
      throw error;
    }
  }

  /**
   * Envia template via WhatsApp Cloud API
   */
  private async sendTemplateViaCloudApi(
    line: any,
    template: any,
    phone: string,
    variables: TemplateVariable[],
  ) {
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
        to: phone,
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
  }

  /**
   * Envia template via Evolution API
   */
  private async sendTemplateViaEvolution(
    evolution: any,
    instanceName: string,
    template: any,
    phone: string,
    variables: TemplateVariable[],
  ) {
    // Substituir variáveis no texto do template
    let messageText = template.bodyText;
    variables.forEach((v: TemplateVariable, index: number) => {
      messageText = messageText.replace(`{{${index + 1}}}`, v.value);
      messageText = messageText.replace(`{{${v.key}}}`, v.value);
    });

    // Tenta enviar como template primeiro
    try {
      await axios.post(
        `${evolution.evolutionUrl}/message/sendTemplate/${instanceName}`,
        {
          number: phone,
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
    } catch (error) {
      // Fallback: envia como mensagem de texto
      console.log('Fallback para mensagem de texto:', error.message);
      await axios.post(
        `${evolution.evolutionUrl}/message/sendText/${instanceName}`,
        {
          number: phone,
          text: messageText,
        },
        {
          headers: { 'apikey': evolution.evolutionKey },
        }
      );
    }
  }
}
