import { Controller, Get, Query, UseGuards, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { ReportFilterDto } from './dto/report-filter.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Response } from 'express';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /**
   * Helper: Aplica filtro de segmento para supervisor
   * Supervisor só vê seu segmento, digital e admin veem todos
   */
  private applySegmentFilter(filters: ReportFilterDto, user: any): ReportFilterDto {
    if (user.role === 'supervisor' && user.segment) {
      filters.segment = user.segment;
    }
    return filters;
  }

  /**
   * RELATÓRIOS FUNDAMENTAIS
   */

  @Get('op-sintetico')
  @Roles('admin', 'supervisor', 'digital')
  async getOpSinteticoReport(@Query() filters: ReportFilterDto, @CurrentUser() user: any) {
    return this.reportsService.getOpSinteticoReport(this.applySegmentFilter(filters, user));
  }

  @Get('kpi')
  @Roles('admin', 'supervisor', 'digital')
  async getKpiReport(@Query() filters: ReportFilterDto, @CurrentUser() user: any) {
    return this.reportsService.getKpiReport(this.applySegmentFilter(filters, user));
  }

  @Get('hsm')
  @Roles('admin', 'supervisor', 'digital')
  async getHsmReport(@Query() filters: ReportFilterDto, @CurrentUser() user: any) {
    return this.reportsService.getHsmReport(this.applySegmentFilter(filters, user));
  }

  @Get('line-status')
  @Roles('admin', 'supervisor', 'digital')
  async getLineStatusReport(@Query() filters: ReportFilterDto, @CurrentUser() user: any) {
    return this.reportsService.getLineStatusReport(this.applySegmentFilter(filters, user));
  }

  /**
   * RELATÓRIOS BANCO DE DADOS
   */

  @Get('envios')
  @Roles('admin', 'supervisor', 'digital')
  async getEnviosReport(@Query() filters: ReportFilterDto, @CurrentUser() user: any) {
    return this.reportsService.getEnviosReport(this.applySegmentFilter(filters, user));
  }

  @Get('indicadores')
  @Roles('admin', 'supervisor', 'digital')
  async getIndicadoresReport(@Query() filters: ReportFilterDto, @CurrentUser() user: any) {
    return this.reportsService.getIndicadoresReport(this.applySegmentFilter(filters, user));
  }

  @Get('tempos')
  @Roles('admin', 'supervisor', 'digital')
  async getTemposReport(@Query() filters: ReportFilterDto, @CurrentUser() user: any) {
    return this.reportsService.getTemposReport(this.applySegmentFilter(filters, user));
  }

  /**
   * NOVOS RELATÓRIOS - TEMPLATES
   */

  @Get('templates')
  @Roles('admin', 'supervisor', 'digital')
  async getTemplatesReport(@Query() filters: ReportFilterDto, @CurrentUser() user: any) {
    return this.reportsService.getTemplatesReport(this.applySegmentFilter(filters, user));
  }

  @Get('completo-csv')
  @Roles('admin', 'supervisor', 'digital')
  async getCompletoCsvReport(@Query() filters: ReportFilterDto, @CurrentUser() user: any) {
    return this.reportsService.getCompletoCsvReport(this.applySegmentFilter(filters, user));
  }

  @Get('equipe')
  @Roles('admin', 'supervisor', 'digital')
  async getEquipeReport(@Query() filters: ReportFilterDto, @CurrentUser() user: any) {
    return this.reportsService.getEquipeReport(this.applySegmentFilter(filters, user));
  }

  @Get('dados-transacionados')
  @Roles('admin', 'supervisor', 'digital')
  async getDadosTransacionadosReport(@Query() filters: ReportFilterDto, @CurrentUser() user: any) {
    return this.reportsService.getDadosTransacionadosReport(this.applySegmentFilter(filters, user));
  }

  @Get('detalhado-conversas')
  @Roles('admin', 'supervisor', 'digital')
  async getDetalhadoConversasReport(@Query() filters: ReportFilterDto, @CurrentUser() user: any) {
    return this.reportsService.getDetalhadoConversasReport(this.applySegmentFilter(filters, user));
  }

  @Get('linhas')
  @Roles('admin', 'supervisor', 'digital')
  async getLinhasReport(@Query() filters: ReportFilterDto, @CurrentUser() user: any) {
    return this.reportsService.getLinhasReport(this.applySegmentFilter(filters, user));
  }

  @Get('resumo-atendimentos')
  @Roles('admin', 'supervisor', 'digital')
  async getResumoAtendimentosReport(@Query() filters: ReportFilterDto, @CurrentUser() user: any) {
    return this.reportsService.getResumoAtendimentosReport(this.applySegmentFilter(filters, user));
  }

  @Get('usuarios')
  @Roles('admin', 'supervisor', 'digital')
  async getUsuariosReport(@Query() filters: ReportFilterDto, @CurrentUser() user: any) {
    return this.reportsService.getUsuariosReport(this.applySegmentFilter(filters, user));
  }

  @Get('hiper-personalizado')
  @Roles('admin', 'supervisor', 'digital')
  async getHiperPersonalizadoReport(@Query() filters: ReportFilterDto, @CurrentUser() user: any) {
    return this.reportsService.getHiperPersonalizadoReport(this.applySegmentFilter(filters, user));
  }

  /**
   * RELATÓRIO CONSOLIDADO
   * Retorna todos os relatórios de uma vez
   */
  @Get('consolidado')
  @Roles('admin', 'supervisor', 'digital')
  async getConsolidatedReport(@Query() filters: ReportFilterDto, @CurrentUser() user: any) {
    // Aplicar filtro de segmento antes de chamar os serviços
    const filteredFilters = this.applySegmentFilter(filters, user);
    const [
      opSintetico,
      kpi,
      hsm,
      lineStatus,
      envios,
      indicadores,
      tempos,
      templates,
      completoCsv,
      equipe,
      dadosTransacionados,
      detalhadoConversas,
      linhas,
      resumoAtendimentos,
      usuarios,
      hiperPersonalizado,
    ] = await Promise.all([
      this.reportsService.getOpSinteticoReport(filteredFilters),
      this.reportsService.getKpiReport(filteredFilters),
      this.reportsService.getHsmReport(filteredFilters),
      this.reportsService.getLineStatusReport(filteredFilters),
      this.reportsService.getEnviosReport(filteredFilters),
      this.reportsService.getIndicadoresReport(filteredFilters),
      this.reportsService.getTemposReport(filteredFilters),
      this.reportsService.getTemplatesReport(filteredFilters),
      this.reportsService.getCompletoCsvReport(filteredFilters),
      this.reportsService.getEquipeReport(filteredFilters),
      this.reportsService.getDadosTransacionadosReport(filteredFilters),
      this.reportsService.getDetalhadoConversasReport(filteredFilters),
      this.reportsService.getLinhasReport(filteredFilters),
      this.reportsService.getResumoAtendimentosReport(filteredFilters),
      this.reportsService.getUsuariosReport(filteredFilters),
      this.reportsService.getHiperPersonalizadoReport(filteredFilters),
    ]);

    return {
      periodo: {
        inicio: filters.startDate || 'Início',
        fim: filters.endDate || 'Atual',
      },
      segmento: filteredFilters.segment || 'Todos',
      relatorios: {
        opSintetico,
        kpi,
        hsm,
        lineStatus,
        envios,
        indicadores,
        tempos,
        templates,
        completoCsv,
        equipe,
        dadosTransacionados,
        detalhadoConversas,
        linhas,
        resumoAtendimentos,
        usuarios,
        hiperPersonalizado,
      },
    };
  }
}

