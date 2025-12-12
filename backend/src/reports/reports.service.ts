import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ReportFilterDto } from './dto/report-filter.dto';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Helper: Formatar data como YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  /**
   * Helper: Formatar hora como HH:MM:SS
   */
  private formatTime(date: Date): string {
    return date.toISOString().split('T')[1].split('.')[0];
  }

  /**
   * OP SINTÉTICO
   * Estrutura: Segmento, Data, Hora, Qtd. Total Mensagens, Qtd. Total Entrantes, 
   * Qtd. Promessas, Conversão, Tempo Médio Transbordo, Tempo Médio Espera Total, 
   * Tempo Médio Atendimento, Tempo Médio Resposta
   */
  async getOpSinteticoReport(filters: ReportFilterDto) {
    const whereClause: any = {};

    if (filters.segment) {
      whereClause.segment = filters.segment;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.datetime = {};
      if (filters.startDate) {
        whereClause.datetime.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        whereClause.datetime.lte = new Date(filters.endDate);
      }
    }

    const conversations = await this.prisma.conversation.findMany({
      where: whereClause,
      orderBy: { datetime: 'asc' },
    });

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map(s => [s.id, s]));

    const tabulations = await this.prisma.tabulation.findMany();
    const tabulationMap = new Map(tabulations.map(t => [t.id, t]));

    // Agrupar por segmento e data
    const grouped: Record<string, Record<string, any>> = {};

    conversations.forEach(conv => {
      const segmentName = conv.segment ? segmentMap.get(conv.segment)?.name || 'Sem Segmento' : 'Sem Segmento';
      const date = this.formatDate(conv.datetime);

      const key = `${segmentName}|${date}`;
      if (!grouped[key]) {
        grouped[key] = {
          segment: segmentName,
          date,
          totalMensagens: 0,
          entrantes: 0,
          promessas: 0,
          tempos: [],
        };
      }

      grouped[key].totalMensagens++;
      
      if (conv.sender === 'contact') {
        grouped[key].entrantes++;
      }

      // Verificar se é promessa (tabulação CPC)
      if (conv.tabulation) {
        const tabulation = tabulationMap.get(conv.tabulation);
        if (tabulation?.isCPC) {
          grouped[key].promessas++;
        }
      }
    });

    const result = Object.values(grouped).map((item: any) => ({
      Segmento: item.segment,
      Data: item.date,
      Hora: null, // Agregado por dia, não por hora específica
      'Qtd. Total Mensagens': item.totalMensagens,
      'Qtd. Total Entrantes': item.entrantes,
      'Qtd. Promessas': item.promessas,
      Conversão: item.totalMensagens > 0 
        ? `${((item.promessas / item.totalMensagens) * 100).toFixed(2)}%`
        : '0%',
      'Tempo Médio Transbordo': null,
      'Tempo Médio Espera Total': null,
      'Tempo Médio Atendimento': null,
      'Tempo Médio Resposta': null,
    }));

    return result;
  }

  /**
   * RELATÓRIO KPI
   * Estrutura: Data Evento, Descrição Evento, Tipo de Evento, Evento Finalizador, 
   * Contato, Identificação, Código Contato, Hashtag, Usuário, Número Protocolo, 
   * Data Hora Geração Protocolo, Observação, SMS Principal, Whatsapp Principal, 
   * Email Principal, Canal, Carteiras, Carteira do Evento, Valor da oportunidade, 
   * Identificador da chamada de Voz
   */
  async getKpiReport(filters: ReportFilterDto) {
    const whereClause: any = {
      tabulation: { not: null },
    };

    if (filters.segment) {
      whereClause.segment = filters.segment;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.datetime = {};
      if (filters.startDate) {
        whereClause.datetime.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        whereClause.datetime.lte = new Date(filters.endDate);
      }
    }

    const conversations = await this.prisma.conversation.findMany({
      where: whereClause,
      orderBy: { datetime: 'desc' },
    });

    const tabulations = await this.prisma.tabulation.findMany();
    const tabulationMap = new Map(tabulations.map(t => [t.id, t]));

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map(s => [s.id, s]));

    const contacts = await this.prisma.contact.findMany();
    const contactMap = new Map(contacts.map(c => [c.phone, c]));

    const result = conversations.map(conv => {
      const tabulation = conv.tabulation ? tabulationMap.get(conv.tabulation) : null;
      const segment = conv.segment ? segmentMap.get(conv.segment) : null;
      const contact = contactMap.get(conv.contactPhone);

      return {
        'Data Evento': this.formatDate(conv.datetime),
        'Descrição Evento': tabulation?.name || 'Sem Tabulação',
        'Tipo de Evento': tabulation?.isCPC ? 'CPC' : 'Atendimento',
        'Evento Finalizador': tabulation ? 'Sim' : 'Não',
        Contato: conv.contactName,
        Identificação: contact?.cpf || null,
        'Código Contato': contact?.id || null,
        Hashtag: null,
        Usuário: conv.userName || null,
        'Número Protocolo': null,
        'Data Hora Geração Protocolo': null,
        Observação: conv.message,
        'SMS Principal': null,
        'Whatsapp Principal': conv.contactPhone,
        'Email Principal': null,
        Canal: 'WhatsApp',
        Carteiras: segment?.name || null,
        'Carteira do Evento': segment?.name || null,
        'Valor da oportunidade': null,
        'Identificador da chamada de Voz': null,
      };
    });

    return result;
  }

  /**
   * RELATÓRIO HSM
   * Estrutura: Contato, Identificador, Código, Hashtag, Template, WhatsApp do contato, 
   * Solicitação envio, Envio, Confirmação, Leitura (se habilitado), Falha entrega, 
   * Motivo falha, WhatsApp de saida, Usuário Solicitante, Carteira, Teve retorno
   */
  async getHsmReport(filters: ReportFilterDto) {
    const whereClause: any = {};

    if (filters.segment) {
      whereClause.contactSegment = filters.segment;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.dateTime = {};
      if (filters.startDate) {
        whereClause.dateTime.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        whereClause.dateTime.lte = new Date(filters.endDate);
      }
    }

    const campaigns = await this.prisma.campaign.findMany({
      where: whereClause,
      orderBy: { dateTime: 'desc' },
    });

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map(s => [s.id, s]));

    const contacts = await this.prisma.contact.findMany();
    const contactMap = new Map(contacts.map(c => [c.phone, c]));

    const lines = await this.prisma.linesStock.findMany();
    const lineMap = new Map(lines.map(l => [l.id, l]));

    const result = campaigns.map(campaign => {
      const contact = contactMap.get(campaign.contactPhone);
      const segment = campaign.contactSegment ? segmentMap.get(campaign.contactSegment) : null;
      const line = campaign.lineReceptor ? lineMap.get(campaign.lineReceptor) : null;

      return {
        Contato: campaign.contactName,
        Identificador: contact?.cpf || null,
        Código: contact?.id || null,
        Hashtag: null,
        Template: campaign.name,
        'WhatsApp do contato': campaign.contactPhone,
        'Solicitação envio': this.formatDate(campaign.createdAt),
        Envio: this.formatDate(campaign.dateTime),
        Confirmação: campaign.response ? 'Sim' : 'Não',
        'Leitura (se habilitado)': null,
        'Falha entrega': campaign.retryCount > 0 ? 'Sim' : 'Não',
        'Motivo falha': null,
        'WhatsApp de saida': line?.phone || null,
        'Usuário Solicitante': null,
        Carteira: segment?.name || null,
        'Teve retorno': campaign.response ? 'Sim' : 'Não',
      };
    });

    return result;
  }

  /**
   * RELATÓRIO STATUS DE LINHA
   * Estrutura: Data, Numero, Business, QualityScore, Tier, Segmento
   */
  async getLineStatusReport(filters: ReportFilterDto) {
    const whereClause: any = {};

    if (filters.segment) {
      whereClause.segment = filters.segment;
    }

    const lines = await this.prisma.linesStock.findMany({
      where: whereClause,
      orderBy: { updatedAt: 'desc' },
    });

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map(s => [s.id, s]));

    const result = lines.map(line => {
      const segment = line.segment ? segmentMap.get(line.segment) : null;

      return {
        Data: this.formatDate(line.updatedAt),
        Numero: line.phone,
        Business: line.businessID || null,
        QualityScore: null,
        Tier: null,
        Segmento: segment?.name || null,
      };
    });

    return result;
  }

  /**
   * RELATÓRIO DE ENVIOS
   * Estrutura: data_envio, hora_envio, fornecedor_envio, codigo_carteira, nome_carteira, 
   * segmento_carteira, numero_contrato, cpf_cliente, telefone_cliente, status_envio, 
   * numero_saida, login_usuario, template_envio, coringa_1, coringa_2, coringa_3, 
   * coringa_4, tipo_envio
   */
  async getEnviosReport(filters: ReportFilterDto) {
    const whereClause: any = {};

    if (filters.segment) {
      whereClause.contactSegment = filters.segment;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.dateTime = {};
      if (filters.startDate) {
        whereClause.dateTime.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        whereClause.dateTime.lte = new Date(filters.endDate);
      }
    }

    // Buscar campanhas (envios massivos)
    const campaigns = await this.prisma.campaign.findMany({
      where: whereClause,
      orderBy: { dateTime: 'desc' },
    });

    // Buscar conversas de operadores (envios 1:1)
    const conversationWhere: any = {
      sender: 'operator',
    };
    if (filters.segment) {
      conversationWhere.segment = filters.segment;
    }
    if (filters.startDate || filters.endDate) {
      conversationWhere.datetime = {};
      if (filters.startDate) {
        conversationWhere.datetime.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        conversationWhere.datetime.lte = new Date(filters.endDate);
      }
    }

    const conversations = await this.prisma.conversation.findMany({
      where: conversationWhere,
      orderBy: { datetime: 'desc' },
    });

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map(s => [s.id, s]));

    const contacts = await this.prisma.contact.findMany();
    const contactMap = new Map(contacts.map(c => [c.phone, c]));

    const lines = await this.prisma.linesStock.findMany();
    const lineMap = new Map(lines.map(l => [l.id, l]));

    const result: any[] = [];

    // Processar campanhas (massivos)
    campaigns.forEach(campaign => {
      const contact = contactMap.get(campaign.contactPhone);
      const segment = campaign.contactSegment ? segmentMap.get(campaign.contactSegment) : null;
      const line = campaign.lineReceptor ? lineMap.get(campaign.lineReceptor) : null;

      result.push({
        data_envio: this.formatDate(campaign.dateTime),
        hora_envio: this.formatTime(campaign.dateTime),
        fornecedor_envio: line?.evolutionName || null,
        codigo_carteira: segment?.id || null,
        nome_carteira: segment?.name || null,
        segmento_carteira: segment?.name || null,
        numero_contrato: contact?.contract || null,
        cpf_cliente: contact?.cpf || null,
        telefone_cliente: campaign.contactPhone,
        status_envio: campaign.response ? 'Entregue' : 'Pendente',
        numero_saida: line?.phone || null,
        login_usuario: null,
        template_envio: campaign.name,
        coringa_1: null,
        coringa_2: null,
        coringa_3: null,
        coringa_4: null,
        tipo_envio: 'Massivo',
      });
    });

    // Processar conversas 1:1
    conversations.forEach(conv => {
      const contact = contactMap.get(conv.contactPhone);
      const segment = conv.segment ? segmentMap.get(conv.segment) : null;
      const line = conv.userLine ? lineMap.get(conv.userLine) : null;

      result.push({
        data_envio: this.formatDate(conv.datetime),
        hora_envio: this.formatTime(conv.datetime),
        fornecedor_envio: line?.evolutionName || null,
        codigo_carteira: segment?.id || null,
        nome_carteira: segment?.name || null,
        segmento_carteira: segment?.name || null,
        numero_contrato: contact?.contract || null,
        cpf_cliente: contact?.cpf || null,
        telefone_cliente: conv.contactPhone,
        status_envio: 'Enviado',
        numero_saida: line?.phone || null,
        login_usuario: conv.userName || null,
        template_envio: null,
        coringa_1: null,
        coringa_2: null,
        coringa_3: null,
        coringa_4: null,
        tipo_envio: '1:1',
      });
    });

    // Ordenar por data/hora descendente
    result.sort((a, b) => {
      const dateA = `${a.data_envio} ${a.hora_envio}`;
      const dateB = `${b.data_envio} ${b.hora_envio}`;
      return dateB.localeCompare(dateA);
    });

    return result;
  }

  /**
   * RELATÓRIO DE INDICADORES
   * Estrutura: data, data_envio, inicio_atendimento, fim_atendimento, tma, tipo_atendimento, 
   * fornecedor, codigo_carteira, carteira, segmento, contrato, cpf, telefone, status, 
   * login, evento, evento_normalizado, envio, falha, entregue, lido, cpc, cpc_produtivo, 
   * boleto, valor, transbordo, primeira_opcao_oferta, segunda_via, nota_nps, obs_nps, 
   * erro_api, abandono, protocolo
   */
  async getIndicadoresReport(filters: ReportFilterDto) {
    const whereClause: any = {};

    if (filters.segment) {
      whereClause.segment = filters.segment;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.datetime = {};
      if (filters.startDate) {
        whereClause.datetime.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        whereClause.datetime.lte = new Date(filters.endDate);
      }
    }

    const conversations = await this.prisma.conversation.findMany({
      where: whereClause,
      orderBy: { datetime: 'asc' },
    });

    const tabulations = await this.prisma.tabulation.findMany();
    const tabulationMap = new Map(tabulations.map(t => [t.id, t]));

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map(s => [s.id, s]));

    const contacts = await this.prisma.contact.findMany();
    const contactMap = new Map(contacts.map(c => [c.phone, c]));

    const lines = await this.prisma.linesStock.findMany();
    const lineMap = new Map(lines.map(l => [l.id, l]));

    // Agrupar conversas por contato para calcular TMA
    const contactConvs: Record<string, any[]> = {};
    conversations.forEach(conv => {
      if (!contactConvs[conv.contactPhone]) {
        contactConvs[conv.contactPhone] = [];
      }
      contactConvs[conv.contactPhone].push(conv);
    });

    const result: any[] = [];

    Object.entries(contactConvs).forEach(([phone, convs]) => {
      const firstConv = convs[0];
      const lastConv = convs[convs.length - 1];
      const contact = contactMap.get(phone);
      const segment = firstConv.segment ? segmentMap.get(firstConv.segment) : null;
      const line = firstConv.userLine ? lineMap.get(firstConv.userLine) : null;
      const tabulation = lastConv.tabulation ? tabulationMap.get(lastConv.tabulation) : null;

      // Calcular TMA (tempo médio de atendimento em minutos)
      const tma = convs.length > 1
        ? Math.round((lastConv.datetime.getTime() - firstConv.datetime.getTime()) / 1000 / 60)
        : 0;

      result.push({
        data: this.formatDate(firstConv.datetime),
        data_envio: this.formatDate(firstConv.datetime),
        inicio_atendimento: this.formatTime(firstConv.datetime),
        fim_atendimento: this.formatTime(lastConv.datetime),
        tma: tma.toString(),
        tipo_atendimento: firstConv.sender === 'operator' ? '1:1' : 'Receptivo',
        fornecedor: line?.evolutionName || null,
        codigo_carteira: segment?.id || null,
        carteira: segment?.name || null,
        segmento: segment?.name || null,
        contrato: contact?.contract || null,
        cpf: contact?.cpf || null,
        telefone: phone,
        status: tabulation ? 'Finalizado' : 'Em Andamento',
        login: firstConv.userName || null,
        evento: tabulation?.name || null,
        evento_normalizado: tabulation?.name || null,
        envio: 'Sim',
        falha: 'Não',
        entregue: 'Sim',
        lido: null,
        cpc: tabulation?.isCPC ? 'Sim' : 'Não',
        cpc_produtivo: tabulation?.isCPC ? 'Sim' : 'Não',
        boleto: tabulation?.isCPC ? 'Sim' : 'Não',
        valor: null,
        transbordo: null,
        primeira_opcao_oferta: null,
        segunda_via: null,
        nota_nps: null,
        obs_nps: null,
        erro_api: null,
        abandono: !tabulation ? 'Sim' : 'Não',
        protocolo: null,
      });
    });

    return result;
  }

  /**
   * RELATÓRIO DE TEMPOS
   * Estrutura: data, hora, fornecedor, codigo_carteira, carteira, segmento, contrato, 
   * cpf, telefone, login, evento, evento_normalizado, tma, tmc, tmpro, tmf, tmrc, 
   * tmro, protocolo
   */
  async getTemposReport(filters: ReportFilterDto) {
    const whereClause: any = {};

    if (filters.segment) {
      whereClause.segment = filters.segment;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.datetime = {};
      if (filters.startDate) {
        whereClause.datetime.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        whereClause.datetime.lte = new Date(filters.endDate);
      }
    }

    const conversations = await this.prisma.conversation.findMany({
      where: whereClause,
      orderBy: [
        { contactPhone: 'asc' },
        { datetime: 'asc' },
      ],
    });

    const tabulations = await this.prisma.tabulation.findMany();
    const tabulationMap = new Map(tabulations.map(t => [t.id, t]));

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map(s => [s.id, s]));

    const contacts = await this.prisma.contact.findMany();
    const contactMap = new Map(contacts.map(c => [c.phone, c]));

    const lines = await this.prisma.linesStock.findMany();
    const lineMap = new Map(lines.map(l => [l.id, l]));

    // Agrupar por contato
    const contactConvs: Record<string, any[]> = {};
    conversations.forEach(conv => {
      if (!contactConvs[conv.contactPhone]) {
        contactConvs[conv.contactPhone] = [];
      }
      contactConvs[conv.contactPhone].push(conv);
    });

    const result: any[] = [];

    Object.entries(contactConvs).forEach(([phone, convs]) => {
      if (convs.length < 2) return; // Precisa de pelo menos 2 mensagens

      const firstConv = convs[0];
      const lastConv = convs[convs.length - 1];
      const contact = contactMap.get(phone);
      const segment = firstConv.segment ? segmentMap.get(firstConv.segment) : null;
      const line = firstConv.userLine ? lineMap.get(firstConv.userLine) : null;
      const tabulation = lastConv.tabulation ? tabulationMap.get(lastConv.tabulation) : null;

      // Calcular tempos em minutos
      const tma = Math.round((lastConv.datetime.getTime() - firstConv.datetime.getTime()) / 1000 / 60);

      result.push({
        data: this.formatDate(firstConv.datetime),
        hora: this.formatTime(firstConv.datetime),
        fornecedor: line?.evolutionName || null,
        codigo_carteira: segment?.id || null,
        carteira: segment?.name || null,
        segmento: segment?.name || null,
        contrato: contact?.contract || null,
        cpf: contact?.cpf || null,
        telefone: phone,
        login: firstConv.userName || null,
        evento: tabulation?.name || null,
        evento_normalizado: tabulation?.name || null,
        tma: tma.toString(),
        tmc: null, // Tempo médio de conversação
        tmpro: null, // Tempo médio de processamento
        tmf: null, // Tempo médio de fila
        tmrc: null, // Tempo médio de resposta do contato
        tmro: null, // Tempo médio de resposta do operador
        protocolo: null,
      });
    });

    return result;
  }

  /**
   * RELATÓRIO DE TEMPLATES
   * Estrutura: Data de Solicitação de Envio, Canal, Fornecedor, Nome do Template,
   * Conteúdo do Disparo Inicial, Carteira, WhatsApp Saída, Quantidade de Disparos,
   * Enviado, Confirmado, Leitura, Falha, Interação
   */
  async getTemplatesReport(filters: ReportFilterDto) {
    const whereClause: any = {};

    if (filters.segment) {
      whereClause.contactSegment = filters.segment;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.dateTime = {};
      if (filters.startDate) {
        whereClause.dateTime.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        whereClause.dateTime.lte = new Date(filters.endDate);
      }
    }

    const campaigns = await this.prisma.campaign.findMany({
      where: whereClause,
      orderBy: { dateTime: 'desc' },
    });

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map(s => [s.id, s]));

    const lines = await this.prisma.linesStock.findMany();
    const lineMap = new Map(lines.map(l => [l.id, l]));

    // Agrupar por nome do template para contar disparos
    const templateGroups: Record<string, any[]> = {};
    campaigns.forEach(campaign => {
      if (!templateGroups[campaign.name]) {
        templateGroups[campaign.name] = [];
      }
      templateGroups[campaign.name].push(campaign);
    });

    const result: any[] = [];

    Object.entries(templateGroups).forEach(([templateName, templateCampaigns]) => {
      const firstCampaign = templateCampaigns[0];
      const segment = firstCampaign.contactSegment ? segmentMap.get(firstCampaign.contactSegment) : null;
      const line = firstCampaign.lineReceptor ? lineMap.get(firstCampaign.lineReceptor) : null;

      // Verificar se houve retorno (se alguma campanha teve resposta)
      const teveRetorno = templateCampaigns.some(c => c.response);
      const enviado = templateCampaigns.length > 0;
      const confirmado = templateCampaigns.some(c => c.response);
      const falha = templateCampaigns.some(c => c.retryCount > 0);

      result.push({
        'Data de Solicitação de Envio': this.formatDate(firstCampaign.createdAt),
        Canal: line?.oficial ? 'Oficial' : 'Não Oficial',
        Fornecedor: 'Vend',
        'Nome do Template': templateName,
        'Conteúdo do Disparo Inicial': null, // Não temos mensagem na campanha, seria necessário adicionar
        Carteira: segment?.name || null,
        'WhatsApp Saída': line?.phone || null,
        'Quantidade de Disparos': templateCampaigns.length,
        Enviado: enviado ? 'Sim' : 'Não',
        Confirmado: confirmado ? 'Sim' : 'Não',
        Leitura: null, // Não temos informação de leitura
        Falha: falha ? 'Sim' : 'Não',
        Interação: teveRetorno ? 'Sim' : 'Não',
      });
    });

    return result;
  }

  /**
   * RELATÓRIO COMPLETO CSV
   * Estrutura: Id, Carteira, Nome do Cliente, Telefone, CNPJ/CPF, Contrato,
   * Nome do Operador, Tabulação, Status, Primeiro Atendimento, Último Atendimento,
   * Enviado, Confirmado, Leitura, Falha, Interação
   */
  async getCompletoCsvReport(filters: ReportFilterDto) {
    const whereClause: any = {};

    if (filters.segment) {
      whereClause.segment = filters.segment;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.datetime = {};
      if (filters.startDate) {
        whereClause.datetime.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        whereClause.datetime.lte = new Date(filters.endDate);
      }
    }

    const conversations = await this.prisma.conversation.findMany({
      where: whereClause,
      orderBy: { datetime: 'asc' },
    });

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map(s => [s.id, s]));

    const contacts = await this.prisma.contact.findMany();
    const contactMap = new Map(contacts.map(c => [c.phone, c]));

    const tabulations = await this.prisma.tabulation.findMany();
    const tabulationMap = new Map(tabulations.map(t => [t.id, t]));

    // Agrupar por contato para pegar primeiro e último atendimento
    const contactConvs: Record<string, any[]> = {};
    conversations.forEach(conv => {
      if (!contactConvs[conv.contactPhone]) {
        contactConvs[conv.contactPhone] = [];
      }
      contactConvs[conv.contactPhone].push(conv);
    });

    const result: any[] = [];

    Object.entries(contactConvs).forEach(([phone, convs]) => {
      const firstConv = convs[0];
      const lastConv = convs[convs.length - 1];
      const contact = contactMap.get(phone);
      const segment = firstConv.segment ? segmentMap.get(firstConv.segment) : null;
      const tabulation = lastConv.tabulation ? tabulationMap.get(lastConv.tabulation) : null;

      // Verificar se houve interação (resposta do cliente)
      const teveInteracao = convs.some(c => c.sender === 'contact');
      const enviado = convs.some(c => c.sender === 'operator');
      const confirmado = enviado; // Assumindo que se foi enviado, foi confirmado

      result.push({
        Id: firstConv.id,
        Carteira: segment?.name || null,
        'Nome do Cliente': firstConv.contactName,
        Telefone: phone,
        'CNPJ/CPF': contact?.cpf || null,
        Contrato: contact?.contract || null,
        'Nome do Operador': firstConv.userName || null,
        Tabulação: tabulation?.name || null,
        Status: tabulation ? 'Finalizado' : 'Em Andamento',
        'Primeiro Atendimento': this.formatDate(firstConv.datetime),
        'Último Atendimento': this.formatDate(lastConv.datetime),
        Enviado: enviado ? 'Sim' : 'Não',
        Confirmado: confirmado ? 'Sim' : 'Não',
        Leitura: null,
        Falha: 'Não',
        Interação: teveInteracao ? 'Sim' : 'Não',
      });
    });

    return result;
  }

  /**
   * RELATÓRIO DE EQUIPE
   * Estrutura: id, Operador, Quantidade de Mensagens, Carteira
   */
  async getEquipeReport(filters: ReportFilterDto) {
    const whereClause: any = {
      sender: 'operator',
    };

    if (filters.segment) {
      whereClause.segment = filters.segment;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.datetime = {};
      if (filters.startDate) {
        whereClause.datetime.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        whereClause.datetime.lte = new Date(filters.endDate);
      }
    }

    const conversations = await this.prisma.conversation.findMany({
      where: whereClause,
      orderBy: { datetime: 'desc' },
    });

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map(s => [s.id, s]));

    const users = await this.prisma.user.findMany({
      where: {
        role: 'operator',
      },
    });
    const userMap = new Map(users.map(u => [u.name, u]));

    // Agrupar por operador
    const operatorGroups: Record<string, { count: number; segment?: number }> = {};
    
    conversations.forEach(conv => {
      if (!conv.userName) return;
      
      const key = conv.userName;
      if (!operatorGroups[key]) {
        operatorGroups[key] = { count: 0, segment: conv.segment || undefined };
      }
      operatorGroups[key].count++;
    });

    const result: any[] = [];

    Object.entries(operatorGroups).forEach(([userName, data]) => {
      const user = userMap.get(userName);
      const segment = data.segment ? segmentMap.get(data.segment) : null;

      result.push({
        id: user?.id || null,
        Operador: userName,
        'Quantidade de Mensagens': data.count,
        Carteira: segment?.name || null,
      });
    });

    return result;
  }

  /**
   * RELATÓRIO DE DADOS TRANSACIONADOS
   * Estrutura: id Ticket, id Template, Nome do Template, Mensagem Template,
   * Dispositivo Disparo, Segmento do Dispositivo, E-mail Operador, Data de Disparo,
   * Dispositivo Recebido, Enviado, Confirmado, Leitura, Falha, Interação
   */
  async getDadosTransacionadosReport(filters: ReportFilterDto) {
    const whereClause: any = {};

    if (filters.segment) {
      whereClause.contactSegment = filters.segment;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.dateTime = {};
      if (filters.startDate) {
        whereClause.dateTime.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        whereClause.dateTime.lte = new Date(filters.endDate);
      }
    }

    const campaigns = await this.prisma.campaign.findMany({
      where: whereClause,
      orderBy: { dateTime: 'desc' },
    });

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map(s => [s.id, s]));

    const lines = await this.prisma.linesStock.findMany();
    const lineMap = new Map(lines.map(l => [l.id, l]));

    const users = await this.prisma.user.findMany({
      where: {
        line: { not: null },
      },
    });
    const userMap = new Map(
      users
        .filter(u => u.line !== null)
        .map(u => [u.line!, u])
    );

    // Buscar conversas relacionadas para verificar interação
    const contactPhones = campaigns.map(c => c.contactPhone);
    const conversations = await this.prisma.conversation.findMany({
      where: {
        contactPhone: { in: contactPhones },
      },
    });

    const contactConvs: Record<string, boolean> = {};
    conversations.forEach(conv => {
      if (conv.sender === 'contact') {
        contactConvs[conv.contactPhone] = true;
      }
    });

    const result = campaigns.map(campaign => {
      const segment = campaign.contactSegment ? segmentMap.get(campaign.contactSegment) : null;
      const line = campaign.lineReceptor ? lineMap.get(campaign.lineReceptor) : null;
      const user = line ? userMap.get(line.id) : null;

      return {
        'id Ticket': campaign.id,
        'id Template': null, // Não temos ID de template separado
        'Nome do Template': campaign.name,
        'Mensagem Template': null, // Não temos mensagem na campanha
        'Dispositivo Disparo': line?.phone || null,
        'Segmento do Dispositivo': segment?.name || null,
        'E-mail Operador': user?.email || null,
        'Data de Disparo': this.formatDate(campaign.dateTime),
        'Dispositivo Recebido': campaign.contactPhone,
        Enviado: 'Sim',
        Confirmado: campaign.response ? 'Sim' : 'Não',
        Leitura: null,
        Falha: campaign.retryCount > 0 ? 'Sim' : 'Não',
        Interação: contactConvs[campaign.contactPhone] ? 'Sim' : 'Não',
      };
    });

    return result;
  }

  /**
   * RELATÓRIO DETALHADO DE CONVERSAS
   * Estrutura: Data de Conversa, Protocolo, Login do Operador, CPF/CNPJ, Contrato,
   * Data e Hora início da Conversa, Data e Hora fim da Conversa, Paschoalotto,
   * Telefone do Cliente, Segmento, Hora da Mensagem, Mensagem Transcrita,
   * Quem Enviou a Mensagem, Finalização
   */
  async getDetalhadoConversasReport(filters: ReportFilterDto) {
    const whereClause: any = {};

    if (filters.segment) {
      whereClause.segment = filters.segment;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.datetime = {};
      if (filters.startDate) {
        whereClause.datetime.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        whereClause.datetime.lte = new Date(filters.endDate);
      }
    }

    const conversations = await this.prisma.conversation.findMany({
      where: whereClause,
      orderBy: [
        { contactPhone: 'asc' },
        { datetime: 'asc' },
      ],
    });

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map(s => [s.id, s]));

    const contacts = await this.prisma.contact.findMany();
    const contactMap = new Map(contacts.map(c => [c.phone, c]));

    const tabulations = await this.prisma.tabulation.findMany();
    const tabulationMap = new Map(tabulations.map(t => [t.id, t]));

    // Agrupar por contato para pegar início e fim
    const contactConvs: Record<string, any[]> = {};
    conversations.forEach(conv => {
      if (!contactConvs[conv.contactPhone]) {
        contactConvs[conv.contactPhone] = [];
      }
      contactConvs[conv.contactPhone].push(conv);
    });

    const result: any[] = [];

    Object.entries(contactConvs).forEach(([phone, convs]) => {
      const firstConv = convs[0];
      const lastConv = convs[convs.length - 1];
      const contact = contactMap.get(phone);
      const segment = firstConv.segment ? segmentMap.get(firstConv.segment) : null;
      const tabulation = lastConv.tabulation ? tabulationMap.get(lastConv.tabulation) : null;

      // Criar uma linha para cada mensagem
      convs.forEach(conv => {
        result.push({
          'Data de Conversa': this.formatDate(firstConv.datetime),
          Protocolo: firstConv.id,
          'Login do Operador': conv.userName || null,
          'CPF/CNPJ': contact?.cpf || null,
          Contrato: contact?.contract || null,
          'Data e Hora início da Conversa': `${this.formatDate(firstConv.datetime)} ${this.formatTime(firstConv.datetime)}`,
          'Data e Hora fim da Conversa': `${this.formatDate(lastConv.datetime)} ${this.formatTime(lastConv.datetime)}`,
          Paschoalotto: 'Paschoalotto',
          'Telefone do Cliente': phone,
          Segmento: segment?.name || null,
          'Hora da Mensagem': this.formatTime(conv.datetime),
          'Mensagem Transcrita': conv.message,
          'Quem Enviou a Mensagem': conv.sender === 'operator' ? 'Operador' : 'Cliente',
          Finalização: tabulation?.name || null,
        });
      });
    });

    return result;
  }

  /**
   * RELATÓRIO DE LINHAS
   * Estrutura: id, Número, Data de Transferência, Blindado, Carteira
   */
  async getLinhasReport(filters: ReportFilterDto) {
    const whereClause: any = {};

    if (filters.segment) {
      whereClause.segment = filters.segment;
    }

    const lines = await this.prisma.linesStock.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
    });

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map(s => [s.id, s]));

    const result = lines.map(line => {
      const segment = line.segment ? segmentMap.get(line.segment) : null;

      return {
        id: line.id,
        Número: line.phone,
        'Data de Transferência': this.formatDate(line.createdAt),
        Blindado: line.lineStatus === 'ban' ? 'Sim' : 'Não',
        Carteira: segment?.name || null,
      };
    });

    return result;
  }

  /**
   * RELATÓRIO RESUMO DE ATENDIMENTOS
   * Estrutura: Data Início Conversa, Data de Início da Conversa, Teve Retorno,
   * Telefone do Cliente, Login do Operador, CPF/CNPJ, Contrato,
   * Data e Hora ínicio da Conversa, Data e hora fim da Conversa, Finalização,
   * Segmento, Carteira, Protocolo
   */
  async getResumoAtendimentosReport(filters: ReportFilterDto) {
    const whereClause: any = {};

    if (filters.segment) {
      whereClause.segment = filters.segment;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.datetime = {};
      if (filters.startDate) {
        whereClause.datetime.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        whereClause.datetime.lte = new Date(filters.endDate);
      }
    }

    const conversations = await this.prisma.conversation.findMany({
      where: whereClause,
      orderBy: { datetime: 'asc' },
    });

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map(s => [s.id, s]));

    const contacts = await this.prisma.contact.findMany();
    const contactMap = new Map(contacts.map(c => [c.phone, c]));

    const tabulations = await this.prisma.tabulation.findMany();
    const tabulationMap = new Map(tabulations.map(t => [t.id, t]));

    // Agrupar por contato
    const contactConvs: Record<string, any[]> = {};
    conversations.forEach(conv => {
      if (!contactConvs[conv.contactPhone]) {
        contactConvs[conv.contactPhone] = [];
      }
      contactConvs[conv.contactPhone].push(conv);
    });

    const result: any[] = [];

    Object.entries(contactConvs).forEach(([phone, convs]) => {
      const firstConv = convs[0];
      const lastConv = convs[convs.length - 1];
      const contact = contactMap.get(phone);
      const segment = firstConv.segment ? segmentMap.get(firstConv.segment) : null;
      const tabulation = lastConv.tabulation ? tabulationMap.get(lastConv.tabulation) : null;

      // Verificar se teve retorno (resposta do cliente)
      const teveRetorno = convs.some(c => c.sender === 'contact');

      result.push({
        'Data Início Conversa': this.formatDate(firstConv.createdAt),
        'Data de Início da Conversa': this.formatDate(firstConv.datetime),
        'Teve Retorno': teveRetorno ? 'Sim' : 'Não',
        'Telefone do Cliente': phone,
        'Login do Operador': firstConv.userName || null,
        'CPF/CNPJ': contact?.cpf || null,
        Contrato: contact?.contract || null,
        'Data e Hora ínicio da Conversa': `${this.formatDate(firstConv.datetime)} ${this.formatTime(firstConv.datetime)}`,
        'Data e hora fim da Conversa': `${this.formatDate(lastConv.datetime)} ${this.formatTime(lastConv.datetime)}`,
        Finalização: tabulation?.name || null,
        Segmento: segment?.name || null,
        Carteira: segment?.name || null,
        Protocolo: firstConv.id,
      });
    });

    return result;
  }

  /**
   * RELATÓRIO HIPERPERSONALIZADO
   * Estrutura: Data de Disparo, Nome do Template, Protocolo, Segmento,
   * Login do Operador, Número de Saída, CPF do Cliente, Telefone do Cliente,
   * Finalização, Disparo, Falha, Entrega, Retorno
   */
  async getHiperPersonalizadoReport(filters: ReportFilterDto) {
    const whereClause: any = {};

    if (filters.segment) {
      whereClause.contactSegment = filters.segment;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.dateTime = {};
      if (filters.startDate) {
        whereClause.dateTime.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        whereClause.dateTime.lte = new Date(filters.endDate);
      }
    }

    const campaigns = await this.prisma.campaign.findMany({
      where: whereClause,
      orderBy: { dateTime: 'desc' },
    });

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map(s => [s.id, s]));

    const lines = await this.prisma.linesStock.findMany();
    const lineMap = new Map(lines.map(l => [l.id, l]));

    const users = await this.prisma.user.findMany({
      where: {
        line: { not: null },
      },
    });
    const userMap = new Map(
      users
        .filter(u => u.line !== null)
        .map(u => [u.line!, u])
    );

    const contacts = await this.prisma.contact.findMany();
    const contactMap = new Map(contacts.map(c => [c.phone, c]));

    // Buscar conversas para verificar retorno e finalização
    const contactPhones = campaigns.map(c => c.contactPhone);
    const conversations = await this.prisma.conversation.findMany({
      where: {
        contactPhone: { in: contactPhones },
      },
    });

    const tabulations = await this.prisma.tabulation.findMany();
    const tabulationMap = new Map(tabulations.map(t => [t.id, t]));

    const contactConvs: Record<string, { retorno: boolean; tabulation?: number }> = {};
    conversations.forEach(conv => {
      if (!contactConvs[conv.contactPhone]) {
        contactConvs[conv.contactPhone] = { retorno: false };
      }
      if (conv.sender === 'contact') {
        contactConvs[conv.contactPhone].retorno = true;
      }
      if (conv.tabulation) {
        contactConvs[conv.contactPhone].tabulation = conv.tabulation;
      }
    });

    const result = campaigns.map(campaign => {
      const segment = campaign.contactSegment ? segmentMap.get(campaign.contactSegment) : null;
      const line = campaign.lineReceptor ? lineMap.get(campaign.lineReceptor) : null;
      const user = line ? userMap.get(line.id) : null;
      const contact = contactMap.get(campaign.contactPhone);
      const convData = contactConvs[campaign.contactPhone];
      const tabulation = convData?.tabulation ? tabulationMap.get(convData.tabulation) : null;

      return {
        'Data de Disparo': this.formatDate(campaign.createdAt),
        'Nome do Template': campaign.name,
        Protocolo: campaign.id,
        Segmento: segment?.name || null,
        'Login do Operador': user?.email || null,
        'Número de Saída': line?.phone || null,
        'CPF do Cliente': contact?.cpf || null,
        'Telefone do Cliente': campaign.contactPhone,
        Finalização: tabulation?.name || null,
        Disparo: '1',
        Falha: campaign.retryCount > 0 ? '1' : '0',
        Entrega: campaign.response ? '1' : '0',
        Retorno: convData?.retorno ? '1' : '0',
      };
    });

    return result;
  }
}
