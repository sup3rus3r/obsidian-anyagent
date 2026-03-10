import { cn } from "@/lib/utils"

interface LogoProps {
  className?: string
  size?: "sm" | "md" | "lg"
  showText?: boolean
}

export function Logo({ className, size = "md", showText = true }: LogoProps) {
  const dims = { sm: 24, md: 32, lg: 44 }[size]
  const textSize = { sm: "text-sm", md: "text-base", lg: "text-xl" }[size]

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      {/* Geometric hexagon mark */}
      <svg
        width={dims}
        height={dims}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0"
      >
        {/* Outer hexagon */}
        <polygon
          points="16,2 28,9 28,23 16,30 4,23 4,9"
          stroke="oklch(0.60 0.22 20)"
          strokeWidth="1.5"
          fill="none"
        />
        {/* Inner diamond */}
        <polygon
          points="16,8 22,16 16,24 10,16"
          fill="oklch(0.60 0.22 20)"
          opacity="0.9"
        />
        {/* Center dot */}
        <circle cx="16" cy="16" r="2.5" fill="oklch(0.05 0 0)" />
        {/* Connection lines top */}
        <line x1="16" y1="2"  x2="16" y2="8"  stroke="oklch(0.60 0.22 20)" strokeWidth="1" opacity="0.5" />
        <line x1="16" y1="24" x2="16" y2="30" stroke="oklch(0.60 0.22 20)" strokeWidth="1" opacity="0.5" />
        <line x1="28" y1="9"  x2="22" y2="16" stroke="oklch(0.60 0.22 20)" strokeWidth="1" opacity="0.5" />
        <line x1="4"  y1="9"  x2="10" y2="16" stroke="oklch(0.60 0.22 20)" strokeWidth="1" opacity="0.5" />
      </svg>

      {showText && (
        <div className="flex flex-col leading-none">
          <span className={cn("font-bold tracking-tight text-foreground", textSize)}>
            Obsidian
          </span>
          <span className={cn("font-light tracking-widest uppercase text-primary", {
            "text-[9px]":  size === "sm",
            "text-[10px]": size === "md",
            "text-xs":     size === "lg",
          })}>
            Any Agent
          </span>
        </div>
      )}
    </div>
  )
}
