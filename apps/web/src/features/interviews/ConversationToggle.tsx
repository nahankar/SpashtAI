/** Display-only switch for the practice transcript; it never touches the room, microphone or saving. */
export function ConversationToggle({ checked, onChange, controls }: { checked: boolean; onChange: (next: boolean) => void; controls: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-controls={controls} onClick={() => onChange(!checked)}
    className="inline-flex items-center gap-2 rounded-md text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
    <span aria-hidden="true" className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-muted-foreground/40'}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </span>
    Show conversation
  </button>
}
