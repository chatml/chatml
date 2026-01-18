"use client"

import * as React from "react"
import { GripVerticalIcon } from "lucide-react"
import {
  Group,
  Panel,
  Separator,
} from "react-resizable-panels"

import { cn } from "@/lib/utils"

type ResizablePanelGroupProps = Omit<React.ComponentProps<typeof Group>, 'orientation'> & {
  direction?: "horizontal" | "vertical"
}

function ResizablePanelGroup({
  className,
  direction = "horizontal",
  ...props
}: ResizablePanelGroupProps) {
  return (
    <Group
      orientation={direction}
      className={cn("flex h-full w-full", className)}
      {...props}
    />
  )
}

function ResizablePanel({
  className,
  ...props
}: React.ComponentProps<typeof Panel>) {
  return (
    <Panel
      className={cn("", className)}
      {...props}
    />
  )
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof Separator> & {
  withHandle?: boolean
}) {
  return (
    <Separator
      className={cn(
        "relative flex items-center justify-center bg-border hover:bg-primary/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        // Horizontal separator (for vertical panel group) - full width, thin height
        "aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:cursor-row-resize",
        // Vertical separator (for horizontal panel group) - full height, thin width
        "aria-[orientation=vertical]:w-px aria-[orientation=vertical]:h-full aria-[orientation=vertical]:cursor-col-resize",
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
          <GripVerticalIcon className="h-2.5 w-2.5" />
        </div>
      )}
    </Separator>
  )
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
