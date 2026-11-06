import { OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { AuthPort } from '../integrations/auth/auth.port.js';

const userRoom = (userId: string) => `user:${userId}`;

/** The shared gateway. Modules push to users through emitToUser. */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit {
  @WebSocketServer()
  private readonly server!: Server;

  constructor(private readonly auth: AuthPort) {}

  afterInit(server: Server) {
    server.use(async (socket, next) => {
      const token: unknown = socket.handshake.auth.token;
      const user = typeof token === 'string' ? await this.auth.verifyToken(token) : null;
      if (!user) return next(new Error('unauthorized'));

      socket.data.user = user;
      // Joined here, not on connection, so nothing sent right after connect is missed.
      await socket.join(userRoom(user.id));
      next();
    });
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server.to(userRoom(userId)).emit(event, payload);
  }
}
