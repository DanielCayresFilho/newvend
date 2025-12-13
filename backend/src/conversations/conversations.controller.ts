import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { TabulateConversationDto } from './dto/tabulate-conversation.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('conversations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  @Roles(Role.admin, Role.supervisor, Role.operator)
  create(@Body() createConversationDto: CreateConversationDto) {
    return this.conversationsService.create(createConversationDto);
  }

  @Get()
  @Roles(Role.admin, Role.supervisor, Role.operator)
  findAll(@Query() filters: any) {
    return this.conversationsService.findAll(filters);
  }

  @Get('active')
  @Roles(Role.admin, Role.supervisor, Role.operator)
  getActiveConversations(@CurrentUser() user: any) {
    // Admin e Supervisor podem ver todas as conversas ativas
    // Operator só vê as conversas da sua linha
    if (user.role === 'admin') {
      return this.conversationsService.findAll({ tabulation: null });
    }
    if (user.role === 'supervisor') {
      return this.conversationsService.findAll({ segment: user.segment, tabulation: null });
    }
    return this.conversationsService.findActiveConversations(user.line);
  }

  @Get('segment/:segment')
  @Roles(Role.supervisor, Role.admin)
  getBySegment(
    @Param('segment') segment: string,
    @Query('tabulated') tabulated?: string,
  ) {
    return this.conversationsService.getConversationsBySegment(
      +segment,
      tabulated === 'true',
    );
  }

  @Get('contact/:phone')
  @Roles(Role.admin, Role.supervisor, Role.operator)
  getByContactPhone(
    @Param('phone') phone: string,
    @Query('tabulated') tabulated?: string,
  ) {
    return this.conversationsService.findByContactPhone(
      phone,
      tabulated === 'true',
    );
  }

  @Get(':id')
  @Roles(Role.admin, Role.supervisor, Role.operator)
  findOne(@Param('id') id: string) {
    return this.conversationsService.findOne(+id);
  }

  @Patch(':id')
  @Roles(Role.admin, Role.supervisor, Role.operator)
  update(@Param('id') id: string, @Body() updateConversationDto: UpdateConversationDto) {
    return this.conversationsService.update(+id, updateConversationDto);
  }

  @Post('tabulate/:phone')
  @Roles(Role.operator)
  tabulate(
    @Param('phone') phone: string,
    @Body() tabulateDto: TabulateConversationDto,
  ) {
    return this.conversationsService.tabulateConversation(phone, tabulateDto.tabulationId);
  }

  @Delete(':id')
  @Roles(Role.admin, Role.supervisor)
  remove(@Param('id') id: string) {
    return this.conversationsService.remove(+id);
  }
}
