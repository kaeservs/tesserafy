/**
 * Points out of a streaming structured answer, each as soon as it is whole.
 *
 * The model's answer is JSON of a fixed shape, `{"points":[{…},{…}]}`, and
 * arrives a few characters at a time. Waiting for all of it is what made the
 * overlay's help feel slow: the first point is usually complete a second or
 * two before the last. This reads the stream as it comes and hands back each
 * point object the moment its closing brace arrives, so it can be checked
 * (its quote found in the call or a document) and shown.
 *
 * It only has to know JSON's structure, not the schema's: braces and brackets
 * nest, and inside a string — escapes included — nothing does. The finished
 * answer is still parsed and checked whole; this only makes it visible sooner.
 */
export class PointStream {
  private text = '';
  private scanned = 0;
  private depth = 0;
  private inString = false;
  private escaped = false;
  private start = -1;

  /** Feed the next piece; get back every point object completed by it. */
  push(piece: string): unknown[] {
    this.text += piece;
    const done: unknown[] = [];
    for (; this.scanned < this.text.length; this.scanned++) {
      const char = this.text[this.scanned];
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (char === '\\') this.escaped = true;
        else if (char === '"') this.inString = false;
        continue;
      }
      if (char === '"') {
        this.inString = true;
      } else if (char === '{' || char === '[') {
        // depth 1 is the answer, 2 the list of points, 3 a point.
        if (char === '{' && this.depth === 2) this.start = this.scanned;
        this.depth++;
      } else if (char === '}' || char === ']') {
        this.depth--;
        if (char === '}' && this.depth === 2 && this.start >= 0) {
          try {
            done.push(JSON.parse(this.text.slice(this.start, this.scanned + 1)));
          } catch {
            // Not a whole object after all; the final parse decides.
          }
          this.start = -1;
        }
      }
    }
    return done;
  }
}
