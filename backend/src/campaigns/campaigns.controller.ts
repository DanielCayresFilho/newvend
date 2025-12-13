import { Controller, Get, Post, Body, Param, Delete, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import csv from 'csv-parser';
import { Readable } from 'stream';

@Controller('campaigns')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Post()
  @Roles(Role.admin, Role.supervisor)
  create(@Body() createCampaignDto: CreateCampaignDto) {
    return this.campaignsService.create(createCampaignDto);
  }

  @Post(':id/upload')
  @Roles(Role.admin, Role.supervisor)
  @UseInterceptors(FileInterceptor('file'))
  async uploadCsv(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('message') message?: string,
    @Body('useTemplate') useTemplate?: string,
    @Body('templateId') templateId?: string,
  ) {
    if (!file) {
      throw new BadRequestException('Arquivo CSV é obrigatório');
    }

    const contacts = [];
    const stream = Readable.from(file.buffer.toString());

    return new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on('data', (row) => {
          if (row.name && row.phone) {
            contacts.push({
              name: row.name,
              phone: row.phone,
              segment: row.segment ? parseInt(row.segment) : undefined,
            });
          }
        })
        .on('end', async () => {
          try {
            const result = await this.campaignsService.uploadCampaign(
              +id,
              contacts,
              message,
              useTemplate === 'true',
              templateId ? parseInt(templateId) : undefined,
            );
            resolve(result);
          } catch (error) {
            reject(error);
          }
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }

  @Get()
  @Roles(Role.admin, Role.supervisor)
  findAll() {
    return this.campaignsService.findAll();
  }

  @Get(':id')
  @Roles(Role.admin, Role.supervisor)
  findOne(@Param('id') id: string) {
    return this.campaignsService.findOne(+id);
  }

  @Get('stats/:name')
  @Roles(Role.admin, Role.supervisor)
  getStats(@Param('name') name: string) {
    return this.campaignsService.getStats(name);
  }

  @Delete(':id')
  @Roles(Role.admin, Role.supervisor)
  remove(@Param('id') id: string) {
    return this.campaignsService.remove(+id);
  }
}
