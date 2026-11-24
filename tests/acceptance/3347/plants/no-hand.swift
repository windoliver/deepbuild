#!/usr/bin/env swift
// Draws the planted clip with no hand in it: 60 frames at 1280 by 720 and 30 a second, a plain wall whose light moves
// slowly, with a 64 by 64 block of a fixed colour pattern in one corner. `no-hand.swift <path to write>`
import AVFoundation
import CoreGraphics

let out = URL(fileURLWithPath: CommandLine.arguments[1])
let (width, height, frames) = (1280, 720, 60)
try? FileManager.default.removeItem(at: out)
let writer = try AVAssetWriter(outputURL: out, fileType: .mov)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height])
let pixels = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: nil)
writer.add(input)
guard writer.startWriting() else { fatalError("\(String(describing: writer.error))") }
writer.startSession(atSourceTime: .zero)

var frame = 0
let done = DispatchSemaphore(value: 0)
input.requestMediaDataWhenReady(on: DispatchQueue(label: "no-hand")) {
  while input.isReadyForMoreMediaData && frame < frames {
    var buffer: CVPixelBuffer?
    CVPixelBufferCreate(nil, width, height, kCVPixelFormatType_32BGRA, [kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary] as CFDictionary, &buffer)
    CVPixelBufferLockBaseAddress(buffer!, [])
    let context = CGContext(data: CVPixelBufferGetBaseAddress(buffer!), width: width, height: height, bitsPerComponent: 8,
      bytesPerRow: CVPixelBufferGetBytesPerRow(buffer!), space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
    for column in 0..<64 {
      let light = 0.55 + 0.1 * CGFloat(column) / 64 + 0.05 * CGFloat(frame) / CGFloat(frames)
      context.setFillColor(CGColor(red: light, green: light * 0.96, blue: light * 0.9, alpha: 1))
      context.fill(CGRect(x: column * 20, y: 0, width: 20, height: height))
    }
    for cell in 0..<16 {
      context.setFillColor(CGColor(red: cell % 2 == 0 ? 1 : 0, green: cell % 3 == 0 ? 1 : 0, blue: cell % 4 < 2 ? 1 : 0, alpha: 1))
      context.fill(CGRect(x: (cell % 4) * 16, y: (cell / 4) * 16, width: 16, height: 16))
    }
    CVPixelBufferUnlockBaseAddress(buffer!, [])
    pixels.append(buffer!, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: 30))
    frame += 1
  }
  if frame == frames {
    input.markAsFinished()
    writer.finishWriting { done.signal() }
  }
}
done.wait()
guard writer.status == .completed else { fatalError("\(String(describing: writer.error))") }
