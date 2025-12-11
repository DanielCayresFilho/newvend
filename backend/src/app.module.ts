import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { PrismaService } from './prisma.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SegmentsModule } from './segments/segments.module';
import { TabulationsModule } from './tabulations/tabulations.module';
import { ContactsModule } from './contacts/contacts.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { BlocklistModule } from './blocklist/blocklist.module';
import { LinesModule } from './lines/lines.module';
import { EvolutionModule } from './evolution/evolution.module';
import { ConversationsModule } from './conversations/conversations.module';
import { WebsocketModule } from './websocket/websocket.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        username: process.env.REDIS_USERNAME,
        password: process.env.REDIS_PASSWORD,
        db: process.env.REDIS_DB ? parseInt(process.env.REDIS_DB) : undefined,
      },
    }),
    AuthModule,
    UsersModule,
    SegmentsModule,
    TabulationsModule,
    ContactsModule,
    CampaignsModule,
    BlocklistModule,
    LinesModule,
    EvolutionModule,
    ConversationsModule,
    WebsocketModule,
    WebhooksModule,
  ],
  controllers: [HealthController],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class AppModule {}
