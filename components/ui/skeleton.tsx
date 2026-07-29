import { cn } from "@/lib/utils"

/**
 * Loading placeholder. Uses foreground/10 (not bg-muted) so bars stay visible
 * on the specimen-note sage paper — --muted is only a 6% ink mix and reads as
 * blank on bg-background panels.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-foreground/10", className)}
      {...props}
    />
  )
}

export { Skeleton }
