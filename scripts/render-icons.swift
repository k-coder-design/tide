// Tide Home Screen icons from build/icon.svg: 180 (apple-touch-icon), 192 and 512 px for the manifest.
// Run: swift scripts/render-icons.swift (drawn by the macOS system SVG engine, no third-party packages).
// iOS caches icons by URL: a new icon needs new file names.
import AppKit

let root = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : FileManager.default.currentDirectoryPath)
let svg = root.appendingPathComponent("build/icon.svg")
let outDir = root.appendingPathComponent("public/icons")
guard let image = NSImage(contentsOf: svg) else { fatalError("Cannot read \(svg.path)") }

for (size, name) in [(180, "apple-touch-icon-c.png"), (192, "icon-192-c.png"), (512, "icon-512-c.png")] {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
                             samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                             bytesPerRow: 0, bitsPerPixel: 0)!
  rep.size = NSSize(width: size, height: size)
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  NSGraphicsContext.current?.imageInterpolation = .high
  image.draw(in: NSRect(x: 0, y: 0, width: size, height: size))
  NSGraphicsContext.restoreGraphicsState()
  try! rep.representation(using: .png, properties: [:])!.write(to: outDir.appendingPathComponent(name))
  print("wrote \(name)")
}
