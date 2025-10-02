# Storywink Monorepo Optimization Plan - June 8, 2025

## Executive Summary

This document outlines high-impact optimization opportunities identified during the monorepo import architecture cleanup. Each optimization includes context, current state analysis, implementation approach, and expected benefits. The optimizations are prioritized by impact and complexity.

## Priority 1: Type-Safe Database Layer

### Current State
- Prisma generates types, but they're not consistently used across the codebase
- Many API responses use `any` types or manual type definitions
- Database query results often lose type safety when passed between layers
- No standardized approach to handling Prisma's generated types

### Investigation Starting Points
```bash
# Find type safety issues in database queries
grep -r "as any\|: any" apps/ --include="*.ts" --include="*.tsx"

# Check for manual type definitions that duplicate Prisma types
grep -r "interface.*Book\|interface.*Page\|interface.*User" apps/ --include="*.ts"

# Find Prisma query results without proper typing
grep -r "await prisma\." apps/ --include="*.ts" | grep -v "satisfies\|as \w"
```

### Implementation Plan

#### Step 1: Create Type-Safe Database Service Layer
Create `packages/database/src/services/` with typed query functions:

```typescript
// packages/database/src/services/bookService.ts
import { Prisma, Book, Page } from '@prisma/client';
import { prisma } from '../client';

// Define reusable includes
const bookWithPages = Prisma.validator<Prisma.BookArgs>()({
  include: {
    pages: {
      orderBy: { pageNumber: 'asc' },
      include: {
        asset: {
          select: {
            id: true,
            url: true,
            thumbnailUrl: true,
          },
        },
      },
    },
  },
});

// Export the type for use in other files
export type BookWithPages = Prisma.BookGetPayload<typeof bookWithPages>;

export const bookService = {
  async findByUser(userId: string): Promise<BookWithPages[]> {
    return prisma.book.findMany({
      where: { userId },
      ...bookWithPages,
      orderBy: { updatedAt: 'desc' },
    });
  },
  
  async findById(id: string, userId: string): Promise<BookWithPages | null> {
    return prisma.book.findFirst({
      where: { id, userId },
      ...bookWithPages,
    });
  },
};
```

#### Step 2: Update API Routes to Use Service Layer
Replace direct Prisma calls with service layer:

```typescript
// Before (apps/api/src/routes/books.ts)
const books = await prisma.book.findMany({
  where: { userId },
  include: { pages: { /* ... */ } },
});

// After
import { bookService } from '@storywink/database/services';
const books = await bookService.findByUser(userId);
```

#### Step 3: Export Database Types from Shared Package
Add to `packages/shared/src/types.ts`:

```typescript
// Re-export Prisma types with proper constraints
export type { 
  Book, 
  Page, 
  User, 
  Asset,
  BookStatus,
  PageType 
} from '@storywink/database';

// Export service types
export type { 
  BookWithPages,
  PageWithAsset,
  UserWithProfile 
} from '@storywink/database/services';
```

### Expected Benefits
- Compile-time type safety for all database operations
- Reduced runtime errors from type mismatches
- Better IDE autocomplete and refactoring support
- Centralized query logic for easier optimization
- Consistent data shapes across the application

## Priority 2: Centralized Error Handling

### Current State
- Inconsistent error handling across services
- No standardized error types or codes
- API errors return different formats
- Limited error context for debugging
- No correlation between frontend and backend errors

### Investigation Starting Points
```bash
# Find different error handling patterns
grep -r "catch.*error" apps/ --include="*.ts" -A 3

# Find manual error responses
grep -r "res\.status.*json" apps/api --include="*.ts"

# Check for error logging inconsistencies
grep -r "console\.error\|logger\.error" apps/ --include="*.ts"
```

### Implementation Plan

#### Step 1: Create Shared Error Types
Add to `packages/shared/src/errors.ts`:

```typescript
export enum ErrorCode {
  // Authentication errors
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  
  // Validation errors
  INVALID_INPUT = 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  
  // Resource errors
  NOT_FOUND = 'NOT_FOUND',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  
  // System errors
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  RATE_LIMITED = 'RATE_LIMITED',
}

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public statusCode: number = 500,
    public context?: Record<string, any>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(
    message: string,
    public fields?: Record<string, string[]>
  ) {
    super(ErrorCode.INVALID_INPUT, message, 400, { fields });
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      ErrorCode.NOT_FOUND,
      `${resource} not found${id ? `: ${id}` : ''}`,
      404
    );
  }
}
```

#### Step 2: Create Error Handling Middleware
Add to `apps/api/src/middleware/error-handler.ts`:

```typescript
import { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@storywink/shared';
import { ZodError } from 'zod';
import logger from '../lib/logger';

export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Log error with context
  logger.error({
    err: error,
    req: {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body,
    },
    userId: (req as any).dbUser?.id,
  });

  // Handle known error types
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        context: error.context,
      },
    });
  }

  if (error instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.INVALID_INPUT,
        message: 'Validation failed',
        context: {
          fields: error.errors.reduce((acc, err) => {
            const path = err.path.join('.');
            if (!acc[path]) acc[path] = [];
            acc[path].push(err.message);
            return acc;
          }, {} as Record<string, string[]>),
        },
      },
    });
  }

  // Handle Prisma errors
  if (error.constructor.name === 'PrismaClientKnownRequestError') {
    const prismaError = error as any;
    if (prismaError.code === 'P2002') {
      return res.status(409).json({
        success: false,
        error: {
          code: ErrorCode.ALREADY_EXISTS,
          message: 'Resource already exists',
        },
      });
    }
  }

  // Default error response
  res.status(500).json({
    success: false,
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
    },
  });
}
```

#### Step 3: Create Frontend Error Handler
Add to `apps/web/src/lib/error-handler.ts`:

```typescript
import { ErrorCode, AppError } from '@storywink/shared';
import { toast } from 'sonner';
import logger from './logger';

export function handleApiError(error: any, context?: string) {
  logger.error('API Error', { error, context });

  // Handle known error codes
  if (error.code === ErrorCode.UNAUTHORIZED) {
    toast.error('Please sign in to continue');
    // Redirect to login
    return;
  }

  if (error.code === ErrorCode.RATE_LIMITED) {
    toast.error('Too many requests. Please try again later.');
    return;
  }

  if (error.code === ErrorCode.VALIDATION_ERROR && error.context?.fields) {
    const fieldErrors = Object.entries(error.context.fields)
      .map(([field, errors]) => `${field}: ${errors.join(', ')}`)
      .join('\n');
    toast.error(`Validation failed:\n${fieldErrors}`);
    return;
  }

  // Default error message
  toast.error(error.message || 'Something went wrong. Please try again.');
}
```

### Expected Benefits
- Consistent error responses across all APIs
- Better error context for debugging
- Improved user experience with clear error messages
- Centralized error logging with correlation IDs
- Easier to implement retry logic and error recovery

## Priority 3: Shared Validation Layer

### Current State
- Zod schemas scattered across different apps
- Duplicate validation logic between frontend and backend
- No shared validation for common patterns (email, phone, etc.)
- Inconsistent validation error messages

### Investigation Starting Points
```bash
# Find all Zod schema definitions
grep -r "z\." apps/ --include="*.ts" | grep -E "object|string|number|boolean"

# Find duplicate schemas
grep -r "Schema.*=.*z\.object" apps/ --include="*.ts"

# Check for validation in multiple places
grep -r "email.*@.*\.com\|phone.*[0-9]" apps/ --include="*.ts"
```

### Implementation Plan

#### Step 1: Centralize All Schemas
Move all schemas to `packages/shared/src/schemas/`:

```typescript
// packages/shared/src/schemas/common.ts
import { z } from 'zod';

// Reusable field validators
export const email = z.string().email('Invalid email address');
export const url = z.string().url('Invalid URL');
export const nonEmptyString = z.string().min(1, 'This field is required');
export const positiveInt = z.number().int().positive();

// Common patterns
export const pagination = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

export const dateRange = z.object({
  startDate: z.date(),
  endDate: z.date(),
}).refine(data => data.endDate >= data.startDate, {
  message: 'End date must be after start date',
});
```

```typescript
// packages/shared/src/schemas/book.ts
import { z } from 'zod';
import { nonEmptyString, positiveInt } from './common';

export const createBookSchema = z.object({
  childName: nonEmptyString.max(50),
  pageLength: z.enum(['8', '12', '16']).transform(Number),
  artStyle: z.string().optional(),
  tone: z.string().optional(),
  theme: z.string().optional(),
  isWinkifyEnabled: z.boolean().default(false),
  assetIds: z.array(z.string().uuid()).min(1, 'At least one photo is required'),
});

export const updateBookSchema = createBookSchema.partial();

// Validation helpers
export function validateBookTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length < 3) {
    throw new Error('Title must be at least 3 characters');
  }
  if (trimmed.length > 100) {
    throw new Error('Title must be less than 100 characters');
  }
  return trimmed;
}
```

#### Step 2: Create Validation Middleware
Add to `apps/api/src/middleware/validate.ts`:

```typescript
import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { ValidationError } from '@storywink/shared';

export function validate(schema: ZodSchema) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = await schema.parseAsync(req.body);
      req.body = validated;
      next();
    } catch (error) {
      next(new ValidationError('Validation failed', error.errors));
    }
  };
}

export function validateQuery(schema: ZodSchema) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = await schema.parseAsync(req.query);
      req.query = validated;
      next();
    } catch (error) {
      next(new ValidationError('Invalid query parameters', error.errors));
    }
  };
}
```

#### Step 3: Create Frontend Validation Hooks
Add to `apps/web/src/hooks/useValidation.ts`:

```typescript
import { useState, useCallback } from 'react';
import { ZodSchema, ZodError } from 'zod';

export function useValidation<T>(schema: ZodSchema<T>) {
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const validate = useCallback(async (data: unknown): Promise<T | null> => {
    try {
      const validated = await schema.parseAsync(data);
      setErrors({});
      return validated;
    } catch (error) {
      if (error instanceof ZodError) {
        const fieldErrors = error.errors.reduce((acc, err) => {
          const path = err.path.join('.');
          if (!acc[path]) acc[path] = [];
          acc[path].push(err.message);
          return acc;
        }, {} as Record<string, string[]>);
        setErrors(fieldErrors);
      }
      return null;
    }
  }, [schema]);

  const clearErrors = useCallback(() => setErrors({}), []);

  return { validate, errors, clearErrors };
}
```

### Expected Benefits
- Single source of truth for all validation logic
- Consistent validation between frontend and backend
- Better error messages for users
- Reduced code duplication
- Type-safe validation with proper inference

## Priority 4: Unified Logging System

### Current State
- Different logging approaches in each service
- Console.log still used in many places
- No structured logging format
- No log correlation across services
- Limited log aggregation capabilities

### Investigation Starting Points
```bash
# Find all logging patterns
grep -r "console\.\|logger\." apps/ --include="*.ts" | cut -d: -f1 | sort -u

# Check for different logger imports
grep -r "import.*logger" apps/ --include="*.ts"

# Find unstructured logging
grep -r "console\.log\|console\.error" apps/ --include="*.ts" | wc -l
```

### Implementation Plan

#### Step 1: Create Shared Logger Configuration
Add to `packages/shared/src/logger/`:

```typescript
// packages/shared/src/logger/config.ts
import pino from 'pino';

export interface LogContext {
  service: string;
  environment: string;
  version?: string;
  requestId?: string;
  userId?: string;
  [key: string]: any;
}

export const createLogger = (context: LogContext) => {
  return pino({
    level: process.env.LOG_LEVEL || 'info',
    formatters: {
      level: (label) => ({ level: label }),
    },
    base: context,
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
      err: pino.stdSerializers.err,
    },
    // Pretty print in development
    transport: process.env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            ignore: 'pid,hostname',
            translateTime: 'SYS:standard',
          },
        }
      : undefined,
  });
};

// Correlation ID middleware
export function correlationId() {
  return (req: any, res: any, next: any) => {
    req.id = req.headers['x-request-id'] || crypto.randomUUID();
    res.setHeader('x-request-id', req.id);
    next();
  };
}
```

#### Step 2: Service-Specific Logger Setup
Update each service's logger:

```typescript
// apps/api/src/lib/logger.ts
import { createLogger } from '@storywink/shared/logger';

export const logger = createLogger({
  service: 'api',
  environment: process.env.NODE_ENV || 'development',
  version: process.env.npm_package_version,
});

// Request-scoped logger
export function createRequestLogger(req: any) {
  return logger.child({
    requestId: req.id,
    userId: req.dbUser?.id,
    method: req.method,
    path: req.path,
  });
}
```

#### Step 3: Structured Logging Patterns
Create logging utilities:

```typescript
// packages/shared/src/logger/utils.ts
export function logDatabaseQuery(logger: any, operation: string, duration: number, result?: any) {
  logger.debug({
    type: 'database_query',
    operation,
    duration_ms: duration,
    result_count: Array.isArray(result) ? result.length : result ? 1 : 0,
  });
}

export function logApiCall(logger: any, service: string, method: string, duration: number, status: number) {
  logger.info({
    type: 'api_call',
    service,
    method,
    duration_ms: duration,
    status,
  });
}

export function logJobProcessing(logger: any, jobType: string, jobId: string, status: 'started' | 'completed' | 'failed', duration?: number, error?: any) {
  const level = status === 'failed' ? 'error' : 'info';
  logger[level]({
    type: 'job_processing',
    job_type: jobType,
    job_id: jobId,
    status,
    duration_ms: duration,
    error,
  });
}
```

### Expected Benefits
- Structured logs for better querying and analysis
- Correlation IDs to trace requests across services
- Consistent log format for easier parsing
- Performance metrics built into logging
- Better debugging with contextual information

## Priority 5: Performance Monitoring

### Current State
- No systematic performance monitoring
- Database queries not optimized or tracked
- No visibility into slow API endpoints
- Missing metrics for queue processing times
- No frontend performance tracking

### Investigation Starting Points
```bash
# Find potential N+1 queries
grep -r "await.*map.*async" apps/ --include="*.ts"

# Check for missing database indexes
grep -r "where:.*{" apps/ --include="*.ts" -A 3

# Find large data transfers
grep -r "findMany\|findFirst" apps/ --include="*.ts" | grep -v "take:\|limit:"
```

### Implementation Plan

#### Step 1: Add Database Query Monitoring
Extend Prisma client:

```typescript
// packages/database/src/client.ts
import { PrismaClient } from '@prisma/client';
import { logger } from '@storywink/shared/logger';

const prisma = new PrismaClient({
  log: [
    {
      emit: 'event',
      level: 'query',
    },
  ],
});

// Log slow queries
prisma.$on('query', (e) => {
  if (e.duration > 100) {
    logger.warn({
      type: 'slow_query',
      query: e.query,
      params: e.params,
      duration_ms: e.duration,
      target: e.target,
    });
  }
});

// Add query timing
export const timedPrisma = new Proxy(prisma, {
  get(target, property) {
    const original = target[property];
    if (typeof original === 'object' && original !== null) {
      return new Proxy(original, {
        get(innerTarget, innerProperty) {
          const innerOriginal = innerTarget[innerProperty];
          if (typeof innerOriginal === 'function') {
            return async (...args) => {
              const start = performance.now();
              try {
                const result = await innerOriginal.apply(innerTarget, args);
                const duration = performance.now() - start;
                logDatabaseQuery(logger, `${property}.${innerProperty}`, duration, result);
                return result;
              } catch (error) {
                const duration = performance.now() - start;
                logDatabaseQuery(logger, `${property}.${innerProperty}`, duration);
                throw error;
              }
            };
          }
          return innerOriginal;
        },
      });
    }
    return original;
  },
});

export default timedPrisma;
```

#### Step 2: API Performance Middleware
Add to `apps/api/src/middleware/performance.ts`:

```typescript
import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

export function performanceMonitoring(req: Request, res: Response, next: NextFunction) {
  const start = performance.now();
  
  // Capture response
  const originalSend = res.send;
  res.send = function(data) {
    const duration = performance.now() - start;
    
    logger.info({
      type: 'api_request',
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: duration,
      response_size: Buffer.byteLength(data),
      user_agent: req.headers['user-agent'],
    });
    
    // Add performance headers
    res.setHeader('X-Response-Time', `${duration}ms`);
    
    return originalSend.call(this, data);
  };
  
  next();
}
```

#### Step 3: Frontend Performance Tracking
Add to `apps/web/src/lib/performance.ts`:

```typescript
import { logger } from './logger';

// Track component render times
export function measureComponentPerformance(componentName: string) {
  return function decorator(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = function(...args: any[]) {
      const start = performance.now();
      const result = originalMethod.apply(this, args);
      const duration = performance.now() - start;
      
      if (duration > 16) { // Log if render takes more than one frame
        logger.warn({
          type: 'slow_render',
          component: componentName,
          method: propertyKey,
          duration_ms: duration,
        });
      }
      
      return result;
    };
  };
}

// Track API call performance
export async function trackApiCall<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const duration = performance.now() - start;
    
    logger.debug({
      type: 'api_call',
      name,
      duration_ms: duration,
      success: true,
    });
    
    return result;
  } catch (error) {
    const duration = performance.now() - start;
    
    logger.error({
      type: 'api_call',
      name,
      duration_ms: duration,
      success: false,
      error,
    });
    
    throw error;
  }
}
```

### Expected Benefits
- Identify performance bottlenecks early
- Track performance trends over time
- Optimize slow database queries
- Improve user experience with faster responses
- Data-driven performance improvements

## Implementation Priority Matrix

| Optimization | Impact | Complexity | Dependencies | Recommended Order |
|--------------|--------|------------|--------------|-------------------|
| Type-Safe Database | High | Medium | None | 1st |
| Error Handling | High | Low | None | 2nd |
| Validation Layer | Medium | Low | Error Handling | 3rd |
| Logging System | High | Medium | None | 4th (parallel) |
| Performance Monitoring | Medium | High | Logging | 5th |

## Success Metrics

### Type-Safe Database
- Zero runtime type errors in production
- 50% reduction in database-related bugs
- Improved developer velocity with better autocomplete

### Error Handling
- 100% of errors follow standard format
- 90% reduction in generic error messages
- Clear error tracking and debugging

### Validation Layer
- Zero validation logic duplication
- 100% consistent validation between frontend/backend
- 80% reduction in validation-related bugs

### Logging System
- 100% structured logging adoption
- < 5 minute mean time to trace issues
- Complete request tracing across services

### Performance Monitoring
- < 100ms p95 API response time
- < 50ms p95 database query time
- Proactive performance issue detection

## Migration Strategy

1. **Start with new code**: Apply patterns to new features first
2. **Gradual migration**: Update existing code during regular maintenance
3. **Automated tooling**: Create codemods for common transformations
4. **Team training**: Document patterns and provide examples
5. **Monitoring**: Track adoption and impact metrics

## Conclusion

These optimizations will significantly improve the codebase's maintainability, reliability, and performance. The modular approach allows for incremental implementation without disrupting ongoing development. Each optimization builds upon the centralized architecture established in the import cleanup, creating a robust and scalable foundation for future growth.