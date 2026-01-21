import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const glassCardVariants = cva(
  "rounded-xl border backdrop-blur-md transition-all duration-200",
  {
    variants: {
      variant: {
        default: "bg-card/80 border-border/50",
        elevated: "bg-card/90 border-border/60 shadow-lg",
        subtle: "bg-card/50 border-border/30",
        glow: "bg-card/80 border-primary/30 shadow-[0_0_30px_-5px_var(--primary)]",
      },
      hover: {
        none: "",
        lift: "hover:translate-y-[-2px] hover:shadow-lg",
        glow: "hover:border-primary/50 hover:shadow-[0_0_20px_-5px_var(--primary)]",
        scale: "hover:scale-[1.02]",
      },
      padding: {
        none: "",
        sm: "p-4",
        default: "p-6",
        lg: "p-8",
      },
    },
    defaultVariants: {
      variant: "default",
      hover: "none",
      padding: "default",
    },
  }
)

interface GlassCardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof glassCardVariants> {}

function GlassCard({
  className,
  variant,
  hover,
  padding,
  children,
  ...props
}: GlassCardProps) {
  return (
    <div
      data-slot="glass-card"
      className={cn(glassCardVariants({ variant, hover, padding, className }))}
      {...props}
    >
      {children}
    </div>
  )
}

// Glass card with animated gradient border
function GlassCardGradient({
  className,
  children,
  ...props
}: Omit<GlassCardProps, "variant">) {
  return (
    <div className="relative p-[1px] rounded-xl">
      {/* Gradient border */}
      <div
        className="absolute inset-0 rounded-xl bg-gradient-to-r from-primary via-purple-500 to-primary animate-gradient-shift opacity-60"
        style={{ backgroundSize: "200% 200%" }}
      />
      {/* Card content */}
      <div
        data-slot="glass-card"
        className={cn(
          "relative rounded-xl bg-card/95 backdrop-blur-md p-6",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </div>
  )
}

export { GlassCard, GlassCardGradient, glassCardVariants }
