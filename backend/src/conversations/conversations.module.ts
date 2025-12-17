import { Module, forwardRef } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { AutoMessageService } from './auto-message.service';
import { PrismaService } from '../prisma.service';
import { ControlPanelModule } from '../control-panel/control-panel.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ControlPanelModule,
    forwardRef(() => WebsocketModule),
  ],
  controllers: [ConversationsController],
  providers: [ConversationsService, AutoMessageService, PrismaService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
