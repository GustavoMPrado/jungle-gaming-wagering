import { randomUUID } from 'node:crypto';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';

import { MetricsService } from '../../infrastructure/observability/metrics.service.js';

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  public constructor(
    private readonly metrics: MetricsService,
  ) {}

  public intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const correlationHeader = request.header('x-correlation-id');

    const correlationId =
      correlationHeader?.trim() || randomUUID();

    response.setHeader('X-Correlation-ID', correlationId);

    const startedAt = performance.now();

    const log = (level: string, statusCode: number): void => {
      const durationMs = Math.round(
        performance.now() - startedAt,
      );

      this.metrics.increment('http_requests_total');
      this.metrics.increment(`http_status_${statusCode}_total`);
      this.metrics.observeDuration(
        'http_request_duration_ms',
        durationMs,
      );

      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        event: 'http_request_completed',
        correlationId,
        method: request.method,
        route: request.route?.path ?? request.path,
        statusCode,
        durationMs,
      }));
    };

    return next.handle().pipe(
      tap({
        next: () => log('info', response.statusCode),
        error: (error: unknown) => {
          const statusCode =
            error !== null &&
            typeof error === 'object' &&
            'getStatus' in error &&
            typeof error.getStatus === 'function'
              ? error.getStatus() as number
              : 500;

          log('error', statusCode);
        },
      }),
    );
  }
}
