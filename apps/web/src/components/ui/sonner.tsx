"use client"

import { Toaster as Sonner, ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  // Removed useTheme to prevent hydration issues
  // Using system theme detection via CSS instead
  
  return (
    <Sonner
      theme="light"
      className="toaster group"
      style={
        {
          "--normal-bg": "white",
          "--normal-text": "#1a1a1a",
          "--normal-border": "var(--coral-primary)",
          "--success-bg": "white",
          "--success-text": "#1a1a1a",
          "--success-border": "var(--coral-primary)",
          "--info-bg": "white",
          "--info-text": "#1a1a1a",
          "--info-border": "var(--coral-primary)",
          "--warning-bg": "white",
          "--warning-text": "#1a1a1a",
          "--warning-border": "var(--coral-primary)",
          "--error-bg": "white",
          "--error-text": "#1a1a1a",
          "--error-border": "var(--coral-primary)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
