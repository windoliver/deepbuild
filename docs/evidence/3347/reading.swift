// #3347: how many of a clip's frames hold one hand with 21 points, by the request #1186 names for its macOS backend,
// Vision's hand pose, at most two hands a frame. It is not #1186's backend, which doesn't exist yet, so no test reads it.
//   swift docs/evidence/3347/reading.swift <clip>
import AVFoundation
import Vision

let asset = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[1]))
guard let track = try await asset.loadTracks(withMediaType: .video).first else { fatalError("no video track") }
let reader = try AVAssetReader(asset: asset)
let output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
reader.add(output)
reader.startReading()
var frames = 0, held = 0, right = 0
while let sample = output.copyNextSampleBuffer() {
    guard let picture = CMSampleBufferGetImageBuffer(sample) else { continue }
    frames += 1
    let request = VNDetectHumanHandPoseRequest()
    request.maximumHandCount = 2
    try VNImageRequestHandler(cvPixelBuffer: picture).perform([request])
    guard let hands = request.results, hands.count == 1 else { continue }
    // A point Vision doesn't find has confidence 0.
    guard try hands[0].recognizedPoints(.all).values.filter({ $0.confidence > 0 }).count == 21 else { continue }
    held += 1
    if hands[0].chirality == .right { right += 1 }
}
guard reader.status == .completed, frames > 0 else { fatalError("the clip wasn't read to its end") }
print("one hand with 21 points in \(Double(held) / Double(frames)) of \(frames) frames, a right hand in \(right)")
