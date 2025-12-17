import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { WebsocketGateway } from './websocket.gateway';
import { PrismaService } from '../prisma.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { ControlPanelModule } from '../control-panel/control-panel.module';
import { MediaModule } from '../media/media.module';
import { LinesModule } from '../lines/lines.module';
import { SystemEventsModule } from '../system-events/system-events.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
      }),
    }),
    ConversationsModule,
    ControlPanelModule,
    MediaModule,
    forwardRef(() => LinesModule),
    SystemEventsModule,
  ],
  providers: [WebsocketGateway, PrismaService],
  exports: [WebsocketGateway],
})
export class WebsocketModule {}
