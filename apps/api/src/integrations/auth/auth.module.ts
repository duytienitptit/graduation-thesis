import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthGuard, RolesGuard } from './auth.guards.js';
import { AuthPort } from './auth.port.js';
import { DevAuthController, DevOnlyGuard } from './dev-auth.controller.js';
import { DevAuthService } from './dev-auth.service.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('AUTH_JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [DevAuthController],
  providers: [
    DevAuthService,
    DevOnlyGuard,
    { provide: AuthPort, useExisting: DevAuthService },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthPort],
})
export class AuthModule {}
