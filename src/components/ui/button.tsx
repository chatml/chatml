import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-1 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-red-600/80 text-white font-semibold border-red-600/80 hover:bg-red-600 hover:border-red-600 dark:bg-red-700/70 dark:hover:bg-red-600/80 dark:border-red-700/70 dark:hover:border-red-600/80",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-muted-foreground/40 dark:hover:bg-input/50",
        success:
          "bg-emerald-600/80 text-white font-semibold border-emerald-600/80 hover:bg-emerald-600 hover:border-emerald-600 dark:bg-emerald-700/70 dark:hover:bg-emerald-600/80 dark:border-emerald-700/70 dark:hover:border-emerald-600/80",
        warning:
          "bg-yellow-600/80 text-white font-semibold border-yellow-600/80 hover:bg-yellow-600 hover:border-yellow-600 dark:bg-yellow-700/70 dark:hover:bg-yellow-600/80 dark:border-yellow-700/70 dark:hover:border-yellow-600/80",
        info:
          "bg-blue-600/80 text-white font-semibold border-blue-600/80 hover:bg-blue-600 hover:border-blue-600 dark:bg-blue-700/70 dark:hover:bg-blue-600/80 dark:border-blue-700/70 dark:hover:border-blue-600/80",
        purple:
          "bg-purple-600/80 text-white font-semibold border-purple-600/80 hover:bg-purple-600 hover:border-purple-600 dark:bg-purple-700/70 dark:hover:bg-purple-600/80 dark:border-purple-700/70 dark:hover:border-purple-600/80",
        secondary:
          "bg-secondary text-secondary-foreground border border-border hover:bg-secondary-foreground/10 dark:bg-surface-2 dark:hover:bg-surface-2/80",
        ghost:
          "border border-transparent hover:bg-foreground/5 hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        gradient:
          "bg-gradient-to-r from-primary to-purple-500 text-primary-foreground hover:from-primary/90 hover:to-purple-500/90 shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30",
      },
      size: {
        default: "h-8 px-3 py-2 has-[>svg]:px-2.5",
        sm: "h-7 rounded-md gap-1.5 px-2.5 text-xs has-[>svg]:px-2",
        lg: "h-9 rounded-md px-4 has-[>svg]:px-3",
        icon: "size-8",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
      state: {
        default: "",
        loading: "cursor-wait",
        success: "bg-ai-success text-white hover:bg-ai-success/90",
        error: "bg-ai-error text-white hover:bg-ai-error/90",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      state: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  state = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-state={state}
      className={cn(buttonVariants({ variant, size, state, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
