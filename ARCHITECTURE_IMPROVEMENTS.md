# Storywink.ai Architecture Improvements Plan

## Overview
This document outlines the architectural improvements for Storywink.ai to create a more robust, scalable, and maintainable system.

## Current State Analysis

### Architecture Overview
- **Frontend**: Next.js 15 with App Router, mix of server actions and API routes
- **Backend**: Express.js API server (partially integrated)
- **Queue System**: BullMQ with Redis for async job processing
- **Database**: PostgreSQL with Prisma ORM
- **Real-time Updates**: Client-side polling (inefficient)

### Key Issues
1. **Inconsistent Data Patterns**: Mix of server actions and API routes
2. **No Real-time Updates**: Relies on polling for status updates
3. **Limited Error Recovery**: Failed jobs lack proper retry mechanisms
4. **No Progress Tracking**: Can't see detailed progress of operations
5. **Missing Observability**: Limited logging and monitoring

## Implementation Phases

### Phase 1: Fix Critical Issues (Immediate)
**Timeline**: 1-2 days
**Goal**: Get the system working correctly

#### Tasks:
1. **Fix Library Data Fetching**
   - Update library page to use server actions
   - Remove incorrect API client usage
   - Ensure consistent data flow

2. **Fix Book Finalization**
   - Correct status enum case mismatch
   - Add comprehensive logging
   - Verify parent-child job relationships

3. **Improve Error Handling**
   - Add proper error boundaries
   - Implement graceful fallbacks
   - Better error messages for users

### Phase 2: Improve Robustness (Current Sprint)
**Timeline**: 3-5 days
**Goal**: Make the system more reliable and responsive

#### Tasks:
1. **Implement Server-Sent Events (SSE)**
   ```typescript
   // New endpoint: /api/book/[bookId]/status/stream
   // Provides real-time status updates without polling
   ```

2. **Add Progress Tracking**
   ```typescript
   interface BookProgress {
     status: BookStatus;
     storyGeneration: {
       started: boolean;
       completed: boolean;
       error?: string;
     };
     illustrations: {
       total: number;
       completed: number;
       failed: number;
       inProgress: number;
     };
   }
   ```

3. **Enhanced Job Retry Logic**
   - Exponential backoff for failed jobs
   - Partial retry capability (retry only failed illustrations)
   - Dead letter queue for persistent failures

4. **Centralized Status Service**
   ```typescript
   class BookStatusService {
     static async updateStatus(bookId: string, update: StatusUpdate);
     static async getDetailedStatus(bookId: string): BookProgress;
     static async subscribeToUpdates(bookId: string, callback: Function);
   }
   ```

### Phase 3: Enhanced Features (Next Month)
**Timeline**: 2-3 weeks
**Goal**: Add advanced features for better UX and scalability

#### Tasks:
1. **WebSocket Integration**
   - Real-time bidirectional communication
   - Instant updates across all connected clients
   - Reduced server load from polling

2. **Advanced Queue Management**
   - Priority queues for premium users
   - Queue visualization dashboard
   - Job scheduling and batch processing

3. **Comprehensive Monitoring**
   - Application Performance Monitoring (APM)
   - Custom metrics dashboard
   - Alert system for failures

4. **API Standardization**
   - RESTful API design
   - OpenAPI documentation
   - Rate limiting and quota management

### Phase 4: Scale and Optimize (Future)
**Timeline**: Ongoing
**Goal**: Prepare for growth and scale

#### Tasks:
1. **Microservices Architecture**
   - Separate services for story generation, illustration, PDF generation
   - Independent scaling of services
   - Service mesh for communication

2. **Caching Strategy**
   - Redis caching for frequently accessed data
   - CDN for static assets
   - Edge caching for API responses

3. **Database Optimization**
   - Read replicas for scaling reads
   - Partitioning for large tables
   - Query optimization

## Technical Decisions

### Data Fetching Strategy
**Recommendation**: Stick with Server Actions for internal use
- **Pros**: Type-safe, simple, efficient
- **Cons**: Not suitable for external API consumers
- **Migration Path**: If external API needed, create separate API layer

### Real-time Updates
**Recommendation**: Start with SSE, migrate to WebSockets if needed
- **SSE**: Simpler, one-way communication, perfect for status updates
- **WebSockets**: More complex, bidirectional, needed for collaborative features

### Job Processing
**Recommendation**: Enhance BullMQ with better observability
- Add job progress events
- Implement custom job states
- Create job history tracking

## Implementation Guidelines

### Code Organization
```
apps/
  web/
    app/
      (auth)/        # Auth-related pages
      (main)/        # Main app pages
      api/           # API routes (if needed)
    lib/
      services/      # Business logic services
      actions/       # Server actions
      hooks/         # Custom React hooks
    components/
      ui/           # Reusable UI components
      features/     # Feature-specific components

  workers/
    src/
      workers/      # Job processors
      services/     # Shared services
      utils/        # Helper functions
```

### Error Handling Pattern
```typescript
// Consistent error handling across the app
class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public isOperational: boolean = true
  ) {
    super(message);
  }
}

// Usage
throw new AppError('Book not found', 'BOOK_NOT_FOUND', 404);
```

### Logging Strategy
```typescript
// Structured logging with context
logger.info({
  action: 'book.create',
  userId: user.id,
  bookId: book.id,
  duration: Date.now() - startTime,
}, 'Book created successfully');
```

## Migration Checklist

### Before Each Phase
- [ ] Backup database
- [ ] Create feature flags for new features
- [ ] Update documentation
- [ ] Write migration scripts if needed
- [ ] Plan rollback strategy

### Testing Requirements
- [ ] Unit tests for new services
- [ ] Integration tests for API endpoints
- [ ] E2E tests for critical user flows
- [ ] Load testing for performance-critical features
- [ ] Error scenario testing

### Deployment Strategy
1. **Development**: Continuous deployment from feature branches
2. **Staging**: Daily deployment from main branch
3. **Production**: Weekly deployment with approval
4. **Rollback**: Automated rollback on error rate spike

## Success Metrics

### Technical Metrics
- **Response Time**: < 200ms for API calls
- **Job Success Rate**: > 95% for all queues
- **Error Rate**: < 0.1% for critical operations
- **Uptime**: 99.9% availability

### Business Metrics
- **User Engagement**: Track completion rates
- **Performance**: Reduce time to complete book
- **Reliability**: Reduce support tickets by 50%
- **Scalability**: Support 10x current load

## Risk Mitigation

### Technical Risks
1. **Data Loss**: Regular backups, transaction logs
2. **Service Outages**: Multi-region deployment, failover
3. **Performance Degradation**: Auto-scaling, monitoring
4. **Security Breaches**: Regular audits, encryption

### Business Risks
1. **User Experience**: A/B testing, gradual rollouts
2. **Cost Overruns**: Budget monitoring, cost optimization
3. **Technical Debt**: Regular refactoring sprints
4. **Vendor Lock-in**: Abstract external services

## Conclusion
This plan provides a roadmap for transforming Storywink.ai into a robust, scalable platform. Each phase builds upon the previous one, ensuring continuous improvement while maintaining system stability.