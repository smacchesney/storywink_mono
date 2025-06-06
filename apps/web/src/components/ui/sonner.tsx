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
          "--success-bg": "#F76C5E",
          "--success-text": "white",
          "--success-border": "#F76C5E",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
