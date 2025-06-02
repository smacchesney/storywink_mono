import { Router } from "express";
import { Webhook } from "svix";
import prisma from "../database/index.ts";

export const webhooksRouter = Router();

// POST /api/webhooks/clerk - Handle Clerk webhooks
webhooksRouter.post("/clerk", async (req, res, next) => {
  try {
    const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

    if (!WEBHOOK_SECRET) {
      throw new Error("CLERK_WEBHOOK_SECRET not configured");
    }

    // Get headers
    const svix_id = req.headers["svix-id"] as string;
    const svix_timestamp = req.headers["svix-timestamp"] as string;
    const svix_signature = req.headers["svix-signature"] as string;

    if (!svix_id || !svix_timestamp || !svix_signature) {
      return res.status(400).json({
        success: false,
        error: "Missing svix headers",
      });
    }

    // Create Svix instance
    const wh = new Webhook(WEBHOOK_SECRET);

    // Verify webhook
    let evt: any;
    try {
      evt = wh.verify(JSON.stringify(req.body), {
        "svix-id": svix_id,
        "svix-timestamp": svix_timestamp,
        "svix-signature": svix_signature,
      });
    } catch (err) {
      console.error("Webhook verification failed:", err);
      return res.status(400).json({
        success: false,
        error: "Webhook verification failed",
      });
    }

    // Handle different event types
    const eventType = evt.type;

    if (eventType === "user.created" || eventType === "user.updated") {
      const { id, email_addresses, first_name, last_name, image_url } =
        evt.data;

      const email = email_addresses[0]?.email_address;
      const name = [first_name, last_name].filter(Boolean).join(" ");

      await prisma.user.upsert({
        where: { clerkId: id },
        update: {
          email,
          name: name || email,
          image: image_url,
        },
        create: {
          clerkId: id,
          email,
          name: name || email,
          image: image_url,
        },
      });
    }

    if (eventType === "user.deleted") {
      const { id } = evt.data;

      await prisma.user.delete({
        where: { clerkId: id },
      });
    }

    res.json({
      success: true,
      message: "Webhook processed",
    });
  } catch (error) {
    next(error);
  }
});
