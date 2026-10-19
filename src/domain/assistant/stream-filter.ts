// Keeps the model's internal markers ("[INTENT: tool_call]", "[tool: x]") off
// the screen while the answer streams. Text goes through unchanged, except that
// from a "[" on it is held back until the bracket closes (then a marker is
// dropped and anything else released), a newline arrives, or it is too long to
// be a marker.

export const INTERNAL_MARKER = /\[(?:INTENT|PLAN|THOUGHT|TOOL(?:_CALL)?)\b[^\]\n]*\]/gi;
// Longest marker we have seen is ~30 characters.
const HOLD_MAX = 60;

export class MarkerFilter {
  private held = '';

  // The part of `delta` that can be shown now.
  push(delta: string): string {
    let text = this.held + delta;
    this.held = '';
    text = text.replace(INTERNAL_MARKER, '');
    const open = text.lastIndexOf('[');
    if (open !== -1 && !text.includes(']', open) && !text.includes('\n', open) && text.length - open <= HOLD_MAX) {
      this.held = text.slice(open);
      text = text.slice(0, open);
    }
    return text;
  }

  // The turn's text ended: whatever was held was not a marker.
  flush(): string {
    const rest = this.held.replace(INTERNAL_MARKER, '');
    this.held = '';
    return rest;
  }
}
