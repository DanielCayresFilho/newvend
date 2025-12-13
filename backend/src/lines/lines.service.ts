import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateLineDto } from './dto/create-line.dto';
import { UpdateLineDto } from './dto/update-line.dto';
import axios from 'axios';

@Injectable()
export class LinesService {
  constructor(private prisma: PrismaService) {}

  async create(createLineDto: CreateLineDto) {
    console.log('📝 Dados recebidos no service:', JSON.stringify(createLineDto, null, 2));

    // Limpar strings vazias e converter para null
    if (createLineDto.token === '') createLineDto.token = null;
    if (createLineDto.businessID === '') createLineDto.businessID = null;
    if (createLineDto.numberId === '') createLineDto.numberId = null;

    console.log('📝 Dados após limpeza:', JSON.stringify(createLineDto, null, 2));

    // Verificar se já existe uma linha com este telefone
    const existingLine = await this.prisma.linesStock.findUnique({
      where: { phone: createLineDto.phone },
    });

    if (existingLine) {
      throw new BadRequestException('Já existe uma linha com este telefone');
    }

    // Buscar configuração da Evolution
    const evolution = await this.prisma.evolution.findUnique({
      where: { evolutionName: createLineDto.evolutionName },
    });

    if (!evolution) {
      throw new NotFoundException(`Evolution "${createLineDto.evolutionName}" não encontrada. Evolutions disponíveis: ${await this.getAvailableEvolutionNames()}`);
    }

    // Testar conexão com Evolution antes de criar instância
    try {
      console.log('🔍 Testando conexão com Evolution:', evolution.evolutionUrl);

      const testResponse = await axios.get(
        `${evolution.evolutionUrl}/manager/getInstances`,
        {
          headers: {
            'apikey': evolution.evolutionKey,
          },
          timeout: 10000,
        }
      );

      console.log('✅ Conexão com Evolution OK. Instâncias encontradas:', testResponse.data?.length || 0);
    } catch (testError) {
      console.error('❌ Falha ao conectar com Evolution:', {
        url: evolution.evolutionUrl,
        error: testError.message,
        response: testError.response?.data,
        status: testError.response?.status,
      });
      throw new BadRequestException(
        `Não foi possível conectar à Evolution API. Verifique a URL (${evolution.evolutionUrl}) e a chave da Evolution "${evolution.evolutionName}".`
      );
    }

    // Criar instância na Evolution API
    try {
      const instanceName = `line_${createLineDto.phone.replace(/\D/g, '')}`;
      const webhookUrl = `${process.env.APP_URL || 'http://localhost:3000'}/webhooks/evolution`;

      const requestData = {
        instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
      };

      console.log('📡 Criando instância na Evolution:', {
        instanceName,
        evolutionUrl: evolution.evolutionUrl,
        requestData,
      });

      // Criar instância
      const createResponse = await axios.post(
        `${evolution.evolutionUrl}/instance/create`,
        requestData,
        {
          headers: {
            'apikey': evolution.evolutionKey,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      console.log('✅ Instância criada:', {
        instanceName,
        response: createResponse.data,
      });

      // Configurar webhook separadamente (aguardar 2 segundos para garantir que a instância está pronta)
      await new Promise(resolve => setTimeout(resolve, 2000));

      try {
        const webhookData = {
          url: webhookUrl,
          enabled: true,
          webhook_by_events: true,
          webhook_base64: true,
          events: [
            'MESSAGES_UPSERT',    // Mensagens recebidas/enviadas
            'MESSAGES_UPDATE',     // Atualização de status (sent, delivered, read)
            'CONNECTION_UPDATE',   // Atualização de conexão
          ],
        };

        console.log('🔗 Configurando webhook:', {
          instanceName,
          url: `${evolution.evolutionUrl}/webhook/set/${instanceName}`,
          webhookData,
        });

        const webhookResponse = await axios.post(
          `${evolution.evolutionUrl}/webhook/set/${instanceName}`,
          webhookData,
          {
            headers: {
              'apikey': evolution.evolutionKey,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          }
        );

        console.log('✅ Webhook configurado com sucesso:', webhookResponse.data);
      } catch (webhookError) {
        console.error('⚠️ Erro ao configurar webhook (formato direto):', {
          error: webhookError.message,
          response: JSON.stringify(webhookError.response?.data, null, 2),
          status: webhookError.response?.status,
        });

        // Tentar formato alternativo com wrapper
        if (webhookError.response?.status === 400 || webhookError.response?.status === 422) {
          console.log('🔄 Tentando formato alternativo com wrapper webhook...');
          try {
            const alternativePayload = {
              webhook: {
                url: webhookUrl,
                enabled: true,
                webhook_by_events: true,
                webhook_base64: true,
                events: [
                  'MESSAGES_UPSERT',
                  'MESSAGES_UPDATE',
                  'CONNECTION_UPDATE',
                ],
              },
            };

            console.log('🔗 Payload alternativo:', alternativePayload);

            const altResponse = await axios.post(
              `${evolution.evolutionUrl}/webhook/set/${instanceName}`,
              alternativePayload,
              {
                headers: {
                  'apikey': evolution.evolutionKey,
                  'Content-Type': 'application/json',
                },
                timeout: 10000,
              }
            );

            console.log('✅ Webhook configurado com formato alternativo:', altResponse.data);
          } catch (retryError) {
            console.error('❌ Erro também com formato alternativo:', {
              error: retryError.message,
              response: JSON.stringify(retryError.response?.data, null, 2),
            });
            console.warn('⚠️ Webhook não configurado automaticamente. Configure manualmente na Evolution API.');
          }
        } else {
          console.warn('⚠️ Webhook não configurado automaticamente. Configure manualmente na Evolution API.');
        }
      }

      // Criar linha no banco
      return this.prisma.linesStock.create({
        data: createLineDto,
      });
    } catch (error) {
      console.error('❌ Erro ao criar linha (detalhado):', {
        message: error.message,
        responseData: JSON.stringify(error.response?.data, null, 2),
        status: error.response?.status,
        url: error.config?.url,
        method: error.config?.method,
        requestData: error.config?.data,
      });

      // Extrair mensagem de erro detalhada
      let errorMsg = 'Erro desconhecido';

      if (error.response?.data?.response?.message) {
        const messages = error.response.data.response.message;
        errorMsg = Array.isArray(messages)
          ? messages.join(', ')
          : messages;
      } else if (error.response?.data?.message) {
        const messages = error.response.data.message;
        errorMsg = Array.isArray(messages)
          ? messages.join(', ')
          : messages;
      } else if (error.response?.data) {
        errorMsg = JSON.stringify(error.response.data);
      } else {
        errorMsg = error.message;
      }

      if (error.message.includes('P2002')) {
        throw new BadRequestException('Telefone já cadastrado');
      }

      throw new BadRequestException(`Erro na Evolution API: ${errorMsg}`);
    }
  }

  async findAll(filters?: any) {
    // Remover campos inválidos que não existem no schema
    const { search, ...validFilters } = filters || {};
    
    // Se houver busca por texto, aplicar filtros
    const where = search 
      ? {
          ...validFilters,
          OR: [
            { phone: { contains: search } },
            { evolutionName: { contains: search } },
          ],
        }
      : validFilters;

    return this.prisma.linesStock.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: number) {
    const line = await this.prisma.linesStock.findUnique({
      where: { id },
    });

    if (!line) {
      throw new NotFoundException(`Linha com ID ${id} não encontrada`);
    }

    return line;
  }

  async getQRCode(id: number) {
    const line = await this.findOne(id);
    const evolution = await this.prisma.evolution.findUnique({
      where: { evolutionName: line.evolutionName },
    });

    if (!evolution) {
      throw new NotFoundException('Evolution não encontrada para esta linha');
    }

    try {
      const instanceName = `line_${line.phone.replace(/\D/g, '')}`;
      
      // Primeiro, verificar o status da conexão
      try {
        const connectionResponse = await axios.get(
          `${evolution.evolutionUrl}/instance/connectionState/${instanceName}`,
          {
            headers: {
              'apikey': evolution.evolutionKey,
            },
          }
        );

        console.log('Status da conexão:', connectionResponse.data);
        
        // Se já está conectado, não precisa de QR Code
        if (connectionResponse.data?.state === 'open' || connectionResponse.data?.instance?.state === 'open') {
          return { qrcode: null, connected: true, message: 'Linha já está conectada' };
        }
      } catch (connError) {
        console.log('Não foi possível verificar status da conexão, continuando...');
      }

      // Buscar o QR Code
      const response = await axios.get(
        `${evolution.evolutionUrl}/instance/connect/${instanceName}`,
        {
          headers: {
            'apikey': evolution.evolutionKey,
          },
        }
      );

      console.log('Resposta do QR Code:', JSON.stringify(response.data, null, 2));

      // Normalizar a resposta para o formato esperado pelo frontend
      // A Evolution API pode retornar em diferentes formatos
      let qrcode = null;
      
      if (response.data?.base64) {
        // Formato: { base64: "data:image/png;base64,..." }
        qrcode = response.data.base64;
      } else if (response.data?.qrcode?.base64) {
        // Formato: { qrcode: { base64: "..." } }
        qrcode = response.data.qrcode.base64;
      } else if (response.data?.code) {
        // Formato: { code: "texto do qr" } - precisa gerar imagem
        qrcode = response.data.code;
      } else if (typeof response.data === 'string' && response.data.startsWith('data:image')) {
        // Formato: string base64 direto
        qrcode = response.data;
      } else if (response.data?.pairingCode) {
        // Pairing code para WhatsApp Web
        return { 
          qrcode: null, 
          pairingCode: response.data.pairingCode,
          message: 'Use o código de pareamento' 
        };
      }

      if (!qrcode) {
        console.warn('Formato de resposta não reconhecido:', response.data);
        // Retornar os dados brutos para debug
        return { 
          qrcode: null, 
          rawData: response.data,
          message: 'QR Code não disponível no momento. Verifique se a instância está pronta.' 
        };
      }

      return { qrcode };
    } catch (error) {
      console.error('Erro ao obter QR Code:', error.response?.data || error.message);
      
      if (error.response?.status === 404) {
        throw new NotFoundException('Instância não encontrada na Evolution API. Tente recriar a linha.');
      }

      if (error.response?.data?.message) {
        throw new BadRequestException(`Erro na Evolution API: ${error.response.data.message}`);
      }

      throw new BadRequestException(`Erro ao obter QR Code: ${error.message || 'Erro desconhecido'}`);
    }
  }

  async update(id: number, updateLineDto: UpdateLineDto) {
    await this.findOne(id);

    return this.prisma.linesStock.update({
      where: { id },
      data: updateLineDto,
    });
  }

  async remove(id: number) {
    const line = await this.findOne(id);

    // Deletar instância na Evolution
    const evolution = await this.prisma.evolution.findUnique({
      where: { evolutionName: line.evolutionName },
    });

    try {
      const instanceName = `line_${line.phone.replace(/\D/g, '')}`;
      await axios.delete(
        `${evolution.evolutionUrl}/instance/delete/${instanceName}`,
        {
          headers: {
            'apikey': evolution.evolutionKey,
          },
        }
      );
    } catch (error) {
      console.error('Erro ao deletar instância na Evolution:', error);
    }

    return this.prisma.linesStock.delete({
      where: { id },
    });
  }

  // Lógica automática de troca de linhas banidas
  async handleBannedLine(lineId: number) {
    const line = await this.findOne(lineId);

    // Marcar linha como banida
    await this.update(lineId, { lineStatus: 'ban' });

    // Se a linha estava vinculada a um operador, remover vínculo
    if (line.linkedTo) {
      await this.prisma.user.update({
        where: { id: line.linkedTo },
        data: { line: null },
      });

      // Buscar uma nova linha ativa do mesmo segmento
      const availableLine = await this.prisma.linesStock.findFirst({
        where: {
          lineStatus: 'active',
          segment: line.segment,
          linkedTo: null,
        },
      });

      if (availableLine) {
        // Vincular nova linha ao operador
        await this.update(availableLine.id, { linkedTo: line.linkedTo });
        await this.prisma.user.update({
          where: { id: line.linkedTo },
          data: { line: availableLine.id },
        });

        console.log(`✅ Linha ${availableLine.phone} atribuída ao operador ${line.linkedTo}`);
      } else {
        console.warn(`⚠️ Nenhuma linha disponível para substituir a linha banida`);
      }
    }
  }

  async getAvailableLines(segment: number) {
    return this.prisma.linesStock.findMany({
      where: {
        lineStatus: 'active',
        segment,
        linkedTo: null,
      },
    });
  }

  async getEvolutions() {
    return this.prisma.evolution.findMany({
      orderBy: {
        evolutionName: 'asc',
      },
    });
  }

  private async getAvailableEvolutionNames(): Promise<string> {
    const evolutions = await this.prisma.evolution.findMany({
      select: { evolutionName: true },
    });
    return evolutions.map(e => e.evolutionName).join(', ') || 'nenhuma';
  }

  async fetchInstancesFromEvolution(evolutionName: string) {
    const evolution = await this.prisma.evolution.findUnique({
      where: { evolutionName },
    });

    if (!evolution) {
      throw new NotFoundException('Evolution não encontrada');
    }

    try {
      const response = await axios.get(
        `${evolution.evolutionUrl}/instance/fetchInstances`,
        {
          headers: {
            'apikey': evolution.evolutionKey,
          },
          params: {
            instanceName: evolutionName,
          },
        }
      );

      return response.data;
    } catch (error) {
      console.error('Erro ao buscar instâncias:', error.response?.data || error.message);
      throw new BadRequestException('Erro ao buscar instâncias da Evolution API');
    }
  }
}
