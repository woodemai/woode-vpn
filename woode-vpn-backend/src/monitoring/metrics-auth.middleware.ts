import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';

@Injectable()
export class MetricsAuthMiddleware implements NestMiddleware {
    constructor(private readonly configService: ConfigService) { }

    use(request: Request, response: Response, next: NextFunction): void {
        const nodeEnv = this.configService.get<string>('NODE_ENV') ?? 'development';
        if (nodeEnv !== 'production') {
            next();
            return;
        }

        const expectedApiKey =
            this.configService.get<string>('METRICS_API_KEY') ?? '';
        if (!expectedApiKey) {
            response.status(404).send('Not found');
            return;
        }

        const providedApiKey = request.header('x-metrics-key') ?? '';
        if (providedApiKey !== expectedApiKey) {
            response.status(401).send('Unauthorized');
            return;
        }

        next();
    }
}
