import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const skeletonVariants = cva(
  "bg-muted rounded-md",
  {
    variants: {
      variant: {
        default: "rounded-md",
        circular: "rounded-full",
        text: "rounded h-4 w-full",
      },
      animation: {
        shimmer: "relative overflow-hidden before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.5s_ease-in-out_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/10 before:to-transparent",
        pulse: "animate-pulse",
        none: "",
      },
    },
    defaultVariants: {
      variant: "default",
      animation: "shimmer",
    },
  }
)

interface SkeletonProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof skeletonVariants> {}

function Skeleton({
  className,
  variant,
  animation,
  ...props
}: SkeletonProps) {
  return (
    <div
      data-slot="skeleton"
      className={cn(skeletonVariants({ variant, animation, className }))}
      {...props}
    />
  )
}

// Preset: Text lines skeleton
function SkeletonText({
  lines = 3,
  className,
  ...props
}: { lines?: number } & Omit<SkeletonProps, "variant">) {
  return (
    <div className={cn("space-y-2", className)} {...props}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          variant="text"
          className={cn(
            "h-4",
            i === lines - 1 && lines > 1 ? "w-3/4" : "w-full"
          )}
        />
      ))}
    </div>
  )
}

// Preset: Card skeleton
function SkeletonCard({ className, ...props }: Omit<SkeletonProps, "variant">) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-6 space-y-4",
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-3">
        <Skeleton variant="circular" className="size-10" />
        <div className="space-y-2 flex-1">
          <Skeleton variant="text" className="h-4 w-1/3" />
          <Skeleton variant="text" className="h-3 w-1/2" />
        </div>
      </div>
      <SkeletonText lines={3} />
    </div>
  )
}

// Preset: Chat message skeleton
function SkeletonMessage({
  className,
  ...props
}: Omit<SkeletonProps, "variant">) {
  return (
    <div
      className={cn("flex gap-3 p-4", className)}
      {...props}
    >
      <Skeleton variant="circular" className="size-8 shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton variant="text" className="h-4 w-1/4" />
        <SkeletonText lines={2} />
      </div>
    </div>
  )
}

export {
  Skeleton,
  SkeletonText,
  SkeletonCard,
  SkeletonMessage,
  skeletonVariants,
}
