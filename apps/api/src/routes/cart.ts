import { Router } from 'express';
import { requireAuth } from '@clerk/express';
import prisma from '../database/index.js';
import { ensureDbUser, AuthenticatedRequest } from '../middleware/ensureDbUser.js';
import { LULU_ORDER_LIMITS } from '@storywink/shared/lulu';

export const cartRouter = Router();

// Apply auth middleware to all routes
cartRouter.use(requireAuth());
cartRouter.use(ensureDbUser);

/**
 * GET /api/cart - Get all cart items for the authenticated user
 */
cartRouter.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.dbUser!.id;

    const cartItems = await prisma.cartItem.findMany({
      where: { userId },
      include: {
        book: {
          include: {
            pages: {
              where: { isTitlePage: true },
              select: {
                generatedImageUrl: true,
              },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Transform to include cover image and total
    const items = cartItems.map(item => ({
      id: item.id,
      bookId: item.bookId,
      quantity: item.quantity,
      book: {
        id: item.book.id,
        title: item.book.title,
        childName: item.book.childName,
        status: item.book.status,
        pageCount: item.book.pageLength,
        coverImageUrl: item.book.pages[0]?.generatedImageUrl || null,
      },
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));

    // Calculate totals
    const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);

    res.json({
      success: true,
      data: {
        items,
        totalItems,
        itemCount: items.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/cart - Add a book to the cart
 * If the book is already in the cart, updates the quantity instead.
 */
cartRouter.post('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.dbUser!.id;
    const { bookId, quantity = 1 } = req.body;

    if (!bookId) {
      res.status(400).json({
        success: false,
        error: 'bookId is required',
      });
      return;
    }

    // Validate quantity
    const qty = Math.min(Math.max(1, quantity), LULU_ORDER_LIMITS.MAX_QUANTITY);

    // Verify book exists, belongs to user, and is COMPLETED or PARTIAL
    const book = await prisma.book.findFirst({
      where: {
        id: bookId,
        userId,
        status: { in: ['COMPLETED', 'PARTIAL'] },
      },
    });

    if (!book) {
      res.status(404).json({
        success: false,
        error: 'Book not found or not ready for printing',
      });
      return;
    }

    // Upsert cart item (create or update quantity)
    const cartItem = await prisma.cartItem.upsert({
      where: {
        userId_bookId: { userId, bookId },
      },
      create: {
        userId,
        bookId,
        quantity: qty,
      },
      update: {
        quantity: qty,
      },
      include: {
        book: {
          select: {
            id: true,
            title: true,
            childName: true,
            status: true,
            pageLength: true,
          },
        },
      },
    });

    res.status(201).json({
      success: true,
      data: cartItem,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/cart/:cartItemId - Update cart item quantity
 */
cartRouter.patch('/:cartItemId', async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.dbUser!.id;
    const { cartItemId } = req.params;
    const { quantity } = req.body;

    if (quantity === undefined) {
      res.status(400).json({
        success: false,
        error: 'quantity is required',
      });
      return;
    }

    // Validate quantity range
    const qty = Math.min(Math.max(LULU_ORDER_LIMITS.MIN_QUANTITY, quantity), LULU_ORDER_LIMITS.MAX_QUANTITY);

    // Verify ownership
    const existingItem = await prisma.cartItem.findFirst({
      where: { id: cartItemId, userId },
    });

    if (!existingItem) {
      res.status(404).json({
        success: false,
        error: 'Cart item not found',
      });
      return;
    }

    // Update quantity
    const cartItem = await prisma.cartItem.update({
      where: { id: cartItemId },
      data: { quantity: qty },
      include: {
        book: {
          select: {
            id: true,
            title: true,
            childName: true,
            status: true,
            pageLength: true,
          },
        },
      },
    });

    res.json({
      success: true,
      data: cartItem,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/cart/:cartItemId - Remove item from cart
 */
cartRouter.delete('/:cartItemId', async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.dbUser!.id;
    const { cartItemId } = req.params;

    // Verify ownership
    const existingItem = await prisma.cartItem.findFirst({
      where: { id: cartItemId, userId },
    });

    if (!existingItem) {
      res.status(404).json({
        success: false,
        error: 'Cart item not found',
      });
      return;
    }

    // Delete item
    await prisma.cartItem.delete({
      where: { id: cartItemId },
    });

    res.json({
      success: true,
      message: 'Item removed from cart',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/cart - Clear entire cart
 */
cartRouter.delete('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.dbUser!.id;

    const result = await prisma.cartItem.deleteMany({
      where: { userId },
    });

    res.json({
      success: true,
      message: `Removed ${result.count} item(s) from cart`,
      deletedCount: result.count,
    });
  } catch (error) {
    next(error);
  }
});
