import {
    CallHandler,
    ExecutionContext,
    Injectable,
    Logger,
    NestInterceptor,
} from '@nestjs/common';
import { Histogram, Counter } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import {
    HTTP_REQUEST_DURATION_MS,
    HTTP_REQUESTS_TOTAL,
} from './metrics.constants';

type RequestLike = {
    method?: string;
    baseUrl?: string;
    route?: { path?: string };
    path?: string;
    url?: string;
};

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
    private readonly logger = new Logger(HttpMetricsInterceptor.name);

    constructor(
        @InjectMetric(HTTP_REQUESTS_TOTAL)
        private readonly requestsCounter: Counter<string>,
        @InjectMetric(HTTP_REQUEST_DURATION_MS)
        private readonly requestDurationHistogram: Histogram<string>,
    ) { }

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        if (context.getType<'http'>() !== 'http') {
            return next.handle();
        }

        const startedAt = process.hrtime.bigint();
        const httpContext = context.switchToHttp();
        const request = httpContext.getRequest<RequestLike>();
        const response = httpContext.getResponse<{ statusCode?: number }>();

        const method = request.method ?? 'UNKNOWN';
        const route = this.normalizeRoute(request);

        if (route === '/api') {
            return next.handle();
        }

        return next.handle().pipe(
            finalize(() => {
                const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
                const status = String(response.statusCode ?? 500);

                this.requestsCounter.inc({ method, route, status });
                this.requestDurationHistogram.observe(
                    { method, route, status },
                    durationMs,
                );

                this.logger.log(
                    `[HTTP] ${method} ${route} ${status} - ${Math.round(durationMs)}ms`,
                );
            }),
        );
    }

    private normalizeRoute(request: RequestLike): string {
        const baseUrl = request.baseUrl ?? '';
        const routePath = request.route?.path;

        if (routePath) {
            return this.normalizeSlashes(`${baseUrl}/${routePath}`);
        }

        const fallbackPath = request.path ?? request.url ?? '/unknown';
        if (fallbackPath.startsWith('/sub/')) {
            return '/sub/:token';
        }

        return this.normalizeSlashes(fallbackPath);
    }

    private normalizeSlashes(path: string): string {
        const normalized = path.replace(/\/+/g, '/');
        return normalized.startsWith('/') ? normalized : `/${normalized}`;
    }
}
