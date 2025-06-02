import { Webhook } from 'svix';
import { headers } from 'next/headers';
import { WebhookEvent } from '@clerk/nextjs/server';
import { db as prisma } from '@/lib/db';
import logger from '@/lib/logger';
import { NextResponse } from 'next/server';
import { ensureUser } from '@/lib/db/ensureUser';

// Ensure Clerk Webhook Secret is set in environment variables
const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

if (!WEBHOOK_SECRET) {
  logger.error('CLERK_WEBHOOK_SECRET is not set in environment variables.');
  // Optionally throw an error during startup if critical
  // throw new Error('CLERK_WEBHOOK_SECRET is not set.');
}

export async function POST(req: Request) {
  logger.info('Received Clerk webhook request.');

  if (!WEBHOOK_SECRET) {
    logger.error('Webhook secret not configured, cannot process request.');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  // Get the headers
  const headerPayload = await headers();
  const svix_id = headerPayload.get("svix-id");
  const svix_timestamp = headerPayload.get("svix-timestamp");
  const svix_signature = headerPayload.get("svix-signature");

  // If there are no headers, error out
  if (!svix_id || !svix_timestamp || !svix_signature) {
    logger.warn('Webhook request missing required Svix headers.');
    return NextResponse.json({ error: 'Missing Svix headers' }, { status: 400 });
  }

  // Get the body
  let payload: WebhookEvent;
  try {
    const body = await req.json();
    payload = body as WebhookEvent; // Cast after parsing
  } catch (err) {
    logger.error('Error parsing webhook request body:', err);
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }


  // Create a new Svix instance with your secret.
  const wh = new Webhook(WEBHOOK_SECRET);

  let evt: WebhookEvent;

  // Verify the payload with the headers
  try {
    evt = wh.verify(JSON.stringify(payload), { // Verify the stringified payload
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    }) as WebhookEvent;
    logger.info({ eventType: evt.type }, 'Webhook signature verified successfully.');
  } catch (err: any) {
    logger.error('Error verifying webhook signature:', err.message);
    return NextResponse.json({ error: 'Webhook signature verification failed' }, { status: 400 });
  }

  // Get the ID and type
  const eventType = evt.type;

  logger.info({ eventType }, `Processing webhook event...`);

  // Handle the event type
  try {
    switch (eventType) {
      case 'user.created':
      case 'user.updated':
        const { id, email_addresses, first_name, last_name, image_url } = evt.data;
        const primaryEmail = email_addresses?.find(e => e.id === evt.data.primary_email_address_id)?.email_address || email_addresses?.[0]?.email_address;

        if (!primaryEmail) {
           logger.warn({ clerkUserId: id, eventType }, 'User created/updated webhook missing primary email address.');
           // Depending on your requirements, you might want to return an error or log and skip.
           // For now, we'll log and attempt to proceed if ensureUser can handle a missing email (it currently requires it).
           // If email is absolutely essential for user creation, return an error here.
           return NextResponse.json({ error: 'Missing primary email for user.created/updated event' }, { status: 400 });
        }

        logger.info({ clerkUserId: id, email: primaryEmail, eventType }, `Calling ensureUser for user...`);
        await ensureUser({
            id: id, // This is the Clerk ID
            email: primaryEmail,
            name: `${first_name || ''} ${last_name || ''}`.trim() || null,
            imageUrl: image_url,
        });
        logger.info({ clerkUserId: id, eventType }, `ensureUser call completed.`);
        break;

      case 'user.deleted':
        // Clerk might send delete events even for users not in your DB if sync was incomplete
        // Use deleteMany which doesn't throw if the user doesn't exist.
        const { id: deletedClerkId, deleted } = evt.data; // Clerk sends `id` and `deleted` status
        
        if (deleted && deletedClerkId) { // Ensure it's a true deletion event and ID is present
            logger.info({ clerkUserId: deletedClerkId }, `Attempting to delete user based on clerkId...`);
            const deleteResult = await prisma.user.deleteMany({
              where: { clerkId: deletedClerkId },
            });
            if (deleteResult.count > 0) {
                logger.info({ clerkUserId: deletedClerkId }, `User deleted successfully from DB.`);
            } else {
                logger.warn({ clerkUserId: deletedClerkId }, `User deletion webhook (clerkId) received, but user not found in DB.`);
            }
        } else if (deletedClerkId) {
            logger.warn({ clerkUserId: deletedClerkId, deletedStatus: deleted }, 'User deleted webhook received, but deleted status is not true or ID is missing.');
        } else {
             logger.warn('User deleted webhook received, but no ID found in payload data.');
        }
        break;

      default:
        logger.info({ eventType }, `Ignoring unhandled webhook event type.`);
    }

    return NextResponse.json({ message: 'Webhook processed successfully' }, { status: 200 });

  } catch (error: any) {
    logger.error({ eventType, error: error.message }, 'Error processing webhook event.');
    return NextResponse.json({ error: 'Internal server error processing webhook' }, { status: 500 });
  }
} 