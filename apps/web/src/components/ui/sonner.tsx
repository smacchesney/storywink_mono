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
          "--normal-border": "#F76C5E",
          "--success-bg": "white",
          "--success-text": "#1a1a1a",
          "--success-border": "#F76C5E",
          "--info-bg": "white",
          "--info-text": "#1a1a1a",
          "--info-border": "#F76C5E",
          "--warning-bg": "white",
          "--warning-text": "#1a1a1a",
          "--warning-border": "#F76C5E",
          "--error-bg": "white",
          "--error-text": "#1a1a1a",
          "--error-border": "#F76C5E",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
