"use client"

import * as React from "react"
import { GripVerticalIcon } from "lucide-react"
import {
  Group,
  Panel,
  Separator,
  type PanelImperativeHandle,
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

const ResizablePanel = React.forwardRef<
  PanelImperativeHandle,
  React.ComponentProps<typeof Panel>
>(({ className, ...props }, ref) => {
  return (
    <Panel
      panelRef={ref}
      className={cn("", className)}
      {...props}
    />
  )
})
ResizablePanel.displayName = "ResizablePanel"

function ResizableHandle({
  withHandle,
  direction,
  className,
  ...props
}: React.ComponentProps<typeof Separator> & {
  withHandle?: boolean
  direction?: "horizontal" | "vertical"
}) {
  // Separator orientation is opposite of panel group direction
  // horizontal group = vertical separator (col-resize cursor)
  // vertical group = horizontal separator (row-resize cursor)
  const isVerticalSeparator = direction === "horizontal"

  return (
    <Separator
      className={cn(
        "relative z-10 flex items-center justify-center bg-transparent outline-none",
        // Visible line via pseudo-element
        "after:absolute after:bg-border hover:after:bg-primary/50",
        isVerticalSeparator ? [
          // Vertical separator (for horizontal panel group)
          // 6px wide hit area, negative margins to not affect layout
          "w-[6px] -mx-[2.5px] h-full !cursor-col-resize",
          "after:w-px after:h-full",
        ] : [
          // Horizontal separator (for vertical panel group)
          // 6px tall hit area, negative margins to not affect layout
          "h-[6px] -my-[2.5px] w-full !cursor-row-resize",
          "after:h-px after:w-full",
        ],
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
