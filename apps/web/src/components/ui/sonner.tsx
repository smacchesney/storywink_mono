"use client"

import { Toaster as Sonner, ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  // Removed useTheme to prevent hydration issues
  // Using system theme detection via CSS instead
  
  return (
    <Sonner
      theme="system"
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          // Success - coral
          "--success-bg": "#F76C5E",
          "--success-text": "white",
          "--success-border": "#F76C5E",
          // Info - coral
          "--info-bg": "#F76C5E",
          "--info-text": "white",
          "--info-border": "#F76C5E",
          // Warning - coral
          "--warning-bg": "#F76C5E",
          "--warning-text": "white",
          "--warning-border": "#F76C5E",
          // Error - uses Sonner defaults (red)
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
