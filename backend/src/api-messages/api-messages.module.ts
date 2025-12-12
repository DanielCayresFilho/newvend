import { Module } from '@nestjs/common';
import { ApiMessagesService } from './api-messages.service';
import { ApiMessagesController } from './api-messages.controller';
import { PrismaService } from '../prisma.service';
import { TagsModule } from '../tags/tags.module';
import { ApiLogsModule } from '../api-logs/api-logs.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { ContactsModule } from '../contacts/contacts.module';

@Module({
  imports: [TagsModule, ApiLogsModule, ConversationsModule, ContactsModule],
  controllers: [ApiMessagesController],
  providers: [ApiMessagesService, PrismaService],
})
export class ApiMessagesModule {}

