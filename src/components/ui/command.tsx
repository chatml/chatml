"use client"

import * as React from "react"
import { Command as CommandPrimitive } from "cmdk"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { SearchIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog"

type CommandDialogVariant = "centered" | "spotlight"

// Context for tracking mouse hover separately from keyboard selection
const CommandHoverContext = React.createContext<{
  hoveredValue: string | null
  setHoveredValue: (value: string | null) => void
}>({
  hoveredValue: null,
  setHoveredValue: () => {},
})

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  const [hoveredValue, setHoveredValue] = React.useState<string | null>(null)

  const contextValue = React.useMemo(() => ({
    hoveredValue,
    setHoveredValue,
  }), [hoveredValue])

  return (
    <CommandHoverContext.Provider value={contextValue}>
      <CommandPrimitive
        data-slot="command"
        className={cn(
          "bg-surface-1 text-popover-foreground flex h-full w-full flex-col overflow-hidden rounded-md",
          className
        )}
        // Disable cmdk's pointer selection - we handle mouse hover separately
        disablePointerSelection
        {...props}
      />
    </CommandHoverContext.Provider>
  )
}

// Styles for centered (modal) command dialog
const centeredCommandStyles = cn(
  "[&_[cmdk-group-heading]]:text-muted-foreground",
  "**:data-[slot=command-input-wrapper]:h-12",
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium",
  "[&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0",
  "[&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5",
  "[&_[cmdk-input]]:h-12",
  "[&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3",
  "[&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5"
)

// Styles for spotlight (top-positioned) command dialog - more compact
const spotlightCommandStyles = cn(
  "[&_[cmdk-group-heading]]:text-muted-foreground",
  "**:data-[slot=command-input-wrapper]:h-10",
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium",
  "[&_[cmdk-group]]:px-1.5 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0",
  "[&_[cmdk-input-wrapper]_svg]:h-4 [&_[cmdk-input-wrapper]_svg]:w-4",
  "[&_[cmdk-input]]:h-10",
  "[&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-1",
  "[&_[cmdk-item]_svg]:h-4 [&_[cmdk-item]_svg]:w-4"
)

type CommandFilter = React.ComponentProps<typeof CommandPrimitive>["filter"]

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  showCloseButton = true,
  variant = "centered",
  filter,
  shouldFilter,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string
  description?: string
  className?: string
  showCloseButton?: boolean
  variant?: CommandDialogVariant
  filter?: CommandFilter
  shouldFilter?: boolean
}) {
  const isSpotlight = variant === "spotlight"

  return (
    <Dialog {...props}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {isSpotlight ? (
        <DialogPortal>
          <DialogOverlay className="bg-transparent" />
          <DialogPrimitive.Content
            data-slot="dialog-content"
            className={cn(
              "fixed top-8 inset-x-0 mx-auto z-50",
              "w-full max-w-xl",
              "bg-surface-1/95 backdrop-blur-xl",
              "border rounded-lg shadow-2xl",
              "overflow-hidden p-0",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
              "data-[state=open]:slide-in-from-top-4 data-[state=closed]:slide-out-to-top-4",
              "duration-200",
              className
            )}
          >
            <Command className={spotlightCommandStyles} filter={filter} shouldFilter={shouldFilter}>
              {children}
            </Command>
            {showCloseButton && (
              <DialogPrimitive.Close
                data-slot="dialog-close"
                className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-2 right-2 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
              >
                <XIcon />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            )}
          </DialogPrimitive.Content>
        </DialogPortal>
      ) : (
        <DialogContent
          className={cn("overflow-hidden p-0", className)}
          showCloseButton={showCloseButton}
        >
          <Command className={centeredCommandStyles} filter={filter} shouldFilter={shouldFilter}>
            {children}
          </Command>
        </DialogContent>
      )}
    </Dialog>
  )
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="flex h-9 items-center gap-3 border-b px-3"
    >
      <SearchIcon className="size-4 shrink-0 opacity-50" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "placeholder:text-muted-foreground flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
    </div>
  )
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "max-h-[300px] scroll-py-1 overflow-x-hidden overflow-y-auto",
        className
      )}
      {...props}
    />
  )
}

function CommandEmpty({
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className="py-6 text-center text-sm"
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "text-foreground [&_[cmdk-group-heading]]:text-muted-foreground overflow-hidden p-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium",
        className
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("bg-border -mx-1 h-px", className)}
      {...props}
    />
  )
}

function CommandItem({
  className,
  value,
  onSelect,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  const { hoveredValue, setHoveredValue } = React.useContext(CommandHoverContext)
  const isHovered = value !== undefined && hoveredValue === value

  const handleMouseEnter = React.useCallback(() => {
    if (value !== undefined) {
      setHoveredValue(value)
    }
  }, [value, setHoveredValue])

  const handleMouseLeave = React.useCallback(() => {
    setHoveredValue(null)
  }, [setHoveredValue])

  // Handle click - this triggers onSelect for the hovered item
  const handleClick = React.useCallback(() => {
    onSelect?.(value ?? "")
  }, [onSelect, value])

  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      data-hovered={isHovered ? "true" : undefined}
      value={value}
      onSelect={onSelect}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      className={cn(
        // Base styles
        "[&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-3 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // Mouse hover - subtle styling (comes first so keyboard selection can override)
        "data-[hovered=true]:bg-muted",
        // Keyboard selection - prominent styling (comes last to take precedence)
        "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "text-muted-foreground ml-auto text-xs tracking-widest",
        className
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}
