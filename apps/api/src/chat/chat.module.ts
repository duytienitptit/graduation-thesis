import { Module } from '@nestjs/common';
import { FilesModule } from '../integrations/files/files.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { TaskModule } from '../task/task.module.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';

@Module({
  imports: [FilesModule, RealtimeModule, TaskModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
