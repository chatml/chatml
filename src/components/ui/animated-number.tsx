"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface AnimatedNumberProps extends React.HTMLAttributes<HTMLSpanElement> {
  value: number
  duration?: number
  formatFn?: (value: number) => string
  delay?: number
}

// Easing function: easeOutCubic
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function AnimatedNumber({
  value,
  duration = 500,
  formatFn = (n) => n.toLocaleString(),
  delay = 0,
  className,
  ...props
}: AnimatedNumberProps) {
  const [displayValue, setDisplayValue] = React.useState(value)
  const previousValueRef = React.useRef(value)
  const animationRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    const startValue = previousValueRef.current
    const endValue = value
    const startTime = performance.now() + delay

    // Skip animation if reduced motion is preferred
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches

    if (prefersReducedMotion) {
      setDisplayValue(endValue)
      previousValueRef.current = endValue
      return
    }

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime

      if (elapsed < 0) {
        animationRef.current = requestAnimationFrame(animate)
        return
      }

      if (elapsed >= duration) {
        setDisplayValue(endValue)
        previousValueRef.current = endValue
        return
      }

      const progress = easeOutCubic(elapsed / duration)
      const currentValue = startValue + (endValue - startValue) * progress

      setDisplayValue(Math.round(currentValue))
      animationRef.current = requestAnimationFrame(animate)
    }

    animationRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [value, duration, delay])

  return (
    <span
      data-slot="animated-number"
      className={cn("tabular-nums", className)}
      {...props}
    >
      {formatFn(displayValue)}
    </span>
  )
}

// Preset: Currency display
function AnimatedCurrency({
  value,
  currency = "USD",
  ...props
}: Omit<AnimatedNumberProps, "formatFn"> & { currency?: string }) {
  const formatFn = React.useCallback(
    (n: number) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(n),
    [currency]
  )

  return <AnimatedNumber value={value} formatFn={formatFn} {...props} />
}

// Preset: Percentage display
function AnimatedPercentage({
  value,
  ...props
}: Omit<AnimatedNumberProps, "formatFn">) {
  const formatFn = React.useCallback(
    (n: number) => `${n}%`,
    []
  )

  return <AnimatedNumber value={value} formatFn={formatFn} {...props} />
}

export { AnimatedNumber, AnimatedCurrency, AnimatedPercentage }
