import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { ApiMessagesService } from './api-messages.service';
import { MassiveCpcDto } from './dto/massive-cpc.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@Controller('api/messages')
export class ApiMessagesController {
  constructor(private readonly apiMessagesService: ApiMessagesService) {}

  @Post('massivocpc')
  @UseGuards(ApiKeyGuard)
  async sendMassiveCpc(@Body() dto: MassiveCpcDto, @Req() req: any) {
    const ipAddress = req.ip || req.connection?.remoteAddress;
    const userAgent = req.headers['user-agent'];

    return this.apiMessagesService.sendMassiveCpc(dto, ipAddress, userAgent);
  }
}

