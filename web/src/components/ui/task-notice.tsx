import { cn } from "@/lib/utils"

export type Notice = {
  id: string
  /** What ended, in a few words. */
  title: string
  status: "completed" | "failed" | "stopped"
  /** Said after the title, fainter: how long it ran, say. */
  note?: string
}

/**
 * News of something ending behind the conversation — a background command,
 * a subagent, a schedule coming due. It is set in the grey of the lines that
 * say what the agent did, with a dot for how it went, because that is what it
 * is: the reason the agent is about to speak. It is not something the user
 * said, and not an announcement across the thread.
 *
 * Hue means finished or stopped; nothing here moves.
 */
function TaskNotice({ notices, className }: { notices: Notice[]; className?: string }) {
  if (!notices.length) return null
  return (
    <div data-slot="task-notice" className={cn("flex flex-col gap-1", className)}>
      {notices.map((notice) => (
        <div key={notice.id} className="flex max-w-full items-center gap-2 text-[12.5px] text-muted-foreground">
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              notice.status === "completed"
                ? "bg-emerald-500/80"
                : notice.status === "failed"
                  ? "bg-destructive"
                  : "bg-muted-foreground/60"
            )}
          />
          <span className="truncate">
            {notice.title}
            {notice.note && <span className="text-muted-foreground/70"> · {notice.note}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

export { TaskNotice }
