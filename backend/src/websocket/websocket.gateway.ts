import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import axios from 'axios';

@WebSocketGateway({
  cors: {
    origin: (origin, callback) => {
      const allowedOrigins = process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
        : ['http://localhost:5173', 'http://localhost:3001'];
      
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  },
})
export class WebsocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private connectedUsers: Map<number, string> = new Map();

  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private conversationsService: ConversationsService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token || client.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user) {
        client.disconnect();
        return;
      }

      client.data.user = user;
      this.connectedUsers.set(user.id, client.id);

      console.log(`✅ Usuário ${user.name} (${user.role}) conectado via WebSocket`);

      // Enviar conversas ativas ao conectar (apenas para operators)
      if (user.role === 'operator' && user.line) {
        const activeConversations = await this.conversationsService.findActiveConversations(user.line);
        client.emit('active-conversations', activeConversations);
      }
    } catch (error) {
      console.error('Erro na autenticação WebSocket:', error);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    if (client.data.user) {
      this.connectedUsers.delete(client.data.user.id);
      console.log(`❌ Usuário ${client.data.user.name} desconectado do WebSocket`);
    }
  }

  @SubscribeMessage('send-message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { contactPhone: string; message: string; messageType?: string; mediaUrl?: string },
  ) {
    console.log(`📤 [WebSocket] Recebido send-message:`, JSON.stringify(data, null, 2));
    
    const user = client.data.user;
    console.log(`👤 [WebSocket] Usuário: ${user?.name}, role: ${user?.role}, line: ${user?.line}`);

    if (!user || !user.line) {
      console.error('❌ [WebSocket] Usuário não autenticado ou sem linha');
      return { error: 'Usuário não autenticado ou sem linha atribuída' };
    }

    try {
      // Buscar linha do usuário
      const line = await this.prisma.linesStock.findUnique({
        where: { id: user.line },
      });

      if (!line || line.lineStatus !== 'active') {
        return { error: 'Linha não disponível' };
      }

      const evolution = await this.prisma.evolution.findUnique({
        where: { evolutionName: line.evolutionName },
      });
      const instanceName = `line_${line.phone.replace(/\D/g, '')}`;

      // Enviar mensagem via Evolution API
      let apiResponse;

      if (data.messageType === 'image' && data.mediaUrl) {
        apiResponse = await axios.post(
          `${evolution.evolutionUrl}/message/sendMedia/${instanceName}`,
          {
            number: data.contactPhone.replace(/\D/g, ''),
            mediaUrl: data.mediaUrl,
            caption: data.message,
          },
          {
            headers: { 'apikey': evolution.evolutionKey },
          }
        );
      } else if (data.messageType === 'document' && data.mediaUrl) {
        apiResponse = await axios.post(
          `${evolution.evolutionUrl}/message/sendMedia/${instanceName}`,
          {
            number: data.contactPhone.replace(/\D/g, ''),
            mediaUrl: data.mediaUrl,
          },
          {
            headers: { 'apikey': evolution.evolutionKey },
          }
        );
      } else {
        apiResponse = await axios.post(
          `${evolution.evolutionUrl}/message/sendText/${instanceName}`,
          {
            number: data.contactPhone.replace(/\D/g, ''),
            text: data.message,
          },
          {
            headers: { 'apikey': evolution.evolutionKey },
          }
        );
      }

      // Buscar contato
      const contact = await this.prisma.contact.findFirst({
        where: { phone: data.contactPhone },
      });

      // Salvar conversa
      const conversation = await this.conversationsService.create({
        contactName: contact?.name || 'Desconhecido',
        contactPhone: data.contactPhone,
        segment: user.segment,
        userName: user.name,
        userLine: user.line,
        message: data.message,
        sender: 'operator',
        messageType: data.messageType || 'text',
        mediaUrl: data.mediaUrl,
      });

      console.log(`✅ [WebSocket] Mensagem salva no banco, ID: ${conversation.id}`);
      
      // Emitir mensagem para o usuário (usar mesmo formato que new_message)
      client.emit('message-sent', { message: conversation });
      console.log(`📤 [WebSocket] Emitido message-sent para o cliente`);

      // Se houver supervisores online do mesmo segmento, enviar para eles também
      this.emitToSupervisors(user.segment, 'new_message', { message: conversation });

      return { success: true, conversation };
    } catch (error) {
      console.error('❌ [WebSocket] Erro ao enviar mensagem:', error.response?.data || error.message);
      return { error: `Erro ao enviar mensagem: ${error.message}` };
    }
  }

  @SubscribeMessage('typing')
  async handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { contactPhone: string; typing: boolean },
  ) {
    // Emitir evento de digitação para outros usuários
    client.broadcast.emit('user-typing', {
      contactPhone: data.contactPhone,
      typing: data.typing,
    });
  }

  // Método para emitir mensagens recebidas via webhook
  async emitNewMessage(conversation: any) {
    console.log(`📤 Emitindo new_message para contactPhone: ${conversation.contactPhone}`);
    
    // Emitir para o operador responsável
    if (conversation.userLine) {
      const users = await this.prisma.user.findMany({
        where: { line: conversation.userLine },
      });

      users.forEach(user => {
        const socketId = this.connectedUsers.get(user.id);
        if (socketId) {
          console.log(`  → Enviando para ${user.name} (${user.role})`);
          // Usar underscore para corresponder ao frontend: new_message
          this.server.to(socketId).emit('new_message', { message: conversation });
        }
      });
    }

    // Emitir para supervisores do segmento
    if (conversation.segment) {
      this.emitToSupervisors(conversation.segment, 'new_message', { message: conversation });
    }
  }

  private async emitToSupervisors(segment: number, event: string, data: any) {
    const supervisors = await this.prisma.user.findMany({
      where: {
        role: 'supervisor',
        segment,
      },
    });

    supervisors.forEach(supervisor => {
      const socketId = this.connectedUsers.get(supervisor.id);
      if (socketId) {
        this.server.to(socketId).emit(event, data);
      }
    });
  }

  // Emitir atualização de conversa tabulada
  async emitConversationTabulated(contactPhone: string, tabulationId: number) {
    this.server.emit('conversation-tabulated', { contactPhone, tabulationId });
  }
}
