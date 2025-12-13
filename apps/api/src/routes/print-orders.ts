import { Router } from 'express';
import { requireAuth } from '@clerk/express';
import prisma from '../database/index.js';
import { ensureDbUser, AuthenticatedRequest } from '../middleware/ensureDbUser.js';
import { getLuluClient, LuluShippingAddress } from '../lib/lulu/client.js';
import { LULU_ORDER_LIMITS, LULU_TEST_ADDRESS } from '@storywink/shared/lulu';

export const printOrdersRouter = Router();

// Apply auth middleware to all routes
printOrdersRouter.use(requireAuth());
printOrdersRouter.use(ensureDbUser);

/**
 * POST /api/print-orders/calculate-price - Get price quote from Lulu API
 * This calls Lulu's cost calculation endpoint without creating an order.
 */
printOrdersRouter.post('/calculate-price', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { bookId, quantity = 1, shippingAddress, shippingOption = 'MAIL' } = req.body;
    const userId = req.dbUser!.id;

    if (!bookId) {
      res.status(400).json({
        success: false,
        error: 'bookId is required',
      });
      return;
    }

    // Validate quantity
    const qty = Math.min(Math.max(1, quantity), LULU_ORDER_LIMITS.MAX_QUANTITY);

    // Fetch book to get page count
    const book = await prisma.book.findFirst({
      where: { id: bookId, userId },
      select: {
        id: true,
        title: true,
        pageLength: true,
        status: true,
        _count: { select: { pages: true } },
      },
    });

    if (!book) {
      res.status(404).json({
        success: false,
        error: 'Book not found',
      });
      return;
    }

    if (book.status !== 'COMPLETED' && book.status !== 'PARTIAL') {
      res.status(400).json({
        success: false,
        error: `Book is not ready for printing. Status: ${book.status}`,
      });
      return;
    }

    // Use provided address or test address
    const address: LuluShippingAddress = shippingAddress || {
      name: LULU_TEST_ADDRESS.name,
      street1: LULU_TEST_ADDRESS.street1,
      city: LULU_TEST_ADDRESS.city,
      state_code: LULU_TEST_ADDRESS.stateCode,
      country_code: LULU_TEST_ADDRESS.countryCode,
      postcode: LULU_TEST_ADDRESS.postcode,
      phone_number: LULU_TEST_ADDRESS.phoneNumber,
    };

    // Call Lulu API for price calculation
    const client = getLuluClient();
    const costResult = await client.calculateCost({
      pageCount: book._count.pages,
      quantity: qty,
      shippingAddress: address,
      shippingOption,
    });

    res.json({
      success: true,
      data: {
        bookId: book.id,
        bookTitle: book.title,
        pageCount: book._count.pages,
        quantity: qty,
        shippingOption,
        costs: {
          printCost: costResult.line_item_costs[0]?.cost_excl_discounts || '0.00',
          shippingCost: costResult.shipping_cost.total_cost_excl_tax,
          subtotal: costResult.total_cost_excl_tax,
          tax: costResult.total_tax,
          total: costResult.total_cost_incl_tax,
          currency: costResult.currency,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/print-orders/shipping-options - Get available shipping options
 */
printOrdersRouter.post('/shipping-options', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { bookId, quantity = 1, shippingAddress } = req.body;
    const userId = req.dbUser!.id;

    if (!bookId) {
      res.status(400).json({
        success: false,
        error: 'bookId is required',
      });
      return;
    }

    // Validate quantity
    const qty = Math.min(Math.max(1, quantity), LULU_ORDER_LIMITS.MAX_QUANTITY);

    // Fetch book to get page count
    const book = await prisma.book.findFirst({
      where: { id: bookId, userId },
      select: {
        id: true,
        pageLength: true,
        _count: { select: { pages: true } },
      },
    });

    if (!book) {
      res.status(404).json({
        success: false,
        error: 'Book not found',
      });
      return;
    }

    // Use provided address or test address
    const address: LuluShippingAddress = shippingAddress || {
      name: LULU_TEST_ADDRESS.name,
      street1: LULU_TEST_ADDRESS.street1,
      city: LULU_TEST_ADDRESS.city,
      state_code: LULU_TEST_ADDRESS.stateCode,
      country_code: LULU_TEST_ADDRESS.countryCode,
      postcode: LULU_TEST_ADDRESS.postcode,
      phone_number: LULU_TEST_ADDRESS.phoneNumber,
    };

    // Call Lulu API for shipping options
    const client = getLuluClient();
    const optionsResult = await client.getShippingOptions({
      pageCount: book._count.pages,
      quantity: qty,
      shippingAddress: address,
    });

    // Lulu API returns array directly, not wrapped in shipping_options
    res.json({
      success: true,
      data: {
        bookId: book.id,
        pageCount: book._count.pages,
        quantity: qty,
        shippingOptions: optionsResult.map(opt => ({
          level: opt.level,
          costExclTax: opt.total_cost_excl_tax,
          costInclTax: opt.total_cost_incl_tax,
          currency: opt.currency,
          // estimated_shipping_dates may be undefined for some options
          estimatedDelivery: opt.estimated_shipping_dates ? {
            min: opt.estimated_shipping_dates.arrival_min,
            max: opt.estimated_shipping_dates.arrival_max,
          } : null,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/print-orders - Create a new print order
 * For testing/dummy checkout, this creates the order record but doesn't submit to Lulu yet.
 */
printOrdersRouter.post('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.dbUser!.id;
    const {
      bookId,
      quantity = 1,
      shippingAddress,
      shippingLevel: _shippingLevel = 'MAIL', // Stored for when order is submitted to Lulu
      isTest = false,
    } = req.body;

    if (!bookId) {
      res.status(400).json({
        success: false,
        error: 'bookId is required',
      });
      return;
    }

    // Validate quantity
    const qty = Math.min(Math.max(1, quantity), LULU_ORDER_LIMITS.MAX_QUANTITY);

    // Verify book
    const book = await prisma.book.findFirst({
      where: { id: bookId, userId },
      select: {
        id: true,
        title: true,
        status: true,
        _count: { select: { pages: true } },
      },
    });

    if (!book) {
      res.status(404).json({
        success: false,
        error: 'Book not found',
      });
      return;
    }

    if (book.status !== 'COMPLETED' && book.status !== 'PARTIAL') {
      res.status(400).json({
        success: false,
        error: 'Book is not ready for printing',
      });
      return;
    }

    // Parse shipping address
    const address = shippingAddress || LULU_TEST_ADDRESS;

    // Create print order record
    const printOrder = await prisma.printOrder.create({
      data: {
        userId,
        bookId,
        quantity: qty,
        status: isTest ? 'PAYMENT_COMPLETED' : 'PENDING_PAYMENT',
        pageCount: book._count.pages,
        shippingName: address.name,
        shippingStreet1: address.street1,
        shippingStreet2: address.street2,
        shippingCity: address.city,
        shippingState: address.state_code || address.stateCode,
        shippingPostcode: address.postcode,
        shippingCountry: address.country_code || address.countryCode || 'US',
        shippingPhone: address.phone_number || address.phoneNumber,
        contactEmail: address.email || req.dbUser!.email,
      },
    });

    res.status(201).json({
      success: true,
      data: printOrder,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/print-orders - List all print orders for the user
 */
printOrdersRouter.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.dbUser!.id;

    const orders = await prisma.printOrder.findMany({
      where: { userId },
      include: {
        book: {
          select: {
            id: true,
            title: true,
            childName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: orders,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/print-orders/:orderId - Get a specific print order
 */
printOrdersRouter.get('/:orderId', async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.dbUser!.id;
    const { orderId } = req.params;

    const order = await prisma.printOrder.findFirst({
      where: { id: orderId, userId },
      include: {
        book: {
          select: {
            id: true,
            title: true,
            childName: true,
            pageLength: true,
          },
        },
      },
    });

    if (!order) {
      res.status(404).json({
        success: false,
        error: 'Order not found',
      });
      return;
    }

    res.json({
      success: true,
      data: order,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/print-orders/:orderId/submit-to-lulu - Submit order to Lulu API
 * This is called after payment is confirmed (or for test orders).
 */
printOrdersRouter.post('/:orderId/submit-to-lulu', async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.dbUser!.id;
    const { orderId } = req.params;
    const { interiorPdfUrl, coverPdfUrl, shippingLevel = 'MAIL' } = req.body;

    if (!interiorPdfUrl || !coverPdfUrl) {
      res.status(400).json({
        success: false,
        error: 'interiorPdfUrl and coverPdfUrl are required',
      });
      return;
    }

    // Fetch order
    const order = await prisma.printOrder.findFirst({
      where: { id: orderId, userId },
      include: {
        book: {
          select: { id: true, title: true },
        },
      },
    });

    if (!order) {
      res.status(404).json({
        success: false,
        error: 'Order not found',
      });
      return;
    }

    // Only allow submission if payment completed
    if (order.status !== 'PAYMENT_COMPLETED') {
      res.status(400).json({
        success: false,
        error: `Cannot submit order with status: ${order.status}`,
      });
      return;
    }

    // Submit to Lulu API
    const client = getLuluClient();
    const printJob = await client.createPrintJob({
      contactEmail: order.contactEmail || 'orders@storywink.ai',
      pageCount: order.pageCount || 0,
      quantity: order.quantity,
      interiorPdfUrl,
      coverPdfUrl,
      shippingAddress: {
        name: order.shippingName || '',
        street1: order.shippingStreet1 || '',
        street2: order.shippingStreet2 || undefined,
        city: order.shippingCity || '',
        state_code: order.shippingState || undefined,
        country_code: order.shippingCountry || 'US',
        postcode: order.shippingPostcode || '',
        phone_number: order.shippingPhone || undefined,
      },
      shippingLevel,
      bookTitle: order.book.title,
      externalId: order.id,
    });

    // Update order with Lulu details
    const updatedOrder = await prisma.printOrder.update({
      where: { id: orderId },
      data: {
        status: 'SUBMITTED_TO_LULU',
        luluPrintJobId: String(printJob.id),
        interiorPdfUrl,
        coverPdfUrl,
        submittedAt: new Date(),
      },
    });

    res.json({
      success: true,
      data: {
        order: updatedOrder,
        luluPrintJob: printJob,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/print-orders/:orderId/cancel - Cancel an order
 */
printOrdersRouter.post('/:orderId/cancel', async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.dbUser!.id;
    const { orderId } = req.params;

    const order = await prisma.printOrder.findFirst({
      where: { id: orderId, userId },
    });

    if (!order) {
      res.status(404).json({
        success: false,
        error: 'Order not found',
      });
      return;
    }

    // Only allow cancellation of pending orders
    const cancellableStatuses = ['PENDING_PAYMENT', 'PAYMENT_COMPLETED'];
    if (!cancellableStatuses.includes(order.status)) {
      res.status(400).json({
        success: false,
        error: `Cannot cancel order with status: ${order.status}`,
      });
      return;
    }

    // If already submitted to Lulu, try to cancel there too
    if (order.luluPrintJobId) {
      try {
        const client = getLuluClient();
        await client.cancelPrintJob(order.luluPrintJobId);
      } catch (luluError) {
        // Log but don't fail - order might already be in production
        console.warn('Failed to cancel Lulu print job:', luluError);
      }
    }

    // Update order status
    const updatedOrder = await prisma.printOrder.update({
      where: { id: orderId },
      data: { status: 'CANCELLED' },
    });

    res.json({
      success: true,
      data: updatedOrder,
    });
  } catch (error) {
    next(error);
  }
});
