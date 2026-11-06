import {
  Body,
  CanActivate,
  Controller,
  Get,
  HttpCode,
  Injectable,
  NotFoundException,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsEmail } from 'class-validator';
import { CurrentUser, Public } from './auth.decorators.js';
import { AuthUser } from './auth.port.js';
import { DevAuthService } from './dev-auth.service.js';

class DevLoginDto {
  @IsEmail()
  email!: string;
}

/** Password-free login must never exist outside development. */
@Injectable()
export class DevOnlyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate() {
    if (this.config.get('NODE_ENV') === 'production') throw new NotFoundException();
    return true;
  }
}

@Controller('auth')
export class DevAuthController {
  constructor(private readonly auth: DevAuthService) {}

  @Public()
  @UseGuards(DevOnlyGuard)
  @Get('dev-users')
  users() {
    return this.auth.listUsers();
  }

  @Public()
  @UseGuards(DevOnlyGuard)
  @Post('dev-login')
  @HttpCode(200)
  async login(@Body() body: DevLoginDto) {
    const session = await this.auth.login(body.email);
    if (!session) throw new UnauthorizedException();
    return session;
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
