import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { CampaignContact } from './dto/upload-campaign.dto';
import { ContactsService } from '../contacts/contacts.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class CampaignsService {
  constructor(
    @InjectQueue('campaigns') private campaignsQueue: Queue,
    private prisma: PrismaService,
    private contactsService: ContactsService,
    private usersService: UsersService,
  ) {}

  async create(createCampaignDto: CreateCampaignDto) {
    return this.prisma.campaign.create({
      data: {
        name: createCampaignDto.name,
        contactName: '',
        contactPhone: '',
        contactSegment: parseInt(createCampaignDto.segment),
        speed: createCampaignDto.speed,
        useTemplate: createCampaignDto.useTemplate || false,
        templateId: createCampaignDto.templateId,
        templateVariables: createCampaignDto.templateVariables 
          ? JSON.stringify(createCampaignDto.templateVariables) 
          : null,
      },
    });
  }

  async uploadCampaign(campaignId: number, contacts: CampaignContact[], message?: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      throw new NotFoundException('Campanha não encontrada');
    }

    // Buscar operadores online do segmento
    const onlineOperators = await this.usersService.getOnlineOperators(campaign.contactSegment);

    if (onlineOperators.length === 0) {
      throw new BadRequestException('Nenhum operador online disponível para este segmento');
    }

    // Dividir contatos igualmente entre operadores
    const contactsPerOperator = Math.ceil(contacts.length / onlineOperators.length);

    // Calcular delay baseado na velocidade
    let delayMinutes = 6; // medium
    if (campaign.speed === 'fast') {
      delayMinutes = 3;
    } else if (campaign.speed === 'slow') {
      delayMinutes = 10;
    }

    const delayMs = delayMinutes * 60 * 1000;

    // Criar contatos e agendar envios
    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      const operatorIndex = Math.floor(i / contactsPerOperator);
      const operator = onlineOperators[operatorIndex];

      if (!operator || !operator.line) {
        continue;
      }

      // Criar ou atualizar contato
      let existingContact = await this.contactsService.findByPhone(contact.phone);
      if (!existingContact) {
        await this.contactsService.create({
          name: contact.name,
          phone: contact.phone,
          segment: campaign.contactSegment,
        });
      }

      // Criar registro da campanha
      const campaignRecord = await this.prisma.campaign.create({
        data: {
          name: campaign.name,
          contactName: contact.name,
          contactPhone: contact.phone,
          contactSegment: campaign.contactSegment,
          lineReceptor: operator.line,
          speed: campaign.speed,
          response: false,
          useTemplate: campaign.useTemplate || false,
          templateId: campaign.templateId,
          templateVariables: campaign.templateVariables,
        },
      });

      // Adicionar à fila com delay
      const delay = i * delayMs;
      await this.campaignsQueue.add(
        'send-campaign-message',
        {
          campaignId: campaignRecord.id,
          contactName: contact.name,
          contactPhone: contact.phone,
          contactSegment: campaign.contactSegment,
          lineId: operator.line,
          message,
          useTemplate: campaign.useTemplate || false,
          templateId: campaign.templateId,
          templateVariables: campaign.templateVariables,
        },
        {
          delay,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        }
      );
    }

    return {
      message: `Campanha processada com sucesso. ${contacts.length} contatos agendados para envio.`,
      totalContacts: contacts.length,
      operators: onlineOperators.length,
      delayMinutes,
    };
  }

  async findAll(filters?: any) {
    // Remover campos inválidos que não existem no schema
    const { search, ...validFilters } = filters || {};
    
    // Se houver busca por texto, aplicar filtros
    const where = search 
      ? {
          ...validFilters,
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { contactName: { contains: search, mode: 'insensitive' } },
            { contactPhone: { contains: search } },
          ],
        }
      : validFilters;

    return this.prisma.campaign.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: number) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
    });

    if (!campaign) {
      throw new NotFoundException(`Campanha com ID ${id} não encontrada`);
    }

    return campaign;
  }

  async remove(id: number) {
    await this.findOne(id);

    return this.prisma.campaign.delete({
      where: { id },
    });
  }

  async getStats(campaignName: string) {
    const total = await this.prisma.campaign.count({
      where: { name: campaignName },
    });

    const sent = await this.prisma.campaign.count({
      where: { name: campaignName, response: true },
    });

    const failed = await this.prisma.campaign.count({
      where: { name: campaignName, response: false },
    });

    return {
      total,
      sent,
      failed,
      successRate: total > 0 ? ((sent / total) * 100).toFixed(2) : 0,
    };
  }
}
