import type { Appearance } from "@clerk/types";

/**
 * Brand-matched appearance for Clerk's hosted <SignIn> / <SignUp> widgets so
 * their primary action reads as a coral pill instead of Clerk's default black.
 */
export const clerkAppearance: Appearance = {
  variables: {
    colorPrimary: "#F76C5E",
    colorText: "#1a1a1a",
    borderRadius: "0.75rem",
    fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
  },
  elements: {
    formButtonPrimary:
      "rounded-full font-semibold hover:opacity-90 transition-opacity",
    card: "shadow-lg",
  },
};
