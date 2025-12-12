import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ApiLogFilterDto } from './dto/api-log-filter.dto';

@Injectable()
export class ApiLogsService {
  constructor(private prisma: PrismaService) {}

  async createLog(data: {
    endpoint: string;
    method: string;
    requestPayload: any;
    responsePayload: any;
    statusCode: number;
    ipAddress?: string;
    userAgent?: string;
  }) {
    return this.prisma.apiLog.create({
      data: {
        endpoint: data.endpoint,
        method: data.method,
        requestPayload: JSON.stringify(data.requestPayload),
        responsePayload: JSON.stringify(data.responsePayload),
        statusCode: data.statusCode,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      },
    });
  }

  async findAll(filters: ApiLogFilterDto) {
    const whereClause: any = {};

    if (filters.endpoint) {
      whereClause.endpoint = { contains: filters.endpoint, mode: 'insensitive' };
    }

    if (filters.method) {
      whereClause.method = filters.method;
    }

    if (filters.statusCode) {
      whereClause.statusCode = filters.statusCode;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.createdAt = {};
      if (filters.startDate) {
        whereClause.createdAt.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        whereClause.createdAt.lte = new Date(filters.endDate);
      }
    }

    return this.prisma.apiLog.findMany({
      where: whereClause,
      orderBy: {
        createdAt: 'desc',
      },
      take: 1000, // Limitar a 1000 registros por padrão
    });
  }

  async findOne(id: number) {
    return this.prisma.apiLog.findUnique({
      where: { id },
    });
  }
}

