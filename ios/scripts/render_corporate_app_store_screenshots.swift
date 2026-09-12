#!/usr/bin/env swift

import AppKit
import Foundation

struct ScreenshotCard {
    let inputName: String
    let outputName: String
    let title: String
    let subtitle: String
}

let cards = [
    ScreenshotCard(
        inputName: "01-type-your-message.png",
        outputName: "01-write-your-message.png",
        title: "Write your message",
        subtitle: "Start with the words you want to send"
    ),
    ScreenshotCard(
        inputName: "02-choose-corporate.png",
        outputName: "02-choose-corporate.png",
        title: "Choose Corporate",
        subtitle: "Tap once for a polished, professional tone"
    ),
    ScreenshotCard(
        inputName: "03-review-the-rewrite.png",
        outputName: "03-review-the-rewrite.png",
        title: "Review the rewrite",
        subtitle: "See the suggestion before anything changes"
    ),
    ScreenshotCard(
        inputName: "04-send-with-confidence.png",
        outputName: "04-send-with-confidence.png",
        title: "Send with confidence",
        subtitle: "The rewrite fills your message field"
    )
]

guard CommandLine.arguments.count == 3 else {
    fputs("Usage: render_corporate_app_store_screenshots.swift RAW_DIR OUTPUT_DIR\n", stderr)
    exit(2)
}

let fileManager = FileManager.default
let rawDirectory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let outputDirectory = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
try fileManager.createDirectory(at: outputDirectory, withIntermediateDirectories: true)

let canvasWidth = 1_320
let canvasHeight = 2_868
let imageRect = NSRect(x: 130, y: 175, width: 1_060, height: 2_303)

let titleStyle: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 82, weight: .bold),
    .foregroundColor: NSColor(calibratedWhite: 0.05, alpha: 1),
    .paragraphStyle: {
        let style = NSMutableParagraphStyle()
        style.alignment = .center
        return style
    }()
]

let subtitleStyle: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 40, weight: .medium),
    .foregroundColor: NSColor(calibratedWhite: 0.42, alpha: 1),
    .paragraphStyle: {
        let style = NSMutableParagraphStyle()
        style.alignment = .center
        return style
    }()
]

for card in cards {
    let inputURL = rawDirectory.appendingPathComponent(card.inputName)
    guard let source = NSImage(contentsOf: inputURL) else {
        fputs("Could not load \(inputURL.path)\n", stderr)
        exit(3)
    }

    guard let bitmapContext = CGContext(
        data: nil,
        width: canvasWidth,
        height: canvasHeight,
        bitsPerComponent: 8,
        bytesPerRow: canvasWidth * 4,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
    ) else {
        fputs("Could not create output bitmap\n", stderr)
        exit(4)
    }
    let context = NSGraphicsContext(cgContext: bitmapContext, flipped: false)

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    NSColor.white.setFill()
    NSRect(x: 0, y: 0, width: canvasWidth, height: canvasHeight).fill()

    let titleRect = NSRect(x: 70, y: 2_625, width: 1_180, height: 110)
    let subtitleRect = NSRect(x: 80, y: 2_525, width: 1_160, height: 70)
    card.title.draw(in: titleRect, withAttributes: titleStyle)
    card.subtitle.draw(in: subtitleRect, withAttributes: subtitleStyle)

    let clipPath = NSBezierPath(roundedRect: imageRect, xRadius: 38, yRadius: 38)
    NSGraphicsContext.saveGraphicsState()
    clipPath.addClip()
    source.draw(
        in: imageRect,
        from: .zero,
        operation: .copy,
        fraction: 1,
        respectFlipped: false,
        hints: [.interpolation: NSImageInterpolation.high]
    )
    NSGraphicsContext.restoreGraphicsState()

    NSColor(calibratedWhite: 0.86, alpha: 1).setStroke()
    clipPath.lineWidth = 2
    clipPath.stroke()
    context.flushGraphics()
    NSGraphicsContext.restoreGraphicsState()

    guard let renderedImage = bitmapContext.makeImage() else {
        fputs("Could not finalize \(card.outputName)\n", stderr)
        exit(5)
    }
    let bitmap = NSBitmapImageRep(cgImage: renderedImage)
    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        fputs("Could not encode \(card.outputName)\n", stderr)
        exit(6)
    }
    let outputURL = outputDirectory.appendingPathComponent(card.outputName)
    try png.write(to: outputURL, options: .atomic)
    print("Wrote \(outputURL.path)")
}
