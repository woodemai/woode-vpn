import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
    }>();

    const expected = this.configService.get<string>('app.admin.apiKey') ?? '';
    if (!expected) {
      throw new UnauthorizedException('Admin API is not configured');
    }

    const headerValue = request.headers?.['x-api-key'];
    const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    if (!provided || provided !== expected) {
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }
}
