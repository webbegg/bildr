/**
 * Where the canvas puts a box's type label: above the box, or inside it
 * (top-left, inset) when the box starts too close to the frame top for the
 * label to show above it, which the frame would clip. Both values are canvas
 * pixels from the frame top; at a zoom below 100% the label is taller in
 * canvas pixels, since it keeps its screen size.
 */
export function labelPlacement(rectTop: number, labelHeight: number): 'above' | 'inside' {
  return rectTop < labelHeight ? 'inside' : 'above'
}
